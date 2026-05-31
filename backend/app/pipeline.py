"""End-to-end processing pipeline for /api/generate.

A single Gemini call watches the screen recording and returns the document's
introduction + steps (instruction, caption, narration span, and the click
timestamp located via the recorder's red click-highlight ring). This module
then picks one screenshot per step -- tightly around the click instant when
available, otherwise by sampling the narration window -- and renders the .docx.
(Replaces the former Groq-transcribe -> GPT-segment -> GPT-polish chain; see
app/gemini.py.)

Workdir lifecycle is owned by the caller (the route handler) so cleanup can run
via FastAPI's BackgroundTasks AFTER the FileResponse is sent.
"""

import asyncio
import os
import shutil
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

from app.document import render_document
from app.ffmpeg_utils import measure_audio_levels, probe_duration
from app.gemini import generate_document
from app.screenshots import extract_frame, resize_screenshot

# ARCHITECTURE.md: limit concurrent pipeline executions to 2 on the
# 2 vCPU / 4 GB target server. Additional requests queue automatically.
PIPELINE_SEMAPHORE = asyncio.Semaphore(2)

DEFAULT_TEMP_DIR = "/tmp/instruction-generator"

# Reject recordings whose mean audio level is at or below this threshold.
# A silent recording has no narration for Gemini to work from, so it would
# yield a meaningless document; reject it early with a clear message rather
# than spend a Gemini request. Matches the extension's pre-upload warning
# threshold so the rejection is consistent with what users were warned about.
SILENT_MEAN_THRESHOLD_DB = -50.0

# When a sample timestamp is clamped to the video's end, stay this far inside
# it so the seek lands on a real, decodable frame rather than past the last one.
END_CLAMP_MARGIN_SECONDS = 0.5

# At a Gemini-guessed (non-authoritative) click we extract the click instant
# itself (offset 0.0); the other offsets (seconds) are only fallbacks if that
# exact seek fails to produce a frame.
CLICK_FALLBACK_OFFSETS = (0.0, -0.15, 0.15, -0.3, 0.3)

# For an AUTHORITATIVE (recorded) click we bias the screenshot slightly BEFORE
# the click. The recorded timestamp marks the mouse press, but a fast control
# can navigate on release a few frames later; leading by ~0.15s keeps the shot
# on the control being clicked rather than the page it opens, and also absorbs
# the small (late-leaning) video-start anchor skew. Tunable via env. Values
# after the first are fallbacks tried in order if a seek fails (e.g. video end).
AUTHORITATIVE_CLICK_LEAD_SECONDS = float(os.getenv("CLICK_LEAD_SECONDS", "0.15"))
AUTHORITATIVE_CLICK_OFFSETS = (
    -AUTHORITATIVE_CLICK_LEAD_SECONDS,
    -AUTHORITATIVE_CLICK_LEAD_SECONDS - 0.15,
    0.0,
    0.15,
)
# A click_time is trusted only if it falls within the step's narration window
# (plus this slack); otherwise we fall back to sampling the window.
CLICK_WINDOW_SLACK_SECONDS = 2.0

# Fallback narration-window sampling: sample several frames across the leading
# part of a step's window and keep the most-detailed one (skips blank /
# half-loaded frames, which compress to small JPEGs).
MIN_CANDIDATES = 2
MAX_CANDIDATES = 6
WINDOW_LEAD_FRACTION = 0.85


def create_temp_workdir() -> Path:
    """Create a unique workdir under TEMP_DIR for one request."""
    base = Path(os.getenv("TEMP_DIR", DEFAULT_TEMP_DIR))
    base.mkdir(parents=True, exist_ok=True)
    workdir = base / str(uuid.uuid4())
    workdir.mkdir()
    return workdir


def cleanup_workdir(workdir: Path) -> None:
    """Delete the workdir tree. Safe to call multiple times."""
    if workdir.exists():
        shutil.rmtree(workdir, ignore_errors=True)


@contextmanager
def _step(request_id: str, name: str):
    """Log a pipeline step's failure with request_id and re-raise.

    HTTPException is preserved as-is so the friendly detail set by the
    underlying module flows through to the client. Any other exception is
    wrapped in a generic 500 so raw stack traces never leak.
    """
    try:
        yield
    except HTTPException as exc:
        print(
            f"[{request_id}] step={name} status={exc.status_code} "
            f"detail={exc.detail!r}",
            file=sys.stderr,
        )
        raise
    except Exception as exc:
        print(f"[{request_id}] step={name} err={exc!r}", file=sys.stderr)
        raise HTTPException(
            status_code=500,
            detail=f"{name.replace('_', ' ').capitalize()} failed",
        ) from exc


def _clamp_timestamp(ts: float, video_duration: float | None) -> float:
    """Clamp a timestamp into a safely extractable range.

    Negatives become 0. If the video duration is known, the value is kept just
    inside the end so a seek does not land past the last frame.
    """
    ts = max(0.0, float(ts))
    if video_duration and video_duration > 0:
        ts = min(ts, max(0.0, video_duration - END_CLAMP_MARGIN_SECONDS))
    return ts


def _candidate_timestamps(
    start: float,
    end: float,
    video_duration: float | None,
) -> list[float]:
    """Evenly-spaced sample timestamps across the leading part of a step's
    narration window, each clamped to the video duration.
    """
    if end <= start:
        return [_clamp_timestamp(start, video_duration)]
    lead_end = start + WINDOW_LEAD_FRACTION * (end - start)
    span = lead_end - start
    n = max(MIN_CANDIDATES, min(MAX_CANDIDATES, int(span // 2) + 1))
    if n == 1:
        points = [start + span / 2]
    else:
        points = [start + span * k / (n - 1) for k in range(n)]
    return [_clamp_timestamp(p, video_duration) for p in points]


def _extract_best(
    video_path: Path,
    timestamps: list[float],
    index: int,
    video_duration: float | None,
    workdir: Path,
    final: Path,
    tag: str,
) -> Path | None:
    """Extract frames at the given timestamps and keep the largest (most
    detail) as `final`. Returns `final`, or None if none could be extracted.
    """
    candidates: list[tuple[Path, int]] = []
    for j, ts in enumerate(timestamps):
        cand = workdir / f"frame_{index:03d}_{tag}{j}.jpg"
        try:
            extract_frame(video_path, _clamp_timestamp(ts, video_duration), cand)
        except HTTPException:
            continue
        candidates.append((cand, cand.stat().st_size))
    if not candidates:
        return None
    # Largest JPEG = most detail -> skips blank / half-loaded frames.
    # max() keeps the earliest on ties.
    best_path = max(candidates, key=lambda c: c[1])[0]
    best_path.replace(final)
    resize_screenshot(final)
    return final


def _select_step_frame(
    video_path: Path,
    step: dict,
    index: int,
    video_duration: float | None,
    workdir: Path,
) -> Path:
    """Pick one screenshot for a step.

    Preferred: a tight cluster around the click_time Gemini located (via the
    red click-highlight ring) -- the cursor-on-control instant. Falls back to
    sampling the narration window, then to coarse fixed points. Returns the
    chosen frame's path (resized in place).
    """
    raw_start, raw_end = step.get("start_time"), step.get("end_time")
    start = float(raw_start) if isinstance(raw_start, (int, float)) else 0.0
    end = float(raw_end) if isinstance(raw_end, (int, float)) else start
    final = workdir / f"frame_{index:03d}.jpg"

    # 1) Click-centered: extract the click instant itself (the cursor-on-
    #    control frame). An *authoritative* click_time comes from the
    #    extension's recorded click log, so trust it outright. A
    #    non-authoritative one is Gemini's own guess from the video, so trust it
    #    only if it sits within the step's narration window (guards overshoot).
    click = step.get("click_time")
    authoritative = bool(step.get("click_authoritative"))
    if isinstance(click, (int, float)) and (
        authoritative
        or (
            start - CLICK_WINDOW_SLACK_SECONDS
            <= float(click)
            <= end + CLICK_WINDOW_SLACK_SECONDS
        )
    ):
        offsets = (
            AUTHORITATIVE_CLICK_OFFSETS if authoritative else CLICK_FALLBACK_OFFSETS
        )
        for off in offsets:
            try:
                extract_frame(
                    video_path,
                    _clamp_timestamp(float(click) + off, video_duration),
                    final,
                )
                resize_screenshot(final)
                return final
            except HTTPException:
                continue

    # 2) Narration-window sampling.
    chosen = _extract_best(
        video_path,
        _candidate_timestamps(start, end, video_duration),
        index,
        video_duration,
        workdir,
        final,
        "c",
    )
    if chosen is not None:
        return chosen

    # 3) Coarse last-resort fallbacks.
    last_error: HTTPException | None = None
    for ts in ((start + end) / 2.0, start, 0.0):
        try:
            extract_frame(video_path, _clamp_timestamp(ts, video_duration), final)
            resize_screenshot(final)
            return final
        except HTTPException as exc:
            last_error = exc
            continue
    raise last_error or HTTPException(
        status_code=500, detail="Could not extract a screenshot for a step"
    )


async def process_video(
    video_path: Path,
    title: str,
    workdir: Path,
    clicks: list[dict] | None = None,
) -> Path:
    """Run the full pipeline against `video_path`. Returns the .docx path.

    `clicks` is the extension's recorded click log (a list of {t, label, role,
    tag}); when present it drives Gemini's marker mode and gives authoritative
    screenshot timestamps. When empty/None, Gemini locates clicks itself.

    Caller owns the lifecycle of `workdir`. This function does not delete it on
    success or failure; the route handler does, via BackgroundTasks on success
    or its own try/except on failure.
    """
    request_id = workdir.name  # the per-request uuid doubles as a log tag
    started = time.perf_counter()
    print(f"[{request_id}] pipeline start: title={title!r}")

    async with PIPELINE_SEMAPHORE:
        with _step(request_id, "check_audio_level"):
            mean_db, max_db = measure_audio_levels(video_path)
            print(
                f"[{request_id}] audio levels: mean={mean_db} dB, max={max_db} dB"
            )
            if mean_db is not None and mean_db <= SILENT_MEAN_THRESHOLD_DB:
                level_str = "-inf" if mean_db == float("-inf") else f"{mean_db:.1f}"
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"This recording is silent or near-silent (mean audio "
                        f"level {level_str} dB). Re-record while speaking through "
                        f"each step. The tool needs your voice to generate the "
                        f"instructions."
                    ),
                )

        # Duration is needed before the Gemini call to pick the perception fps.
        with _step(request_id, "probe_duration"):
            video_duration = probe_duration(video_path)
            print(f"[{request_id}] video duration: {video_duration}")

        # One Gemini call does transcription, segmentation, instruction
        # writing, captions, and click localization. Run it off the event
        # loop since the SDK calls are blocking.
        with _step(request_id, "generate_document"):
            result = await asyncio.to_thread(
                generate_document, video_path, request_id, video_duration, clicks
            )
        introduction = result["introduction"]
        steps = result["steps"]

        if not steps:
            print(
                f"[{request_id}] step=generate_document: zero usable steps",
                file=sys.stderr,
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    "This recording contains no narration. Please re-record "
                    "while speaking through each step. The tool needs your "
                    "voice to generate the instructions."
                ),
            )

        with _step(request_id, "extract_screenshots"):
            for i, step in enumerate(steps):
                frame_path = _select_step_frame(
                    video_path, step, i, video_duration, workdir
                )
                step["screenshot_path"] = frame_path
                print(
                    f"[{request_id}] step={i} "
                    f"window=[{step.get('start_time')}, {step.get('end_time')}]s "
                    f"click={step.get('click_time')}s -> {frame_path.name}"
                )

        output_path = workdir / "output.docx"
        with _step(request_id, "render_document"):
            render_document(
                title,
                steps,
                output_path,
                introduction=introduction,
            )

    elapsed = time.perf_counter() - started
    print(
        f"[{request_id}] pipeline complete: steps={len(steps)} "
        f"elapsed={elapsed:.1f}s"
    )
    return output_path
