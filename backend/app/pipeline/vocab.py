from collections import defaultdict
from functools import lru_cache

from pydantic import BaseModel
from wordfreq import zipf_frequency

from app.pipeline.types import Line, SceneSpan

CONTENT_POS = {"NOUN", "VERB", "ADJ", "ADV"}


class Candidate(BaseModel):
    lemma: str
    surface: str
    line_idx: int  # 场景内的序号
    zipf: float


class Occurrence(BaseModel):
    scene_seq: int
    text: str


@lru_cache
def _nlp():
    import spacy

    return spacy.load("en_core_web_sm", disable=["parser", "ner"])


def _content_tokens(text: str):
    for tok in _nlp()(text):
        if tok.is_alpha and not tok.is_stop and tok.pos_ in CONTENT_POS and len(tok.text) >= 3:
            yield tok.lemma_.lower(), tok.text


def scene_candidates(
    scene_lines: list[Line], zipf_max: float, exclude: set[str] = frozenset()
) -> list[Candidate]:
    """本场里可能需要讲的词：实词、词频够低、之前的场景没讲过。按生僻程度排序。"""
    seen: dict[str, Candidate] = {}
    for i, line in enumerate(scene_lines):
        for lemma, surface in _content_tokens(line.text):
            if lemma in seen or lemma in exclude:
                continue
            z = zipf_frequency(lemma, "en")
            # Zipf 太低的多半是识别错误或人名，不当生词
            if 1.5 < z < zipf_max:
                seen[lemma] = Candidate(lemma=lemma, surface=surface, line_idx=i, zipf=round(z, 2))
    return sorted(seen.values(), key=lambda c: c.zipf)


def film_occurrences(lines: list[Line], spans: list[SceneSpan]) -> dict[str, list[Occurrence]]:
    """每个词在全片出现在哪些场景的哪句话里，用来给单词卡找"本片例句"。"""
    occ: dict[str, list[Occurrence]] = defaultdict(list)
    for span in spans:
        for line in lines[span.first_line : span.last_line + 1]:
            for lemma in {lemma for lemma, _ in _content_tokens(line.text)}:
                occ[lemma].append(Occurrence(scene_seq=span.seq, text=line.text))
    return occ
