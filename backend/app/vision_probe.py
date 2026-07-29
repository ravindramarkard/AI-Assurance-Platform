"""Vision capability probe for Auto mode.

Sends a tiny PNG via OpenAI-compatible /chat/completions to detect whether
the configured local gateway accepts image payloads.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Literal

import httpx

logger = logging.getLogger(__name__)

VISION_PROBE_TIMEOUT_S = 20

# 1x1 PNG
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

VisionMode = Literal["auto", "on", "off"]


def resolve_vision_mode(mode: str | None) -> VisionMode:
    m = (mode or "auto").strip().lower()
    if m in ("auto", "on", "off"):
        return m  # type: ignore[return-value]
    return "auto"


def migrate_llm_use_vision_value(raw: str | None) -> VisionMode | None:
    if raw is None or raw == "":
        return None
    if str(raw).lower() in ("1", "true", "yes"):
        return "on"
    if str(raw).lower() in ("0", "false", "no"):
        return "off"
    return None


def needs_live_vision_probe(provider: str | None) -> bool:
    return (provider or "local").strip().lower() == "local"


def vision_probe_key(provider: str, base_url: str | None, model: str) -> str:
    return f"{provider}|{base_url or ''}|{model}"


def classify_vision_probe_response(status: int, body: Any) -> bool:
    if status != 200:
        return False
    data = body
    if isinstance(body, (bytes, bytearray)):
        try:
            data = json.loads(body.decode("utf-8", errors="replace"))
        except Exception:
            return False
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            return False
    if not isinstance(data, dict):
        return False
    if data.get("error"):
        return False
    choices = data.get("choices")
    return bool(choices)


def effective_vision_from_cache(cfg: dict[str, Any]) -> bool | None:
    """Resolve vision without network. None = auto/local not probed yet."""
    mode = resolve_vision_mode(cfg.get("llm_vision_mode") if isinstance(cfg.get("llm_vision_mode"), str) else None)
    if mode == "off":
        return False
    if mode == "on":
        return True
    provider = str(cfg.get("llm_provider") or "local")
    if not needs_live_vision_probe(provider):
        return True
    key = vision_probe_key(
        provider,
        str(cfg.get("llm_base_url") or "") or None,
        str(cfg.get("llm_model") or ""),
    )
    cached_key = cfg.get("llm_vision_probe_key")
    probe_ok = cfg.get("llm_vision_probe_ok")
    if cached_key == key and isinstance(probe_ok, bool):
        return probe_ok
    if cached_key == key and isinstance(probe_ok, str):
        return probe_ok.lower() in ("1", "true", "yes")
    return None


async def probe_vision_support(cfg: dict[str, Any]) -> bool:
    base = str(cfg.get("llm_base_url") or "").rstrip("/")
    model = str(cfg.get("llm_model") or "local-model")
    api_key = str(cfg.get("llm_api_key") or "lm-studio")
    if not base:
        logger.warning("Vision probe skipped: empty llm_base_url")
        return False
    url = f"{base}/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Reply with one word: ok"},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{TINY_PNG_B64}"},
                    },
                ],
            }
        ],
        "max_completion_tokens": 32,
        "temperature": 0,
    }
    try:
        async with httpx.AsyncClient(timeout=VISION_PROBE_TIMEOUT_S) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            try:
                body = resp.json()
            except Exception:
                body = resp.text
            ok = classify_vision_probe_response(resp.status_code, body)
            logger.info(
                "Vision probe status=%s ok=%s url=%s",
                resp.status_code,
                ok,
                url,
            )
            return ok
    except Exception as e:
        logger.warning("Vision probe failed: %s", e)
        return False


async def ensure_vision_for_cfg(
    cfg: dict[str, Any],
    *,
    force_refresh: bool = False,
    persist: bool = True,
) -> bool:
    mode = resolve_vision_mode(
        str(cfg.get("llm_vision_mode")) if cfg.get("llm_vision_mode") is not None else None
    )
    if mode == "off":
        return False
    if mode == "on":
        return True

    provider = str(cfg.get("llm_provider") or "local")
    if not needs_live_vision_probe(provider):
        return True

    base_url = str(cfg.get("llm_base_url") or "") or None
    model = str(cfg.get("llm_model") or "")
    key = vision_probe_key(provider, base_url, model)

    if not force_refresh:
        cached = effective_vision_from_cache(cfg)
        if cached is not None:
            return cached
        if persist:
            from . import db

            stored_key = await db.get_setting("llm_vision_probe_key")
            stored_ok = await db.get_setting("llm_vision_probe_ok")
            if stored_key == key and stored_ok is not None:
                return stored_ok.lower() in ("1", "true", "yes")

    ok = await probe_vision_support(cfg)
    if persist:
        from . import db

        await db.set_setting("llm_vision_probe_ok", "true" if ok else "false")
        await db.set_setting("llm_vision_probe_at", datetime.now(timezone.utc).isoformat())
        await db.set_setting("llm_vision_probe_key", key)
    cfg["llm_vision_probe_ok"] = ok
    cfg["llm_vision_probe_key"] = key
    return ok
