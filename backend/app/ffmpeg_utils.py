"""Shared helper for invoking FFmpeg via subprocess with consistent error handling.

Used by `screenshots.py` and `transcription.py` so that timeout, exception
mapping, and output-file verification stay in one place.
"""

import re
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


def measure_audio_levels(audio_path: Path) -> tuple[float | None, float | None]:
    """Return ``(mean_dB, max_dB)`` for the audio file via ffmpeg's ``volumedetect``.

    The pipeline uses this to reject silent recordings before Whisper sees
    them. On pure silence Whisper hallucinates plausible filler text, which
    then passes the zero-steps check and yields a meaningless document; an
    RMS-based gate is the reliable fix.

    Returns ``(None, None)`` if ffmpeg fails or its output cannot be parsed,
    in which case the caller should fall through to the downstream zero-steps
    safety net rather than block the request.
    """
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-i", str(audio_path),
                "-af", "volumedetect",
                "-f", "null",
                "-",
                "-hide_banner",
            ],
            capture_output=True,
            text=True,
            timeout=FFMPEG_TIMEOUT_SECONDS,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None, None

    # volumedetect writes its summary to stderr regardless of -f null.
    output = result.stderr
    mean = _parse_db(re.search(r"mean_volume:\s*(-?[\d.]+|-?inf)\s*dB", output))
    peak = _parse_db(re.search(r"max_volume:\s*(-?[\d.]+|-?inf)\s*dB", output))
    return mean, peak


def _parse_db(match: re.Match | None) -> float | None:
    if not match:
        return None
    val = match.group(1)
    if "inf" in val:
        return float("-inf")
    return float(val)
