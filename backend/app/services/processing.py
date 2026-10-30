import logging
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import JobStatus, ProcessingJob, Scene
from app.pipeline.runner import PipelineResult, run_pipeline

log = logging.getLogger(__name__)


def save_result(db: Session, film_id: int, result: PipelineResult) -> None:
    db.execute(delete(Scene).where(Scene.film_id == film_id))
    for s in result.scenes:
        db.add(Scene(film_id=film_id, **s.model_dump()))


def process_job(db: Session, job_id: int, media: Path, settings: Settings, delete_media: bool = True) -> None:
    job = db.get(ProcessingJob, job_id)
    if job is None:
        raise ValueError(f"job {job_id} not found")

    def on_progress(step: str, progress: float) -> None:
        job.current_step, job.progress = step, round(progress, 3)
        db.commit()

    job.status = JobStatus.running
    db.commit()
    try:
        result = run_pipeline(media, settings, on_progress=on_progress)
        save_result(db, job.film_id, result)
        job.status, job.cost_usd, job.stats = JobStatus.succeeded, result.cost_usd, result.stats
        db.commit()
    except Exception as e:
        db.rollback()
        log.exception("job %s failed", job_id)
        job.status, job.error = JobStatus.failed, f"{type(e).__name__}: {e}"
        db.commit()
        raise
    finally:
        # 上传的音轨处理完就删，不留存
        if delete_media:
            media.unlink(missing_ok=True)
