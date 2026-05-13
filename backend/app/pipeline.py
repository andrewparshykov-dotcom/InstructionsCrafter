"""End-to-end processing pipeline for /api/generate.

Connects the per-step modules (audio extraction, Whisper transcription,
segmentation, screenshot extraction + resizing, GPT-4o mini polishing,
document rendering) into a single async function.

Workdir lifecycle is owned by the caller (the route handler) so cleanup
can run via FastAPI's BackgroundTasks AFTER the FileResponse is sent.
"""

import asyncio
import os
import shutil
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

from app.document import render_document
from app.polishing import polish_steps
from app.screenshots import extract_frame, resize_screenshot
from app.segmentation import segment_transcript
from app.transcription import extract_audio, transcribe

# ARCHITECTURE.md: limit concurrent pipeline executions to 2 on the
# 2 vCPU / 4 GB target server. Additional requests queue automatically.
PIPELINE_SEMAPHORE = asyncio.Semaphore(2)

DEFAULT_TEMP_DIR = "/tmp/instruction-generator"

# Adaptive candidate-frame counts per step. Short steps usually contain a
# fast action + page transition (where loading-screen captures happen), so
# they get more frames; long steps are usually narrator explanation over a
# stable page, so a smaller sample is sufficient. The polishing model
# selects the best frame from these candidates per step.
SHORT_STEP_THRESHOLD_SECONDS = 4.0
LONG_STEP_THRESHOLD_SECONDS = 15.0
CANDIDATES_SHORT = 5   # steps shorter than SHORT_STEP_THRESHOLD_SECONDS
CANDIDATES_NORMAL = 3  # steps within the thresholds
CANDIDATES_LONG = 2    # steps longer than LONG_STEP_THRESHOLD_SECONDS

# How far past the final step's narration end the screenshot window may
# extend (clamped to the video's duration). Lets us catch the page
# settling during the silence after the narrator finishes.
LAST_STEP_TAIL_SECONDS = 1.5


def _compute_candidate_timestamps(
    step: dict,
    next_step_start: float | None,
    video_duration: float,
) -> tuple[list[float], float, float]:
    """Compute evenly-spaced candidate frame timestamps for one step.

    Returns (timestamps, window_start, window_end). The window starts at
    the step's narration start and extends to the next step's start (or
    LAST_STEP_TAIL_SECONDS past end_time, clamped to video_duration, for
    the final step). N candidates are chosen by step duration.
    """
    duration = step["end_time"] - step["start_time"]
    if duration < SHORT_STEP_THRESHOLD_SECONDS:
        n = CANDIDATES_SHORT
    elif duration > LONG_STEP_THRESHOLD_SECONDS:
        n = CANDIDATES_LONG
    else:
        n = CANDIDATES_NORMAL

    window_start = float(step["start_time"])
    if next_step_start is not None:
        window_end = float(next_step_start)
    else:
        max_end = float(step["end_time"]) + LAST_STEP_TAIL_SECONDS
        window_end = min(max_end, video_duration) if video_duration > 0 else max_end

    # Defensive: collapsed window (next step adjacent or rounding glitch).
    if window_end <= window_start:
        window_end = window_start + 0.1

    width = window_end - window_start
    timestamps = [
        window_start + width * (k + 1) / (n + 1) for k in range(n)
    ]
    return timestamps, window_start, window_end


def create_temp_workdir() -> Path:
    """Create a unique workdir under TEMP_DIR for one request."""
    base = Path(os.getenv("TEMP_DIR", DEFAULT_TEMP_DIR))
    base.mkdir(parents=True, exist_ok=True)
    workdir = base / str(uuid.uuid4())
    workdir.mkdir()
    return workdir


def cleanup_workdir(workdir: Path) -> None:
    """Delete the workdir tree. Safe to call multiple times."""
    if workdir.exists():
        shutil.rmtree(workdir, ignore_errors=True)


@contextmanager
def _step(request_id: str, name: str):
    """Log a pipeline step's failure with request_id and re-raise.

    HTTPException is preserved as-is so the friendly detail set by the
    underlying module flows through to the client. Any other exception
    is wrapped in a generic 500 so raw stack traces never leak.
    """
    try:
        yield
    except HTTPException as exc:
        print(
            f"[{request_id}] step={name} status={exc.status_code} "
            f"detail={exc.detail!r}",
            file=sys.stderr,
        )
        raise
    except Exception as exc:
        print(f"[{request_id}] step={name} err={exc!r}", file=sys.stderr)
        raise HTTPException(
            status_code=500,
            detail=f"{name.replace('_', ' ').capitalize()} failed",
        ) from exc


async def process_video(
    video_path: Path,
    title: str,
    workdir: Path,
) -> Path:
    """Run the full pipeline against `video_path`. Returns the .docx path.

    Caller owns the lifecycle of `workdir`. This function does not delete
    it on success or failure; the route handler does, via BackgroundTasks
    on success or its own try/except on failure.
    """
    request_id = workdir.name  # the per-request uuid doubles as a log tag
    started = time.perf_counter()
    print(f"[{request_id}] pipeline start: title={title!r}")

    async with PIPELINE_SEMAPHORE:
        with _step(request_id, "extract_audio"):
            audio_path = extract_audio(video_path, workdir)

        with _step(request_id, "transcribe"):
            transcript = transcribe(audio_path)

        with _step(request_id, "segment_transcript"):
            segmentation_result = await segment_transcript(transcript)
            introduction = segmentation_result["introduction"]
            steps = segmentation_result["steps"]

        if not steps:
            print(
                f"[{request_id}] step=segment_transcript: zero usable steps",
                file=sys.stderr,
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    "This recording contains no narration. Please re-record "
                    "while speaking through each step. The tool needs your "
                    "voice to generate the instructions."
                ),
            )

        video_duration = float(transcript.get("duration") or 0)

        with _step(request_id, "extract_screenshots"):
            for i, step in enumerate(steps):
                next_start = (
                    steps[i + 1]["start_time"] if i + 1 < len(steps) else None
                )
                timestamps, window_start, window_end = (
                    _compute_candidate_timestamps(
                        step, next_start, video_duration
                    )
                )

                candidate_paths = []
                for j, ts in enumerate(timestamps):
                    frame_path = workdir / f"frame_{i:03d}_cand_{j}.jpg"
                    extract_frame(video_path, ts, frame_path)
                    resize_screenshot(frame_path)
                    candidate_paths.append(frame_path)

                step["candidate_frame_paths"] = candidate_paths

                print(
                    f"[{request_id}] step={i} "
                    f"narration=[{step['start_time']:.2f}s, "
                    f"{step['end_time']:.2f}s] "
                    f"window=[{window_start:.2f}s, {window_end:.2f}s] "
                    f"candidates={len(timestamps)}"
                )

        with _step(request_id, "polish_steps"):
            polished_steps = await polish_steps(steps, request_id)

        output_path = workdir / "output.docx"
        with _step(request_id, "render_document"):
            render_document(
                title,
                polished_steps,
                output_path,
                introduction=introduction,
            )

    elapsed = time.perf_counter() - started
    print(
        f"[{request_id}] pipeline complete: steps={len(steps)} "
        f"elapsed={elapsed:.1f}s"
    )
    return output_path
