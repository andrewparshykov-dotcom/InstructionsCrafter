"""Audio extraction and Whisper transcription."""

import os
import sys
from pathlib import Path

import openai
from fastapi import HTTPException
from openai import OpenAI

from app.ffmpeg_utils import run_ffmpeg

# Whisper's native sample rate. Using it now avoids server-side resampling later.
WHISPER_SAMPLE_RATE = 16000

# MP3 bitrate for the extracted audio. 64 kbps mono is transparent for
# clean voice narration (verified by a listening test against uncompressed
# PCM and FLAC -- no perceptible difference) and gives ~4x more capacity
# within Whisper's 25 MB file size cap than uncompressed PCM would,
# lifting the effective recording-duration limit from ~13 min to ~54 min.
WHISPER_AUDIO_BITRATE = "64k"

# Whisper API rejects audio files larger than 25 MiB.
WHISPER_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

# ARCHITECTURE.md: 120s timeout for Whisper API calls.
WHISPER_TIMEOUT_SECONDS = 120


def extract_audio(video_path: Path, output_dir: Path) -> Path:
    """Extract a 16 kHz mono MP3 (64 kbps) audio track from `video_path`.

    Writes the MP3 to `<output_dir>/audio.mp3` and returns its path.
    Raises HTTPException(400) if FFmpeg cannot extract audio.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "audio.mp3"

    cmd = [
        "ffmpeg",
        "-y",                              # overwrite output if it already exists
        "-i", str(video_path),
        "-vn",                             # drop video stream
        "-ac", "1",                        # downmix to mono
        "-ar", str(WHISPER_SAMPLE_RATE),   # resample to 16 kHz
        "-c:a", "libmp3lame",              # MP3 encoder
        "-b:a", WHISPER_AUDIO_BITRATE,     # transparent for voice; see constant comment
        str(output_path),
    ]

    run_ffmpeg(cmd, output_path, failure_label="Audio extraction")
    return output_path


def transcribe(audio_path: Path) -> dict:
    """Transcribe `audio_path` via Groq's whisper-large-v3-turbo.

    Uses Groq's OpenAI-compatible audio endpoint instead of OpenAI's
    own Whisper API. Free tier on Groq covers our usage comfortably,
    and Whisper Large V3 Turbo is more accurate than whisper-1
    (especially for non-English speech).

    Returns a dict (the SDK's `Transcription.model_dump()`) with keys
    including `text`, `language`, `duration`, `segments`, and `words`.
    Each segment carries `start`, `end`, and `text`; each word carries
    `word`, `start`, and `end`.

    Raises:
        HTTPException(400) if the file exceeds Whisper's 25 MiB limit.
        HTTPException(500) for missing API key or non-timeout API errors.
        HTTPException(504) if the request times out.
    """
    if audio_path.stat().st_size > WHISPER_MAX_FILE_SIZE_BYTES:
        # ARCHITECTURE.md: "handle the error gracefully and display
        # 'Recording too long' to the user."
        raise HTTPException(status_code=400, detail="Recording too long")

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Groq API key is not configured on the server",
        )

    # Groq exposes an OpenAI-compatible endpoint, so we keep using the
    # `openai` SDK but redirect it at Groq's base URL. Segmentation and
    # polishing still hit OpenAI directly with OPENAI_API_KEY.
    client = OpenAI(
        api_key=api_key,
        base_url="https://api.groq.com/openai/v1",
        timeout=WHISPER_TIMEOUT_SECONDS,
    )

    try:
        with audio_path.open("rb") as f:
            transcript = client.audio.transcriptions.create(
                model="whisper-large-v3-turbo",
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["segment", "word"],
            )
    except openai.APITimeoutError:
        raise HTTPException(status_code=504, detail="Transcription timed out")
    except openai.AuthenticationError:
        # DECISION: Bad Groq credentials are a server config error, not a
        # client auth error. /api/generate already authenticates the *client*
        # via SHARED_PASSWORD; this 500 is about the server's own credential.
        raise HTTPException(
            status_code=500,
            detail="Server failed to authenticate to Groq",
        )
    except openai.APIError as exc:
        # Log the underlying API error so it's visible in server logs even
        # though the client only sees the generic "Transcription failed".
        # Mirrors the pattern in polishing.py.
        print(f"transcribe: Groq APIError: {exc!r}", file=sys.stderr)
        raise HTTPException(status_code=500, detail="Transcription failed")

    return transcript.model_dump()
