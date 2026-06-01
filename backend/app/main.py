"""FastAPI application for the InstructionsCrafter backend."""

import json
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
    if not SHARED_PASSWORD or not secrets.compare_digest(password, SHARED_PASSWORD):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not (1 <= len(title) <= 200):
        raise HTTPException(status_code=400, detail="Title must be 1 to 200 characters")

    if video.size is not None and video.size > MAX_VIDEO_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Video exceeds maximum size")
    if video.size == 0:
        raise HTTPException(status_code=400, detail="Empty video file")

    workdir = create_temp_workdir()
    try:
        # Stream the upload to disk in chunks so a 500 MB request does not
        # have to be held entirely in memory.
        upload_ext = Path(video.filename or "upload.mp4").suffix or ".mp4"
        upload_path = workdir / f"upload{upload_ext}"
        with upload_path.open("wb") as out:
            while chunk := await video.read(UPLOAD_CHUNK_BYTES):
                out.write(chunk)

        clicks = _parse_clicklog(clicklog)
        output_path = await process_video(upload_path, title, workdir, clicks=clicks)
    except Exception:
        # Failure path: clean up immediately, before the exception propagates.
        cleanup_workdir(workdir)
        raise

    # Success path: cleanup runs AFTER FileResponse has finished streaming.
    background_tasks.add_task(cleanup_workdir, workdir)

    filename = f"{_sanitize_title(title)}_{date.today().isoformat()}.docx"
    return FileResponse(
        path=str(output_path),
        media_type=DOCX_MEDIA_TYPE,
        filename=filename,
    )


def _sanitize_title(title: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 \-]", "_", title).strip()
    return cleaned or "document"


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
