"""从电影音轨里拿到干净的台词：分离人声 → 识别 → 用人声检测和识别置信度去掉幻听。

电影对白底下压着配乐和音效，直接识别时 Whisper 会在纯音乐、片尾字幕段编出
"Thank you." 之类的句子；人声检测在混合音轨上也会漏掉大量真实台词。先用 Demucs
把人声分离出来，两者都会准很多。
"""

import re
from collections.abc import Callable
from pathlib import Path

import numpy as np

from app.pipeline.audio import SAMPLE_RATE, read_wav, write_wav
from app.pipeline.transcribe import Transcriber
from app.pipeline.types import Line

Span = tuple[float, float]

# 已经指定了英语，还冒出中日韩文字，基本是乱码（例如片尾常见的"字幕"）
CJK = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]")


class DemucsSeparator:
    """用 Demucs 分离人声。Apple 芯片上走 MPS，12 分钟音频约 2 分钟。"""

    def __init__(self, model: str = "htdemucs", chunk_sec: int = 300):
        self.model = model
        # 整部电影一次性分离要十几 GB 内存，按段处理
        self.chunk_sec = chunk_sec

    def separate(self, src: Path, dst: Path, on_progress: Callable[[float], None] = lambda p: None) -> Path:
        import torch
        from demucs.api import Separator
        from demucs.audio import convert_audio

        device = "mps" if torch.backends.mps.is_available() else "cpu"
        separator = Separator(model=self.model, device=device)
        audio = read_wav(src)
        vocals = np.zeros_like(audio)
        chunk, pad = self.chunk_sec * SAMPLE_RATE, 2 * SAMPLE_RATE
        for begin in range(0, len(audio), chunk):
            on_progress(begin / len(audio))
            # 每段前后多带 2 秒，避免切口处的人声被截断
            a, b = max(0, begin - pad), min(len(audio), begin + chunk + pad)
            x = torch.from_numpy(audio[a:b]).repeat(2, 1)
            _, stems = separator.separate_tensor(x, SAMPLE_RATE)
            v = convert_audio(stems["vocals"], separator.samplerate, SAMPLE_RATE, 1)[0].cpu().numpy()
            n = min(chunk, len(audio) - begin)
            piece = v[begin - a : begin - a + n]
            vocals[begin : begin + len(piece)] = piece
        on_progress(1.0)
        return write_wav(dst, vocals)


def speech_spans(wav: Path, threshold: float = 0.3, offset: float = 0.0) -> list[Span]:
    """Silero VAD 找出有人声的时间段（秒，已加 offset）。"""
    import torch
    from silero_vad import get_speech_timestamps, load_silero_vad

    stamps = get_speech_timestamps(
        torch.from_numpy(read_wav(wav)),
        load_silero_vad(),
        threshold=threshold,
        sampling_rate=SAMPLE_RATE,
        min_speech_duration_ms=200,
        min_silence_duration_ms=300,
        speech_pad_ms=200,
        return_seconds=True,
    )
    return [(s["start"] + offset, s["end"] + offset) for s in stamps]


def voiced_ratio(line: Line, spans: list[Span]) -> float:
    """这句台词有多大比例落在人声段里。有词级时间戳时只算词本身，不算词间停顿。"""
    pieces = [(w.start, w.end) for w in line.words] or [(line.start, line.end)]
    total = sum(e - s for s, e in pieces)
    if total <= 0:
        return 0.0
    covered = sum(max(0.0, min(e, se) - max(s, ss)) for s, e in pieces for ss, se in spans)
    return covered / total


def drop_hallucinations(
    lines: list[Line], spans: list[Span], *, min_voiced: float = 0.2, min_confidence: float = 0.8
) -> tuple[list[Line], list[Line]]:
    """去掉幻听，返回 (保留的, 丢掉的)，保留的会重新编号。

    一种是人声检测几乎没听到、识别也没把握的句子。两个条件都满足才丢：人声检测会漏掉
    喊叫，但这类真台词识别置信度通常很高；幻听的句子置信度低，而且落在没有人声的地方。
    另一种是混进了中日韩文字的乱码。
    """
    kept: list[Line] = []
    dropped: list[Line] = []
    for line in lines:
        unvoiced = line.confidence < min_confidence and voiced_ratio(line, spans) < min_voiced
        if unvoiced or CJK.search(line.text):
            dropped.append(line)
        else:
            kept.append(line.model_copy(update={"idx": len(kept)}))
    return kept, dropped


def recognize(
    wav: Path,
    transcriber: Transcriber,
    workdir: Path,
    *,
    offset: float = 0.0,
    separate: bool = True,
    vad_threshold: float = 0.3,
    on_stage: Callable[[str], None] = lambda stage: None,
) -> tuple[list[Line], list[Line]]:
    """完整的识别流程，返回 (台词, 被当作幻听丢掉的句子)。"""
    if separate:
        on_stage("vocals")
        wav = DemucsSeparator().separate(wav, workdir / "vocals.wav")
    on_stage("asr")
    lines = transcriber.transcribe(wav, offset=offset)
    return drop_hallucinations(lines, speech_spans(wav, vad_threshold, offset))
