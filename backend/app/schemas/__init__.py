from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.pipeline.content import QuizQuestion, WordCard


class FilmCreate(BaseModel):
    fingerprint: str = Field(min_length=16, max_length=64)
    title: str = Field(min_length=1, max_length=200)
    file_name: str | None = None
    duration_sec: float | None = None


class FilmOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    fingerprint: str
    title: str
    file_name: str | None
    duration_sec: float | None
    created_at: datetime


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    film_id: int
    status: str
    current_step: str | None
    progress: float
    error: str | None
    cost_usd: float
    stats: dict[str, Any]


class FilmDetail(FilmOut):
    scene_count: int
    latest_job: JobOut | None


class LineContent(BaseModel):
    start: float
    end: float
    text: str
    speaker: str
    zh: str
    markup: str
    notes: list[str]


class SceneContent(BaseModel):
    lines: list[LineContent]
    words: list[WordCard]
    quiz: list[QuizQuestion]


class SceneSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    seq: int
    start_ms: int
    end_ms: int
    title_zh: str
    title_en: str
    summary_zh: str
    word_count: int


class SceneOut(SceneSummary):
    content: SceneContent
