"""Single-frame extraction and resizing for screenshots."""

from pathlib import Path

from fastapi import HTTPException
from PIL import Image

from app.ffmpeg_utils import run_ffmpeg

# Max pixel width for embedded screenshots. 1920 px matches the most common
# native screen-recording resolution (1080p), so most frames are not
# downscaled at all -- yielding the sharpest possible rendering on retina
# displays while keeping file size modest.
MAX_SCREENSHOT_WIDTH = 1920

# JPEG quality for resized output (Pillow default is 75; 85 is a common
# sweet spot for technical screenshots).
RESIZED_JPEG_QUALITY = 85


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


def resize_screenshot(
    path: Path,
    max_width: int = MAX_SCREENSHOT_WIDTH,
) -> None:
    """Resize the JPEG at `path` in-place if it exceeds `max_width`, and
    re-encode through Pillow either way.

    The re-encode is important even when no resize is needed: python-docx's
    image parser requires a JFIF or Exif marker right after a JPEG's SOI
    bytes, and FFmpeg's raw JPEG output sometimes omits these markers,
    causing UnrecognizedImageError at document rendering. Pillow always
    writes a JFIF marker, so re-saving through it normalizes the file.

    Preserves aspect ratio. Raises HTTPException(500) on Pillow failure
    (corrupt or unreadable source).
    """
    try:
        with Image.open(path) as img:
            if img.width > max_width:
                new_height = round(img.height * (max_width / img.width))
                output = img.resize(
                    (max_width, new_height),
                    Image.Resampling.LANCZOS,
                )
            else:
                # No resize needed; copy() detaches from the file so we
                # can save back to the same path after the with block.
                output = img.copy()
        # Image is closed here; safe to overwrite the source file.
        output.save(path, "JPEG", quality=RESIZED_JPEG_QUALITY, optimize=True)
    except OSError:
        raise HTTPException(
            status_code=500,
            detail="Failed to resize screenshot",
        )
