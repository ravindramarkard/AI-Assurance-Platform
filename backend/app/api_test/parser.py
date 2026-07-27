"""OpenAPI / Swagger parse and normalize."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from typing import Any

import httpx
import yaml

from .ssrf import UnsafeURLError, assert_safe_url

HTTP_METHODS = ("get", "post", "put", "patch", "delete", "head", "options")


def parse_spec_text(text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        raise ValueError("Empty OpenAPI document")
    try:
        if text.startswith("{") or text.startswith("["):
            data = json.loads(text)
        else:
            data = yaml.safe_load(text)
    except Exception as exc:
        raise ValueError(f"Failed to parse OpenAPI document: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("OpenAPI root must be an object")
    return data


async def fetch_spec(url: str, *, allow_private: bool = False) -> tuple[str, dict[str, Any]]:
    safe = assert_safe_url(url, allow_private=allow_private)
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(safe, headers={"Accept": "application/json, application/yaml, text/yaml, */*"})
        resp.raise_for_status()
        raw = resp.text
    return raw, parse_spec_text(raw)


def _resolve_ref(doc: dict[str, Any], ref: str, stack: set[str] | None = None) -> Any:
    if not ref.startswith("#/"):
        raise ValueError(f"Remote $ref not supported in V1: {ref}")
    stack = stack or set()
    if ref in stack:
        return {}
    stack.add(ref)
    parts = ref[2:].split("/")
    cur: Any = doc
    for p in parts:
        p = p.replace("~1", "/").replace("~0", "~")
        if not isinstance(cur, dict) or p not in cur:
            return {}
        cur = cur[p]
    if isinstance(cur, dict) and "$ref" in cur:
        return _resolve_ref(doc, cur["$ref"], stack)
    return deepcopy(cur)


def resolve_local_refs(node: Any, doc: dict[str, Any], depth: int = 0) -> Any:
    if depth > 40:
        return node
    if isinstance(node, dict):
        if "$ref" in node and isinstance(node["$ref"], str):
            resolved = _resolve_ref(doc, node["$ref"])
            if isinstance(resolved, dict):
                merged = {**resolved, **{k: v for k, v in node.items() if k != "$ref"}}
                return resolve_local_refs(merged, doc, depth + 1)
            return resolved
        return {k: resolve_local_refs(v, doc, depth + 1) for k, v in node.items()}
    if isinstance(node, list):
        return [resolve_local_refs(v, doc, depth + 1) for v in node]
    return node


def _swagger2_to_openapiish(doc: dict[str, Any]) -> dict[str, Any]:
    """Light normalization so downstream code can treat Swagger 2 like OAS3."""
    if doc.get("openapi"):
        return doc
    if not doc.get("swagger"):
        return doc
    out = deepcopy(doc)
    out["openapi"] = "3.0.0-converted"
    schemes = out.get("securityDefinitions") or {}
    out.setdefault("components", {})["securitySchemes"] = schemes
    # Convert body parameters to requestBody when present
    paths = out.get("paths") or {}
    for path, item in list(paths.items()):
        if not isinstance(item, dict):
            continue
        for method in HTTP_METHODS:
            op = item.get(method)
            if not isinstance(op, dict):
                continue
            params = list(op.get("parameters") or [])
            body_param = next((p for p in params if p.get("in") == "body"), None)
            if body_param:
                schema = body_param.get("schema") or {"type": "object"}
                op["requestBody"] = {
                    "required": bool(body_param.get("required")),
                    "content": {"application/json": {"schema": schema}},
                }
                op["parameters"] = [p for p in params if p.get("in") != "body"]
            # responses may use schema at top level
            responses = op.get("responses") or {}
            for code, resp in list(responses.items()):
                if isinstance(resp, dict) and "schema" in resp and "content" not in resp:
                    resp["content"] = {"application/json": {"schema": resp.pop("schema")}}
    # servers from host/basePath
    if out.get("host"):
        scheme = (out.get("schemes") or ["https"])[0]
        base = out.get("basePath") or ""
        out["servers"] = [{"url": f"{scheme}://{out['host']}{base}"}]
    return out


def extract_security_schemes(doc: dict[str, Any]) -> dict[str, Any]:
    comps = doc.get("components") or {}
    schemes = comps.get("securitySchemes") or doc.get("securityDefinitions") or {}
    return deepcopy(schemes) if isinstance(schemes, dict) else {}


def _response_schema(op: dict[str, Any]) -> dict[str, Any] | None:
    responses = op.get("responses") or {}
    for code in ("200", "201", "202", "default"):
        resp = responses.get(code)
        if not isinstance(resp, dict):
            continue
        content = resp.get("content") or {}
        for ct in ("application/json", "application/*+json"):
            if ct in content and isinstance(content[ct], dict):
                sch = content[ct].get("schema")
                if isinstance(sch, dict):
                    return sch
        # any content
        for block in content.values():
            if isinstance(block, dict) and isinstance(block.get("schema"), dict):
                return block["schema"]
        if isinstance(resp.get("schema"), dict):
            return resp["schema"]
    return None


def _request_schema(op: dict[str, Any]) -> dict[str, Any] | None:
    body = op.get("requestBody")
    if not isinstance(body, dict):
        return None
    content = body.get("content") or {}
    for ct in ("application/json", "application/*+json", "application/x-www-form-urlencoded"):
        if ct in content and isinstance(content[ct], dict):
            sch = content[ct].get("schema")
            if isinstance(sch, dict):
                return sch
    for block in content.values():
        if isinstance(block, dict) and isinstance(block.get("schema"), dict):
            return block["schema"]
    return None


def _path_params(path: str) -> list[str]:
    return re.findall(r"\{([^}]+)\}", path)


def normalize_operations(doc: dict[str, Any]) -> list[dict[str, Any]]:
    doc = _swagger2_to_openapiish(doc)
    resolved = resolve_local_refs(doc, doc)
    paths = resolved.get("paths") or {}
    global_security = resolved.get("security")
    ops: list[dict[str, Any]] = []
    for path, item in paths.items():
        if not isinstance(item, dict):
            continue
        shared_params = item.get("parameters") or []
        for method in HTTP_METHODS:
            op = item.get(method)
            if not isinstance(op, dict):
                continue
            params = list(shared_params) + list(op.get("parameters") or [])
            params = [resolve_local_refs(p, resolved) if isinstance(p, dict) else p for p in params]
            security = op.get("security") if "security" in op else global_security
            op_id = op.get("operationId") or f"{method}_{path}".replace("/", "_").replace("{", "").replace("}", "")
            ops.append(
                {
                    "method": method.upper(),
                    "path": path,
                    "operation_id": op_id,
                    "summary": op.get("summary") or "",
                    "tags": list(op.get("tags") or []),
                    "parameters": params,
                    "path_params": _path_params(path),
                    "request_schema": _request_schema(op),
                    "response_schema": _response_schema(op),
                    "security": security,
                    "responses": {
                        str(k): {"description": (v or {}).get("description", "") if isinstance(v, dict) else ""}
                        for k, v in (op.get("responses") or {}).items()
                    },
                }
            )
    return ops


def infer_base_url(doc: dict[str, Any], fallback: str = "") -> str:
    doc = _swagger2_to_openapiish(doc)
    servers = doc.get("servers") or []
    if servers and isinstance(servers[0], dict) and servers[0].get("url"):
        return str(servers[0]["url"]).rstrip("/")
    if doc.get("host"):
        scheme = (doc.get("schemes") or ["https"])[0]
        base = doc.get("basePath") or ""
        return f"{scheme}://{doc['host']}{base}".rstrip("/")
    return (fallback or "").rstrip("/")


def fingerprint_ops(ops: list[dict[str, Any]]) -> set[str]:
    return {f"{o['method']} {o['path']}" for o in ops}


__all__ = [
    "UnsafeURLError",
    "fetch_spec",
    "parse_spec_text",
    "normalize_operations",
    "extract_security_schemes",
    "infer_base_url",
    "fingerprint_ops",
    "resolve_local_refs",
]
