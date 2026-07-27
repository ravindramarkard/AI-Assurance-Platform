"""Heuristic (+ optional LLM) request payload synthesis."""

from __future__ import annotations

import logging
import random
import string
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def _rand_email() -> str:
    return f"user_{uuid.uuid4().hex[:8]}@example.test"


def _rand_str(n: int = 10) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def synthesize_value(name: str, schema: dict[str, Any] | None, *, kind: str = "happy") -> Any:
    schema = schema or {}
    t = schema.get("type")
    fmt = schema.get("format") or ""
    enum = schema.get("enum")
    n = name.lower()

    if kind == "negative":
        if enum:
            return "__INVALID_ENUM__"
        if t == "string":
            return 12345
        if t in ("integer", "number"):
            return "not-a-number"
        if t == "boolean":
            return "yes"
        if t == "array":
            return "not-an-array"
        return None

    if kind == "edge":
        if t == "string" or t is None:
            if "email" in n or fmt == "email":
                return ""
            if fmt == "uuid":
                return "00000000-0000-0000-0000-000000000000"
            return "测试🚀" + ("x" * min(int(schema.get("maxLength") or 80), 80))
        if t in ("integer", "number"):
            return schema.get("maximum", 10**9)
        if t == "boolean":
            return True
        if t == "array":
            return []

    # happy
    if enum:
        return enum[0]
    if "example" in schema:
        return schema["example"]
    if schema.get("default") is not None:
        return schema["default"]

    if fmt == "email" or "email" in n:
        return _rand_email()
    if fmt == "uuid" or n in ("id", "uuid", "guid") or n.endswith("_id") or n.endswith("id") and t == "string":
        return str(uuid.uuid4())
    if fmt in ("date-time", "datetime") or "time" in n or "date" in n and "update" in n:
        return datetime.now(timezone.utc).isoformat()
    if fmt == "date" or n.endswith("_date") or n == "date":
        return datetime.now(timezone.utc).date().isoformat()
    if "phone" in n:
        return "+1555" + "".join(random.choices(string.digits, k=7))
    if "url" in n or fmt == "uri":
        return "https://example.test/resource"
    if "password" in n:
        return "TestPass!" + _rand_str(6)
    if "card" in n or "pan" in n:
        return "4111111111111111"
    if "cvv" in n or "cvc" in n:
        return "123"
    if t == "integer" or fmt in ("int32", "int64"):
        return random.randint(1, 100)
    if t == "number" or fmt in ("float", "double"):
        return round(random.uniform(1, 100), 2)
    if t == "boolean":
        return True
    if t == "array":
        item = schema.get("items") if isinstance(schema.get("items"), dict) else {"type": "string"}
        if kind == "edge":
            return []
        # photoUrls / tags style arrays need at least one value for Petstore-like APIs
        return [synthesize_value(name + "_item", item, kind="happy")]
    if t == "object" or schema.get("properties"):
        return synthesize_object(schema, kind=kind)
    if "photo" in n or "url" in n:
        return ["https://example.test/pet.jpg"] if t == "array" else "https://example.test/pet.jpg"
    return _rand_str(8)


def synthesize_object(schema: dict[str, Any] | None, *, kind: str = "happy") -> dict[str, Any]:
    schema = schema or {"type": "object"}
    if schema.get("type") == "array":
        return synthesize_value("items", schema, kind=kind)  # type: ignore[return-value]
    props = schema.get("properties") or {}
    required = list(schema.get("required") or [])
    out: dict[str, Any] = {}
    names = list(props.keys()) if props else required
    if kind == "negative" and required:
        # omit first required field
        skip = required[0]
        for name in names:
            if name == skip:
                continue
            out[name] = synthesize_value(name, props.get(name) if isinstance(props, dict) else None, kind="happy")
        return out
    for name in names:
        prop = props.get(name) if isinstance(props, dict) else None
        if kind == "happy" and name not in required and random.random() < 0.3 and required:
            continue
        out[name] = synthesize_value(name, prop if isinstance(prop, dict) else None, kind=kind)
    if not out and required:
        for name in required:
            out[name] = synthesize_value(name, props.get(name) if isinstance(props, dict) else None, kind="happy")
    return out


def synthesize_params(
    parameters: list[dict[str, Any]],
    *,
    kind: str = "happy",
    variables: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Return {path: {}, query: {}, header: {}}."""
    variables = variables or {}
    buckets: dict[str, dict[str, Any]] = {"path": {}, "query": {}, "header": {}}
    for p in parameters:
        if not isinstance(p, dict):
            continue
        loc = (p.get("in") or "query").lower()
        if loc not in buckets:
            continue
        name = p.get("name") or "param"
        # prefer bound variables
        for vk, vv in variables.items():
            if _name_match(name, vk):
                buckets[loc][name] = vv
                break
        else:
            schema = p.get("schema") if isinstance(p.get("schema"), dict) else {"type": p.get("type") or "string"}
            buckets[loc][name] = synthesize_value(name, schema, kind=kind)
    return buckets


def _name_match(a: str, b: str) -> bool:
    na = a.lower().replace("-", "").replace("_", "")
    nb = b.lower().replace("-", "").replace("_", "")
    return na == nb or na.endswith(nb) or nb.endswith(na)


async def llm_enrich_payload(
    schema: dict[str, Any] | None,
    context: str,
    *,
    kind: str = "happy",
    seed: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Optional LLM assist; delegates to api_test.ai (heuristics remain fallback)."""
    from .ai import llm_enrich_payload as _ai_enrich

    return await _ai_enrich(schema, context, kind=kind, seed=seed)
