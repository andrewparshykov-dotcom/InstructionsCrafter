"""One-call video -> step-by-step document generation with Gemini.

Replaces the former Groq-transcribe -> GPT-segment -> GPT-polish chain. A
single Gemini call watches the screen recording (video + audio) and returns a
task-oriented introduction plus a list of steps, each with an imperative-voice
instruction and a caption, anchored to the step's narration time span.

The screenshot for each step is chosen downstream (see pipeline.py) by
sampling that step's narration window with FFmpeg — Gemini proved unreliable
at naming a single exact screenshot timestamp, but it identifies the narration
span of each step accurately, so we sample within that span instead.

Runs synchronously (uploads a file, polls, then one blocking generate call);
the async pipeline calls it via ``asyncio.to_thread`` so it never blocks the
event loop.
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

# gemini-3.5-flash: natively multimodal, strong on the multimodal benchmarks
# this task depends on, and free-tier eligible. Overridable via env for easy
# A/B testing or a later move to a paid model.
DEFAULT_MODEL = "gemini-3.5-flash"

# Seconds to wait for Gemini's File API to finish ingesting the upload before
# giving up. A few-minute screen recording usually processes in seconds.
UPLOAD_PROCESS_TIMEOUT_SECONDS = 300
UPLOAD_POLL_INTERVAL_SECONDS = 3


PROMPT = """\
You convert a screen recording with voice narration into a step-by-step
how-to document. Work ONLY from what you can see and hear in this video. Do
not invent anything that is not shown or said.

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
into its own step. Skip pure end-filler like "and that's all" or "thanks for
watching".

Each step object must have:
- "start_time" and "end_time" (numbers, seconds): the precise span of THIS
step's narration, taken from the audio. Be accurate -- the screenshot for the
step is chosen from within this window, so loose or guessed times produce the
wrong screenshot. start_time is when the narrator begins describing this step;
end_time is when they move on to the next step.
- "instruction" (string): imperative voice ("Click X", not "I click X" or
"you need to click X"). Preserve useful detail the narrator gave -- if they
explained WHY, keep the why. Strip filler ("um", "okay", "as you can see").
Do not number the step.
- "caption" (string): one sentence, under 25 words, describing what is
visible on screen while this step is being performed.\
"""


class _GeminiStep(BaseModel):
    start_time: float
    end_time: float
    instruction: str
    caption: str


class _GeminiDoc(BaseModel):
    introduction: str
    steps: list[_GeminiStep]


def generate_document(video_path: Path, request_id: str) -> dict[str, Any]:
    """Run the single Gemini video call.

    Returns ``{"introduction": str, "steps": list[dict]}`` where each step
    dict has start_time, end_time, instruction, and caption. Synchronous --
    call via ``asyncio.to_thread`` from the async pipeline.

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

        # 2) One generation call, constrained to our JSON schema.
        try:
            response = client.models.generate_content(
                model=model,
                contents=[uploaded, PROMPT],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=_GeminiDoc,
                ),
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
