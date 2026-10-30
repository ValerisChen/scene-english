from pydantic import BaseModel

from app.pipeline.llm import LLM
from app.pipeline.types import Line, SceneSpan

SYSTEM = """You split a film's dialogue transcript into scenes for an English-learning app.
Chinese learners study one scene at a time, so each scene must be a self-contained unit of story.

A scene is continuous action in one place and time. Long pauses (shown as "+Ns" before a line),
a change of location, or a jump in time usually mark a boundary. Aim for scenes of 2-6 minutes;
if a scene runs past about 6 minutes or 60 lines, split it at the most natural turn in the conversation.
Every line must belong to exactly one scene, scenes must be in order and must not overlap.

For each scene give:
- first_line / last_line: the bracketed line numbers it covers, inclusive
- title_zh: a short Chinese title, at most 12 characters, naming the place or the key moment
- title_en: a 1-4 word English title
- summary_zh: one Chinese sentence saying what happens"""


class _SceneOut(BaseModel):
    first_line: int
    last_line: int
    title_zh: str
    title_en: str
    summary_zh: str


class _SegmentOut(BaseModel):
    scenes: list[_SceneOut]


def _clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def format_transcript(lines: list[Line]) -> str:
    rows = []
    for i, line in enumerate(lines):
        gap = line.start - lines[i - 1].end if i else 0.0
        rows.append(f"[{line.idx}] {_clock(line.start)} +{max(gap, 0):.1f}s {line.text}")
    return "\n".join(rows)


def repair_spans(scenes: list[_SceneOut], n_lines: int) -> list[SceneSpan]:
    """模型给的边界不一定严丝合缝：排序、去掉重叠和空洞，保证每句只属于一个场景。"""
    if n_lines == 0:
        return []
    ordered = sorted(scenes, key=lambda s: s.first_line)
    spans: list[SceneSpan] = []
    next_first = 0
    for s in ordered:
        last = min(max(s.last_line, next_first), n_lines - 1)
        if next_first > n_lines - 1 or last < next_first:
            continue
        spans.append(
            SceneSpan(
                seq=len(spans) + 1,
                first_line=next_first,
                last_line=last,
                title_zh=s.title_zh,
                title_en=s.title_en,
                summary_zh=s.summary_zh,
            )
        )
        next_first = last + 1
    if not spans:
        return [
            SceneSpan(
                seq=1,
                first_line=0,
                last_line=n_lines - 1,
                title_zh="全片",
                title_en="Full Film",
                summary_zh="",
            )
        ]
    if spans[-1].last_line < n_lines - 1:
        spans[-1].last_line = n_lines - 1
    return spans


def segment_scenes(lines: list[Line], llm: LLM, model: str) -> list[SceneSpan]:
    result = llm.structured(
        model=model,
        system=SYSTEM,
        prompt=f"Transcript ({len(lines)} lines):\n\n{format_transcript(lines)}",
        schema=_SegmentOut,
    )
    return repair_spans(result.scenes, len(lines))
