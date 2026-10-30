"""连读弱读的标注语法（和演示页面一致）：

a~b     连读          Come~on
°w      弱读          pull °you
^w      吞音 / 闪音    ^water
{a_b}   缩略          {gonna}  {you'd_have}
"""

import re

_MARKS = re.compile(r"[°^{}]")
_QUOTES = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'})


def plain(markup: str) -> str:
    return _MARKS.sub("", markup).replace("~", " ").replace("_", " ")


def _normalize(s: str) -> str:
    return " ".join(s.translate(_QUOTES).lower().split())


def markup_matches(markup: str, text: str) -> bool:
    """标注去掉记号后必须和原台词一字不差，否则说明模型改了台词。"""
    return _normalize(plain(markup)) == _normalize(text)
