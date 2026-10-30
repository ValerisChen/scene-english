from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# 生产用 PostgreSQL 的 JSONB，测试时可以落到 SQLite 的 JSON
JSONType = JSON().with_variant(JSONB(), "postgresql")


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class Film(Base):
    __tablename__ = "films"
    __table_args__ = (UniqueConstraint("owner_id", "fingerprint"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # 用户导入的影片只对所有者可见
    owner_id: Mapped[int] = mapped_column(index=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(200))
    file_name: Mapped[str | None] = mapped_column(String(500))
    duration_sec: Mapped[float | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    scenes: Mapped[list["Scene"]] = relationship(
        back_populates="film", order_by="Scene.seq", cascade="all, delete-orphan"
    )
    jobs: Mapped[list["ProcessingJob"]] = relationship(back_populates="film", cascade="all, delete-orphan")


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    film_id: Mapped[int] = mapped_column(ForeignKey("films.id", ondelete="CASCADE"), index=True)
    status: Mapped[JobStatus] = mapped_column(String(20), default=JobStatus.queued)
    current_step: Mapped[str | None] = mapped_column(String(40))
    progress: Mapped[float] = mapped_column(default=0.0)
    error: Mapped[str | None] = mapped_column(Text)
    cost_usd: Mapped[float] = mapped_column(default=0.0)
    stats: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    film: Mapped[Film] = relationship(back_populates="jobs")


class Scene(Base):
    __tablename__ = "scenes"
    __table_args__ = (UniqueConstraint("film_id", "seq"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    film_id: Mapped[int] = mapped_column(ForeignKey("films.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int]
    start_ms: Mapped[int]
    end_ms: Mapped[int]
    title_zh: Mapped[str] = mapped_column(String(100))
    title_en: Mapped[str] = mapped_column(String(100))
    summary_zh: Mapped[str] = mapped_column(Text, default="")
    # 台词、声音标注、单词卡、测验：基本只读，结构会随内容迭代，所以整体存 JSON
    content: Mapped[dict[str, Any]] = mapped_column(JSONType)

    film: Mapped[Film] = relationship(back_populates="scenes")
