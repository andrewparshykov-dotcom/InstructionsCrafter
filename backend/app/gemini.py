"""One-call video -> step-by-step document generation with Gemini.

A single Gemini call watches the screen recording (video + audio) and returns a
task-oriented introduction plus a list of steps. Each step carries its narration
time span, an imperative-voice instruction, a caption, and -- via an
``anchor_source`` -- the moment to screenshot:
- "click": a physical click the extension captured (precise timestamp + label),
- "voice": the instant the narrator said a cue word ("screenshot" / "скріншот"
  / "скриншот") -- used where a click could not be captured, or to override one,
- "auto":  Gemini's own best-moment pick when neither applies.

A spoken cue takes priority over a click for the same step. The captured click
list and the spoken cue are handled in ONE pass, so a single recording can mix
both (clicks for most steps, a spoken cue for the few a click can't reach -- an
embedded frame, a blocked page, a desktop app).

The screenshot JPEGs are extracted downstream (pipeline.py) at the chosen
timestamp -- biased slightly earlier so a fast control can't swap the screen
first -- at native resolution.

Perception fps is low (1 fps by default, which is also Gemini's own default
sampling rate): the anchors, not high-fps frame-watching, carry the timing
precision, and 1 fps keeps token cost ~10x lower.

Runs synchronously; the async pipeline calls it via ``asyncio.to_thread``.
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

DEFAULT_MODEL = "gemini-3.5-flash"

# Seconds to wait for Gemini's File API to finish ingesting the upload.
UPLOAD_PROCESS_TIMEOUT_SECONDS = 300
UPLOAD_POLL_INTERVAL_SECONDS = 3

# --- Perception frame rate (the fps Gemini samples the video at) ----------
# One fps for every recording. 1 fps is Gemini's own default video sampling rate
# and is plenty here: click and voice anchors carry the timing precision, and
# the screenshots themselves are extracted full-resolution by ffmpeg downstream.
# Override via the PERCEPTION_FPS env var. _target_fps() can throttle even lower
# for very long videos to stay within the token budget; it never goes higher.
PERCEPTION_FPS = float(os.getenv("PERCEPTION_FPS", "1.0"))
PERCEPTION_TARGET_TOKENS = 600_000
# Verified for Gemini 3 video frames: LOW/MEDIUM = 70, HIGH = 280 per frame.
# This matches PERCEPTION_MEDIA_RESOLUTION below; keep them in sync.
PERCEPTION_TOKENS_PER_FRAME = 280
PERCEPTION_FPS_MIN = 0.2
PERCEPTION_FPS_DEFAULT = 1.0  # used only if the duration probe fails

# High resolution so Gemini can read fine on-screen text. (Final screenshots are
# extracted by ffmpeg at native resolution downstream, so this does not affect
# their quality -- only how clearly Gemini perceives the video.)
PERCEPTION_MEDIA_RESOLUTION = types.MediaResolution.MEDIA_RESOLUTION_HIGH


PROMPT_TEMPLATE = """\
You convert a screen recording with voice narration into a step-by-step
how-to document. Work ONLY from what you can see and hear in this video. Do
not invent anything that is not shown or said.

Write the entire document -- the introduction, every instruction, and every
caption -- in clear, grammatically correct English, regardless of the language
the narrator speaks (often Ukrainian or Russian): translate as needed, and fix
grammar and phrasing, including when the narration is already in English. Keep
any on-screen text and control labels exactly as they appear on screen (do not
translate those), so the reader can match them to what they see.

{clicks_section}\
The narrator may also say a CUE WORD out loud to mark the exact moment they want
captured for a step -- "screenshot", "скріншот", or "скриншот" (the same word in
English, Ukrainian, and Russian; also accept an obvious inflected form of it).
They typically perform an action and then say it -- often when a click could not
be captured. Treat a cue word purely as a marker command -- NEVER write it into
the instruction or caption. A spoken cue ALWAYS takes priority over a matching
click when choosing the step's screenshot moment.

Return a JSON object with two keys: "introduction" and "steps".

INTRODUCTION
- ONE sentence stating what this document helps the reader accomplish (its
overall purpose), in task-oriented voice ("This guide walks through..."). Do
NOT write "I will show you...", "You will learn...", or "In this video...", and
do NOT restate or list the individual steps -- the steps section covers those.
- Ground it strictly in the narration. If you cannot confidently determine the
subject, return an empty string.

STEPS -- one object per action. A step is a SINGLE action the reader performs --
typically one click, selection, or entry. Split distinct actions into separate
steps: "open the Settings menu" is one step and "choose Account" is the next,
even if the narrator described both in one breath. Do NOT, however, split a
single action's narration into pieces -- the explanation, the "why", a pause, or
a description of what is on screen all stay attached to that action's step
(never make an explanation a step of its own). Skip pure end-filler like "and
that's all".

Each step object must have:
- "start_time" and "end_time" (numbers, seconds): the precise span of THIS
step's narration, taken from the audio.
- "voice_cued" (boolean): true if the narrator said a cue word to mark this
step's moment. Set this true whenever they said the cue word, EVEN IF the step
also matches a listed click.
- "click_index" (integer): if this step performs one of the captured clicks
listed above, its NUMBER (use the one whose time falls within this step's
narration and whose label matches what the step is about); otherwise -1. This
is ignored when voice_cued is true.
- "screenshot_time" (number, seconds): the moment to capture when no click is
used. If voice_cued, set it to the instant the narrator says the cue word;
otherwise set it to the moment the step's action or result is most clearly and
completely shown on screen.
- "instruction" (string): imperative voice ("Click X", not "I click X" or "you
need to click X"). When the step uses a listed click, name the control using its
LABEL so the wording is exact. Preserve ALL the explanatory detail the narrator
gave -- if they explained why, keep the why; if they described what is on screen
or gave context, warnings, or tips, keep those too. There is NO length limit:
use as many sentences as the narration warrants, so a richly-explained step
produces a rich, multi-sentence instruction rather than a one-line summary.
Strip only filler ("um", "okay", "as you can see") and never include a cue word.
Do not number the step.
- "caption" (string): one sentence, under 25 words, describing what is visible
on screen at the chosen moment.\
"""


class _GeminiStep(BaseModel):
    start_time: float
    end_time: float
    voice_cued: bool  # narrator said a cue word to mark this step's moment
    click_index: int  # captured-click number, or -1; ignored when voice_cued
    screenshot_time: float  # moment to capture when no click is used
    instruction: str
    caption: str


class _GeminiDoc(BaseModel):
    introduction: str
    steps: list[_GeminiStep]


def _format_clicks(clicks: list[dict]) -> str:
    """Render the click list as a numbered block for the prompt."""
    lines = []
    for i, c in enumerate(clicks):
        label = (c.get("label") or "").strip()
        if label:
            desc = f'"{label}"'
        else:
            desc = f"<{c.get('role') or c.get('tag') or 'element'}>"
        lines.append(f"{i}: {float(c['t']):.2f}s -- {desc}")
    return "\n".join(lines)


def _clicks_section(clicks: list[dict]) -> str:
    """Build the prompt's click-list paragraph (or a no-clicks note)."""
    if not clicks:
        return (
            "No mouse clicks were captured for this recording, so set "
            '"click_index" to -1 for every step.\n\n'
        )
    return (
        "Some of the steps were captured as physical mouse clicks. Each has a "
        "NUMBER, a TIME in seconds from the start of the video, and the on-screen "
        "LABEL of the control clicked. These timings are ground truth, but the "
        "list can be INCOMPLETE -- clicks inside embedded frames or on certain "
        "pages are not captured, and the narrator may mark those moments with a "
        "spoken cue word instead:\n\n" + _format_clicks(clicks) + "\n\n"
    )


def _target_fps(video_duration: float | None) -> float:
    """Pick a perception fps that keeps the video within the token budget.

    Returns the budget-allowed fps; the caller caps it at PERCEPTION_FPS, so in
    practice this only matters when a very long video forces fps BELOW 1.
    """
    if not video_duration or video_duration <= 0:
        return PERCEPTION_FPS_DEFAULT
    fps = PERCEPTION_TARGET_TOKENS / (video_duration * PERCEPTION_TOKENS_PER_FRAME)
    return max(PERCEPTION_FPS_MIN, fps)


def _video_part(uploaded: Any, fps: float) -> types.Part:
    """Build the video content part with a custom sampling frame rate."""
    return types.Part(
        file_data=types.FileData(
            file_uri=uploaded.uri, mime_type=uploaded.mime_type
        ),
        video_metadata=types.VideoMetadata(fps=fps),
    )


def generate_document(
    video_path: Path,
    request_id: str,
    video_duration: float | None = None,
    clicks: list[dict] | None = None,
) -> dict[str, Any]:
    """Run the single Gemini video call.

    One unified pass: Gemini is given the captured click list (if any) AND told
    to listen for a spoken cue word, then chooses, per step, the screenshot
    anchor -- a spoken cue (wins), else a captured click, else its own best
    moment. ``clicks`` is the extension's click log (list of {t, label, role,
    tag}); it may be empty (desktop recordings, or web where capture failed).

    Returns ``{"introduction": str, "steps": list[dict]}`` where each step dict
    has start_time, end_time, click_time (float or None), anchor_source
    ("click" | "voice" | "auto"), instruction, and caption. Synchronous -- call
    via ``asyncio.to_thread`` from the async pipeline.

    Raises HTTPException on missing key, upload/processing failure, rate
    limits, or an unparseable response.
    """
    clicks = clicks or []
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Gemini API key is not configured on the server",
        )
    model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL)

    client = genai.Client(api_key=api_key)

    # 1) Upload the video and wait for the File API to finish processing it.
    try:
        uploaded = client.files.upload(file=str(video_path))
    except genai_errors.APIError as exc:
        print(f"[{request_id}] gemini upload error: {exc!r}", file=sys.stderr)
        raise HTTPException(
            status_code=502, detail="Failed to upload video to Gemini"
        )

    try:
        started = time.time()
        while True:
            state = getattr(uploaded.state, "name", str(uploaded.state))
            if state == "ACTIVE":
                break
            if state == "FAILED":
                raise HTTPException(
                    status_code=400,
                    detail="Gemini could not process this video",
                )
            if time.time() - started > UPLOAD_PROCESS_TIMEOUT_SECONDS:
                raise HTTPException(
                    status_code=504,
                    detail="Gemini video processing timed out",
                )
            time.sleep(UPLOAD_POLL_INTERVAL_SECONDS)
            uploaded = client.files.get(name=uploaded.name)

        # 2) One generation call: video sampled at a low fps (anchors carry the
        #    precision), high media resolution, high thinking, JSON schema.
        fps = min(_target_fps(video_duration), PERCEPTION_FPS)
        prompt = PROMPT_TEMPLATE.format(clicks_section=_clicks_section(clicks))
        print(
            f"[{request_id}] gemini: fps={fps:.2f} (duration={video_duration}) "
            f"clicks={len(clicks)}"
        )
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_GeminiDoc,
            media_resolution=PERCEPTION_MEDIA_RESOLUTION,
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.HIGH
            ),
        )
        try:
            response = client.models.generate_content(
                model=model,
                contents=[_video_part(uploaded, fps), prompt],
                config=config,
            )
        except genai_errors.APIError as exc:
            code = getattr(exc, "code", None)
            if code == 429 or "RESOURCE_EXHAUSTED" in str(exc):
                raise HTTPException(
                    status_code=429,
                    detail=(
                        "Gemini rate limit reached (free tier allows 20 "
                        "requests/day). Try again later or enable billing."
                    ),
                )
            print(
                f"[{request_id}] gemini generate error: {exc!r}",
                file=sys.stderr,
            )
            raise HTTPException(status_code=502, detail="Gemini request failed")
    finally:
        # Always remove the uploaded video from Gemini's servers (no
        # long-term storage, per the project's data policy).
        try:
            client.files.delete(name=uploaded.name)
        except Exception:
            pass

    # 3) Parse + validate. Prefer the SDK's schema-parsed object; fall back to
    #    parsing the raw JSON text if needed.
    doc = getattr(response, "parsed", None)
    if not isinstance(doc, _GeminiDoc):
        raw = getattr(response, "text", None)
        if not raw:
            raise HTTPException(
                status_code=502, detail="Gemini returned an empty response"
            )
        try:
            doc = _GeminiDoc.model_validate_json(raw)
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            print(
                f"[{request_id}] gemini response parse failed: {exc!r}",
                file=sys.stderr,
            )
            raise HTTPException(
                status_code=502,
                detail="Gemini returned an unexpected response",
            )

    # 4) Normalize to a uniform step dict the pipeline understands: a click_time
    #    (float or None) plus an anchor_source telling the pipeline how to
    #    trust/extract it. Priority is voice -> click -> auto (a spoken cue wins
    #    over a matching click):
    #      "voice" -> narrator said a cue word (authoritative, larger lead)
    #      "click" -> a real recorded web click (authoritative, small lead)
    #      "auto"  -> Gemini's own guess from the video (window-checked, no lead)
    steps: list[dict[str, Any]] = []
    counts = {"voice": 0, "click": 0, "auto": 0}
    for s in doc.steps:
        if s.voice_cued:
            click_time = s.screenshot_time
            anchor_source = "voice"
        elif 0 <= s.click_index < len(clicks):
            click_time = float(clicks[s.click_index]["t"])
            anchor_source = "click"
        else:
            click_time = s.screenshot_time
            anchor_source = "auto"
        counts[anchor_source] += 1
        steps.append(
            {
                "start_time": s.start_time,
                "end_time": s.end_time,
                "click_time": click_time,
                "anchor_source": anchor_source,
                "instruction": s.instruction,
                "caption": s.caption,
            }
        )

    print(
        f"[{request_id}] gemini: {len(steps)} steps, model={model}, "
        f"anchors: voice={counts['voice']} click={counts['click']} "
        f"auto={counts['auto']}"
    )
    return {"introduction": doc.introduction.strip(), "steps": steps}
