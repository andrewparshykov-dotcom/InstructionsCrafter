"""In-memory job store for asynchronous document generation.

The extension used to hold ONE long HTTP request open while the whole
pipeline ran (upload -> Gemini -> .docx). Anything on the network path that
dislikes idle connections (VPN gateways, nginx's proxy_read_timeout) could
kill that silent multi-minute wait. Now the upload endpoints reply
immediately with a job id, the extension polls the job status every few
seconds, and downloads the result when it is ready — traffic keeps flowing,
so there is never a long idle connection to kill.

DECISION: jobs live in a plain module-level dict, which requires the backend
to run as a SINGLE uvicorn worker process (the systemd unit starts plain
`uvicorn`, which is single-process by default). No Redis/queue/database for
a <=5-user internal tool.
"""

import asyncio
import shutil
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import HTTPException

from app.pipeline import cleanup_workdir

# A finished job (its workdir then holds only the .docx) is kept briefly so
# the extension can download it — and retry the download if a network blip
# interrupts it — then everything is deleted. This keeps the "no long-term
# storage" principle with a hard time bound.
FINISHED_JOB_TTL_SECONDS = 30 * 60

# Hard cap on one generation, so a hung Gemini/FFmpeg call cannot occupy a
# PIPELINE_SEMAPHORE slot forever. The clock includes time spent queued for
# a semaphore slot, hence the generous value.
JOB_MAX_RUNTIME_SECONDS = 30 * 60

# Backstop: drop anything this old regardless of state.
JOB_MAX_AGE_SECONDS = 2 * 60 * 60


@dataclass
class Job:
    id: str
    workdir: Path
    filename: str  # download filename for the finished .docx
    status: str = "processing"  # processing | done | error
    error: str | None = None
    result_path: Path | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    # Strong reference to the background task — asyncio only keeps weak refs,
    # so without this the task could be garbage-collected mid-run.
    task: asyncio.Task | None = None


_jobs: dict[str, Job] = {}


def create_job(workdir: Path, filename: str) -> Job:
    purge_expired()
    job = Job(id=uuid.uuid4().hex, workdir=workdir, filename=filename)
    _jobs[job.id] = job
    return job


def get_job(job_id: str) -> Job | None:
    purge_expired()
    return _jobs.get(job_id)


def start_job(job: Job, pipeline_coro) -> None:
    """Run a pipeline coroutine in the background, recording its outcome."""
    job.task = asyncio.create_task(_run(job, pipeline_coro))


async def _run(job: Job, pipeline_coro) -> None:
    try:
        output_path = await asyncio.wait_for(
            pipeline_coro, timeout=JOB_MAX_RUNTIME_SECONDS
        )
    except HTTPException as exc:
        # The pipelines raise HTTPException with user-friendly details
        # (silent recording, Gemini failure, ...) — pass those through.
        _fail(job, str(exc.detail))
    except asyncio.TimeoutError:
        _fail(job, "Document generation timed out after 30 minutes. Please try again.")
    except Exception as exc:  # pipeline._step wraps most errors; last resort
        print(f"[{job.id}] job crashed: {exc!r}", file=sys.stderr)
        _fail(job, "Document generation failed")
    else:
        # Free the big inputs (video/frames) right away; keep only the .docx
        # until it is downloaded or the TTL purge removes it.
        _slim_workdir(job.workdir, keep=output_path)
        job.result_path = output_path
        job.status = "done"
        job.finished_at = time.time()


def _fail(job: Job, message: str) -> None:
    job.error = message
    job.status = "error"
    job.finished_at = time.time()
    cleanup_workdir(job.workdir)


def _slim_workdir(workdir: Path, keep: Path) -> None:
    for path in workdir.iterdir():
        if path == keep:
            continue
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


def purge_expired() -> None:
    now = time.time()
    for job_id, job in list(_jobs.items()):
        finished_and_stale = (
            job.finished_at is not None
            and now - job.finished_at > FINISHED_JOB_TTL_SECONDS
        )
        if finished_and_stale or now - job.created_at > JOB_MAX_AGE_SECONDS:
            cleanup_workdir(job.workdir)
            del _jobs[job_id]
