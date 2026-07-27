"""Runtime self-healing: analyze 400/422 errors and coerce request payloads."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from typing import Any


_TYPE_HINTS = {
    "array": list,
    "list": list,
    "object": dict,
    "dict": dict,
    "map": dict,
    "string": str,
    "str": str,
    "integer": int,
    "int": int,
    "number": float,
    "float": float,
    "boolean": bool,
    "bool": bool,
}


def error_text_from_response(resp_body: Any) -> str:
    if resp_body is None:
        return ""
    if isinstance(resp_body, str):
        return resp_body
    try:
        return json.dumps(resp_body)
    except Exception:
        return str(resp_body)


def _error_text(resp_body: Any) -> str:
    return error_text_from_response(resp_body)


def _coerce(value: Any, target: type) -> Any:
    if target is list:
        if isinstance(value, list):
            return value
        if value is None:
            return []
        return [value]
    if target is dict:
        if isinstance(value, dict):
            return value
        return {"value": value}
    if target is str:
        return "" if value is None else str(value)
    if target is int:
        try:
            return int(float(value))
        except Exception:
            return 0
    if target is float:
        try:
            return float(value)
        except Exception:
            return 0.0
    if target is bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ("1", "true", "yes")
        return bool(value)
    return value


def _set_path(body: dict[str, Any], dotted: str, value: Any) -> bool:
    parts = [p for p in re.split(r"[.\[]", dotted) if p and p != "]"]
    parts = [p.rstrip("]") for p in parts]
    if not parts:
        return False
    cur: Any = body
    for p in parts[:-1]:
        if isinstance(cur, dict):
            if p not in cur or not isinstance(cur[p], (dict, list)):
                cur[p] = {}
            cur = cur[p]
        else:
            return False
    leaf = parts[-1]
    if isinstance(cur, dict):
        cur[leaf] = value
        return True
    return False


def heal_payload(
    body: Any,
    *,
    status_code: int,
    resp_body: Any,
    request_schema: dict[str, Any] | None = None,
) -> tuple[Any, list[str]]:
    """
    Attempt to heal a request body after a client error.
    Returns (new_body, list_of_heal_actions). Empty actions => no heal.
    """
    if status_code not in (400, 422, 415) or not isinstance(body, dict):
        return body, []

    text = _error_text(resp_body).lower()
    actions: list[str] = []
    healed = deepcopy(body)

    # Pattern: field X should be array / expected type Y for field Z
    patterns = [
        r"(?:field|property|param(?:eter)?)\s+['\"]?([a-zA-Z0-9_]+)['\"]?.{0,40}?(?:must be|should be|expected)\s+(array|list|object|string|integer|number|boolean)",
        r"['\"]([a-zA-Z0-9_]+)['\"].{0,40}?(?:must be|should be|expected).{0,10}?(array|list|object|string|integer|number|boolean)",
        r"(?:expected)\s+(array|list|object|string|integer|number|boolean).{0,20}?['\"]([a-zA-Z0-9_]+)['\"]",
        r"([a-zA-Z0-9_]+).{0,20}?not\s+(?:of\s+)?type\s+(array|list|object|string|integer|number|boolean)",
        r"cannot\s+deserialize.{0,40}?['\"]([a-zA-Z0-9_]+)['\"].{0,40}?(array|list|object|string|integer|number|boolean)",
    ]

    for pat in patterns:
        for m in re.finditer(pat, text, re.I):
            g = m.groups()
            if len(g) == 2:
                # order may be field,type or type,field
                if g[0].lower() in _TYPE_HINTS and g[1].lower() not in _TYPE_HINTS:
                    typ, field = g[0].lower(), g[1]
                else:
                    field, typ = g[0], g[1].lower()
                target = _TYPE_HINTS.get(typ)
                if not target or field not in healed:
                    # try nested / case-insensitive
                    match_key = next((k for k in healed if k.lower() == field.lower()), None)
                    if not match_key or not target:
                        continue
                    field = match_key
                if target:
                    old = healed.get(field)
                    new = _coerce(old, target)
                    if new != old:
                        healed[field] = new
                        actions.append(f"coerced {field}: {type(old).__name__}→{typ}")

    # Schema-driven heal: coerce each property to declared type
    if request_schema and isinstance(request_schema.get("properties"), dict):
        props = request_schema["properties"]
        for name, prop in props.items():
            if name not in healed or not isinstance(prop, dict):
                continue
            t = prop.get("type")
            target = _TYPE_HINTS.get(str(t or "").lower())
            if not target:
                continue
            if not isinstance(healed[name], target):
                # only when error mentions the field or type mismatch is obvious
                if name.lower() in text or str(t) in text or not actions:
                    old = healed[name]
                    healed[name] = _coerce(old, target)
                    if healed[name] != old:
                        actions.append(f"schema-coerced {name}→{t}")

    # Common photoUrls / tags mistake: string instead of array
    for arr_field in ("photoUrls", "photo_urls", "tags", "items", "ids"):
        if arr_field in healed and not isinstance(healed[arr_field], list):
            if arr_field.lower() in text or "array" in text or status_code in (400, 422):
                old = healed[arr_field]
                healed[arr_field] = _coerce(old, list)
                actions.append(f"wrapped {arr_field} as array")

    # If still nothing and body has string where schema wants array — apply broadly once
    if not actions and request_schema and isinstance(request_schema.get("properties"), dict):
        for name, prop in request_schema["properties"].items():
            if name in healed and isinstance(prop, dict) and prop.get("type") == "array":
                if not isinstance(healed[name], list):
                    healed[name] = _coerce(healed[name], list)
                    actions.append(f"forced-array {name}")

    # Deduplicate
    uniq: list[str] = []
    for a in actions:
        if a not in uniq:
            uniq.append(a)
    return healed, uniq


def enrich_captures_from_body(body: Any) -> list[dict[str, str]]:
    """Default JSONPath extraction rules for common id fields."""
    caps: list[dict[str, str]] = []
    if not isinstance(body, dict):
        return caps
    for key, val in body.items():
        kl = key.lower()
        if kl == "id" or kl.endswith("_id") or kl.endswith("id"):
            caps.append({"var": f"extracted_{key}", "jsonpath": f"$.{key}"})
            caps.append({"var": key, "jsonpath": f"$.{key}"})
        if isinstance(val, dict) and "id" in val:
            caps.append({"var": f"extracted_{key}_id", "jsonpath": f"$.{key}.id"})
    # nested data.id
    if isinstance(body.get("data"), dict) and "id" in body["data"]:
        caps.append({"var": "extracted_post_id", "jsonpath": "$.data.id"})
        caps.append({"var": "extracted_id", "jsonpath": "$.data.id"})
    if "id" in body:
        caps.append({"var": "extracted_post_id", "jsonpath": "$.id"})
    return caps
