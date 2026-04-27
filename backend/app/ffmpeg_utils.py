"""Shared helper for invoking FFmpeg via subprocess with consistent error handling.

Used by `screenshots.py` and `transcription.py` so that timeout, exception
mapping, and output-file verification stay in one place.
"""

import subprocess
from pathlib import Path

from fastapi import HTTPException

# ARCHITECTURE.md: every FFmpeg call must have a timeout (60s for FFmpeg).
FFMPEG_TIMEOUT_SECONDS = 60


def run_ffmpeg(
    cmd: list[str],
    output_path: Path,
    *,
    failure_label: str,
) -> None:
    """Run an FFmpeg command with timeout and uniform error handling.

    On success, returns None. On any failure, raises an `HTTPException` with
    a user-friendly message derived from `failure_label` (e.g. "Audio
    extraction" → "Audio extraction failed", "Audio extraction timed out").

    After the run completes, verifies that `output_path` exists and is
    non-empty — FFmpeg occasionally exits 0 without producing output (for
    example when seeking past end of file).
    """
    try:
        subprocess.run(
            cmd,
            timeout=FFMPEG_TIMEOUT_SECONDS,
            capture_output=True,
            check=True,
        )
    except FileNotFoundError:
        # DECISION: Missing FFmpeg is a server config error, not a client error,
        # so we return 500. ARCHITECTURE.md's "HTTP 400 on extraction failure"
        # rule is about bad media, not a missing toolchain.
        raise HTTPException(
            status_code=500,
            detail="FFmpeg is not installed on the server",
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=400, detail=f"{failure_label} timed out")
    except subprocess.CalledProcessError:
        raise HTTPException(status_code=400, detail=f"{failure_label} failed")

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise HTTPException(status_code=400, detail=f"{failure_label} produced no output")
