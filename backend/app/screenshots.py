"""Single-frame extraction from video files using FFmpeg."""

from pathlib import Path

from fastapi import HTTPException

from app.ffmpeg_utils import run_ffmpeg


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

    run_ffmpeg(cmd, output_path, failure_label="Frame extraction")
    return output_path
