"""示例数据：和演示页面相同的《泰坦尼克号》船尾一场，台词是按剧情改写的，时间轴只是示意。

配好 API key、跑过真实影片之前，可以先用它在网页上看完整的学习流程：
    uv run scene-english seed-demo ~/Movies/Titanic.mp4
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Film, Scene

TITLE = "泰坦尼克号（示例数据）"


def _line(start: float, end: float, speaker: str, markup: str, zh: str, notes: list[str]) -> dict[str, Any]:
    from app.pipeline.markup import plain

    return {"start": start, "end": end, "text": plain(markup), "speaker": speaker, "zh": zh,
            "markup": markup, "notes": notes}  # fmt: skip


def _word(text, ipa, pos, zh, line_idx, highlight, collocations, examples) -> dict[str, Any]:
    return {
        "text": text,
        "lemma": text,
        "ipa": ipa,
        "pos": pos,
        "zh": zh,
        "line_idx": line_idx,
        "highlight": highlight,
        "collocations": [{"text": t, "zh": z, "in_film": f} for t, z, f in collocations],
        "examples": [{"en": e, "zh": z, "source": s, "scene_seq": q} for e, z, s, q in examples],
    }


STERN = {
    "lines": [
        _line(2484, 2489.5, "Jack", "Hey, ^don't do~it. ^Just take my hand.", "嘿，别这么做。抓住我的手。",
              ["don't 的 t 几乎不发音（失去爆破）", "do‿it 连读"]),
        _line(2490, 2496.5, "Rose", "Stay back! ^Don't come~any closer.", "别过来！别再靠近了。",
              ["come‿any 连读成 /kʌˈmeni/"]),
        _line(2497, 2502.5, "Jack", "Come~on, I'll pull °you back~over.", "来吧，我把你拉回来。",
              ["Come‿on 连读", "pull you 里的 you 弱读成 /jə/", "back‿over 连读"]),
        _line(2503, 2509.5, "Rose", "No! I mean~it. I'll ^let go.", "不！我是认真的。我会松手的。",
              ["mean‿it 连读", "let 的 t 不爆破，听起来像 le' go"]),
        _line(2510, 2521.5, "Jack", "No, you won't. If °you °were {gonna} do~it, {you'd_have} done~it~already.",
              "不，你不会的。你要是真想跳，早就跳了。",
              ["gonna = going to", "you'd have 读作 /jʊdəv/", "done‿it‿already 连成一串"]),
        _line(2522, 2530.5, "Rose", "You don't know what~I will °or won't do.", "你根本不知道我会做什么、不会做什么。",
              ["what‿I 连读，t 闪音成 /wʌɾaɪ/", "or 弱读成 /ər/"]),
        _line(2531, 2540.5, "Jack", "°The ^water down there~is freezing. Trust me, I've been~in~it.",
              "下面的水冷得刺骨。相信我，我掉进去过。", ["water 的 t 在美音里闪音，听起来像 wa-der"]),
        _line(2541, 2548.5, "Rose", "You're crazy.", "你疯了。", []),
        _line(2549, 2556, "Jack", "I'm involved now. You jump, I jump.", "我现在已经卷进来了。你跳，我也跳。",
              ["两个 jump 都重读，逗号处停顿"]),
    ],
    "words": [
        _word("let go", "/ˌlet ˈɡoʊ/", "phr.", "松手；放开", 3, "let go",
              [("never let go", "永不放手", True), ("let go of sth", "放开某物", False)],
              [("I'll never let go.", "我永远不会放手。", "film", 16),
               ("Let go of my arm, you're hurting me.", "放开我的胳膊，你弄疼我了。", "ai", None)]),
        _word("freezing", "/ˈfriːzɪŋ/", "adj.", "冰冷刺骨的", 6, "freezing",
              [("freezing water", "冰冷的水", True), ("freezing cold", "冷得要命", False)],
              [("It's freezing in here. Can you close the window?", "这里冷死了，能把窗户关上吗？", "ai", None),
               ("I'm freezing.", "我快冻死了。", "ai", None)]),
        _word("involved", "/ɪnˈvɑːlvd/", "adj.", "卷入的；牵涉其中的", 8, "involved",
              [("I'm involved now", "我已经卷进来了", True), ("get involved in sth", "参与某事", False)],
              [("I don't want to get involved in their argument.", "我不想掺和他们的争吵。", "ai", None),
               ("How many people were involved in the project?", "有多少人参与了这个项目？", "ai", None)]),
        _word("mean it", "/ˈmiːn ɪt/", "phr.", "是认真的；说到做到", 3, "mean it",
              [("I mean it.", "我是认真的", True), ("I didn't mean it.", "我不是故意的", False)],
              [("Sorry, I didn't mean it.", "对不起，我不是故意的。", "ai", None),
               ("Stay out of my room. I mean it!", "别进我房间，我说真的！", "ai", None)]),
        _word("pull back over", "/pʊl bæk ˈoʊvər/", "phr.", "（越过栏杆）把人拉回来", 2, "pull you back over",
              [("pull sb back", "把某人拉回来", True), ("pull over", "靠边停车（意思不同）", False)],
              [("He pulled her out of the water.", "他把她从水里拉了出来。", "ai", None),
               ("Pull over, I think we have a flat tire.", "靠边停一下，好像爆胎了。", "ai", None)]),
    ],
    "quiz": [
        {"question_zh": "Jack 为什么断定 Rose 不会松手？", "options": ["她要是真想跳，早就跳了", "他已经抓住了她的手", "栏杆很牢固，她掉不下去"], "answer_index": 0, "audio_line_idx": None},
        {"question_zh": "Jack 怎么知道下面的水冷得刺骨？", "options": ["船员告诉他的", "他以前掉进过这样的水里", "他刚刚把手伸进水里试过"], "answer_index": 1, "audio_line_idx": None},
        {"question_zh": "\"I'm involved now.\" 在这里最接近哪个意思？", "options": ["我现在很忙", "我现在加入你们了", "我已经卷进来了，不能不管"], "answer_index": 2, "audio_line_idx": None},
        {"question_zh": "听一句台词，选出你听到的内容", "options": ["…you'd have done it already.", "…you'd have to do it already.", "…you'll have done it ready."], "answer_index": 0, "audio_line_idx": 4},
    ],
}  # fmt: skip


def seed_demo(db: Session, owner_id: int, fingerprint: str, duration_sec: float | None) -> Film:
    film = db.scalar(select(Film).where(Film.owner_id == owner_id, Film.fingerprint == fingerprint))
    if film is None:
        film = Film(owner_id=owner_id, fingerprint=fingerprint, title=TITLE, duration_sec=duration_sec)
        db.add(film)
    film.scenes = [
        Scene(
            seq=1,
            start_ms=2470_000,
            end_ms=2560_000,
            title_zh="船尾 · 你跳我也跳",
            title_en="The Stern",
            summary_zh="Jack 在船尾劝下想要轻生的 Rose，两人第一次说上话。",
            content=STERN,
        )
    ]
    db.commit()
    return film
