from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://scene:scene@localhost:5442/scene_english"
    redis_url: str = "redis://localhost:6389/0"
    storage_dir: Path = Path("data")
    cors_origins: list[str] = ["http://localhost:5173"]

    # 从 .env 读进来后显式传给 SDK；SDK 自己只认环境变量，不读 .env
    anthropic_api_key: SecretStr | None = None

    # 阶段一只有一个用户
    owner_id: int = 1

    whisper_model: str = "mlx-community/whisper-large-v3-turbo"
    # 识别前先用 Demucs 分离人声；关掉能快一倍，但幻听和漏识别会明显变多
    separate_vocals: bool = True
    # Silero 人声检测阈值，在分离后的人声上 0.3 比较合适
    vad_threshold: float = 0.3

    # 默认都用 Opus 5.5；阶段一对比质量后再决定哪些任务换模型
    llm_model_segment: str = "claude-opus-5-5"
    llm_model_content: str = "claude-opus-5-5"
    llm_effort: str = "medium"

    # wordfreq 的 Zipf 词频低于这个值才算候选生词（数值越小越生僻）
    vocab_zipf_max: float = 4.8

    @property
    def upload_dir(self) -> Path:
        return self.storage_dir / "uploads"


@lru_cache
def get_settings() -> Settings:
    return Settings()
