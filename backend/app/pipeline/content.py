import json
from typing import Any, Literal

from pydantic import BaseModel

from app.pipeline.llm import LLM
from app.pipeline.markup import markup_matches
from app.pipeline.types import Line, SceneSpan
from app.pipeline.vocab import Candidate, Occurrence

SYSTEM = """You write study material for one scene of a film, for an English-learning app used by Chinese speakers.
The learner already knows roughly 4,000-6,000 common English words and can read simple English,
but cannot follow native speech and cannot speak. Their goal is to watch this film with no subtitles.
All explanations are in Simplified Chinese, short and plain.

You receive the scene's numbered lines, candidate words found in it, words already taught in earlier scenes,
and where each candidate appears elsewhere in the film. Produce three things.

1. lines - one entry for EVERY line, same idx:
   - speaker: the character's name, inferred from context; use names already listed under "known characters"
     when it is the same person; "?" if you cannot tell
   - zh: a natural Chinese translation that fits the scene
   - markup: the line's exact text, unchanged, with connected-speech marks inserted:
       a~b  linking between two words (Come~on)
       °w   weak form (pull °you)
       ^w   dropped or flapped sound (^water, ^let go)
       {a_b} reduced form, words inside joined by _ ({gonna}, {you'd_have})
     Removing the marks must give back the original text exactly. Mark only what a learner would actually
     miss when listening; a short line may need no marks at all.
   - notes: 0-3 Chinese notes explaining the marked sounds, e.g. "pull you 里的 you 弱读成 /jə/"

2. words - pick 3-8 words or phrases worth teaching, mainly from the candidates. You may merge a candidate into
   the phrase it belongs to in the line (a phrasal verb or fixed expression such as "let go").
   Skip names, words in "already taught", and words this learner surely knows. For each:
   - text, lemma (dictionary form), ipa (American), pos (n. / v. / adj. / adv. / phr.), zh (meaning in this scene)
   - line_idx: the line it appears in; highlight: the exact substring of that line to highlight
   - collocations: 2-3, the one used in this scene first with in_film=true
   - examples: exactly 2. Prefer a real line from "elsewhere in the film" (source "film", copy the line exactly,
     give its scene_seq); otherwise write a natural everyday sentence (source "ai", scene_seq null). Each with zh.

3. quiz - exactly 4 multiple-choice questions in Chinese, 3 options each, answer_index 0-2.
   Test whether the learner understood what was SAID (you only have the dialogue, not the picture).
   The last question is a listening check: audio_line_idx points at one line, and the options are that line's
   ending plus two similar-sounding but wrong variants. The other questions have audio_line_idx null."""


class LineOut(BaseModel):
    idx: int
    speaker: str
    zh: str
    markup: str
    notes: list[str]


class Collocation(BaseModel):
    text: str
    zh: str
    in_film: bool


class Example(BaseModel):
    en: str
    zh: str
    source: Literal["film", "ai"]
    scene_seq: int | None


class WordCard(BaseModel):
    text: str
    lemma: str
    ipa: str
    pos: str
    zh: str
    line_idx: int
    highlight: str
    collocations: list[Collocation]
    examples: list[Example]


class QuizQuestion(BaseModel):
    question_zh: str
    options: list[str]
    answer_index: int
    audio_line_idx: int | None


class SceneContentOut(BaseModel):
    lines: list[LineOut]
    words: list[WordCard]
    quiz: list[QuizQuestion]


def build_prompt(
    span: SceneSpan,
    scene_lines: list[Line],
    candidates: list[Candidate],
    taught: set[str],
    characters: list[str],
    occurrences: dict[str, list[Occurrence]],
) -> str:
    elsewhere = {
        c.lemma: [o.model_dump() for o in occurrences.get(c.lemma, []) if o.scene_seq != span.seq][:3]
        for c in candidates
    }
    numbered = "\n".join(f"[{i}] {line.text}" for i, line in enumerate(scene_lines))
    return "\n\n".join(
        [
            f"Scene {span.seq}: {span.title_en} ({span.title_zh}). {span.summary_zh}",
            f"Lines:\n{numbered}",
            "Candidates (lemma, surface, line, Zipf frequency - lower is rarer):\n"
            + "\n".join(f"- {c.lemma} / {c.surface} / [{c.line_idx}] / {c.zipf}" for c in candidates),
            f"Already taught: {', '.join(sorted(taught)) or '(none)'}",
            f"Known characters: {', '.join(characters) or '(none yet)'}",
            "Elsewhere in the film:\n"
            + json.dumps({k: v for k, v in elsewhere.items() if v}, ensure_ascii=False),
        ]
    )


def merge_content(scene_lines: list[Line], out: SceneContentOut) -> tuple[dict[str, Any], list[str]]:
    """把模型输出和识别出的台词合并，并修掉不可信的部分。返回 (content, 警告列表)。"""
    warnings: list[str] = []
    by_idx = {item.idx: item for item in out.lines}
    lines = []
    for i, line in enumerate(scene_lines):
        item = by_idx.get(i)
        if item is None:
            warnings.append(f"第 {i} 句没有生成内容")
        markup = item.markup if item else line.text
        if item and not markup_matches(markup, line.text):
            warnings.append(f"第 {i} 句的标注改动了原台词，已丢弃标注")
            markup = line.text
        lines.append(
            {
                "start": round(line.start, 2),
                "end": round(line.end, 2),
                "text": line.text,
                "speaker": item.speaker if item else "?",
                "zh": item.zh if item else "",
                "markup": markup,
                "notes": item.notes if item else [],
            }
        )

    words = []
    for card in out.words:
        if not 0 <= card.line_idx < len(scene_lines):
            warnings.append(f"单词 {card.text} 指向了不存在的台词，已丢弃")
            continue
        data = card.model_dump()
        if card.highlight.lower() not in scene_lines[card.line_idx].text.lower():
            data["highlight"] = card.text
        words.append(data)

    quiz = []
    for q in out.quiz:
        audio_ok = q.audio_line_idx is None or 0 <= q.audio_line_idx < len(scene_lines)
        if len(q.options) < 2 or not 0 <= q.answer_index < len(q.options) or not audio_ok:
            warnings.append(f"测验题「{q.question_zh}」格式不对，已丢弃")
            continue
        quiz.append(q.model_dump())

    return {"lines": lines, "words": words, "quiz": quiz}, warnings


def generate_scene_content(
    llm: LLM,
    model: str,
    span: SceneSpan,
    scene_lines: list[Line],
    candidates: list[Candidate],
    taught: set[str],
    characters: list[str],
    occurrences: dict[str, list[Occurrence]],
) -> tuple[dict[str, Any], list[str]]:
    out = llm.structured(
        model=model,
        system=SYSTEM,
        prompt=build_prompt(span, scene_lines, candidates, taught, characters, occurrences),
        schema=SceneContentOut,
    )
    return merge_content(scene_lines, out)
