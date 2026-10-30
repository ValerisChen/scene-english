import os
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.config import Settings
from app.pipeline.audio import to_wav
from app.pipeline.content import generate_scene_content
from app.pipeline.llm import LLM
from app.pipeline.segment import segment_scenes
from app.pipeline.speech import recognize
from app.pipeline.transcribe import MlxWhisperTranscriber, Transcriber
from app.pipeline.types import Line
from app.pipeline.vocab import film_occurrences, scene_candidates


class MissingAPIKeyError(RuntimeError):
    pass


# (步骤名, 0-1 的总体进度)
ProgressFn = Callable[[str, float], None]


class SceneResult(BaseModel):
    seq: int
    start_ms: int
    end_ms: int
    title_zh: str
    title_en: str
    summary_zh: str
    content: dict[str, Any]


class PipelineResult(BaseModel):
    lines: list[Line]
    scenes: list[SceneResult]
    cost_usd: float
    stats: dict[str, Any]


def _brief(line: Line) -> dict[str, Any]:
    return {"start": round(line.start, 1), "text": line.text, "confidence": line.confidence}


def run_pipeline(
    media: Path,
    settings: Settings,
    *,
    start: float | None = None,
    duration: float | None = None,
    transcriber: Transcriber | None = None,
    llm: LLM | None = None,
    on_progress: ProgressFn = lambda step, p: None,
) -> PipelineResult:
    """音频 → 识别 → 场景切分 → 逐场生成学习内容。start/duration 用来只处理一段。"""
    transcriber = transcriber or MlxWhisperTranscriber(settings.whisper_model)
    if llm is None:
        # 人声分离和识别要跑很久，没有 key 就先别开始，免得白跑一趟最后才失败
        key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None
        if not key and not os.environ.get("ANTHROPIC_API_KEY"):
            raise MissingAPIKeyError("没有配置 ANTHROPIC_API_KEY：在 backend/.env 里填上，然后重启 worker")
        llm = LLM(effort=settings.llm_effort, api_key=key)
    timings: dict[str, float] = {}
    warnings: list[str] = []

    def timed(step: str, t0: float) -> None:
        timings[step] = round(time.monotonic() - t0, 1)

    with tempfile.TemporaryDirectory() as tmp:
        on_progress("audio", 0.02)
        t0 = time.monotonic()
        wav = to_wav(media, Path(tmp) / "audio.wav", start=start, duration=duration)
        timed("audio", t0)

        # recognize 内部分"分离人声"和"识别"两段，进入下一段时记下上一段的耗时
        current: list[tuple[str, float]] = []

        def stage(name: str) -> None:
            if current:
                timed(*current.pop())
            current.append((name, time.monotonic()))
            on_progress(name, {"vocals": 0.04, "asr": 0.2}[name])

        lines, dropped = recognize(
            wav,
            transcriber,
            Path(tmp),
            offset=start or 0.0,
            separate=settings.separate_vocals,
            vad_threshold=settings.vad_threshold,
            on_stage=stage,
        )
        timed(*current.pop())
    if not lines:
        raise RuntimeError("没有识别出任何台词")

    on_progress("scene", 0.35)
    t0 = time.monotonic()
    spans = segment_scenes(lines, llm, settings.llm_model_segment)
    timed("scene", t0)

    occurrences = film_occurrences(lines, spans)
    taught: set[str] = set()
    characters: list[str] = []
    scenes: list[SceneResult] = []
    t0 = time.monotonic()
    # 必须按顺序逐场生成：前面讲过的词，后面不再算生词
    for k, span in enumerate(spans):
        on_progress("content", 0.4 + 0.6 * k / len(spans))
        scene_lines = lines[span.first_line : span.last_line + 1]
        candidates = scene_candidates(scene_lines, settings.vocab_zipf_max, exclude=taught)
        content, scene_warnings = generate_scene_content(
            llm, settings.llm_model_content, span, scene_lines, candidates, taught, characters, occurrences
        )
        warnings += [f"SC {span.seq:02d}：{w}" for w in scene_warnings]
        taught |= {w["lemma"].lower() for w in content["words"]}
        for line in content["lines"]:
            if line["speaker"] not in ("?", *characters):
                characters.append(line["speaker"])
        scenes.append(
            SceneResult(
                seq=span.seq,
                start_ms=int(scene_lines[0].start * 1000),
                end_ms=int(scene_lines[-1].end * 1000),
                title_zh=span.title_zh,
                title_en=span.title_en,
                summary_zh=span.summary_zh,
                content=content,
            )
        )
    timed("content", t0)
    on_progress("done", 1.0)

    return PipelineResult(
        lines=lines,
        scenes=scenes,
        cost_usd=round(llm.cost_usd, 4),
        stats={
            "lines": len(lines),
            "scenes": len(scenes),
            "words": sum(len(s.content["words"]) for s in scenes),
            "characters": characters,
            "seconds": timings,
            "llm_calls": llm.calls,
            "warnings": warnings,
            # 给人工核对用：被当作幻听丢掉的句子，和留下来但没把握的句子
            "dropped_lines": [_brief(line) for line in dropped],
            "uncertain_lines": [_brief(line) for line in lines if line.confidence < 0.6],
        },
    )
