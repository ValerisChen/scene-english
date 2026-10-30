from pydantic import BaseModel


class Word(BaseModel):
    text: str
    start: float
    end: float
    probability: float = 1.0


class Line(BaseModel):
    """一句台词。时间单位是秒，从影片开头算起。"""

    idx: int
    start: float
    end: float
    text: str
    words: list[Word] = []
    # 识别置信度：词概率的平均值，没有词级信息时为 1
    confidence: float = 1.0


class SceneSpan(BaseModel):
    """场景切分的结果：覆盖第 first_line 到 last_line 句（含两端）。"""

    seq: int
    first_line: int
    last_line: int
    title_zh: str
    title_en: str
    summary_zh: str
