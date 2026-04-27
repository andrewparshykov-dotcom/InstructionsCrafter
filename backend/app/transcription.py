"""Audio extraction and (later) Whisper transcription.

Phase 2 implements only `extract_audio()`. The Whisper API call lives
alongside it starting in Phase 3.
"""

from pathlib import Path

from app.ffmpeg_utils import run_ffmpeg

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

    run_ffmpeg(cmd, output_path, failure_label="Audio extraction")
    return output_path
