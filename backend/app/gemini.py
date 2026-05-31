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

# High resolution so Gemini can read fine on-screen text and clearly see the
# red click-highlight ring. (Final screenshots are native-quality regardless.)
PERCEPTION_MEDIA_RESOLUTION = types.MediaResolution.MEDIA_RESOLUTION_HIGH


PROMPT = """\
You convert a screen recording with voice narration into a step-by-step
how-to document. Work ONLY from what you can see and hear in this video. Do
not invent anything that is not shown or said.

The recording highlights the mouse cursor, and draws a brief RED RING around
the cursor at the exact instant of each physical left-click. Use that red ring
to pinpoint when and where clicks happen.

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
- "click_time" (number, seconds): the exact moment the user clicks the control
this step is about -- identified by the RED RING appearing around the cursor on
that control. Be precise. If a step has no click (it only observes or explains
something on screen), set click_time to the moment the relevant screen is most
clearly and completely shown.
- "instruction" (string): imperative voice ("Click X", not "I click X" or "you
need to click X"). Preserve useful detail the narrator gave -- if they
explained WHY, keep the why. Strip filler ("um", "okay", "as you can see").
Do not number the step.
- "caption" (string): one sentence, under 25 words, describing what is visible
on screen at the click_time moment.\
"""


class _GeminiStep(BaseModel):
    start_time: float
    end_time: float
    click_time: float
    instruction: str
    caption: str


class _GeminiDoc(BaseModel):
    introduction: str
    steps: list[_GeminiStep]


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
) -> dict[str, Any]:
    """Run the single Gemini video call.

    Returns ``{"introduction": str, "steps": list[dict]}`` where each step dict
    has start_time, end_time, click_time, instruction, and caption.
    Synchronous -- call via ``asyncio.to_thread`` from the async pipeline.

    Raises HTTPException on missing key, upload/processing failure, rate
    limits, or an unparseable response.
    """
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
        print(f"[{request_id}] gemini: fps={fps:.2f} (duration={video_duration})")
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
                contents=[_video_part(uploaded, fps), PROMPT],
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

    steps = [s.model_dump() for s in doc.steps]
    print(f"[{request_id}] gemini: {len(steps)} steps, model={model}")
    return {"introduction": doc.introduction.strip(), "steps": steps}
