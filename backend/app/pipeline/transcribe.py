from pathlib import Path
from typing import Any, Protocol

from app.pipeline.types import Line, Word

SENTENCE_END = (".", "?", "!", "…")


class Transcriber(Protocol):
    def transcribe(self, wav: Path, offset: float = 0.0) -> list[Line]: ...


class MlxWhisperTranscriber:
    """在 Apple 芯片上用 MLX 跑 Whisper。第一次运行会从 Hugging Face 下载模型。"""

    def __init__(self, model: str):
        self.model = model

    def transcribe(self, wav: Path, offset: float = 0.0) -> list[Line]:
        import mlx_whisper

        result = mlx_whisper.transcribe(
            str(wav),
            path_or_hf_repo=self.model,
            language="en",
            word_timestamps=True,
            # 电影里音乐和静音很多，不带上文能减少 Whisper 的循环幻听
            condition_on_previous_text=False,
            hallucination_silence_threshold=2.0,
        )
        return segments_to_lines(result["segments"], offset)


def segments_to_lines(segments: list[dict[str, Any]], offset: float = 0.0) -> list[Line]:
    """Whisper 的分段不一定是整句：有词级时间戳时按句末标点重新切成一句一行。"""
    lines: list[Line] = []

    def emit(text: str, words: list[Word], start: float, end: float) -> None:
        text = " ".join(text.split())
        if not text:
            return
        # 连续重复的同一句多半是幻听
        if lines and lines[-1].text == text:
            return
        confidence = sum(w.probability for w in words) / len(words) if words else 1.0
        lines.append(
            Line(
                idx=len(lines), start=start, end=end, text=text, words=words, confidence=round(confidence, 3)
            )
        )

    def emit_words(words: list[Word]) -> None:
        emit(" ".join(w.text for w in words), words, words[0].start, words[-1].end)

    for seg in segments:
        raw_words = seg.get("words") or []
        if not raw_words:
            emit(seg.get("text", ""), [], seg["start"] + offset, seg["end"] + offset)
            continue
        current: list[Word] = []
        for w in raw_words:
            current.append(
                Word(
                    text=w["word"].strip(),
                    start=w["start"] + offset,
                    end=w["end"] + offset,
                    probability=w.get("probability", 1.0),
                )
            )
            if current[-1].text.endswith(SENTENCE_END):
                emit_words(current)
                current = []
        if current:
            emit_words(current)
    return lines
