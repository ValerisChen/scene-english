"""Celery 入口。macOS 上请用单进程模式启动，MLX 在 fork 出来的子进程里不稳定：

uv run celery -A app.worker worker --pool=solo --loglevel=info
"""

from pathlib import Path

from celery import Celery

from app.config import get_settings
from app.db import get_sessionmaker
from app.services.processing import process_job

settings = get_settings()
celery_app = Celery("scene_english", broker=settings.redis_url)
celery_app.conf.update(task_acks_late=True, worker_prefetch_multiplier=1)


@celery_app.task(name="process_film")
def process_film_task(job_id: int, media_path: str) -> None:
    with get_sessionmaker()() as db:
        process_job(db, job_id, Path(media_path), settings)
