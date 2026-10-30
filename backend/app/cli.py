"""命令行工具：不用起服务，直接拿本地视频跑流水线，检查质量。

uv run scene-english transcribe ~/Movies/Titanic.mp4 --start 41:00 --duration 600
uv run scene-english process ~/Movies/Titanic.mp4 --title 泰坦尼克号 --start 41:00 --duration 600
uv run scene-english import ~/Movies/Titanic.mkv
"""

import json
import tempfile
from pathlib import Path
from typing import Annotated

import typer

from app.config import get_settings
from app.pipeline.audio import probe_duration, to_wav
from app.pipeline.fingerprint import file_fingerprint
from app.pipeline.speech import recognize
from app.pipeline.transcribe import MlxWhisperTranscriber

cli = typer.Typer(no_args_is_help=True, add_completion=False)

Start = Annotated[str | None, typer.Option(help="从哪里开始，秒数或 mm:ss / hh:mm:ss")]
Duration = Annotated[float | None, typer.Option(help="只处理多少秒，调试时建议 600")]


def parse_clock(value: str | None) -> float | None:
    if not value:
        return None
    seconds = 0.0
    for part in value.split(":"):
        seconds = seconds * 60 + float(part)
    return seconds


@cli.command()
def fingerprint(file: Path) -> None:
    """计算文件指纹（和网页端算法一致）。"""
    typer.echo(file_fingerprint(file))


@cli.command()
def transcribe(
    file: Path,
    start: Start = None,
    duration: Duration = None,
    model: Annotated[str | None, typer.Option(help="Whisper 模型，默认读配置")] = None,
    separate: Annotated[bool, typer.Option(help="识别前先分离人声")] = True,
) -> None:
    """只做语音识别，打印带时间的台词。不需要 API key。

    行首 ? 表示识别没把握；最后列出被当作幻听丢掉的句子。
    """
    settings = get_settings()
    offset = parse_clock(start)
    with tempfile.TemporaryDirectory() as tmp:
        wav = to_wav(file, Path(tmp) / "audio.wav", start=offset, duration=duration)
        lines, dropped = recognize(
            wav,
            MlxWhisperTranscriber(model or settings.whisper_model),
            Path(tmp),
            offset=offset or 0.0,
            separate=separate,
            vad_threshold=settings.vad_threshold,
            on_stage=lambda stage: typer.echo({"vocals": "分离人声…", "asr": "识别台词…"}[stage], err=True),
        )
    for line in lines:
        mark = "?" if line.confidence < 0.6 else " "
        typer.echo(f"{mark}{line.start:8.1f}–{line.end:8.1f}  {line.text}")
    typer.echo(f"\n共 {len(lines)} 句")
    if dropped:
        typer.echo(f"丢掉 {len(dropped)} 句疑似幻听：")
        for line in dropped:
            typer.echo(f"  {line.start:8.1f}  {line.text}（置信度 {line.confidence:.2f}）")


@cli.command()
def process(
    file: Path,
    title: Annotated[str, typer.Option(help="影片名，只用于报告")] = "",
    start: Start = None,
    duration: Duration = None,
    out: Annotated[Path, typer.Option(help="输出目录")] = Path("data/output"),
) -> None:
    """跑完整流水线，输出 JSON 和一份 Markdown 质量报告。需要 ANTHROPIC_API_KEY。"""
    from app.pipeline.report import render_report
    from app.pipeline.runner import run_pipeline

    settings = get_settings()
    title = title or file.stem
    total = probe_duration(file)
    typer.echo(f"{file.name} · 片长 {total or 0:.0f} 秒 · 指纹 {file_fingerprint(file)[:12]}")

    result = run_pipeline(
        file,
        settings,
        start=parse_clock(start),
        duration=duration,
        on_progress=lambda step, p: typer.echo(f"[{p:5.0%}] {step}"),
    )

    out.mkdir(parents=True, exist_ok=True)
    stem = f"{file.stem}-{int(parse_clock(start) or 0)}s"
    (out / f"{stem}.json").write_text(result.model_dump_json(indent=2), encoding="utf-8")
    (out / f"{stem}.md").write_text(render_report(title, result), encoding="utf-8")
    typer.echo(json.dumps({k: result.stats[k] for k in ("lines", "scenes", "words")}, ensure_ascii=False))
    typer.echo(f"费用 ${result.cost_usd:.4f}，报告：{out / f'{stem}.md'}")


@cli.command("import")
def import_cmd(
    file: Path,
    title: Annotated[str, typer.Option(help="影片名，默认用文件名")] = "",
) -> None:
    """导入到网页片库：本地提取音轨，交给 worker 处理，进度在网页上看。

    浏览器解不了音轨时（例如 mkv 里的 AC-3 / DTS）用这个。需要 worker 在运行。
    """
    import uuid

    from sqlalchemy import select

    from app.db import get_sessionmaker
    from app.models import Film, JobStatus, ProcessingJob
    from app.pipeline.audio import to_opus
    from app.worker import process_film_task

    settings = get_settings()
    fingerprint = file_fingerprint(file)
    with get_sessionmaker()() as db:
        film = db.scalar(
            select(Film).where(Film.owner_id == settings.owner_id, Film.fingerprint == fingerprint)
        )
        if film and film.scenes:
            typer.echo(f"这个文件已经处理过了：影片 #{film.id}「{film.title}」")
            raise typer.Exit()
        latest = max(film.jobs, key=lambda j: j.id) if film and film.jobs else None
        if latest and latest.status in (JobStatus.queued, JobStatus.running):
            typer.echo(f"影片 #{film.id}「{film.title}」正在处理中，去网页片库看进度")
            raise typer.Exit()
        if film is None:
            film = Film(
                owner_id=settings.owner_id,
                fingerprint=fingerprint,
                title=title or " ".join(file.stem.replace("_", " ").replace(".", " ").split()),
                file_name=file.name,
                duration_sec=probe_duration(file),
            )
            db.add(film)
            db.flush()

        typer.echo("提取音轨…")
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        audio = to_opus(file, settings.upload_dir / f"{film.id}-{uuid.uuid4().hex}.ogg")
        job = ProcessingJob(film_id=film.id, stats={})
        db.add(job)
        db.commit()
        process_film_task.delay(job.id, str(audio.resolve()))
        typer.echo(f"已提交：影片 #{film.id}「{film.title}」，音轨 {audio.stat().st_size / 1e6:.1f} MB。")
        typer.echo("在网页上选择同一个文件学习时会自动认出它。")


@cli.command("seed-demo")
def seed_demo_cmd(
    file: Annotated[Path | None, typer.Argument(help="你本地的影片文件，用它的指纹绑定示例数据")] = None,
) -> None:
    """写入一份示例场景，方便在没有 API key 时试用网页。"""
    from app.db import get_sessionmaker
    from app.demo_seed import seed_demo

    fingerprint = file_fingerprint(file) if file else "0" * 64
    duration = probe_duration(file) if file else None
    with get_sessionmaker()() as db:
        film = seed_demo(db, get_settings().owner_id, fingerprint, duration)
        typer.echo(f"已写入示例影片 #{film.id}「{film.title}」，指纹 {fingerprint[:12]}")


def main() -> None:
    cli()
