import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.models import Film, ProcessingJob, Scene
from app.schemas import FilmCreate, FilmDetail, FilmOut, JobOut, SceneOut, SceneSummary

router = APIRouter()

DB = Annotated[Session, Depends(get_db)]
Config = Annotated[Settings, Depends(get_settings)]
Enqueue = Callable[[int, str], None]

AUDIO_SUFFIXES = {".m4a", ".mp4", ".aac", ".webm", ".ogg", ".opus", ".wav", ".mp3", ".mka"}


def get_enqueue() -> Enqueue:
    from app.worker import process_film_task

    return lambda job_id, path: process_film_task.delay(job_id, path)


def _own_film(db: Session, film_id: int, settings: Settings) -> Film:
    film = db.get(Film, film_id)
    # 不属于当前用户的影片一律当作不存在
    if film is None or film.owner_id != settings.owner_id:
        raise HTTPException(404, "影片不存在")
    return film


def _summary(scene: Scene) -> dict:
    return {
        "id": scene.id,
        "seq": scene.seq,
        "start_ms": scene.start_ms,
        "end_ms": scene.end_ms,
        "title_zh": scene.title_zh,
        "title_en": scene.title_en,
        "summary_zh": scene.summary_zh,
        "word_count": len(scene.content.get("words", [])),
    }


def _detail(film: Film) -> FilmDetail:
    latest = max(film.jobs, key=lambda j: j.id, default=None)
    return FilmDetail(
        **FilmOut.model_validate(film).model_dump(),
        scene_count=len(film.scenes),
        latest_job=JobOut.model_validate(latest) if latest else None,
    )


@router.get("/films", response_model=list[FilmDetail])
def list_films(db: DB, settings: Config) -> list[FilmDetail]:
    films = db.scalars(
        select(Film)
        .where(Film.owner_id == settings.owner_id)
        .order_by(Film.created_at.desc(), Film.id.desc())
    )
    return [_detail(f) for f in films]


@router.get("/films/by-fingerprint/{fingerprint}", response_model=FilmDetail)
def film_by_fingerprint(fingerprint: str, db: DB, settings: Config) -> FilmDetail:
    film = db.scalar(select(Film).where(Film.owner_id == settings.owner_id, Film.fingerprint == fingerprint))
    if film is None:
        raise HTTPException(404, "这个文件还没有处理过")
    return _detail(film)


@router.get("/films/{film_id}", response_model=FilmDetail)
def get_film(film_id: int, db: DB, settings: Config) -> FilmDetail:
    return _detail(_own_film(db, film_id, settings))


@router.post("/films", response_model=FilmDetail, status_code=201)
def create_film(body: FilmCreate, db: DB, settings: Config) -> FilmDetail:
    existing = db.scalar(
        select(Film).where(Film.owner_id == settings.owner_id, Film.fingerprint == body.fingerprint)
    )
    if existing:
        return _detail(existing)
    film = Film(owner_id=settings.owner_id, **body.model_dump())
    db.add(film)
    db.commit()
    return _detail(film)


@router.post("/films/{film_id}/audio", response_model=JobOut, status_code=202)
async def upload_audio(
    film_id: int,
    file: UploadFile,
    db: DB,
    settings: Config,
    enqueue: Annotated[Enqueue, Depends(get_enqueue)],
) -> ProcessingJob:
    film = _own_film(db, film_id, settings)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in AUDIO_SUFFIXES:
        raise HTTPException(415, f"不支持的音频格式：{suffix or '无扩展名'}")

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    path = settings.upload_dir / f"{film.id}-{uuid.uuid4().hex}{suffix}"
    with path.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)

    job = ProcessingJob(film_id=film.id, stats={})
    db.add(job)
    db.commit()
    enqueue(job.id, str(path.resolve()))
    return job


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: DB, settings: Config) -> ProcessingJob:
    job = db.get(ProcessingJob, job_id)
    if job is None:
        raise HTTPException(404, "任务不存在")
    _own_film(db, job.film_id, settings)
    return job


@router.get("/films/{film_id}/scenes", response_model=list[SceneSummary])
def list_scenes(film_id: int, db: DB, settings: Config) -> list[dict]:
    return [_summary(s) for s in _own_film(db, film_id, settings).scenes]


@router.get("/scenes/{scene_id}", response_model=SceneOut)
def get_scene(scene_id: int, db: DB, settings: Config) -> dict:
    scene = db.get(Scene, scene_id)
    if scene is None:
        raise HTTPException(404, "场景不存在")
    _own_film(db, scene.film_id, settings)
    return {**_summary(scene), "content": scene.content}
