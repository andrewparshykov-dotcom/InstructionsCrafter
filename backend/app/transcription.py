"""Audio extraction and Whisper transcription."""

import os
from pathlib import Path

import openai
from fastapi import HTTPException
from openai import OpenAI

from app.ffmpeg_utils import run_ffmpeg

# Whisper's native sample rate. Using it now avoids server-side resampling later.
WHISPER_SAMPLE_RATE = 16000

# Whisper API rejects audio files larger than 25 MiB.
WHISPER_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

# ARCHITECTURE.md: 120s timeout for Whisper API calls.
WHISPER_TIMEOUT_SECONDS = 120

# Domain glossary that biases Whisper toward correct recognition of
# product-specific terms. Including phrases with BOTH "quote" and "code"
# helps Whisper disambiguate between them by audio rather than biasing
# toward one (which would over-correct legitimate uses of the other).
# Add new terms here as real recordings reveal mistranscriptions.
WHISPER_PROMPT = "Insurance quote, Bond quote, Verification code, Class code"


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

    run_ffmpeg(cmd, output_path, failure_label="Audio extraction")
    return output_path


def transcribe(audio_path: Path) -> dict:
    """Transcribe `audio_path` via OpenAI Whisper.

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

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key is not configured on the server",
        )

    client = OpenAI(api_key=api_key, timeout=WHISPER_TIMEOUT_SECONDS)

    try:
        with audio_path.open("rb") as f:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                prompt=WHISPER_PROMPT,
                response_format="verbose_json",
                timestamp_granularities=["segment", "word"],
            )
    except openai.APITimeoutError:
        raise HTTPException(status_code=504, detail="Transcription timed out")
    except openai.AuthenticationError:
        # DECISION: Bad OpenAI credentials are a server config error, not a
        # client auth error. /api/generate already authenticates the *client*
        # via SHARED_PASSWORD; this 500 is about the server's own credential.
        raise HTTPException(
            status_code=500,
            detail="Server failed to authenticate to OpenAI",
        )
    except openai.APIError:
        raise HTTPException(status_code=500, detail="Transcription failed")

    return transcript.model_dump()
