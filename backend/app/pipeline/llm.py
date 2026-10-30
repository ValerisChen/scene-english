import copy
from typing import Any

import anthropic
from pydantic import BaseModel

# 每百万 token 的美元价格（输入, 输出），2026-10 官方价格
PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMError(RuntimeError):
    pass


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """把 Pydantic 生成的 JSON Schema 转成结构化输出要求的严格格式：
    展开 $ref，每个 object 都 additionalProperties=false 且所有字段必填。"""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            return [walk(x) for x in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            return walk(copy.deepcopy(defs[node["$ref"].rsplit("/", 1)[-1]]))
        out: dict[str, Any] = {}
        for key, value in node.items():
            if key in ("title", "default"):
                continue
            if key == "properties":
                # 这一层的键是字段名，不能当成 schema 关键字过滤
                out[key] = {name: walk(sub) for name, sub in value.items()}
            else:
                out[key] = walk(value)
        if out.get("type") == "object":
            out["additionalProperties"] = False
            out["required"] = list(out.get("properties", {}))
        return out

    return walk(schema)


class LLM:
    """对 Claude API 的薄封装：结构化输出 + 拒答回退 + 记账。"""

    def __init__(
        self, client: anthropic.Anthropic | None = None, effort: str = "medium", api_key: str | None = None
    ):
        # api_key 为 None 时 SDK 会去读环境变量 ANTHROPIC_API_KEY
        self.client = client or anthropic.Anthropic(api_key=api_key)
        self.effort = effort
        self.cost_usd = 0.0
        self.calls: list[dict[str, Any]] = []

    def structured[T: BaseModel](
        self, *, model: str, system: str, prompt: str, schema: type[T], max_tokens: int = 64000
    ) -> T:
        with self.client.beta.messages.stream(
            model=model,
            max_tokens=max_tokens,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_config={
                "effort": self.effort,
                "format": {"type": "json_schema", "schema": strict_schema(schema)},
            },
        ) as stream:
            message = stream.get_final_message()

        self._account(model, message)
        if message.stop_reason == "refusal":
            raise LLMError(f"模型拒绝了这次请求：{message.stop_details}")
        if message.stop_reason == "max_tokens":
            raise LLMError("输出超过 max_tokens 被截断")
        text = next((b.text for b in message.content if b.type == "text"), None)
        if text is None:
            raise LLMError("响应里没有文本内容")
        return schema.model_validate_json(text)

    def _account(self, requested_model: str, message: Any) -> None:
        usage = message.usage
        served = message.model if message.model in PRICES else requested_model
        price_in, price_out = PRICES.get(served, PRICES["claude-opus-5-5"])
        cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
        cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
        cost = (
            usage.input_tokens * price_in
            + cache_write * price_in * 1.25
            + cache_read * price_in * 0.1
            + usage.output_tokens * price_out
        ) / 1_000_000
        self.cost_usd += cost
        self.calls.append(
            {
                "model": served,
                "request_id": getattr(message, "_request_id", None),
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "cost_usd": round(cost, 4),
            }
        )
