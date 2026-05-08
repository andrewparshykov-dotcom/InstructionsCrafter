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
            steps = await segment_transcript(transcript)

        if not steps:
            print(
                f"[{request_id}] step=segment_transcript: zero usable steps",
                file=sys.stderr,
            )
            raise HTTPException(
                status_code=400,
                detail="Recording contains no usable narration",
            )

        with _step(request_id, "extract_screenshots"):
            for i, step in enumerate(steps):
                midpoint = (step["start_time"] + step["end_time"]) / 2
                frame_path = workdir / f"frame_{i:03d}.jpg"
                extract_frame(video_path, midpoint, frame_path)
                resize_screenshot(frame_path)
                step["screenshot_path"] = frame_path

        with _step(request_id, "polish_steps"):
            polished_steps = await polish_steps(steps)

        output_path = workdir / "output.docx"
        with _step(request_id, "render_document"):
            render_document(title, polished_steps, output_path)

    elapsed = time.perf_counter() - started
    print(
        f"[{request_id}] pipeline complete: steps={len(steps)} "
        f"elapsed={elapsed:.1f}s"
    )
    return output_path
