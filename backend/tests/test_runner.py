import subprocess

import pytest

from app.config import Settings
from app.pipeline.content import SceneContentOut
from app.pipeline.runner import MissingAPIKeyError, run_pipeline
from app.pipeline.segment import _SegmentOut
from app.pipeline.types import Line


class FakeTranscriber:
    def transcribe(self, wav, offset=0.0):
        texts = ["The water down there is freezing.", "I'm involved now.", "Hold on.", "Never let go."]
        return [
            Line(idx=i, start=offset + i * 2, end=offset + i * 2 + 1.5, text=t) for i, t in enumerate(texts)
        ]


class FakeLLM:
    def __init__(self):
        self.cost_usd = 0.0
        self.calls = []
        self.prompts = []

    def structured(self, *, model, system, prompt, schema, max_tokens=64000):
        self.prompts.append(prompt)
        if schema is _SegmentOut:
            return _SegmentOut.model_validate(
                {
                    "scenes": [
                        {
                            "first_line": 0,
                            "last_line": 1,
                            "title_zh": "船尾",
                            "title_en": "Stern",
                            "summary_zh": "",
                        },
                        {
                            "first_line": 2,
                            "last_line": 3,
                            "title_zh": "冰海",
                            "title_en": "Sea",
                            "summary_zh": "",
                        },
                    ]
                }
            )
        n = prompt.count("\n[")
        return SceneContentOut.model_validate(
            {
                "lines": [
                    {"idx": i, "speaker": "Jack", "zh": "…", "markup": "", "notes": []} for i in range(n)
                ],
                "words": [
                    {
                        "text": "freezing",
                        "lemma": "freezing",
                        "ipa": "",
                        "pos": "adj.",
                        "zh": "冰冷的",
                        "line_idx": 0,
                        "highlight": "freezing",
                        "collocations": [],
                        "examples": [],
                    }
                ],
                "quiz": [],
            }
        )


def test_pipeline_runs_scene_by_scene(tmp_path):
    media = tmp_path / "silence.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", str(media)],
        check=True,
    )
    llm = FakeLLM()
    steps = []
    result = run_pipeline(
        media,
        # 分离人声太慢，单测里跳过；人声检测照常跑
        Settings(separate_vocals=False),
        start=60,
        transcriber=FakeTranscriber(),
        llm=llm,
        on_progress=lambda step, p: steps.append(step),
    )

    assert [s.title_zh for s in result.scenes] == ["船尾", "冰海"]
    assert result.scenes[0].start_ms == 60_000 and result.scenes[1].start_ms == 64_000
    assert len(result.scenes[1].content["lines"]) == 2
    # 第一场讲过 freezing，第二场的提示里要把它列为已讲过
    assert "Already taught: freezing" in llm.prompts[2]
    assert "Known characters: Jack" in llm.prompts[2]
    assert steps[:3] == ["audio", "asr", "scene"] and steps[-1] == "done"
    # 假识别结果没有置信度信息（视为 1），即使静音也不会被当成幻听
    assert result.stats["dropped_lines"] == []


def test_pipeline_fails_fast_without_api_key(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    steps = []
    with pytest.raises(MissingAPIKeyError):
        run_pipeline(
            tmp_path / "missing.wav",
            Settings(_env_file=None, anthropic_api_key=None),
            transcriber=FakeTranscriber(),
            on_progress=lambda step, p: steps.append(step),
        )
    # 一步都没开始
    assert steps == []
