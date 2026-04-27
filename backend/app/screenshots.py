"""Single-frame extraction from video files using FFmpeg."""

import subprocess
from pathlib import Path

from fastapi import HTTPException

# ARCHITECTURE.md: every FFmpeg call must have a timeout (60s for FFmpeg).
FFMPEG_TIMEOUT_SECONDS = 60


def extract_frame(
    video_path: Path,
    timestamp_seconds: float,
    output_path: Path,
) -> Path:
    """Extract a single JPEG frame from `video_path` at `timestamp_seconds`.

    Writes the frame to `output_path` and returns it.
    Raises HTTPException(400) if FFmpeg cannot extract a frame.
    """
    if timestamp_seconds < 0:
        raise HTTPException(status_code=400, detail="Timestamp must be non-negative")

    cmd = [
        "ffmpeg",
        "-y",                              # overwrite output if it already exists
        "-ss", f"{timestamp_seconds}",     # fast seek (before -i = input-level seek)
        "-i", str(video_path),
        "-frames:v", "1",                  # write a single video frame
        "-q:v", "2",                       # high-quality JPEG (lower = better)
        str(output_path),
    ]

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
        raise HTTPException(status_code=400, detail="Frame extraction timed out")
    except subprocess.CalledProcessError:
        raise HTTPException(status_code=400, detail="Failed to extract frame from video")

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise HTTPException(status_code=400, detail="Frame extraction produced no output")

    return output_path
