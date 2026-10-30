"""把处理结果渲染成 Markdown，方便人工检查切分和生成内容的质量。"""

from app.pipeline.runner import PipelineResult


def _clock(ms: int) -> str:
    s = ms // 1000
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def _brief_line(x: dict) -> str:
    return f"- `{_clock(int(x['start'] * 1000))}` {x['text']}（{x['confidence']:.2f}）"


def render_report(title: str, result: PipelineResult) -> str:
    st = result.stats
    out = [
        f"# {title} · 处理报告",
        "",
        f"- 台词 {st['lines']} 句，切分为 {st['scenes']} 个场景，生词 {st['words']} 个",
        f"- 角色：{', '.join(st['characters']) or '无'}",
        f"- 耗时（秒）：{st['seconds']}",
        f"- LLM 费用：${result.cost_usd:.4f}（{len(st['llm_calls'])} 次调用）",
    ]
    if st["warnings"]:
        out += ["", "## 警告", *[f"- {w}" for w in st["warnings"]]]
    if st.get("dropped_lines") or st.get("uncertain_lines"):
        out += ["", "## 识别核对", "", "丢掉的疑似幻听（没有人声、识别也没把握）：", ""]
        out += [_brief_line(x) for x in st["dropped_lines"]]
        out += ["", "保留但没把握的句子（置信度低于 0.6），建议对照原片听一下：", ""]
        out += [_brief_line(x) for x in st["uncertain_lines"]]

    for scene in result.scenes:
        c = scene.content
        out += [
            "",
            f"## SC {scene.seq:02d} {scene.title_zh} / {scene.title_en}",
            f"`{_clock(scene.start_ms)} – {_clock(scene.end_ms)}` {scene.summary_zh}",
            "",
            "### 台词",
            "",
        ]
        for i, line in enumerate(c["lines"]):
            out.append(f"{i}. **{line['speaker']}**：{line['markup']}  \n   {line['zh']}")
            out += [f"   - {n}" for n in line["notes"]]
        out += ["", "### 生词", ""]
        for w in c["words"]:
            cols = "；".join(
                f"{x['text']}（{x['zh']}）{'〔本片〕' if x['in_film'] else ''}" for x in w["collocations"]
            )
            out.append(f"- **{w['text']}** {w['ipa']} {w['pos']} {w['zh']}  \n  搭配：{cols}")
            for ex in w["examples"]:
                src = f"本片 SC {ex['scene_seq']:02d}" if ex["source"] == "film" and ex["scene_seq"] else "AI"
                out.append(f"  - {ex['en']} / {ex['zh']}（{src}）")
        out += ["", "### 测验", ""]
        for qi, q in enumerate(c["quiz"], 1):
            audio = f"（听第 {q['audio_line_idx']} 句）" if q["audio_line_idx"] is not None else ""
            opts = " / ".join(
                ("✓ " if i == q["answer_index"] else "") + o for i, o in enumerate(q["options"])
            )
            out.append(f"{qi}. {q['question_zh']}{audio}  \n   {opts}")
    return "\n".join(out) + "\n"
