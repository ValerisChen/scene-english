import hashlib
import struct

from app.pipeline.content import SceneContentOut, merge_content
from app.pipeline.fingerprint import CHUNK, file_fingerprint
from app.pipeline.llm import strict_schema
from app.pipeline.markup import markup_matches, plain
from app.pipeline.segment import _SceneOut, repair_spans
from app.pipeline.speech import drop_hallucinations, voiced_ratio
from app.pipeline.transcribe import segments_to_lines
from app.pipeline.types import Line, Word
from app.pipeline.vocab import scene_candidates


def test_plain_strips_marks():
    assert plain("If °you °were {gonna} do~it, {you'd_have} done~it~already.") == (
        "If you were gonna do it, you'd have done it already."
    )


def test_markup_matches_ignores_case_and_curly_quotes():
    assert markup_matches("Come~on, I'll pull °you back~over.", "Come on, I’ll pull you back over.")
    assert not markup_matches("Come~on, I will pull °you back.", "Come on, I'll pull you back over.")


def test_fingerprint_matches_browser_algorithm(tmp_path):
    data = bytes(range(256)) * 1000  # 256 KB，首尾片段不重叠
    f = tmp_path / "movie.mp4"
    f.write_bytes(data)
    expected = hashlib.sha256(data[:CHUNK] + data[-CHUNK:] + struct.pack(">d", float(len(data)))).hexdigest()
    assert file_fingerprint(f) == expected


def test_fingerprint_small_file(tmp_path):
    f = tmp_path / "tiny.mp4"
    f.write_bytes(b"abc")
    assert file_fingerprint(f) == hashlib.sha256(b"abc" + b"abc" + struct.pack(">d", 3.0)).hexdigest()


def test_segments_split_into_sentences_and_offset():
    words = [
        {"word": " Stay", "start": 0.0, "end": 0.3},
        {"word": " back!", "start": 0.3, "end": 0.6},
        {"word": " Don't", "start": 1.0, "end": 1.2},
        {"word": " come", "start": 1.2, "end": 1.4},
        {"word": " closer.", "start": 1.4, "end": 1.9},
    ]
    lines = segments_to_lines([{"start": 0, "end": 2, "text": "", "words": words}], offset=100)
    assert [line.text for line in lines] == ["Stay back!", "Don't come closer."]
    assert lines[1].start == 101.0 and lines[1].end == 101.9
    assert [line.idx for line in lines] == [0, 1]


def test_segments_drop_repeated_hallucination():
    segs = [{"start": i, "end": i + 1, "text": " Thank you.", "words": []} for i in range(3)]
    assert len(segments_to_lines(segs)) == 1


def _span(first, last):
    return _SceneOut(first_line=first, last_line=last, title_zh="t", title_en="t", summary_zh="")


def test_repair_spans_fills_gaps_and_overlaps():
    spans = repair_spans([_span(5, 9), _span(0, 3), _span(8, 12)], n_lines=15)
    assert [(s.first_line, s.last_line) for s in spans] == [(0, 3), (4, 9), (10, 14)]
    assert [s.seq for s in spans] == [1, 2, 3]


def test_repair_spans_empty_model_output():
    spans = repair_spans([], n_lines=4)
    assert [(s.first_line, s.last_line) for s in spans] == [(0, 3)]


def test_strict_schema_is_closed_and_inlined():
    schema = strict_schema(SceneContentOut)
    text = str(schema)
    assert "$ref" not in text and "$defs" not in text
    word = schema["properties"]["words"]["items"]
    assert word["additionalProperties"] is False
    assert set(word["required"]) == set(word["properties"])


def _lines(*texts):
    return [Line(idx=i, start=i, end=i + 1, text=t) for i, t in enumerate(texts)]


def test_scene_candidates_filters_common_and_taught_words():
    lines = _lines("The water down there is freezing.", "I'm involved now. Take my hand.")
    lemmas = {c.lemma for c in scene_candidates(lines, zipf_max=4.8)}
    assert "freezing" in lemmas or "freeze" in lemmas
    assert "hand" not in lemmas and "water" not in lemmas
    again = {c.lemma for c in scene_candidates(lines, zipf_max=4.8, exclude=lemmas)}
    assert again == set()


def test_merge_content_drops_bad_markup_and_invalid_items():
    lines = _lines("Come on, I'll pull you back over.", "No!")
    out = SceneContentOut.model_validate(
        {
            "lines": [
                {
                    "idx": 0,
                    "speaker": "Jack",
                    "zh": "来吧",
                    "markup": "Come~on, I will pull you.",
                    "notes": ["x"],
                },
                {"idx": 1, "speaker": "Rose", "zh": "不！", "markup": "No!", "notes": []},
            ],
            "words": [
                {
                    "text": "pull back",
                    "lemma": "pull back",
                    "ipa": "",
                    "pos": "phr.",
                    "zh": "拉回",
                    "line_idx": 0,
                    "highlight": "not in line",
                    "collocations": [],
                    "examples": [],
                },
                {
                    "text": "ghost",
                    "lemma": "ghost",
                    "ipa": "",
                    "pos": "n.",
                    "zh": "",
                    "line_idx": 9,
                    "highlight": "",
                    "collocations": [],
                    "examples": [],
                },
            ],
            "quiz": [
                {
                    "question_zh": "好题",
                    "options": ["a", "b", "c"],
                    "answer_index": 1,
                    "audio_line_idx": None,
                },
                {"question_zh": "坏题", "options": ["a", "b"], "answer_index": 5, "audio_line_idx": None},
            ],
        }
    )
    content, warnings = merge_content(lines, out)
    assert content["lines"][0]["markup"] == "Come on, I'll pull you back over."
    assert content["lines"][0]["start"] == 0
    assert [w["text"] for w in content["words"]] == ["pull back"]
    assert content["words"][0]["highlight"] == "pull back"
    assert [q["question_zh"] for q in content["quiz"]] == ["好题"]
    assert len(warnings) == 3


def test_segments_carry_word_confidence():
    words = [
        {"word": " Thank", "start": 0.0, "end": 0.3, "probability": 0.4},
        {"word": " you.", "start": 0.3, "end": 0.6, "probability": 0.6},
    ]
    (line,) = segments_to_lines([{"start": 0, "end": 1, "text": "", "words": words}])
    assert line.confidence == 0.5
    assert line.words[0].probability == 0.4


def _line(idx, start, end, confidence, text="x"):
    return Line(
        idx=idx,
        start=start,
        end=end,
        text=text,
        confidence=confidence,
        words=[Word(text=text, start=start, end=end, probability=confidence)],
    )


def test_voiced_ratio_counts_only_word_time():
    line = Line(
        idx=0,
        start=0,
        end=10,
        text="a b",
        words=[Word(text="a", start=0, end=1), Word(text="b", start=9, end=10)],
    )
    # 词之间的 8 秒停顿不算；只有 b 落在人声段里
    assert voiced_ratio(line, [(5, 12)]) == 0.5
    assert voiced_ratio(line, []) == 0.0


def test_drop_hallucinations_needs_both_signals():
    spans = [(0.0, 5.0)]
    lines = [
        _line(0, 1, 2, 0.3, "Action!"),  # 有人声：没把握也保留
        _line(1, 10, 11, 0.95, "There she is."),  # 人声检测漏了，但识别很有把握：保留
        _line(2, 20, 21, 0.5, "Thank you."),  # 没人声又没把握：幻听
        _line(3, 3, 4, 0.5, "Community字幕"),  # 有人声，但混进了中文：乱码
    ]
    kept, dropped = drop_hallucinations(lines, spans)
    assert [line.text for line in kept] == ["Action!", "There she is."]
    assert [line.idx for line in kept] == [0, 1]
    assert [line.text for line in dropped] == ["Thank you.", "Community字幕"]
