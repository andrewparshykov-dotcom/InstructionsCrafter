"""Processing pipeline for Click-capture mode (/api/generate-clicks).

The browser "Click capture" mode uploads an ORDERED set of screenshots (one per
click, each with the clicked control's label + the click x/y/dpr) plus optional
mic narration -- no video. This module:

  1. (if narration present and not silent) transcodes it to MP3 for Gemini,
  2. makes ONE Gemini call -> introduction + one imperative step per screenshot,
  3. draws the click ring on each screenshot (Pillow) and resizes it,
  4. renders the .docx with the SAME template as the video path.

There is no ffmpeg frame extraction here -- the screenshots already are the
per-step images. The audio transcode is the only ffmpeg use, and it is
best-effort: any audio problem just drops back to a silent (labels-only) doc.

Concurrency, the silence threshold, and the per-step error logger are shared
with the video pipeline (app.pipeline) so both routes obey the same 2-at-a-time
cap on the small server.
"""

import asyncio
import sys
import time
from pathlib import Path

from fastapi import HTTPException

from app.clicks_annotate import annotate_click
from app.document import render_document
from app.ffmpeg_utils import measure_audio_levels, run_ffmpeg
from app.gemini import generate_document_from_clicks
from app.pipeline import PIPELINE_SEMAPHORE, SILENT_MEAN_THRESHOLD_DB, _step
from app.screenshots import resize_screenshot


def _maybe_prepare_audio(
    audio_path: Path | None, workdir: Path, request_id: str
) -> Path | None:
    """Return an MP3 path to send to Gemini, or None.

    None when there is no audio, when it is silent (narration is optional, so a
    silent track is simply ignored -- never an error), or when the transcode
    fails (we proceed without it rather than fail the request).
    """
    if audio_path is None:
        return None

    mean_db, max_db = measure_audio_levels(audio_path)
    print(f"[{request_id}] clicks audio levels: mean={mean_db} dB, max={max_db} dB")
    if mean_db is not None and mean_db <= SILENT_MEAN_THRESHOLD_DB:
        print(f"[{request_id}] clicks audio is silent -> ignoring narration")
        return None

    mp3_path = workdir / "narration.mp3"
    cmd = [
        "ffmpeg", "-y",
        "-i", str(audio_path),
        "-vn",                      # audio only (the upload may be a webm container)
        "-ac", "1",                 # mono -- it's voice narration
        "-c:a", "libmp3lame",
        "-q:a", "5",
        str(mp3_path),
    ]
    try:
        run_ffmpeg(cmd, mp3_path, failure_label="Audio conversion")
    except HTTPException as exc:
        # Optional narration: a conversion failure must not fail the document.
        print(
            f"[{request_id}] clicks audio transcode failed ({exc.detail!r}); "
            f"continuing without narration",
            file=sys.stderr,
        )
        return None
    return mp3_path


async def process_clicks(
    shot_paths: list[Path],
    metas: list[dict],
    audio_path: Path | None,
    title: str,
    workdir: Path,
) -> Path:
    """Run the full Click-capture pipeline. Returns the .docx path.

    ``shot_paths`` are the saved screenshots in click order; ``metas[i]`` is the
    matching ``{"label", "x", "y", "dpr"}``. ``audio_path`` is the optional
    narration upload (any ffmpeg-readable container) or None.

    Caller owns the lifecycle of ``workdir`` (cleanup runs in the route handler).
    """
    request_id = workdir.name
    started = time.perf_counter()
    print(f"[{request_id}] clicks pipeline start: title={title!r} shots={len(shot_paths)}")

    if not shot_paths:
        raise HTTPException(status_code=400, detail="No screenshots were uploaded")

    async with PIPELINE_SEMAPHORE:
        with _step(request_id, "prepare_audio"):
            audio_for_gemini = _maybe_prepare_audio(audio_path, workdir, request_id)

        shots_input = [
            {
                "image_path": shot_paths[i],
                "label": (metas[i].get("label") if i < len(metas) else "") or "",
            }
            for i in range(len(shot_paths))
        ]

        with _step(request_id, "generate_clicks_document"):
            result = await asyncio.to_thread(
                generate_document_from_clicks,
                shots_input,
                request_id,
                audio_for_gemini,
            )
        introduction = result["introduction"]
        steps = result["steps"]  # exactly one per shot, index-aligned

        with _step(request_id, "annotate_screenshots"):
            for i, step in enumerate(steps):
                meta = metas[i] if i < len(metas) else {}
                shot = shot_paths[i]
                annotate_click(
                    shot,
                    meta.get("x", 0),
                    meta.get("y", 0),
                    meta.get("dpr", 1),
                    marker=meta.get("marker", "ring"),
                )
                resize_screenshot(shot)
                step["screenshot_path"] = shot

        output_path = workdir / "output.docx"
        with _step(request_id, "render_document"):
            render_document(title, steps, output_path, introduction=introduction)

    elapsed = time.perf_counter() - started
    print(
        f"[{request_id}] clicks pipeline complete: steps={len(steps)} "
        f"elapsed={elapsed:.1f}s"
    )
    return output_path
