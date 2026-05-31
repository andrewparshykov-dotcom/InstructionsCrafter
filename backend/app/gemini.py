"""One-call video -> step-by-step document generation with Gemini.

A single Gemini call watches the screen recording (video + audio) and returns a
task-oriented introduction plus a list of steps. Each step carries its
narration time span, the timestamp of its click (located via the recorder's
red click-highlight ring), an imperative-voice instruction, and a caption.

Precision knobs (we optimize for accuracy, not cost):
- Dynamic perception fps: Gemini samples the video at a frame rate computed
  from the video's length so the frames stay within a safe token budget --
  short clips get a high fps (fine temporal detail), long clips a lower one.
  The exact per-frame cost is known (HIGH res = 280 tokens/frame on Gemini 3),
  so the budget math is exact, not estimated.
- High media resolution: lets Gemini read fine on-screen text. (It does NOT
  change the final screenshot quality -- those are extracted by ffmpeg at
  native resolution downstream.)
- High thinking level: helps segmentation and judgment.

The screenshot JPEGs are extracted downstream (see pipeline.py) at each step's
click timestamp, so the chosen frame is the cursor-on-control instant.

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
# tokens ~= duration * fps * tokens_per_frame, so to keep the video within a
# safe slice of the ~1M-token context window we derive fps from the duration
# and clamp it. Short clips get the high ceiling (fine temporal detail to
# catch the brief red click-ring); long clips are throttled down.
PERCEPTION_TARGET_TOKENS = 600_000
# Verified for Gemini 3 video frames: LOW/MEDIUM = 70, HIGH = 280 per frame.
# This matches PERCEPTION_MEDIA_RESOLUTION below; keep them in sync.
PERCEPTION_TOKENS_PER_FRAME = 280
PERCEPTION_FPS_MIN = 0.2
PERCEPTION_FPS_MAX = 10.0
PERCEPTION_FPS_DEFAULT = 2.0  # used only if the duration probe fails

# Marker mode (a click log was supplied) gets its screenshot precision from the
# recorded click timestamps, NOT from watching the video, so it runs at a very
# low perception fps -- enough for Gemini to follow the flow and write captions,
# while cutting video tokens roughly 10x vs auto mode. (A ~1-minute clip at
# 10 fps is ~145k tokens; at 1 fps it is ~15k.) Auto mode keeps the dynamic
# high fps it needs to spot the red click-ring itself. Override via env if a
# longer/denser recording ever needs more temporal detail.
MARKER_PERCEPTION_FPS = float(os.getenv("MARKER_FPS", "1.0"))

# Auto mode (no click log -- desktop, or web where click capture failed) also
# runs at 1 fps. The "screenshot" voice cue is audio-based (fps-independent),
# and 1 fps is Gemini's own default video sampling rate -- plenty for captions
# and for the automatic moment-pick on any uncued step, while keeping tokens low
# and removing the old high-fps cost risk. Override via the AUTO_FPS env var.
AUTO_PERCEPTION_FPS = float(os.getenv("AUTO_FPS", "1.0"))

# High resolution so Gemini can read fine on-screen text and clearly see the
# red click-highlight ring. (Final screenshots are native-quality regardless.)
PERCEPTION_MEDIA_RESOLUTION = types.MediaResolution.MEDIA_RESOLUTION_HIGH


PROMPT = """\
You convert a screen recording with voice narration into a step-by-step
how-to document. Work ONLY from what you can see and hear in this video. Do
not invent anything that is not shown or said.

The narrator may say a CUE WORD out loud to mark the exact moment they want
captured for the step they are describing -- "screenshot", "скріншот", or
"скриншот" (the same word in English, Ukrainian, and Russian; also accept an
obvious inflected form of it). They typically perform an action and then say
it. Treat a cue word purely as a marker command -- NEVER write it into the
instruction or caption.

Return a JSON object with two keys: "introduction" and "steps".

INTRODUCTION
- 3-4 sentences summarizing what the whole guide accomplishes, in
task-oriented voice ("This guide walks through..."). Do NOT write "I will
show you...", "You will learn...", or "In this video...".
- Ground it strictly in the narration. If you cannot confidently determine
the subject, return an empty string.

STEPS -- one object per logical step. A step is ONE action a reader would
perform (for example, "open the settings menu and choose Account"), even if the
narrator pauses or explains across several sentences. Keep an explanation that
belongs to a step together with that step; do not split it into its own step.
Skip pure end-filler like "and that's all".

Each step object must have:
- "start_time" and "end_time" (numbers, seconds): the precise span of THIS
step's narration, taken from the audio.
- "voice_cued" (boolean): true if the narrator said a cue word to mark this
step's moment, false otherwise.
- "screenshot_time" (number, seconds): the moment to capture for this step.
  If voice_cued is true, set it to the instant the narrator says the cue word.
  If voice_cued is false, set it to the moment the step's action or result is
  most clearly and completely shown on screen.
- "instruction" (string): imperative voice ("Click X", not "I click X" or "you
need to click X"). Preserve useful detail the narrator gave -- if they
explained WHY, keep the why. Strip filler ("um", "okay", "as you can see") and
never include a cue word. Do not number the step.
- "caption" (string): one sentence, under 25 words, describing what is visible
on screen at the screenshot_time moment.\
"""


# Marker mode: the extension already captured exactly when/what the user
# clicked, so we hand Gemini that list and it only maps each step to a click
# NUMBER. The click's timestamp (from the recorder) is authoritative, which
# removes the screenshot-overshoot problem and lets us run at a low fps.
MARKER_PROMPT_TEMPLATE = """\
You convert a screen recording with voice narration into a step-by-step
how-to document. Work ONLY from what you can see and hear in this video. Do
not invent anything that is not shown or said.

You are given the exact list of mouse clicks the user made during the
recording. Each click has a NUMBER, a TIME in seconds from the start of the
video, and the on-screen LABEL of the control that was clicked:

{clicks}

These clicks are ground truth -- they tell you precisely when and what the
user clicked. Use them instead of guessing from the video.

Return a JSON object with two keys: "introduction" and "steps".

INTRODUCTION
- 3-4 sentences summarizing what the whole guide accomplishes, in
task-oriented voice ("This guide walks through..."). Do NOT write "I will
show you...", "You will learn...", or "In this video...".
- Ground it strictly in the narration. If you cannot confidently determine
the subject, return an empty string.

STEPS -- one object per logical step. A step is ONE action a reader would
perform (for example, "open the bookmarks bar and click the RLI bookmark"),
even if the narrator pauses or explains across several sentences. Keep an
explanation that belongs to a step together with that step; do not split it
into its own step. Skip pure end-filler like "and that's all".

Each step object must have:
- "start_time" and "end_time" (numbers, seconds): the precise span of THIS
step's narration, taken from the audio.
- "click_index" (integer): the NUMBER of the click (from the list above) that
this step performs -- the one whose time falls within this step's narration
and whose label matches what the step is about. If the step only observes or
explains something on screen and performs none of the listed clicks, set
click_index to -1.
- "instruction" (string): imperative voice ("Click X", not "I click X" or "you
need to click X"). When the step has a click, name the control using its LABEL
from the list above so the wording is exact. Preserve useful detail the
narrator gave -- if they explained WHY, keep the why. Strip filler ("um",
"okay", "as you can see"). Do not number the step.
- "caption" (string): one sentence, under 25 words, describing what is visible
on screen when the step's action happens.\
"""


class _GeminiStep(BaseModel):
    start_time: float
    end_time: float
    voice_cued: bool  # narrator said "screenshot" to mark this step's moment
    screenshot_time: float
    instruction: str
    caption: str


class _GeminiDoc(BaseModel):
    introduction: str
    steps: list[_GeminiStep]


class _GeminiStepMarker(BaseModel):
    start_time: float
    end_time: float
    click_index: int  # index into the supplied click list; -1 = no click
    instruction: str
    caption: str


class _GeminiDocMarker(BaseModel):
    introduction: str
    steps: list[_GeminiStepMarker]


def _format_clicks(clicks: list[dict]) -> str:
    """Render the click list as a numbered block for the marker prompt."""
    lines = []
    for i, c in enumerate(clicks):
        label = (c.get("label") or "").strip()
        if label:
            desc = f'"{label}"'
        else:
            desc = f"<{c.get('role') or c.get('tag') or 'element'}>"
        lines.append(f"{i}: {float(c['t']):.2f}s -- {desc}")
    return "\n".join(lines)


def _target_fps(video_duration: float | None) -> float:
    """Pick a perception fps that keeps the video within the token budget."""
    if not video_duration or video_duration <= 0:
        return PERCEPTION_FPS_DEFAULT
    fps = PERCEPTION_TARGET_TOKENS / (video_duration * PERCEPTION_TOKENS_PER_FRAME)
    return max(PERCEPTION_FPS_MIN, min(PERCEPTION_FPS_MAX, fps))


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

    Two modes, chosen by whether a click log was supplied:
    - **marker mode** (``clicks`` non-empty): the extension already captured
      exactly when/what the user clicked. Gemini is given that list and only
      maps each step to a click NUMBER; the click's recorder timestamp is
      authoritative, so screenshots land precisely and we can run a low fps.
    - **auto mode** (no ``clicks`` -- e.g. desktop recordings): the narrator can
      say "screenshot" to mark a step's moment; Gemini reports that time and a
      voice_cued flag, falling back to its own best-moment pick for uncued steps.

    Returns ``{"introduction": str, "steps": list[dict]}`` where each step dict
    has start_time, end_time, click_time (float or None), anchor_source
    ("click" | "voice" | "auto"), instruction, and caption. Synchronous -- call
    via ``asyncio.to_thread`` from the async pipeline.

    Raises HTTPException on missing key, upload/processing failure, rate
    limits, or an unparseable response.
    """
    clicks = clicks or []
    marker_mode = bool(clicks)
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

        # 2) One generation call: video sampled at a length-aware fps, high
        #    media resolution, high thinking, constrained to our JSON schema.
        fps = _target_fps(video_duration)
        if marker_mode:
            # Markers carry the precision; drop fps low to save tokens. min()
            # keeps the budget-based throttle for very long recordings.
            fps = min(fps, MARKER_PERCEPTION_FPS)
            prompt = MARKER_PROMPT_TEMPLATE.format(clicks=_format_clicks(clicks))
            schema = _GeminiDocMarker
        else:
            fps = min(fps, AUTO_PERCEPTION_FPS)
            prompt = PROMPT
            schema = _GeminiDoc
        print(
            f"[{request_id}] gemini: fps={fps:.2f} (duration={video_duration}) "
            f"mode={'marker' if marker_mode else 'auto'} clicks={len(clicks)}"
        )
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
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
    if not isinstance(doc, schema):
        raw = getattr(response, "text", None)
        if not raw:
            raise HTTPException(
                status_code=502, detail="Gemini returned an empty response"
            )
        try:
            doc = schema.model_validate_json(raw)
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            print(
                f"[{request_id}] gemini response parse failed: {exc!r}",
                file=sys.stderr,
            )
            raise HTTPException(
                status_code=502,
                detail="Gemini returned an unexpected response",
            )

    # 4) Normalize both modes to a uniform step dict the pipeline understands:
    #    a click_time (float or None) plus an anchor_source telling the pipeline
    #    how to trust/extract it:
    #      "click" -> a real recorded web click (authoritative, small lead)
    #      "voice" -> the narrator said "screenshot" (authoritative, bigger lead)
    #      "auto"  -> Gemini's own guess from the video (window-checked, no lead)
    steps: list[dict[str, Any]] = []
    for s in doc.steps:
        if marker_mode:
            idx = s.click_index
            if 0 <= idx < len(clicks):
                click_time = float(clicks[idx]["t"])
                anchor_source = "click"
            else:
                click_time = None
                anchor_source = "auto"
        else:
            click_time = s.screenshot_time
            anchor_source = "voice" if s.voice_cued else "auto"
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
        f"mode={'marker' if marker_mode else 'auto'}"
    )
    return {"introduction": doc.introduction.strip(), "steps": steps}
