from __future__ import annotations

import json

PROVIDERS = ("local", "openai", "anthropic")


def empty_catalog() -> dict[str, list[str]]:
    return {p: [] for p in PROVIDERS}


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in items:
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def normalize_catalog(raw: object | None) -> dict[str, list[str]]:
    base = empty_catalog()
    if not isinstance(raw, dict):
        return base
    for p in PROVIDERS:
        val = raw.get(p)
        if not isinstance(val, list):
            continue
        cleaned: list[str] = []
        for item in val:
            if not isinstance(item, str):
                continue
            s = item.strip()
            if s:
                cleaned.append(s)
        base[p] = _dedupe(cleaned)
    return base


def ensure_model_in_catalog(
    catalog: dict[str, list[str]], provider: str, model: str
) -> dict[str, list[str]]:
    out = normalize_catalog(catalog)
    p = provider if provider in PROVIDERS else "local"
    m = (model or "").strip()
    if not m:
        return out
    if m not in out[p]:
        out[p] = [*out[p], m]
    return out


def parse_catalog_json(text: str | None) -> dict[str, list[str]]:
    if not text or not str(text).strip():
        return empty_catalog()
    try:
        raw = json.loads(text)
    except Exception:
        return empty_catalog()
    return normalize_catalog(raw)
