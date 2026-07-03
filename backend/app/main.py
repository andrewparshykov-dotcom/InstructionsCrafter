"""FastAPI application for the InstructionsCrafter backend."""

import json
import math
import os
import re
import secrets
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

# Load .env BEFORE importing app modules: app.pipeline / app.gemini read tuning
# knobs (PERCEPTION_FPS, CLICK_LEAD_SECONDS, VOICE_CUE_LEAD_SECONDS) at import
# time, so those values must already be in the environment first.
load_dotenv()

from app.pipeline import cleanup_workdir, create_temp_workdir, process_video
from app.clicks_pipeline import process_clicks
from app import jobs

SHARED_PASSWORD = os.getenv("SHARED_PASSWORD", "")
MAX_VIDEO_SIZE_MB = int(os.getenv("MAX_VIDEO_SIZE_MB", "500"))
MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024

# 1 MB chunks when streaming the upload to disk; keeps a 500 MB upload
# from being held entirely in process memory.
UPLOAD_CHUNK_BYTES = 1024 * 1024

DOCX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)

PRIVACY_HTML_PATH = Path(__file__).parent.parent / "templates" / "privacy.html"

app = FastAPI(title="InstructionsCrafter API")

# CORS — the Chrome extension's origin is `chrome-extension://<id>`. ALLOWED_ORIGINS
# in .env can be a comma-separated list of explicit origins. If it is empty or only
# contains the placeholder value, fall back to a regex that accepts any
# chrome-extension origin so local development works without looking up the ID.
# DECISION: dev-mode fallback is intentionally permissive for ≤5-user internal use.
# For Phase 7 production, set ALLOWED_ORIGINS to the exact deployed extension origin.
_allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "")
_dev_placeholder = "replace-with-extension-id"
_explicit_origins = [
    o.strip()
    for o in _allowed_origins_raw.split(",")
    if o.strip() and _dev_placeholder not in o
]
if _explicit_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_explicit_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^chrome-extension://[a-z0-9_-]+$",
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    # Architecture spec wants {"error": "..."} instead of FastAPI's default {"detail": "..."}.
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/privacy")
async def privacy_policy():
    # Chrome Web Store requires a publicly accessible privacy policy URL.
    return FileResponse(PRIVACY_HTML_PATH, media_type="text/html")


@app.post("/api/generate")
async def generate(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    title: str = Form(...),
    password: str = Form(...),
    # Optional click log captured by the extension's content script: a JSON
    # array of {t, label, role, tag} marking each click's time on the video
    # timeline. When present, these are authoritative screenshot anchors (see
    # gemini.py marker mode); when absent, the pipeline falls back to letting
    # Gemini locate clicks itself.
    clicklog: str | None = Form(None),
):
    _require_valid_request(password, title)
    _require_valid_video(video)

    workdir = create_temp_workdir()
    try:
        upload_path = await _save_video_upload(video, workdir)
        clicks = _parse_clicklog(clicklog)
        output_path = await process_video(upload_path, title, workdir, clicks=clicks)
    except Exception:
        # Failure path: clean up immediately, before the exception propagates.
        cleanup_workdir(workdir)
        raise

    # Success path: cleanup runs AFTER FileResponse has finished streaming.
    background_tasks.add_task(cleanup_workdir, workdir)

    return FileResponse(
        path=str(output_path),
        media_type=DOCX_MEDIA_TYPE,
        filename=_docx_filename(title),
    )


@app.post("/api/generate-clicks")
async def generate_clicks(
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    password: str = Form(...),
    # JSON array, aligned to `shots` by index, of {label, x, y, dpr} -- the
    # control's accessible label and the click point (CSS px + device pixel
    # ratio) used to draw the ring marker. See clicks_annotate.py.
    meta: str = Form(...),
    # Ordered screenshots, one per click (captureVisibleTab JPEGs).
    shots: list[UploadFile] = File(...),
    # Optional mic narration for the whole flow (any ffmpeg-readable container).
    audio: UploadFile | None = File(None),
):
    """Click-capture mode: ordered screenshots (+ optional narration) -> .docx.

    The browser-only "Click capture" mode sends one screenshot per click instead
    of a video; the screenshots are the per-step images, so there is no ffmpeg
    frame extraction (see app/clicks_pipeline.py).
    """
    _require_valid_request(password, title)
    _require_valid_shots(shots)

    metas = _parse_clickmeta(meta, len(shots))

    workdir = create_temp_workdir()
    try:
        shot_paths, audio_path = await _save_click_inputs(shots, audio, workdir)
        output_path = await process_clicks(
            shot_paths, metas, audio_path, title.strip(), workdir
        )
    except Exception:
        cleanup_workdir(workdir)
        raise

    background_tasks.add_task(cleanup_workdir, workdir)

    return FileResponse(
        path=str(output_path),
        media_type=DOCX_MEDIA_TYPE,
        filename=_docx_filename(title),
    )


# --- Async job endpoints (submit -> poll -> download) -----------------------
# The extension polls every few seconds instead of holding one long HTTP
# request open while the pipeline runs — see app/jobs.py for why. The legacy
# synchronous endpoints above are kept so already-installed extensions
# (v1.1.0) keep working; remove them once every install runs the polling
# version.


@app.post("/api/jobs/generate")
async def submit_generate(
    video: UploadFile = File(...),
    title: str = Form(...),
    password: str = Form(...),
    clicklog: str | None = Form(None),
):
    _require_valid_request(password, title)
    _require_valid_video(video)

    workdir = create_temp_workdir()
    try:
        upload_path = await _save_video_upload(video, workdir)
        clicks = _parse_clicklog(clicklog)
    except Exception:
        cleanup_workdir(workdir)
        raise

    job = jobs.create_job(workdir, _docx_filename(title))
    jobs.start_job(job, process_video(upload_path, title, workdir, clicks=clicks))
    return {"job_id": job.id}


@app.post("/api/jobs/generate-clicks")
async def submit_generate_clicks(
    title: str = Form(...),
    password: str = Form(...),
    meta: str = Form(...),
    shots: list[UploadFile] = File(...),
    audio: UploadFile | None = File(None),
):
    _require_valid_request(password, title)
    _require_valid_shots(shots)

    metas = _parse_clickmeta(meta, len(shots))

    workdir = create_temp_workdir()
    try:
        shot_paths, audio_path = await _save_click_inputs(shots, audio, workdir)
    except Exception:
        cleanup_workdir(workdir)
        raise

    job = jobs.create_job(workdir, _docx_filename(title))
    jobs.start_job(
        job, process_clicks(shot_paths, metas, audio_path, title.strip(), workdir)
    )
    return {"job_id": job.id}


# DECISION: polling/download are authorized by the unguessable job id (uuid4)
# instead of re-sending the shared password — the id is a capability handed
# out only after a password-checked submit.
@app.get("/api/jobs/{job_id}")
async def job_status(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown or expired job")
    if job.status == "error":
        return {"status": "error", "error": job.error}
    return {"status": job.status}


@app.get("/api/jobs/{job_id}/result")
async def job_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown or expired job")
    if job.status == "error":
        raise HTTPException(status_code=409, detail=job.error or "Generation failed")
    if job.status != "done" or job.result_path is None:
        raise HTTPException(status_code=409, detail="Document is not ready yet")
    # The job (and its workdir) is intentionally NOT deleted after a download:
    # a network blip can interrupt the transfer and the extension may retry.
    # The TTL purge in app/jobs.py removes everything shortly after anyway.
    return FileResponse(
        path=str(job.result_path),
        media_type=DOCX_MEDIA_TYPE,
        filename=job.filename,
    )


def _sanitize_title(title: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 \-]", "_", title).strip()
    return cleaned or "document"


def _docx_filename(title: str) -> str:
    return f"{_sanitize_title(title)}_{date.today().isoformat()}.docx"


# --- Shared request validation / upload saving ------------------------------
# Used by both the legacy synchronous endpoints and the job-based ones, so
# the two flows validate and store uploads identically.


def _require_valid_request(password: str, title: str) -> None:
    if not SHARED_PASSWORD or not secrets.compare_digest(password, SHARED_PASSWORD):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not (1 <= len(title) <= 200):
        raise HTTPException(status_code=400, detail="Title must be 1 to 200 characters")


def _require_valid_video(video: UploadFile) -> None:
    if video.size is not None and video.size > MAX_VIDEO_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Video exceeds maximum size")
    if video.size == 0:
        raise HTTPException(status_code=400, detail="Empty video file")


def _require_valid_shots(shots: list[UploadFile]) -> None:
    if not shots:
        raise HTTPException(status_code=400, detail="No screenshots were uploaded")
    if len(shots) > _MAX_SHOTS:
        raise HTTPException(
            status_code=413,
            detail=f"Too many screenshots (max {_MAX_SHOTS})",
        )


async def _save_video_upload(video: UploadFile, workdir: Path) -> Path:
    # Stream the upload to disk in chunks so a 500 MB request does not
    # have to be held entirely in memory.
    upload_ext = Path(video.filename or "upload.mp4").suffix or ".mp4"
    upload_path = workdir / f"upload{upload_ext}"
    with upload_path.open("wb") as out:
        while chunk := await video.read(UPLOAD_CHUNK_BYTES):
            out.write(chunk)
    return upload_path


async def _save_click_inputs(
    shots: list[UploadFile],
    audio: UploadFile | None,
    workdir: Path,
) -> tuple[list[Path], Path | None]:
    shot_paths: list[Path] = []
    for i, up in enumerate(shots):
        suffix = (Path(up.filename or "").suffix or ".jpg").lower()
        if suffix not in _ALLOWED_SHOT_SUFFIXES:
            suffix = ".jpg"  # we re-encode through Pillow anyway
        data = await up.read()
        if len(data) == 0:
            raise HTTPException(status_code=400, detail="Empty screenshot file")
        if len(data) > _MAX_SHOT_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="A screenshot is too large")
        shot_path = workdir / f"shot_{i:03d}{suffix}"
        shot_path.write_bytes(data)
        shot_paths.append(shot_path)

    audio_path: Path | None = None
    if audio is not None and audio.filename:
        audio_ext = Path(audio.filename).suffix or ".webm"
        candidate = workdir / f"narration{audio_ext}"
        with candidate.open("wb") as out:
            while chunk := await audio.read(UPLOAD_CHUNK_BYTES):
                out.write(chunk)
        # An empty audio part means "no narration" -- treat as absent.
        if candidate.stat().st_size > 0:
            audio_path = candidate

    return shot_paths, audio_path


# Defensive caps for the click log (it comes from the extension, so treat it as
# untrusted input). A real recording has at most a few hundred clicks.
_MAX_CLICKS = 1000
_MAX_LABEL_LEN = 200


def _parse_clicklog(raw: str | None) -> list[dict]:
    """Parse the extension's click-log JSON into a clean, sorted list.

    Returns ``[]`` for anything missing or malformed -- a bad/absent click log
    must never fail a request, it just drops the pipeline back to auto mode.
    Each returned item is ``{"t": float>=0, "label": str, "role": str,
    "tag": str}``, sorted by ``t``.
    """
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return []
    if not isinstance(data, list):
        return []

    clicks: list[dict] = []
    for item in data[:_MAX_CLICKS]:
        if not isinstance(item, dict):
            continue
        t = item.get("t")
        if not isinstance(t, (int, float)) or isinstance(t, bool) or t < 0:
            continue
        clicks.append(
            {
                "t": float(t),
                "label": str(item.get("label") or "")[:_MAX_LABEL_LEN],
                "role": str(item.get("role") or "")[:_MAX_LABEL_LEN],
                "tag": str(item.get("tag") or "")[:_MAX_LABEL_LEN],
            }
        )
    clicks.sort(key=lambda c: c["t"])
    return clicks


# --- Click-capture mode (/api/generate-clicks) ----------------------------

# Defensive caps for click-capture uploads (untrusted extension input).
_MAX_SHOTS = 80
_MAX_SHOT_SIZE_BYTES = 15 * 1024 * 1024  # one viewport screenshot
_ALLOWED_SHOT_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def _safe_float(value, default: float = 0.0) -> float:
    """Coerce to a finite float, falling back to ``default`` on junk input."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


def _parse_clickmeta(raw: str | None, count: int) -> list[dict]:
    """Parse the per-click metadata JSON into a list of exactly ``count`` items.

    Aligns to the uploaded screenshots by index; each item is normalized to
    ``{"label": str, "x": float, "y": float, "dpr": float}`` with safe defaults
    so malformed/missing entries never fail the request (they just yield an
    unmarked screenshot).
    """
    try:
        data = json.loads(raw) if raw else []
    except (ValueError, TypeError):
        data = []
    if not isinstance(data, list):
        data = []

    out: list[dict] = []
    for i in range(count):
        item = data[i] if i < len(data) and isinstance(data[i], dict) else {}
        marker = item.get("marker")
        out.append(
            {
                "label": str(item.get("label") or "")[:_MAX_LABEL_LEN],
                "x": _safe_float(item.get("x")),
                "y": _safe_float(item.get("y")),
                "dpr": _safe_float(item.get("dpr"), default=1.0),
                # "ring" (a click) or "pointer" (a manual/hotkey capture).
                "marker": "pointer" if marker == "pointer" else "ring",
            }
        )
    return out
