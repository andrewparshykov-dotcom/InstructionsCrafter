"""Audio extraction and (later) Whisper transcription.

Phase 2 implements only `extract_audio()`. The Whisper API call lives
alongside it starting in Phase 3.
"""

import subprocess
from pathlib import Path

from fastapi import HTTPException

# ARCHITECTURE.md: every FFmpeg call must have a timeout (60s for FFmpeg).
FFMPEG_TIMEOUT_SECONDS = 60

# Whisper's native sample rate. Using it now avoids server-side resampling later.
WHISPER_SAMPLE_RATE = 16000


def extract_audio(video_path: Path, output_dir: Path) -> Path:
    """Extract a 16 kHz mono WAV audio track from `video_path`.

    Writes the WAV to `<output_dir>/audio.wav` and returns its path.
    Raises HTTPException(400) if FFmpeg cannot extract audio.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "audio.wav"

    cmd = [
        "ffmpeg",
        "-y",                              # overwrite output if it already exists
        "-i", str(video_path),
        "-vn",                             # drop video stream
        "-ac", "1",                        # downmix to mono
        "-ar", str(WHISPER_SAMPLE_RATE),   # resample to 16 kHz
        "-c:a", "pcm_s16le",               # uncompressed 16-bit PCM
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
        raise HTTPException(status_code=400, detail="Audio extraction timed out")
    except subprocess.CalledProcessError:
        raise HTTPException(status_code=400, detail="Failed to extract audio from video")

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise HTTPException(status_code=400, detail="Audio extraction produced no output")

    return output_path
