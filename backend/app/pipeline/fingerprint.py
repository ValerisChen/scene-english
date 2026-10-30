import hashlib
import struct
from pathlib import Path

CHUNK = 64 * 1024


def file_fingerprint(path: Path) -> str:
    """文件首尾各 64 KB 加上文件大小，做 SHA-256。

    浏览器端要用完全相同的算法（大小按 big-endian float64 拼在最后），
    这样同一个文件在网页和命令行里算出来的指纹一致。
    """
    size = path.stat().st_size
    with path.open("rb") as f:
        head = f.read(CHUNK)
        f.seek(max(0, size - CHUNK))
        tail = f.read(CHUNK)
    return hashlib.sha256(head + tail + struct.pack(">d", float(size))).hexdigest()
