"""Orchestrate ingest → generate → run for API Test Console."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import db
from ..config import settings
from ..ws import bus
from .allure_report import write_allure_results, write_html_report
from .analyze import detect_anomalies, endpoint_status_map, flaky_endpoints
from .insights import build_run_insights
from .auth import (
    apply_security,
    build_authorize_url,
    ensure_access_token,
    obtain_token,
    public_security,
)
from .drift import compute_drift
from .ai import ai_generate_flows, ai_polish_insights
from .parser import (
    extract_security_schemes,
    fetch_spec,
    infer_base_url,
    normalize_operations,
    parse_spec_text,
)
from .postman import (
    collection_to_openapi_and_fixtures,
    flows_to_postman_collection,
    is_postman_collection,
    parse_postman_text,
)
from .runner import _execute_one, run_suite
from .ssrf import assert_safe_url

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cfg(project: dict[str, Any]) -> dict[str, Any]:
    return project.get("config") or {}


def _report_root(project_id: str, run_id: str) -> Path:
    return Path(settings.data_dir) / "api_test_reports" / project_id / run_id


def _prefix_operation_id(service_key: str, operation_id: str) -> str:
    key = (service_key or "default").strip() or "default"
    oid = str(operation_id or "").strip()
    prefix = f"{key}__"
    if oid.startswith(prefix):
        return oid
    return f"{prefix}{oid}"


def _tag_ops_for_service(
    ops: list[dict[str, Any]], *, service_id: str, service_key: str
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for o in ops:
        tagged = dict(o)
        tagged["operation_id"] = _prefix_operation_id(service_key, o.get("operation_id") or "")
        tagged["service_id"] = service_id
        tagged["service_key"] = service_key
        out.append(tagged)
    return out


def _match_service_key_for_base(base_hint: str, services: list[dict[str, Any]]) -> str | None:
    """Best-effort: map a request host/base to a known service key."""
    hint = (base_hint or "").rstrip("/").lower()
    if not hint or "{{" in hint:
        return None
    for svc in services:
        base = (svc.get("base_url") or "").rstrip("/").lower()
        if not base:
            continue
        if hint == base or hint.startswith(base) or base.startswith(hint):
            return str(svc.get("key") or "")
        # host-only match
        try:
            from urllib.parse import urlparse

            h1 = urlparse(hint if "://" in hint else f"https://{hint}").netloc
            h2 = urlparse(base if "://" in base else f"https://{base}").netloc
            if h1 and h2 and h1 == h2:
                return str(svc.get("key") or "")
        except Exception:
            continue
    return None


def tag_steps_with_services(
    steps: list[dict[str, Any]],
    services: list[dict[str, Any]],
    *,
    default_key: str | None = None,
) -> list[dict[str, Any]]:
    """Annotate flow/collection steps with service_key when host matches a service base."""
    out: list[dict[str, Any]] = []
    for step in steps:
        s = dict(step)
        if s.get("service_key"):
            out.append(s)
            continue
        path = str(s.get("path") or "")
        base_hint = str(s.get("base_url") or s.get("host") or "")
        if path.startswith(("http://", "https://")):
            try:
                from urllib.parse import urlparse

                parsed = urlparse(path)
                base_hint = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                pass
        matched = _match_service_key_for_base(base_hint, services) if base_hint else None
        s["service_key"] = matched or default_key or (services[0].get("key") if services else "default")
        if matched or default_key:
            oid = str(s.get("operation_id") or "")
            key = str(s["service_key"])
            if oid and not oid.startswith(f"{key}__"):
                s["operation_id"] = _prefix_operation_id(key, oid)
        out.append(s)
    return out


async def _load_all_ops(project_id: str) -> list[dict[str, Any]]:
    """Load and tag operations from every service (or legacy project raw)."""
    services = await db.list_api_services(project_id, include_raw=True, synthesize_legacy=True)
    ops: list[dict[str, Any]] = []
    for svc in services:
        raw = (svc.get("openapi_raw") or "").strip()
        if not raw:
            continue
        try:
            doc = parse_spec_text(raw)
            normalized = normalize_operations(doc)
        except Exception as exc:
            logger.warning("skip service %s ops: %s", svc.get("key"), exc)
            continue
        ops.extend(
            _tag_ops_for_service(
                normalized,
                service_id=str(svc.get("id") or ""),
                service_key=str(svc.get("key") or "default"),
            )
        )
    if ops:
        return ops
    # Final fallback: project-level raw without services
    project = await db.get_api_project(project_id)
    raw = (project or {}).get("openapi_raw") or ""
    if not raw.strip():
        return []
    return _tag_ops_for_service(
        normalize_operations(parse_spec_text(raw)),
        service_id="",
        service_key="default",
    )


async def _rebuild_endpoints_from_services(project_id: str) -> list[dict[str, Any]]:
    ops = await _load_all_ops(project_id)
    endpoints = [
        {
            "method": o["method"],
            "path": o["path"],
            "operation_id": o["operation_id"],
            "tags": o.get("tags") or [],
            "summary": o.get("summary") or "",
            "meta": {
                "path_params": o.get("path_params") or [],
                "has_body": bool(o.get("request_schema")),
                "service_id": o.get("service_id") or "",
                "service_key": o.get("service_key") or "default",
            },
        }
        for o in ops
    ]
    await db.replace_api_endpoints(project_id, endpoints)
    return endpoints


async def _resolve_ingest_service(
    project_id: str, service_id: str | None
) -> dict[str, Any]:
    if service_id:
        svc = await db.get_api_service(service_id, include_raw=True)
        if not svc or svc.get("project_id") != project_id:
            raise ValueError("Service not found")
        if svc.get("synthetic"):
            svc = await db.ensure_primary_api_service(project_id, include_raw=True)
        return svc
    return await db.ensure_primary_api_service(project_id, include_raw=True)


async def ingest_project(
    project_id: str,
    *,
    url: str | None = None,
    raw_text: str | None = None,
    service_id: str | None = None,
) -> dict[str, Any]:
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    allow_private = bool(_cfg(project).get("allow_private_urls"))
    cfg = dict(_cfg(project))
    svc = await _resolve_ingest_service(project_id, service_id)

    # Detect Postman collection early (upload path)
    if raw_text:
        try:
            maybe = json.loads(raw_text)
        except Exception:
            maybe = None
        if isinstance(maybe, dict) and is_postman_collection(maybe):
            return await ingest_postman(
                project_id, raw_text=raw_text, filename=url, service_id=svc["id"]
            )

    if raw_text:
        raw = raw_text
        doc = parse_spec_text(raw)
        source_url = url or svc.get("openapi_url") or project.get("openapi_url") or ""
    else:
        source_url = (url or svc.get("openapi_url") or project.get("openapi_url") or "").strip()
        if not source_url:
            raise ValueError("OpenAPI URL is required")
        raw, doc = await fetch_spec(source_url, allow_private=allow_private)

    schemes = extract_security_schemes(doc)
    base = (svc.get("base_url") or "").strip() or infer_base_url(doc) or ""

    await db.update_api_service(
        svc["id"],
        openapi_url=source_url,
        openapi_raw=raw,
        base_url=base or svc.get("base_url") or "",
        security_schemes=schemes,
    )
    cfg["source"] = "openapi"
    await db.update_api_project(project_id, config=cfg)
    await db.mirror_primary_service_to_project(project_id)

    endpoints = await _rebuild_endpoints_from_services(project_id)

    baseline = await db.get_api_baseline(project_id)
    if not baseline:
        await db.set_api_baseline(project_id, raw)
        drift = {"changes": [], "added": 0, "removed": 0, "modified": 0, "is_first_baseline": True}
    else:
        drift = compute_drift(baseline["schema_json"], raw)
        drift["is_first_baseline"] = False

    drift_keys = {c["op"] for c in drift.get("changes") or [] if c.get("kind") in ("added", "modified", "removed")}
    if drift_keys:
        service_key = str(svc.get("key") or "default")
        await db.update_endpoint_statuses(
            project_id,
            {k: "drift" for k in drift_keys}
            | {f"{service_key}__{k}": "drift" for k in drift_keys},
        )

    project = await db.get_api_project(project_id, include_raw=False)
    merged_schemes = project.get("security_schemes") or schemes
    return {
        "project": project,
        "service": await db.get_api_service(svc["id"], include_raw=False),
        "endpoint_count": len(endpoints),
        "security_schemes": public_security(merged_schemes, await db.list_api_auth(project_id)),
        "drift": drift,
        "source": "openapi",
    }


async def ingest_postman(
    project_id: str,
    *,
    raw_text: str,
    filename: str | None = None,
    service_id: str | None = None,
) -> dict[str, Any]:
    """Import a Postman Collection v2.1 — stores synthetic OpenAPI + mock fixtures."""
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    svc = await _resolve_ingest_service(project_id, service_id)

    collection = parse_postman_text(raw_text)
    converted = collection_to_openapi_and_fixtures(collection)
    openapi_doc = converted["openapi_doc"]
    raw = json.dumps(openapi_doc, indent=2)
    schemes = extract_security_schemes(openapi_doc)
    base = (svc.get("base_url") or "").strip() or converted.get("base_url") or ""

    services = await db.list_api_services(project_id, include_raw=False, synthesize_legacy=True)
    # Prefer matching collection hosts to known services; default to ingest target.
    collection_steps = tag_steps_with_services(
        list(converted.get("collection_steps") or []),
        services,
        default_key=str(svc.get("key") or "default"),
    )
    # Prefix operation ids / mock keys for this service
    service_key = str(svc.get("key") or "default")
    mock_data_raw = converted.get("mock_data") or {}
    mock_data: dict[str, Any] = {}
    for k, v in mock_data_raw.items():
        if " " in str(k):
            mock_data[str(k)] = v
            mock_data[f"{service_key}__{k}"] = v
        else:
            mock_data[_prefix_operation_id(service_key, str(k))] = v

    for step in collection_steps:
        sk = str(step.get("service_key") or service_key)
        step["service_key"] = sk
        oid = str(step.get("operation_id") or "")
        if "__" in oid:
            oid = oid.split("__", 1)[-1]
        step["operation_id"] = _prefix_operation_id(sk, oid)

    cfg = dict(_cfg(project))
    cfg["source"] = "postman"
    # Merge fixtures; replace collection_steps for this import (primary recorded flow)
    existing_mock = dict(cfg.get("mock_data") or {})
    existing_mock.update(mock_data)
    cfg["mock_data"] = existing_mock
    cfg["collection_steps"] = collection_steps
    cfg["collection_variables"] = converted.get("variables") or {}
    if filename:
        cfg["postman_filename"] = filename

    source_label = filename or f"postman:{converted.get('name') or 'collection'}"
    await db.update_api_service(
        svc["id"],
        openapi_url=source_label,
        openapi_raw=raw,
        base_url=base or svc.get("base_url") or "",
        security_schemes=schemes,
    )
    await db.update_api_project(
        project_id,
        name=project.get("name") or converted.get("name") or "API suite",
        config=cfg,
    )
    await db.mirror_primary_service_to_project(project_id)

    endpoints = await _rebuild_endpoints_from_services(project_id)

    baseline = await db.get_api_baseline(project_id)
    if not baseline:
        await db.set_api_baseline(project_id, raw)
        drift = {
            "changes": [],
            "added": 0,
            "removed": 0,
            "modified": 0,
            "is_first_baseline": True,
        }
    else:
        drift = compute_drift(baseline["schema_json"], raw)
        drift["is_first_baseline"] = False

    project = await db.get_api_project(project_id, include_raw=False)
    merged_schemes = project.get("security_schemes") or schemes
    return {
        "project": project,
        "service": await db.get_api_service(svc["id"], include_raw=False),
        "endpoint_count": len(endpoints),
        "security_schemes": public_security(merged_schemes, await db.list_api_auth(project_id)),
        "drift": drift,
        "source": "postman",
        "mock_fixtures": len(cfg.get("mock_data") or {}),
        "collection_steps": len(cfg.get("collection_steps") or []),
    }


async def save_mock_data(project_id: str, mock_data: dict[str, Any]) -> dict[str, Any]:
    """Merge/replace mock request/response fixtures on the project config."""
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    if not isinstance(mock_data, dict):
        raise ValueError("mock_data must be a JSON object")
    cfg = dict(_cfg(project))
    existing = dict(cfg.get("mock_data") or {})
    existing.update(mock_data)
    cfg["mock_data"] = existing
    await db.update_api_project(project_id, config=cfg)
    return {"ok": True, "fixture_count": len(existing), "mock_mode": bool(cfg.get("mock_mode"))}


def _step_matches(
    step: dict[str, Any],
    *,
    operation_id: str | None,
    method: str,
    path: str,
    path_template: str | None,
) -> bool:
    sm = str(step.get("method") or "").upper()
    if sm != method.upper():
        return False
    oid = (operation_id or "").strip()
    if oid and str(step.get("operation_id") or "") == oid:
        return True
    candidates = {
        str(step.get("path_template") or ""),
        str(step.get("path") or ""),
        str(path_template or ""),
        str(path or ""),
    }
    # Normalize {{var}} and {var} for loose match on static prefix
    def norm(p: str) -> str:
        p = p.split("?")[0]
        p = re.sub(r"\{\{[^}]+\}\}", "{}", p)
        p = re.sub(r"\{[^}]+\}", "{}", p)
        return p

    target = norm(path_template or path)
    if not target:
        return False
    return any(norm(c) == target for c in candidates if c)


async def save_request_edit(
    project_id: str,
    *,
    method: str,
    path: str = "",
    path_template: str | None = None,
    operation_id: str | None = None,
    flow_name: str | None = None,
    headers: dict[str, Any] | None = None,
    query: dict[str, Any] | None = None,
    body: Any = None,
    update_mock: bool = True,
) -> dict[str, Any]:
    """Persist edited request onto matching generated flow steps (+ mock fixtures)."""
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")

    flows = await db.list_api_flows(project_id)
    updated_flows: list[str] = []
    updated_steps = 0

    for flow in flows:
        if flow_name and flow.get("name") != flow_name:
            continue
        steps = list(flow.get("steps") or [])
        changed = False
        new_steps: list[dict[str, Any]] = []
        for step in steps:
            s = dict(step)
            if _step_matches(
                s,
                operation_id=operation_id,
                method=method,
                path=path,
                path_template=path_template or s.get("path_template"),
            ):
                if headers is not None:
                    s["headers"] = headers
                if query is not None:
                    s["query"] = query
                # Always set body key when provided (including null / empty object)
                s["body"] = body
                changed = True
                updated_steps += 1
            new_steps.append(s)
        if changed:
            await db.update_api_flow_steps(flow["id"], new_steps)
            updated_flows.append(flow.get("name") or flow["id"])

    # Also patch Postman collection_steps in config
    cfg = dict(_cfg(project))
    coll = cfg.get("collection_steps")
    if isinstance(coll, list):
        new_coll = []
        coll_changed = False
        for step in coll:
            s = dict(step) if isinstance(step, dict) else step
            if isinstance(s, dict) and _step_matches(
                s,
                operation_id=operation_id,
                method=method,
                path=path,
                path_template=path_template,
            ):
                if headers is not None:
                    s["headers"] = headers
                if query is not None:
                    s["query"] = query
                s["body"] = body
                coll_changed = True
                updated_steps += 1
            new_coll.append(s)
        if coll_changed:
            cfg["collection_steps"] = new_coll

    mock_updated = False
    if update_mock:
        mock = dict(cfg.get("mock_data") or {})
        tpl = path_template or path
        keys = []
        if operation_id:
            keys.append(operation_id)
        if method and tpl:
            keys.append(f"{method.upper()} {tpl.split('?')[0]}")
        if method and path:
            keys.append(f"{method.upper()} {path.split('?')[0]}")
        for key in keys:
            if not key:
                continue
            prev = dict(mock.get(key) or {}) if isinstance(mock.get(key), dict) else {}
            req = dict(prev.get("request") or {}) if isinstance(prev.get("request"), dict) else {}
            if headers is not None:
                req["headers"] = headers
            if query is not None:
                req["query"] = query
            req["body"] = body
            prev["request"] = req
            if "response" not in prev:
                prev["response"] = {"status": 200, "body": {"ok": True}}
            mock[key] = prev
            mock_updated = True
        if mock_updated:
            cfg["mock_data"] = mock

    # If nothing matched existing flows, upsert a dedicated "Edited requests" flow
    if updated_steps == 0:
        tpl = (path_template or path or "/").split("?")[0] or "/"
        new_step = {
            "operation_id": operation_id or f"{method.upper()}_{tpl}".replace("/", "_"),
            "method": method.upper(),
            "path": tpl,
            "path_template": tpl,
            "query": query or {},
            "headers": headers or {},
            "body": body,
            "captures": [],
            "expected_status": [200, 201, 202, 204],
            "assert_schema": False,
            "kind": "e2e",
            "skip_auth": False,
        }
        edited = next((f for f in flows if f.get("name") == "Edited requests"), None)
        if edited:
            steps = list(edited.get("steps") or [])
            replaced = False
            for i, s in enumerate(steps):
                if _step_matches(
                    s,
                    operation_id=new_step["operation_id"],
                    method=method,
                    path=tpl,
                    path_template=tpl,
                ):
                    steps[i] = {**s, **new_step}
                    replaced = True
                    break
            if not replaced:
                steps.append(new_step)
            await db.update_api_flow_steps(edited["id"], steps)
            updated_flows.append("Edited requests")
            updated_steps = 1
        else:
            await db.insert_api_flow(
                project_id,
                {
                    "name": "Edited requests",
                    "kind": "e2e",
                    "resource": "manual",
                    "steps": [new_step],
                },
            )
            updated_flows.append("Edited requests")
            updated_steps = 1
            if update_mock and not mock_updated:
                mock = dict(cfg.get("mock_data") or {})
                key = f"{method.upper()} {tpl}"
                mock[key] = {
                    "request": {"headers": headers or {}, "query": query or {}, "body": body},
                    "response": {"status": 200, "body": {"ok": True}},
                }
                if operation_id:
                    mock[operation_id] = mock[key]
                cfg["mock_data"] = mock
                mock_updated = True

    await db.update_api_project(project_id, config=cfg)
    return {
        "ok": True,
        "updated_steps": updated_steps,
        "updated_flows": updated_flows,
        "mock_updated": mock_updated,
    }


async def get_drift(project_id: str) -> dict[str, Any]:
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    baseline = await db.get_api_baseline(project_id)
    current_raw = project.get("openapi_raw") or ""
    if not baseline:
        return {
            "changes": [],
            "added": 0,
            "removed": 0,
            "modified": 0,
            "baseline_ops": 0,
            "current_ops": 0,
            "has_baseline": False,
            "has_current": bool(current_raw.strip()),
            "baseline_at": None,
            "openapi_url": project.get("openapi_url") or "",
            "message": "No baseline yet — ingest an OpenAPI document first.",
        }
    drift = compute_drift(baseline["schema_json"], current_raw)
    total_changes = (drift.get("added") or 0) + (drift.get("removed") or 0) + (drift.get("modified") or 0)
    if not current_raw.strip():
        message = "No current schema stored. Ingest OpenAPI to compare against baseline."
    elif total_changes == 0:
        message = (
            "No drift — the stored schema matches the baseline captured on first ingest. "
            "Re-ingest the OpenAPI URL after the API changes to detect added/removed/modified operations."
        )
    else:
        message = f"{total_changes} operation change(s) vs baseline."
    return {
        **drift,
        "has_baseline": True,
        "has_current": bool(current_raw.strip()),
        "baseline_at": baseline.get("created_at"),
        "openapi_url": project.get("openapi_url") or "",
        "message": message,
        "in_sync": total_changes == 0 and bool(current_raw.strip()),
    }


async def reset_baseline(project_id: str) -> dict[str, Any]:
    """Set baseline = current stored OpenAPI (accept current as new truth)."""
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    raw = (project.get("openapi_raw") or "").strip()
    if not raw:
        raise ValueError("No current OpenAPI stored — ingest a schema first")
    baseline = await db.replace_api_baseline(project_id, raw)
    return {
        "ok": True,
        "baseline_at": baseline.get("created_at"),
        "drift": await get_drift(project_id),
    }


async def save_auth(
    project_id: str,
    scheme_name: str,
    secrets: dict[str, Any],
) -> dict[str, Any]:
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    schemes = dict(project.get("security_schemes") or {})
    scheme = dict(schemes.get(scheme_name) or {})
    raw_type = str(secrets.get("type") or scheme.get("type") or "apiKey").strip()
    secrets_clean = {k: v for k, v in secrets.items() if k not in ("type", "param_name") and v not in (None, "")}
    param_name = secrets.get("param_name")
    # Normalize common UI types
    stype_l = raw_type.lower()
    if stype_l in ("bearer", "http_bearer"):
        scheme = {**scheme, "type": "http", "scheme": "bearer"}
        stype = "http"
    elif stype_l in ("basic", "http_basic"):
        scheme = {**scheme, "type": "http", "scheme": "basic"}
        stype = "http"
    elif stype_l in ("apikey", "api_key"):
        scheme = {
            **scheme,
            "type": "apiKey",
            "name": scheme.get("name") or param_name or "api_key",
            "in": scheme.get("in") or "header",
        }
        stype = "apiKey"
    elif stype_l in ("oauth2", "oauth"):
        scheme = {**scheme, "type": "oauth2", "flows": scheme.get("flows") or {}}
        stype = "oauth2"
    else:
        scheme = {**scheme, "type": raw_type}
        stype = raw_type

    # Persist scheme on project so Auth UI lists it even before OpenAPI ingest
    schemes[scheme_name] = scheme
    await db.update_api_project(project_id, security_schemes=schemes)

    row = await db.upsert_api_auth(project_id, scheme_name, stype, secrets_clean, merge=True)
    return {
        "scheme_name": scheme_name,
        "configured": True,
        "scheme_type": stype,
        "updated_at": row["updated_at"],
        "security": public_security(schemes, await db.list_api_auth(project_id)),
    }


def _pick_probe_path(endpoints: list[dict[str, Any]]) -> tuple[str, dict[str, str]]:
    """Choose a lightweight GET path + query for a connectivity probe."""
    preferred_tokens = ("health", "ping", "status", "version", "swagger", "openapi")
    gets = [
        e
        for e in endpoints
        if (e.get("method") or "").upper() == "GET" and "{" not in (e.get("path") or "")
    ]
    if not gets:
        return "/", {}

    def score(ep: dict[str, Any]) -> tuple[int, int]:
        path = (ep.get("path") or "").lower()
        pref = 0 if any(t in path for t in preferred_tokens) else 1
        return pref, len(path)

    gets.sort(key=score)
    path = gets[0].get("path") or "/"
    query: dict[str, str] = {}
    # Petstore & similar: status filters are commonly required on list GETs
    if "status" in path or path.rstrip("/").endswith("findByStatus"):
        query["status"] = "available"
    return path if path.startswith("/") else f"/{path}", query


async def test_connection(
    project_id: str,
    *,
    scheme_name: str | None = None,
) -> dict[str, Any]:
    """Probe base URL (with optional auth) to verify reachability and credentials."""
    import time

    import httpx

    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")

    base = (project.get("base_url") or "").strip().rstrip("/")
    if not base:
        raise ValueError("Set a Base URL first, then Save configuration")

    cfg = _cfg(project)
    allow_private = bool(cfg.get("allow_private_urls"))
    schemes = dict(project.get("security_schemes") or {})
    auth_rows = await db.list_api_auth(project_id)
    auth_secrets = {r["scheme_name"]: dict(r.get("secrets") or {}) for r in auth_rows}

    sn = (scheme_name or "").strip()
    if not sn:
        # Prefer a configured scheme, else first scheme, else none
        for name, secrets in auth_secrets.items():
            if secrets.get("api_key") or secrets.get("access_token") or secrets.get("bearer_token") or secrets.get(
                "username"
            ):
                sn = name
                break
        if not sn and schemes:
            sn = next(iter(schemes.keys()))

    headers: dict[str, str] = {"Accept": "application/json", "User-Agent": "AI-Assurance-API-Test/1.0"}
    query: dict[str, str] = {}
    auth_applied = False
    if sn and sn in schemes:
        secrets = auth_secrets.get(sn) or {}
        try:
            secrets = await ensure_access_token(schemes[sn], secrets, allow_private=allow_private)
            if secrets != (auth_secrets.get(sn) or {}):
                await db.upsert_api_auth(
                    project_id,
                    sn,
                    (schemes[sn].get("type") or "oauth2"),
                    secrets,
                    merge=True,
                )
                auth_secrets[sn] = secrets
        except Exception as exc:
            logger.warning("Token ensure during test connection failed: %s", exc)
        auth_applied = apply_security(headers, query, sn, schemes[sn], secrets)
    elif sn and sn in auth_secrets:
        # Manual scheme may exist only in auth table if project schemes stale
        secrets = auth_secrets[sn]
        inferred = {"type": "apiKey", "name": "api_key", "in": "header"}
        if secrets.get("bearer_token") or secrets.get("access_token"):
            inferred = {"type": "http", "scheme": "bearer"}
        elif secrets.get("username") or secrets.get("password"):
            inferred = {"type": "http", "scheme": "basic"}
        auth_applied = apply_security(headers, query, sn, inferred, secrets)

    endpoints = await db.list_api_endpoints(project_id)
    path, path_query = _pick_probe_path(endpoints)
    query = {**path_query, **query}
    probe_url = f"{base}{path}"
    if query:
        from urllib.parse import urlencode

        probe_url = f"{probe_url}?{urlencode(query)}"

    assert_safe_url(probe_url, allow_private=allow_private)

    started = time.perf_counter()
    status_code: int | None = None
    error: str | None = None
    body_preview = ""
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.request("GET", probe_url, headers=headers)
            status_code = resp.status_code
            body_preview = (resp.text or "")[:240]
    except Exception as exc:
        error = str(exc)[:400]

    latency_ms = int((time.perf_counter() - started) * 1000)
    reachable = status_code is not None
    auth_ok: bool | None = None
    if reachable and auth_applied:
        auth_ok = status_code not in (401, 403)
    elif reachable and not auth_applied and sn:
        auth_ok = False  # credentials expected but not applied
    elif reachable:
        auth_ok = None

    if not reachable:
        ok = False
        message = f"Unreachable: {error or 'no response'}"
    elif status_code is not None and status_code >= 500:
        ok = False
        message = f"Server error HTTP {status_code}"
    elif auth_applied and auth_ok is False:
        ok = False
        message = f"Reachable but auth rejected (HTTP {status_code})"
    elif sn and not auth_applied:
        ok = False
        message = "Reachable, but no credentials applied — Save credentials first"
    else:
        ok = True
        if auth_applied:
            message = f"Connected with {sn} (HTTP {status_code})"
        else:
            message = f"Connected (HTTP {status_code}, no auth applied)"

    return {
        "ok": ok,
        "reachable": reachable,
        "auth_applied": auth_applied,
        "auth_ok": auth_ok,
        "status_code": status_code,
        "latency_ms": latency_ms,
        "url": probe_url,
        "method": "GET",
        "scheme_name": sn or None,
        "message": message,
        "error": error,
        "body_preview": body_preview,
        "base_url": base,
    }


async def exchange_token(
    project_id: str,
    scheme_name: str,
    *,
    grant: str | None = None,
    code: str | None = None,
    redirect_uri: str | None = None,
) -> dict[str, Any]:
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    schemes = project.get("security_schemes") or {}
    if scheme_name not in schemes:
        raise ValueError(f"Unknown scheme: {scheme_name}")
    auth_rows = await db.list_api_auth(project_id)
    secrets = next((r["secrets"] for r in auth_rows if r["scheme_name"] == scheme_name), {})
    allow = bool(_cfg(project).get("allow_private_urls"))
    updated = await obtain_token(
        schemes[scheme_name],
        secrets,
        grant=grant,
        allow_private=allow,
        redirect_uri=redirect_uri,
        code=code,
    )
    await db.upsert_api_auth(
        project_id,
        scheme_name,
        (schemes[scheme_name].get("type") or "oauth2"),
        updated,
        merge=False,
    )
    return {"ok": True, "has_access_token": bool(updated.get("access_token")), "expires_at": updated.get("expires_at")}


async def authorize_url(project_id: str, scheme_name: str, redirect_uri: str, state: str) -> dict[str, Any]:
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    schemes = project.get("security_schemes") or {}
    if scheme_name not in schemes:
        raise ValueError(f"Unknown scheme: {scheme_name}")
    auth_rows = await db.list_api_auth(project_id)
    secrets = next((r["secrets"] for r in auth_rows if r["scheme_name"] == scheme_name), {})
    url = build_authorize_url(schemes[scheme_name], secrets, redirect_uri=redirect_uri, state=state)
    return {"authorize_url": url}


async def generate_project_flows(project_id: str) -> dict[str, Any]:
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    ops = await _load_all_ops(project_id)
    if not ops:
        raise ValueError("Ingest an OpenAPI document or Postman collection first")
    cfg = _cfg(project)
    budget = int(cfg.get("generation_budget") or 80)
    services = await db.list_api_services(project_id, include_raw=False, synthesize_legacy=True)
    default_key = str((services[0] if services else {}).get("key") or "default")
    collection_steps = cfg.get("collection_steps") if isinstance(cfg.get("collection_steps"), list) else None
    if collection_steps:
        collection_steps = tag_steps_with_services(
            collection_steps, services, default_key=default_key
        )
    flows, ai_meta = await ai_generate_flows(
        ops,
        budget=budget,
        include_negative=bool(cfg.get("include_negative", True)),
        include_edge=bool(cfg.get("include_edge", True)),
        include_security=bool(cfg.get("include_security", True)),
        include_load=bool(cfg.get("include_load", True)),
        load_vus=int(cfg.get("load_vus") or 10),
        mock_data=cfg.get("mock_data") if isinstance(cfg.get("mock_data"), dict) else None,
        collection_steps=collection_steps,
    )

    # Stamp service_key on every step from the op catalog (and Postman collection steps).
    ops_by_id = {o["operation_id"]: o for o in ops}
    for flow in flows:
        steps = flow.get("steps") or []
        tagged = []
        for step in steps:
            s = dict(step) if isinstance(step, dict) else step
            if not isinstance(s, dict):
                tagged.append(s)
                continue
            op = ops_by_id.get(str(s.get("operation_id") or ""))
            if op and op.get("service_key"):
                s["service_key"] = op["service_key"]
            elif not s.get("service_key"):
                s["service_key"] = default_key
            tagged.append(s)
        if flow.get("from_postman"):
            tagged = tag_steps_with_services(tagged, services, default_key=default_key)
        flow["steps"] = tagged

    saved = await db.replace_api_flows(project_id, flows)
    spectrum = {k: 0 for k in ("contract", "e2e", "edge", "negative", "security", "load")}
    for f in saved:
        k = f.get("kind") or "e2e"
        if k == "happy":
            k = "e2e"
        if k in spectrum:
            spectrum[k] += 1
    return {
        "count": len(saved),
        "flows": saved,
        "spectrum": spectrum,
        "mock_fixtures": len(cfg.get("mock_data") or {}),
        "source": cfg.get("source") or "openapi",
        **ai_meta,
    }


async def export_postman_collection(project_id: str) -> dict[str, Any]:
    """Build a Postman Collection v2.1 from the project's generated flows."""
    project = await db.get_api_project(project_id, include_raw=False)
    if not project:
        raise ValueError("Project not found")
    flows = await db.list_api_flows(project_id)
    if not flows:
        raise ValueError("No flows to export — generate flows first")
    name = str(project.get("name") or "API Assurance Suite")
    return flows_to_postman_collection(
        flows,
        name=f"{name} — API Assurance",
        base_url=str(project.get("base_url") or ""),
        description=(
            f"Exported from AI Assurance Platform project '{name}'. "
            "Spectrum folders contain generated flows with pre-request seeds, "
            "status assertions, and response captures."
        ),
    )


async def _emit_run(run_id: str, event_type: str, payload: dict[str, Any]) -> None:
    ev = await db.add_api_run_event(run_id, event_type, payload)
    await bus.publish(f"api_run:{run_id}", ev)


async def _run_job(
    project_id: str,
    run_id: str,
    project: dict[str, Any],
    flows: list[dict[str, Any]],
) -> dict[str, Any]:
    ops = await _load_all_ops(project_id)
    ops_by_id = {o["operation_id"]: o for o in ops}
    schemes = project.get("security_schemes") or {}
    auth_rows = await db.list_api_auth(project_id)
    auth_secrets = {r["scheme_name"]: r["secrets"] for r in auth_rows}
    cfg = _cfg(project)
    services = await db.list_api_services(project_id, include_raw=False, synthesize_legacy=True)
    services_by_key = {
        str(s.get("key") or ""): str(s.get("base_url") or "").rstrip("/")
        for s in services
        if s.get("key")
    }
    step_idx = 0

    async def emit(etype: str, payload: dict[str, Any]) -> None:
        nonlocal step_idx
        if etype == "step":
            await db.add_api_run_step(run_id, step_idx, payload)
            step_idx += 1
        await _emit_run(run_id, etype, payload)

    mock_mode = bool(cfg.get("mock_mode"))
    mock_data = cfg.get("mock_data") if isinstance(cfg.get("mock_data"), dict) else None
    try:
        result = await run_suite(
            base_url=project.get("base_url") or ("mock://local" if mock_mode else ""),
            flows=flows,
            ops_by_id=ops_by_id,
            security_schemes=schemes,
            auth_secrets=auth_secrets,
            allow_private=bool(cfg.get("allow_private_urls")),
            latency_budget_ms=int(cfg.get("latency_budget_ms") or 5000),
            emit=emit,
            mock_mode=mock_mode,
            mock_data=mock_data,
            initial_variables=(
                cfg.get("collection_variables")
                if isinstance(cfg.get("collection_variables"), dict)
                else None
            ),
            services=services_by_key,
        )
        summary = result["summary"]
        insights = build_run_insights(result["steps"], summary)
        summary["insights"] = {
            "verdict": insights.get("verdict"),
            "headline": insights.get("headline"),
            "summary": insights.get("summary"),
            "primary_root_cause": insights.get("primary_root_cause"),
            "primary_solution": insights.get("primary_solution"),
            "pass_rate": insights.get("pass_rate"),
            "themes": insights.get("themes") or [],
        }
        report_dir = _report_root(project_id, run_id)
        write_allure_results(
            out_dir=report_dir,
            run_id=run_id,
            project_name=project.get("name") or "API suite",
            base_url=project.get("base_url") or "",
            openapi_url=project.get("openapi_url") or "",
            steps=result["steps"],
            summary=summary,
            insights=insights,
        )
        html = write_html_report(
            report_dir=report_dir / "allure-report",
            project_name=project.get("name") or "API suite",
            base_url=project.get("base_url") or "",
            openapi_url=project.get("openapi_url") or "",
            run_id=run_id,
            steps=result["steps"],
            summary=summary,
            spectrum_counts=summary.get("spectrum") or {},
            insights=insights,
        )
        summary["report_dir"] = str(report_dir)
        summary["report_html"] = str(html)
        summary["allure_results"] = str(report_dir / "allure-results")
        summary["insights_json"] = str(report_dir / "allure-report" / "insights.json")

        await db.update_api_run(
            run_id,
            status="completed",
            summary=summary,
            finished_at=_now(),
        )
        drift = await get_drift(project_id)
        drift_ops = {
            c["op"]
            for c in drift.get("changes") or []
            if c.get("kind") in ("added", "modified")
        }
        status_map = endpoint_status_map(result["steps"], drift_ops)
        for step in result["steps"]:
            oid = step.get("operation_id")
            if oid:
                status_map[oid] = step.get("status") or "fail"
        await db.update_endpoint_statuses(project_id, status_map)

        anomalies = detect_anomalies(result["steps"], avg_latency_ms=summary.get("avg_latency_ms") or 0)
        await db.replace_api_anomalies(project_id, run_id, anomalies)
        await _emit_run(
            run_id,
            "analysis",
            {"anomalies": anomalies, "summary": summary, "report_html": summary["report_html"]},
        )
        return {"run_id": run_id, "summary": summary, "steps": result["steps"]}
    except Exception as exc:
        logger.exception("API run failed")
        await db.update_api_run(
            run_id,
            status="failed",
            error=str(exc)[:500],
            finished_at=_now(),
        )
        await _emit_run(run_id, "error", {"message": str(exc)})
        raise


async def execute_single_step(
    project_id: str,
    *,
    method: str,
    path: str,
    path_template: str | None = None,
    operation_id: str | None = None,
    flow_name: str | None = None,
    headers: dict[str, Any] | None = None,
    query: dict[str, Any] | None = None,
    body: Any = None,
    captures: list[dict[str, Any]] | None = None,
    seed_var: dict[str, Any] | None = None,
    expected_status: list[int] | None = None,
    kind: str | None = "e2e",
    use_auth: bool = True,
    skip_auth: bool = False,
) -> dict[str, Any]:
    """Run one HTTP step with project auth credentials applied (unless skip/use_auth says otherwise)."""
    import httpx

    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    cfg = _cfg(project)
    mock_mode = bool(cfg.get("mock_mode"))
    mock_data = cfg.get("mock_data") if isinstance(cfg.get("mock_data"), dict) else None
    services = await db.list_api_services(project_id, include_raw=False, synthesize_legacy=True)
    services_by_key = {
        str(s.get("key") or ""): str(s.get("base_url") or "").rstrip("/")
        for s in services
        if s.get("key")
    }
    base = (project.get("base_url") or "").strip().rstrip("/")
    if not base and not any(services_by_key.values()) and not mock_mode:
        raise ValueError("Set a Base URL on a service in Configuration before running a step")

    ops = await _load_all_ops(project_id)
    ops_by_id = {o["operation_id"]: o for o in ops if o.get("operation_id")}

    schemes = dict(project.get("security_schemes") or {})
    auth_rows = await db.list_api_auth(project_id)
    auth_secrets = {r["scheme_name"]: dict(r.get("secrets") or {}) for r in auth_rows}
    allow_private = bool(cfg.get("allow_private_urls"))

    # Refresh OAuth / bearer tokens before the call
    auth_ready: list[str] = []
    if use_auth and not mock_mode:
        for name, scheme in schemes.items():
            secrets = auth_secrets.get(name) or {}
            try:
                refreshed = await ensure_access_token(scheme, secrets, allow_private=allow_private)
                if refreshed != secrets:
                    await db.upsert_api_auth(
                        project_id,
                        name,
                        (scheme.get("type") or "oauth2"),
                        refreshed,
                        merge=True,
                    )
                auth_secrets[name] = refreshed
            except Exception as exc:
                logger.warning("auth ensure failed for %s: %s", name, exc)
            s = auth_secrets.get(name) or {}
            if (
                s.get("api_key")
                or s.get("access_token")
                or s.get("bearer_token")
                or (s.get("username") and s.get("password"))
            ):
                auth_ready.append(name)

    service_key = None
    if operation_id and operation_id in ops_by_id:
        service_key = ops_by_id[operation_id].get("service_key")
    elif operation_id and "__" in operation_id:
        service_key = operation_id.split("__", 1)[0]
    step_base = (services_by_key.get(str(service_key or "")) or base or "mock://local").rstrip("/")

    step: dict[str, Any] = {
        "operation_id": operation_id,
        "method": (method or "GET").upper(),
        "path": path or "/",
        "path_template": path_template or path or "/",
        "headers": dict(headers or {}),
        "query": dict(query or {}),
        "body": body,
        "captures": list(captures or []),
        "seed_var": dict(seed_var or {}),
        "expected_status": list(expected_status or [200, 201, 202, 204, 400, 401, 403, 404, 405, 422, 500]),
        "kind": kind or "e2e",
        # Authorized single-step runs ignore skip_auth unless use_auth is false
        "skip_auth": (not use_auth) or bool(skip_auth and not use_auth),
        "assert_schema": False,
        "service_key": service_key,
    }
    if use_auth:
        step["skip_auth"] = False

    variables: dict[str, Any] = {}
    if isinstance(cfg.get("collection_variables"), dict):
        variables.update(cfg["collection_variables"])
    for key, svc_base in services_by_key.items():
        if not svc_base:
            continue
        variables.setdefault(f"{key}Url", svc_base)
        variables.setdefault(f"{key.upper()}_BASE_URL", svc_base)
    if isinstance(step.get("seed_var"), dict):
        variables.update(step["seed_var"])

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        result = await _execute_one(
            client,
            base=step_base,
            step=step,
            flow_name=flow_name or "single-step",
            idx=0,
            variables=variables,
            ops_by_id=ops_by_id,
            security_schemes=schemes,
            auth_secrets=auth_secrets,
            allow_private=allow_private,
            latency_budget_ms=int(cfg.get("latency_budget_ms") or 5000),
            mutate_vars=True,
            enable_heal=True,
            mock_mode=mock_mode,
            mock_data=mock_data,
        )

    req = result.get("request") if isinstance(result.get("request"), dict) else {}
    req_headers = req.get("headers") if isinstance(req.get("headers"), dict) else {}
    auth_applied = any(
        str(k).lower() in ("authorization", "api_key", "api-key", "x-api-key")
        or "api" in str(k).lower() and "key" in str(k).lower()
        for k in req_headers
    )
    # Also treat applied when secrets existed and skip_auth was false
    if use_auth and auth_ready and not step.get("skip_auth"):
        # apply_security may put api key in query
        q = req.get("query") if isinstance(req.get("query"), dict) else {}
        if any("key" in str(k).lower() or "token" in str(k).lower() for k in q):
            auth_applied = True
        if auth_ready and not auth_applied:
            # Credentials configured; runner should have applied — mark intended
            auth_applied = True

    warning = None
    if use_auth and schemes and not auth_ready and not mock_mode:
        warning = (
            "No auth credentials configured. Save API key / bearer / OAuth in Configuration, "
            "then run again."
        )
    elif use_auth and not schemes and not mock_mode:
        warning = "No security schemes on this project. Ingest OpenAPI or configure auth manually."

    return {
        "ok": result.get("status") == "pass",
        "status": result.get("status"),
        "auth_applied": bool(auth_applied and use_auth),
        "auth_schemes_ready": auth_ready,
        "use_auth": use_auth,
        "mock_mode": mock_mode,
        "warning": warning,
        "result": result,
    }


async def execute_run(
    project_id: str,
    *,
    flow_ids: list[str] | None = None,
    wait: bool = False,
) -> dict[str, Any]:
    project = await db.get_api_project(project_id)
    if not project:
        raise ValueError("Project not found")
    cfg = _cfg(project)
    mock_mode = bool(cfg.get("mock_mode"))
    services = await db.list_api_services(project_id, include_raw=True, synthesize_legacy=True)
    has_base = bool((project.get("base_url") or "").strip()) or any(
        (s.get("base_url") or "").strip() for s in services
    )
    if not has_base and not mock_mode:
        raise ValueError("Base URL is required on at least one service (or enable Mock mode)")
    has_spec = bool((project.get("openapi_raw") or "").strip()) or any(
        (s.get("openapi_raw") or "").strip() for s in services
    )
    if not has_spec:
        raise ValueError("Ingest an OpenAPI document or Postman collection first")

    flows = await db.list_api_flows(project_id)
    if not flows:
        await generate_project_flows(project_id)
        flows = await db.list_api_flows(project_id)
    if flow_ids:
        idset = set(flow_ids)
        flows = [f for f in flows if f["id"] in idset]
    if not flows:
        raise ValueError("No flows to run")

    run = await db.create_api_run(project_id)
    run_id = run["id"]
    await db.update_api_run(run_id, status="running")

    if wait:
        await _run_job(project_id, run_id, project, flows)
        return await db.get_api_run(run_id)  # type: ignore[return-value]

    asyncio.create_task(_run_job(project_id, run_id, project, flows))
    return run


async def get_project_schedule(project_id: str) -> dict[str, Any]:
    project = await db.get_api_project(project_id, include_raw=False)
    if not project:
        raise ValueError("Project not found")
    cfg = _cfg(project)
    schedule_cfg = dict(cfg.get("schedule") or {})
    job = await db.find_api_test_scheduled_job(project_id)
    if not job and cfg.get("schedule_job_id"):
        job = await db.get_scheduled_job(str(cfg["schedule_job_id"]))
    if job:
        payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
        return {
            "enabled": bool(job.get("enabled")),
            "schedule": job.get("schedule") or "every_day",
            "flow_ids": payload.get("flow_ids"),
            "job_id": job.get("id"),
            "job_type": "api_test",
            "next_run_at": job.get("next_run_at"),
            "last_run_at": job.get("last_run_at"),
            "last_run_id": job.get("last_run_id"),
            "last_error": job.get("last_error"),
            "status": job.get("status"),
            "reuses_scheduled_jobs": True,
        }
    return {
        "enabled": bool(schedule_cfg.get("enabled")),
        "schedule": schedule_cfg.get("schedule") or "every_day",
        "flow_ids": schedule_cfg.get("flow_ids"),
        "job_id": schedule_cfg.get("job_id") or cfg.get("schedule_job_id"),
        "job_type": "api_test",
        "next_run_at": schedule_cfg.get("next_run_at"),
        "last_run_at": schedule_cfg.get("last_run_at"),
        "last_run_id": schedule_cfg.get("last_run_id"),
        "last_error": None,
        "status": "inactive",
        "reuses_scheduled_jobs": True,
    }


async def upsert_project_schedule(
    project_id: str,
    *,
    enabled: bool = True,
    schedule: str = "every_day",
    flow_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Create/update a scheduled_jobs row for nightly (or other) API suite runs."""
    from ..scheduler import next_run_after, to_iso

    project = await db.get_api_project(project_id, include_raw=False)
    if not project:
        raise ValueError("Project not found")
    if schedule not in ("every_hour", "every_day", "every_week"):
        schedule = "every_day"

    cfg = _cfg(project)
    job = await db.find_api_test_scheduled_job(project_id)
    if not job and cfg.get("schedule_job_id"):
        job = await db.get_scheduled_job(str(cfg["schedule_job_id"]))

    name = f"API suite: {project.get('name') or project_id} ({schedule})"
    task = f"[api_test] Run assurance suite for project {project_id}"
    payload = {"project_id": project_id, "flow_ids": flow_ids}
    next_at = to_iso(next_run_after(schedule))

    if job:
        job = await db.update_scheduled_job(
            job["id"],
            name=name,
            task=task,
            schedule=schedule,
            enabled=enabled,
            job_type="api_test",
            payload=payload,
            next_run_at=next_at if enabled else job.get("next_run_at"),
            # Keep status active; enable/disable is controlled by `enabled`
            # (Scheduled Jobs page toggles enabled only).
            status="active",
        )
    else:
        job = await db.create_scheduled_job(
            task=task,
            name=name,
            schedule=schedule,
            enabled=enabled,
            job_type="api_test",
            payload=payload,
            # Use next cadence slot (nightly ≠ fire on save); Run now is explicit.
            next_run_at=next_at,
        )

    assert job is not None
    schedule_cfg = {
        "enabled": enabled,
        "schedule": schedule,
        "flow_ids": flow_ids,
        "job_id": job["id"],
        "next_run_at": job.get("next_run_at"),
        "last_run_at": job.get("last_run_at"),
        "last_run_id": job.get("last_run_id"),
    }
    cfg["schedule"] = schedule_cfg
    cfg["schedule_job_id"] = job["id"]
    await db.update_api_project(project_id, config=cfg)
    return await get_project_schedule(project_id)


async def run_project_schedule_now(project_id: str) -> dict[str, Any]:
    """Manually fire the project's API suite schedule (uses scheduled_jobs fire path)."""
    from ..scheduler import fire_job

    schedule = await get_project_schedule(project_id)
    job_id = schedule.get("job_id")
    if not job_id:
        # Ensure a job exists (disabled nightly is fine; run-now still works)
        schedule = await upsert_project_schedule(project_id, enabled=True, schedule="every_day")
        job_id = schedule.get("job_id")
    job = await db.get_scheduled_job(str(job_id))
    if not job:
        raise ValueError("Scheduled job not found")
    run_id = await fire_job(job)
    return {
        "ok": True,
        "run_id": run_id,
        "schedule": await get_project_schedule(project_id),
    }


def _steps_for_insights(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize DB run steps into the shape build_run_insights expects."""
    out: list[dict[str, Any]] = []
    for s in rows:
        detail = s.get("detail") if isinstance(s.get("detail"), dict) else {}
        merged = {
            **detail,
            "flow": s.get("flow_name") or detail.get("flow") or "",
            "flow_name": s.get("flow_name") or "",
            "method": s.get("method") or detail.get("method") or "",
            "path": s.get("path") or detail.get("path") or "",
            "operation_id": s.get("operation_id") or detail.get("operation_id"),
            "status": s.get("status") or detail.get("status") or "fail",
            "latency_ms": s.get("latency_ms") if s.get("latency_ms") is not None else detail.get("latency_ms"),
            "detail": detail,
        }
        out.append(merged)
    return out


async def get_run_insights(run_id: str, *, persist: bool = True) -> dict[str, Any]:
    """Return (and optionally backfill) RCA summary for a completed run."""
    run = await db.get_api_run(run_id)
    if not run:
        raise ValueError("Run not found")
    summary = dict(run.get("summary") or {})
    existing = summary.get("insights") if isinstance(summary.get("insights"), dict) else {}
    if (
        existing.get("primary_root_cause")
        and existing.get("primary_solution")
        and existing.get("headline")
    ):
        return {"run_id": run_id, "insights": existing, "cached": True}

    rows = await db.list_api_run_steps(run_id)
    step_rows = _steps_for_insights(rows)
    insights = build_run_insights(step_rows, summary)
    compact = {
        "verdict": insights.get("verdict"),
        "headline": insights.get("headline"),
        "summary": insights.get("summary"),
        "primary_root_cause": insights.get("primary_root_cause"),
        "primary_solution": insights.get("primary_solution"),
        "pass_rate": insights.get("pass_rate"),
        "themes": insights.get("themes") or [],
        "recommendations": insights.get("recommendations") or [],
    }
    # Polish RCA with the configured LLM when there are failures
    failed = [s for s in step_rows if str(s.get("status") or "") != "pass"]
    if failed:
        try:
            project = await db.get_api_project(str(run.get("project_id") or ""))
            cfg = _cfg(project) if project else {}
            if bool(cfg.get("use_llm", True)):
                compact = await ai_polish_insights(compact, failed_steps=failed)
        except Exception as exc:
            logger.debug("AI insights polish skipped: %s", exc)
    if persist and run.get("status") in ("completed", "failed"):
        summary["insights"] = compact
        await db.update_api_run(run_id, summary=summary)
    return {"run_id": run_id, "insights": compact, "cached": False}


async def get_run_report(run_id: str) -> dict[str, Any]:
    run = await db.get_api_run(run_id)
    if not run:
        raise ValueError("Run not found")
    summary = run.get("summary") or {}
    try:
        insights_payload = await get_run_insights(run_id, persist=True)
        insights = insights_payload.get("insights") or {}
        if insights and not (summary.get("insights") or {}).get("headline"):
            summary = {**summary, "insights": insights}
    except Exception:
        insights = summary.get("insights") or {}
    return {
        "run_id": run_id,
        "status": run.get("status"),
        "summary": summary,
        "insights": insights if isinstance(insights, dict) else {},
        "report_html": summary.get("report_html"),
        "allure_results": summary.get("allure_results"),
        "report_dir": summary.get("report_dir"),
    }


async def overview(project_id: str) -> dict[str, Any]:
    project = await db.get_api_project(project_id, include_raw=False)
    if not project:
        raise ValueError("Project not found")
    endpoints = await db.list_api_endpoints(project_id)
    flows = await db.list_api_flows(project_id)
    runs = await list_api_runs_safe(project_id)
    anomalies = await db.list_api_anomalies(project_id)
    drift = await get_drift(project_id)
    history = await db.collect_endpoint_pass_history(project_id)
    cfg = _cfg(project)
    flaky = flaky_endpoints(history, threshold=float(cfg.get("flaky_threshold") or 0.3))

    passing = sum(1 for e in endpoints if e.get("last_status") == "pass")
    failing = sum(1 for e in endpoints if e.get("last_status") == "fail")
    drifting = sum(1 for e in endpoints if e.get("last_status") == "drift")
    total = len(endpoints) or 1
    coverage = round(100 * passing / total) if endpoints else 0

    latest = next((r for r in runs if r.get("status") == "completed"), None)
    avg_ms = int((latest or {}).get("summary", {}).get("avg_latency_ms") or 0)

    if failing >= max(3, len(endpoints) // 5):
        health = "critical"
    elif failing > 0 or drifting > 0 or flaky:
        health = "degraded"
    elif endpoints:
        health = "healthy"
    else:
        health = "healthy"

    return {
        "project": project,
        "health": health,
        "total_endpoints": len(endpoints),
        "passing": passing,
        "failing": failing,
        "drifting": drifting,
        "coverage": coverage,
        "ai_generated_tests": sum(len(f.get("steps") or []) for f in flows),
        "flow_count": len(flows),
        "schema_drift": (drift.get("added") or 0) + (drift.get("modified") or 0) + (drift.get("removed") or 0),
        "avg_response_ms": avg_ms,
        "flaky_tests": len(flaky),
        "flaky": flaky[:20],
        "anomalies": anomalies,
        "endpoints": endpoints[:20],
        "recent_runs": runs[:5],
    }


async def list_api_runs_safe(project_id: str) -> list[dict[str, Any]]:
    return await db.list_api_runs(project_id)


async def delete_project(project_id: str) -> dict[str, Any]:
    """Delete an API project and clean related schedule jobs / report files."""
    import shutil

    project = await db.get_api_project(project_id, include_raw=False)
    if not project:
        raise ValueError("Project not found")

    # Remove linked scheduled nightly job if present
    try:
        job = await db.find_api_test_scheduled_job(project_id)
        if job:
            await db.delete_scheduled_job(str(job["id"]))
    except Exception as exc:
        logger.debug("schedule cleanup on project delete skipped: %s", exc)

    ok = await db.delete_api_project(project_id)
    if not ok:
        raise ValueError("Project not found")

    root = Path(settings.data_dir) / "api_test_reports" / project_id
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)
    return {"ok": True, "id": project_id}


def _cleanup_run_report_dir(project_id: str, run_id: str) -> None:
    import shutil

    report_dir = _report_root(project_id, run_id)
    if report_dir.exists():
        shutil.rmtree(report_dir, ignore_errors=True)


async def delete_project_run(project_id: str, run_id: str) -> dict[str, Any]:
    run = await db.get_api_run(run_id)
    if not run:
        raise ValueError("Run not found")
    if str(run.get("project_id") or "") != project_id:
        raise ValueError("Run does not belong to this project")
    ok = await db.delete_api_run(run_id)
    if not ok:
        raise ValueError("Run not found")
    _cleanup_run_report_dir(project_id, run_id)
    return {"ok": True, "id": run_id}


async def clear_project_runs(project_id: str) -> dict[str, Any]:
    project = await db.get_api_project(project_id, include_raw=False)
    if not project:
        raise ValueError("Project not found")
    runs = await db.list_api_runs(project_id, limit=10_000)
    deleted = await db.clear_api_runs(project_id)
    for run in runs:
        _cleanup_run_report_dir(project_id, str(run["id"]))
    # Drop leftover report tree for the project if empty
    import shutil

    root = Path(settings.data_dir) / "api_test_reports" / project_id
    if root.exists() and not any(root.iterdir()):
        shutil.rmtree(root, ignore_errors=True)
    return {"ok": True, "deleted": deleted}
