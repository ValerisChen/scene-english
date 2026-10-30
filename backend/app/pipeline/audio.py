import subprocess
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000


class AudioError(RuntimeError):
    pass


def probe_duration(path: Path) -> float | None:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


def to_wav(src: Path, dst: Path, start: float | None = None, duration: float | None = None) -> Path:
    """转成识别用的 16 kHz 单声道 WAV。start / duration 用来截取开发调试用的片段。"""
    cmd = ["ffmpeg", "-y", "-v", "error"]
    if start:
        cmd += ["-ss", str(start)]
    cmd += ["-i", str(src)]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += ["-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(dst)]
    return _ffmpeg(cmd, dst)


def to_opus(src: Path, dst: Path) -> Path:
    """和网页端一样转成单声道 Opus（Ogg 封装），用于上传处理。"""
    return _ffmpeg(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(src),
            "-vn",
            "-ac",
            "1",
            "-c:a",
            "libopus",
            "-b:a",
            "32k",
            str(dst),
        ],
        dst,
    )


def _ffmpeg(cmd: list[str], dst: Path) -> Path:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise AudioError(result.stderr.strip() or f"ffmpeg exited with {result.returncode}")
    return dst


def read_wav(path: Path) -> np.ndarray:
    """读 to_wav 产出的 16 位单声道 WAV，返回 -1..1 的 float32。"""
    with wave.open(str(path)) as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != SAMPLE_RATE:
            raise AudioError(f"需要 {SAMPLE_RATE} Hz 16 位单声道 WAV：{path}")
        data = w.readframes(w.getnframes())
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768


def write_wav(path: Path, samples: np.ndarray) -> Path:
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return path
