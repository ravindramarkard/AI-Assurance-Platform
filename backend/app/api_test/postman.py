"""Postman Collection v2.1 import/export → normalized ops, OpenAPI doc, mock fixtures, flows."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlparse, parse_qsl
from uuid import uuid4


POSTMAN_SCHEMA_HINTS = (
    "postman.com/collection",
    "schema.getpostman.com",
    "postman-collection",
)


def is_postman_collection(doc: Any) -> bool:
    if not isinstance(doc, dict):
        return False
    info = doc.get("info") or {}
    schema = str(info.get("schema") or "")
    if any(h in schema.lower() for h in POSTMAN_SCHEMA_HINTS):
        return True
    # Heuristic: Postman collections have item[] + info.name, no openapi/swagger
    if "item" in doc and isinstance(doc.get("item"), list) and "info" in doc:
        if "openapi" not in doc and "swagger" not in doc and "paths" not in doc:
            return True
    return False


def parse_postman_text(raw: str) -> dict[str, Any]:
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid Postman JSON: {exc}") from exc
    if not is_postman_collection(doc):
        raise ValueError("Not a Postman Collection v2.x document")
    return doc


def _slug(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9_]+", "_", (s or "").strip())
    out = re.sub(r"_+", "_", out).strip("_")
    return out or "op"


def _postman_path_to_openapi(path: str) -> str:
    """Convert /users/:id and {{var}} segments into OpenAPI /users/{id}."""
    path = (path or "").strip() or "/"
    if not path.startswith("/"):
        path = "/" + path
    # :param → {param}
    path = re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", r"{\1}", path)
    # bare {{var}} path segment → {var}
    path = re.sub(r"\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}", r"{\1}", path)
    return path


def _url_parts(url_obj: Any) -> tuple[str, str, dict[str, str]]:
    """Return (base_hint, path, query) from a Postman url field."""
    query: dict[str, str] = {}
    if isinstance(url_obj, str):
        parsed = urlparse(url_obj)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True):
            query[k] = v
        path = parsed.path or "/"
        base = ""
        if parsed.scheme and parsed.netloc:
            base = f"{parsed.scheme}://{parsed.netloc}"
        return base, _postman_path_to_openapi(path), query

    if not isinstance(url_obj, dict):
        return "", "/", {}

    for q in url_obj.get("query") or []:
        if not isinstance(q, dict) or q.get("disabled"):
            continue
        if q.get("key") is not None:
            query[str(q["key"])] = str(q.get("value") or "")

    raw = url_obj.get("raw")
    if isinstance(raw, str) and raw.strip():
        base, path, q2 = _url_parts(raw)
        query = {**q2, **query}
        return base, path, query

    host = url_obj.get("host") or []
    if isinstance(host, list):
        host_s = ".".join(str(h) for h in host if h not in (None, ""))
    else:
        host_s = str(host or "")
    protocol = str(url_obj.get("protocol") or "https").rstrip(":/")
    base = f"{protocol}://{host_s}" if host_s and "{{" not in host_s else ""

    path_parts = url_obj.get("path") or []
    if isinstance(path_parts, list):
        segs = []
        for p in path_parts:
            s = str(p or "").strip("/")
            if not s:
                continue
            if s.startswith(":") and len(s) > 1:
                segs.append("{" + s[1:] + "}")
            elif s.startswith("{{") and s.endswith("}}"):
                segs.append("{" + s[2:-2] + "}")
            else:
                segs.append(s)
        path = "/" + "/".join(segs) if segs else "/"
    else:
        path = _postman_path_to_openapi(str(path_parts or "/"))
    return base, _postman_path_to_openapi(path), query


def _body_from_request(req: dict[str, Any]) -> Any:
    body = req.get("body") or {}
    if not isinstance(body, dict):
        return None
    mode = body.get("mode")
    if mode == "raw":
        raw = body.get("raw")
        if raw in (None, ""):
            return None
        if isinstance(raw, (dict, list)):
            return raw
        text = str(raw).strip()
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text
    if mode == "urlencoded":
        out: dict[str, Any] = {}
        for row in body.get("urlencoded") or []:
            if isinstance(row, dict) and row.get("key") is not None and not row.get("disabled"):
                out[str(row["key"])] = row.get("value")
        return out or None
    if mode == "formdata":
        out = {}
        for row in body.get("formdata") or []:
            if isinstance(row, dict) and row.get("key") is not None and not row.get("disabled"):
                if row.get("type") == "file":
                    out[str(row["key"])] = "<file>"
                else:
                    out[str(row["key"])] = row.get("value")
        return out or None
    return None


def _headers_from_request(req: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for h in req.get("header") or []:
        if not isinstance(h, dict) or h.get("disabled"):
            continue
        key = h.get("key")
        if key:
            out[str(key)] = str(h.get("value") or "")
    return out


def _example_response(item: dict[str, Any]) -> tuple[int, Any] | None:
    """Pick first saved example response body + status."""
    for key in ("response", "responses"):
        responses = item.get(key)
        if not isinstance(responses, list) or not responses:
            continue
        for resp in responses:
            if not isinstance(resp, dict):
                continue
            code = resp.get("code") or resp.get("status")
            try:
                status = int(code) if code is not None else 200
            except (TypeError, ValueError):
                status = 200
            body = resp.get("body")
            if isinstance(body, str):
                try:
                    body = json.loads(body) if body.strip() else None
                except json.JSONDecodeError:
                    pass
            elif body is None and isinstance(resp.get("json"), (dict, list)):
                body = resp["json"]
            return status, body
    return None


def _infer_schema_from_example(example: Any) -> dict[str, Any] | None:
    if isinstance(example, dict):
        props = {}
        for k, v in example.items():
            if isinstance(v, bool):
                props[k] = {"type": "boolean", "example": v}
            elif isinstance(v, int) and not isinstance(v, bool):
                props[k] = {"type": "integer", "example": v}
            elif isinstance(v, float):
                props[k] = {"type": "number", "example": v}
            elif isinstance(v, list):
                props[k] = {"type": "array", "example": v, "items": {"type": "string"}}
            elif isinstance(v, dict):
                nested = _infer_schema_from_example(v) or {"type": "object"}
                props[k] = nested
            else:
                props[k] = {"type": "string", "example": v}
        return {"type": "object", "properties": props, "example": example}
    if isinstance(example, list):
        item_schema = _infer_schema_from_example(example[0]) if example else {"type": "string"}
        return {"type": "array", "items": item_schema or {"type": "string"}, "example": example}
    return None


def _walk_items(
    items: list[Any],
    *,
    folder_tags: list[str],
    out_ops: list[dict[str, Any]],
    mock_data: dict[str, Any],
    collection_steps: list[dict[str, Any]],
    bases: list[str],
) -> None:
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "request")
        # Folder
        if isinstance(item.get("item"), list) and "request" not in item:
            _walk_items(
                item["item"],
                folder_tags=folder_tags + [name],
                out_ops=out_ops,
                mock_data=mock_data,
                collection_steps=collection_steps,
                bases=bases,
            )
            continue

        req = item.get("request")
        if isinstance(req, str):
            req = {"method": "GET", "url": req}
        if not isinstance(req, dict):
            continue

        method = str(req.get("method") or "GET").upper()
        base, path, query = _url_parts(req.get("url"))
        if base:
            bases.append(base)
        body = _body_from_request(req)
        headers = _headers_from_request(req)
        tag = folder_tags[-1] if folder_tags else "collection"
        op_id = _slug(f"{method}_{path}_{name}")[:80]
        path_params = re.findall(r"\{([^}]+)\}", path)

        parameters: list[dict[str, Any]] = []
        for p in path_params:
            parameters.append({"name": p, "in": "path", "required": True, "schema": {"type": "string"}})
        for k, v in query.items():
            parameters.append(
                {
                    "name": k,
                    "in": "query",
                    "schema": {"type": "string", "example": v},
                    "example": v,
                }
            )

        req_schema = _infer_schema_from_example(body) if isinstance(body, (dict, list)) else None
        ex_resp = _example_response(item)
        resp_schema = None
        resp_status = 200
        resp_body = None
        if ex_resp:
            resp_status, resp_body = ex_resp
            resp_schema = _infer_schema_from_example(resp_body)

        op = {
            "method": method,
            "path": path,
            "operation_id": op_id,
            "summary": name,
            "tags": [tag],
            "parameters": parameters,
            "path_params": path_params,
            "request_schema": req_schema,
            "response_schema": resp_schema,
            "security": None,
            "responses": {str(resp_status): {"description": "Postman example"}},
            # extras consumed by mock/fixture layer
            "example_request": body,
            "example_query": query,
            "example_headers": {
                k: v
                for k, v in headers.items()
                if k.lower() not in ("content-type", "content-length", "host")
            },
            "example_response": {"status": resp_status, "body": resp_body},
        }
        out_ops.append(op)

        fixture = {
            "request": {
                "body": body,
                "query": query,
                "headers": op["example_headers"],
            },
            "response": {"status": resp_status, "body": resp_body if resp_body is not None else {"ok": True}},
        }
        mock_data[op_id] = fixture
        mock_data[f"{method} {path}"] = fixture

        # Collection-order step for e2e replay
        step_path = path
        for p in path_params:
            step_path = step_path.replace("{" + p + "}", "{{" + p + "}}")
        collection_steps.append(
            {
                "operation_id": op_id,
                "method": method,
                "path": step_path,
                "path_template": path,
                "query": query,
                "headers": op["example_headers"],
                "body": body,
                "captures": [],
                "expected_status": [resp_status] if resp_status else [200, 201, 202, 204],
                "assert_schema": False,
                "kind": "e2e",
                "skip_auth": False,
                "from_postman": True,
                "base_url": base or "",
            }
        )


def collection_to_openapi_and_fixtures(collection: dict[str, Any]) -> dict[str, Any]:
    """Convert Postman collection → OpenAPI 3 doc + mock_data + collection flow steps."""
    info = collection.get("info") or {}
    name = str(info.get("name") or "Postman Collection")
    ops: list[dict[str, Any]] = []
    mock_data: dict[str, Any] = {}
    collection_steps: list[dict[str, Any]] = []
    bases: list[str] = []

    # Collection variables as default mock vars
    variables: dict[str, Any] = {}
    for v in collection.get("variable") or []:
        if isinstance(v, dict) and v.get("key") is not None:
            variables[str(v["key"])] = v.get("value")

    _walk_items(
        collection.get("item") or [],
        folder_tags=[],
        out_ops=ops,
        mock_data=mock_data,
        collection_steps=collection_steps,
        bases=bases,
    )

    # Deduplicate ops by METHOD path (keep first)
    seen: set[str] = set()
    unique_ops: list[dict[str, Any]] = []
    for op in ops:
        key = f"{op['method']} {op['path']}"
        if key in seen:
            continue
        seen.add(key)
        unique_ops.append(op)

    base_url = next((b for b in bases if b and "{{" not in b), "")
    paths: dict[str, Any] = {}
    for op in unique_ops:
        paths.setdefault(op["path"], {})
        content: dict[str, Any] = {
            "operationId": op["operation_id"],
            "summary": op["summary"],
            "tags": op["tags"],
            "parameters": op["parameters"],
            "responses": {
                str(k): {"description": v.get("description", "")}
                for k, v in (op.get("responses") or {}).items()
            },
        }
        if op.get("request_schema"):
            content["requestBody"] = {
                "content": {
                    "application/json": {
                        "schema": op["request_schema"],
                        "example": op.get("example_request"),
                    }
                }
            }
        if op.get("response_schema"):
            code = str((op.get("example_response") or {}).get("status") or 200)
            content["responses"][code] = {
                "description": "Example",
                "content": {
                    "application/json": {
                        "schema": op["response_schema"],
                        "example": (op.get("example_response") or {}).get("body"),
                    }
                },
            }
        paths[op["path"]][op["method"].lower()] = content

    openapi_doc = {
        "openapi": "3.0.3",
        "info": {
            "title": name,
            "version": "1.0.0",
            "description": f"Imported from Postman collection: {name}",
        },
        "servers": [{"url": base_url}] if base_url else [],
        "paths": paths,
        "x-source": "postman",
    }

    return {
        "openapi_doc": openapi_doc,
        "ops": unique_ops,
        "mock_data": mock_data,
        "collection_steps": collection_steps,
        "base_url": base_url,
        "variables": variables,
        "name": name,
    }


def apply_fixtures_to_step(step: dict[str, Any], mock_data: dict[str, Any] | None) -> dict[str, Any]:
    """Overlay Postman/mock request fixtures onto a generated step."""
    if not mock_data:
        return step
    oid = step.get("operation_id") or ""
    key = f"{step.get('method')} {step.get('path_template') or step.get('path')}"
    fixture = mock_data.get(oid) or mock_data.get(key)
    if not fixture or not isinstance(fixture, dict):
        return step
    req = fixture.get("request") if isinstance(fixture.get("request"), dict) else fixture
    out = dict(step)
    if req.get("body") is not None and out.get("body") is None:
        out["body"] = req["body"]
    elif req.get("body") is not None and out.get("kind") in ("contract", "e2e", "happy", "load"):
        out["body"] = req["body"]
    if req.get("query"):
        out["query"] = {**(out.get("query") or {}), **req["query"]}
    if req.get("headers"):
        out["headers"] = {**(out.get("headers") or {}), **req["headers"]}
    return out


def lookup_mock_response(
    mock_data: dict[str, Any] | None,
    *,
    operation_id: str | None,
    method: str,
    path_template: str,
) -> dict[str, Any] | None:
    if not mock_data:
        return None
    fixture = None
    if operation_id and operation_id in mock_data:
        fixture = mock_data[operation_id]
    if fixture is None:
        fixture = mock_data.get(f"{method.upper()} {path_template}")
    if not isinstance(fixture, dict):
        return None
    resp = fixture.get("response")
    if isinstance(resp, dict):
        return resp
    # Allow shorthand: { "status": 200, "body": {...} } at top level
    if "status" in fixture or "body" in fixture:
        return {"status": fixture.get("status", 200), "body": fixture.get("body")}
    return None


_KIND_FOLDER_LABELS = {
    "contract": "1. Contract / Schema",
    "e2e": "2. E2E / Happy path",
    "happy": "2. E2E / Happy path",
    "edge": "3. Boundary & Edge",
    "negative": "4. Negative & Errors",
    "security": "5. Security & Auth",
    "load": "6. Performance / Load",
}


def _openapi_path_to_postman(path: str) -> str:
    """Convert /pet/{petId} → /pet/{{petId}} (Postman variables)."""
    path = (path or "").strip() or "/"
    if not path.startswith("/"):
        path = "/" + path
    return re.sub(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", r"{{\1}}", path)


def _apply_path_params(path: str, path_params: dict[str, Any] | None) -> str:
    out = path
    for key, value in (path_params or {}).items():
        token = str(value)
        out = out.replace("{{" + str(key) + "}}", token)
        out = out.replace("{" + str(key) + "}", token)
    return out


def _jsonpath_to_js(jsonpath: str) -> str:
    """Best-effort $.a.b[0].c → JS accessor chain for pm.response.json()."""
    jp = (jsonpath or "").strip()
    if not jp or jp == "$":
        return ""
    if jp.startswith("$."):
        jp = jp[2:]
    elif jp.startswith("$"):
        jp = jp[1:].lstrip(".")
    parts: list[str] = []
    for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]*|\[\d+\]", jp):
        if token.startswith("[") and token.endswith("]"):
            parts.append(token)
        else:
            parts.append(f"[{json.dumps(token)}]")
    return "".join(parts)


def _step_to_postman_item(step: dict[str, Any], *, index: int = 0) -> dict[str, Any]:
    method = str(step.get("method") or "GET").upper()
    path_template = str(step.get("path_template") or step.get("path") or "/")
    path = _openapi_path_to_postman(str(step.get("path") or path_template))
    path = _apply_path_params(
        path,
        step.get("path_params") if isinstance(step.get("path_params"), dict) else None,
    )
    query = step.get("query") if isinstance(step.get("query"), dict) else {}
    headers = step.get("headers") if isinstance(step.get("headers"), dict) else {}
    body = step.get("body")

    path_segments = [seg for seg in path.strip("/").split("/") if seg != ""]
    query_rows = [
        {"key": str(k), "value": "" if v is None else str(v)}
        for k, v in query.items()
    ]
    raw = "{{baseUrl}}" + path
    if query_rows:
        raw += "?" + "&".join(f"{q['key']}={q['value']}" for q in query_rows)

    header_rows = [
        {"key": str(k), "value": "" if v is None else str(v), "type": "text"}
        for k, v in headers.items()
        if str(k).lower() != "content-type" or body is None
    ]
    request: dict[str, Any] = {
        "method": method,
        "header": header_rows,
        "url": {
            "raw": raw,
            "host": ["{{baseUrl}}"],
            "path": path_segments,
            "query": query_rows,
        },
    }
    desc_bits = []
    if step.get("operation_id"):
        desc_bits.append(f"operationId: {step['operation_id']}")
    if step.get("kind"):
        desc_bits.append(f"kind: {step['kind']}")
    if step.get("security_probe"):
        desc_bits.append(f"security_probe: {step['security_probe']}")
    if step.get("rationale"):
        desc_bits.append(str(step["rationale"]))
    if desc_bits:
        request["description"] = "\n".join(desc_bits)

    if body is not None:
        if isinstance(body, (dict, list)):
            raw_body = json.dumps(body, indent=2, default=str)
        else:
            raw_body = str(body)
        request["body"] = {
            "mode": "raw",
            "raw": raw_body,
            "options": {"raw": {"language": "json"}},
        }
        if not any(str(h.get("key") or "").lower() == "content-type" for h in header_rows):
            header_rows.append(
                {"key": "Content-Type", "value": "application/json", "type": "text"}
            )

    events: list[dict[str, Any]] = []
    seed = step.get("seed_var") if isinstance(step.get("seed_var"), dict) else {}
    if seed:
        exec_lines = [
            "// Seed variables from AI Assurance Platform flow step",
            *[
                f"pm.collectionVariables.set({json.dumps(str(k))}, {json.dumps(v, default=str)});"
                for k, v in seed.items()
            ],
        ]
        events.append(
            {
                "listen": "prerequest",
                "script": {"type": "text/javascript", "exec": exec_lines},
            }
        )

    test_lines: list[str] = []
    expected = step.get("expected_status") or []
    if isinstance(expected, list) and expected:
        codes = ", ".join(str(int(c)) for c in expected if str(c).isdigit() or isinstance(c, int))
        if codes:
            test_lines.extend(
                [
                    f"pm.test('Status code in [{codes}]', function () {{",
                    f"  pm.expect([{codes}]).to.include(pm.response.code);",
                    "});",
                ]
            )
    for cap in step.get("captures") or []:
        if not isinstance(cap, dict):
            continue
        var = str(cap.get("var") or "").strip()
        if not var:
            continue
        accessor = _jsonpath_to_js(str(cap.get("jsonpath") or "$.id"))
        if not accessor:
            continue
        test_lines.extend(
            [
                "try {",
                "  const __body = pm.response.json();",
                f"  const __val = __body{accessor};",
                f"  if (__val !== undefined && __val !== null) pm.collectionVariables.set({json.dumps(var)}, __val);",
                "} catch (e) { /* ignore capture errors */ }",
            ]
        )
    if step.get("skip_auth"):
        test_lines.append("// skip_auth: request intentionally omits auth headers")
    if test_lines:
        events.append(
            {
                "listen": "test",
                "script": {"type": "text/javascript", "exec": test_lines},
            }
        )

    oid = step.get("operation_id") or path_template
    name = f"{index + 1}. {method} {path_template}"
    if step.get("operation_id"):
        name = f"{index + 1}. {oid}"
    item: dict[str, Any] = {"name": name[:160], "request": request}
    if events:
        item["event"] = events
    return item


def flows_to_postman_collection(
    flows: list[dict[str, Any]],
    *,
    name: str,
    base_url: str = "",
    description: str | None = None,
) -> dict[str, Any]:
    """Convert API Test Console flows into a Postman Collection v2.1 document."""
    by_kind: dict[str, list[dict[str, Any]]] = {}
    for flow in flows:
        kind = str(flow.get("kind") or "e2e")
        if kind == "happy":
            kind = "e2e"
        by_kind.setdefault(kind, []).append(flow)

    kind_order = ["contract", "e2e", "edge", "negative", "security", "load"]
    folders: list[dict[str, Any]] = []
    for kind in kind_order + [k for k in by_kind if k not in kind_order]:
        group = by_kind.get(kind) or []
        if not group:
            continue
        flow_items: list[dict[str, Any]] = []
        for flow in group:
            steps = [s for s in (flow.get("steps") or []) if isinstance(s, dict)]
            step_items = [_step_to_postman_item(s, index=i) for i, s in enumerate(steps)]
            if not step_items:
                continue
            flow_name = str(flow.get("name") or f"{kind} flow")[:160]
            if len(step_items) == 1:
                single = dict(step_items[0])
                single["name"] = flow_name
                flow_items.append(single)
            else:
                flow_items.append({"name": flow_name, "item": step_items})
        if flow_items:
            folders.append(
                {
                    "name": _KIND_FOLDER_LABELS.get(kind, kind),
                    "item": flow_items,
                }
            )

    if not folders:
        raise ValueError("No exportable steps in flows")

    coll_name = (name or "API Assurance Suite").strip() or "API Assurance Suite"
    desc = description or (
        "Exported from AI Assurance Platform API Test Console. "
        "Folders are spectrum layers; nested folders are flows. "
        "Uses collection variable `baseUrl`."
    )
    variables = [
        {
            "key": "baseUrl",
            "value": (base_url or "").rstrip("/"),
            "type": "string",
        }
    ]
    # Seed common vars seen in seed_var / captures so Postman UI shows them
    seen_vars = {"baseUrl"}
    for flow in flows:
        for step in flow.get("steps") or []:
            if not isinstance(step, dict):
                continue
            seed = step.get("seed_var") if isinstance(step.get("seed_var"), dict) else {}
            for key, value in seed.items():
                key_s = str(key)
                if key_s in seen_vars:
                    continue
                seen_vars.add(key_s)
                variables.append(
                    {
                        "key": key_s,
                        "value": "" if value is None else str(value),
                        "type": "string",
                    }
                )
            for cap in step.get("captures") or []:
                if not isinstance(cap, dict):
                    continue
                key_s = str(cap.get("var") or "").strip()
                if not key_s or key_s in seen_vars:
                    continue
                seen_vars.add(key_s)
                variables.append({"key": key_s, "value": "", "type": "string"})

    return {
        "info": {
            "_postman_id": str(uuid4()),
            "name": coll_name,
            "description": desc,
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "variable": variables,
        "item": folders,
    }


__all__ = [
    "is_postman_collection",
    "parse_postman_text",
    "collection_to_openapi_and_fixtures",
    "apply_fixtures_to_step",
    "lookup_mock_response",
    "flows_to_postman_collection",
]
