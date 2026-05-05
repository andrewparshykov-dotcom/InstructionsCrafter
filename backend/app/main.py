"""FastAPI application for the InstructionsCrafter backend."""

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
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.pipeline import cleanup_workdir, create_temp_workdir, process_video

load_dotenv()

SHARED_PASSWORD = os.getenv("SHARED_PASSWORD", "")
MAX_VIDEO_SIZE_MB = int(os.getenv("MAX_VIDEO_SIZE_MB", "500"))
MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024

# 1 MB chunks when streaming the upload to disk; keeps a 500 MB upload
# from being held entirely in process memory.
UPLOAD_CHUNK_BYTES = 1024 * 1024

DOCX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)

app = FastAPI(title="InstructionsCrafter API")


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


@app.post("/api/generate")
async def generate(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    title: str = Form(...),
    password: str = Form(...),
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

        output_path = await process_video(upload_path, title, workdir)
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
