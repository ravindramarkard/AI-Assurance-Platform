"""Execute flows with variable binding, self-healing, and multi-layer assertions."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any, Awaitable, Callable

import httpx
from jsonpath_ng import parse as jsonpath_parse

from .auth import apply_security, ensure_access_token
from .heal import enrich_captures_from_body, error_text_from_response, heal_payload
from .ssrf import assert_safe_url

logger = logging.getLogger(__name__)

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]

_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")


def _interpolate(value: Any, variables: dict[str, Any]) -> Any:
    """Injection: replace {{var}} placeholders with captured/synthesized values."""
    if isinstance(value, str):

        def repl(m: re.Match[str]) -> str:
            key = m.group(1)
            if key in variables:
                return str(variables[key])
            return m.group(0)

        full = _VAR_RE.fullmatch(value.strip())
        if full:
            return variables.get(full.group(1), value)
        return _VAR_RE.sub(repl, value)
    if isinstance(value, dict):
        return {k: _interpolate(v, variables) for k, v in value.items()}
    if isinstance(value, list):
        return [_interpolate(v, variables) for v in value]
    return value


def _capture(body: Any, captures: list[dict[str, str]], variables: dict[str, Any]) -> dict[str, Any]:
    """Extraction: apply JSONPath rules into the shared variable store."""
    got: dict[str, Any] = {}
    if body is None:
        return got
    rules = list(captures or [])
    # Always enrich with common id extractors (extracted_post_id = response.body.id)
    for extra in enrich_captures_from_body(body):
        if not any(r.get("var") == extra.get("var") and r.get("jsonpath") == extra.get("jsonpath") for r in rules):
            rules.append(extra)
    for cap in rules:
        var = cap.get("var")
        path = cap.get("jsonpath") or "$"
        if not var:
            continue
        try:
            expr = jsonpath_parse(path)
            matches = [m.value for m in expr.find(body)]
            if matches:
                variables[var] = matches[0]
                got[var] = matches[0]
        except Exception as exc:
            logger.debug("capture failed %s: %s", path, exc)
    if isinstance(body, dict):
        for k, v in body.items():
            kl = k.lower()
            if kl == "id" or kl.endswith("_id"):
                variables.setdefault(k, v)
                variables.setdefault("id", v)
                variables.setdefault("extracted_post_id", v)
                got.setdefault(k, v)
                got.setdefault("extracted_post_id", v)
    return got


def _validate_schema(instance: Any, schema: dict[str, Any] | None) -> tuple[bool, str | None]:
    if not schema:
        return True, None
    try:
        import jsonschema

        jsonschema.validate(instance=instance, schema=schema)
        return True, None
    except Exception as exc:
        return False, str(exc)[:300]


def _apply_auth(
    headers: dict[str, str],
    query: dict[str, str],
    *,
    step: dict[str, Any],
    op: dict[str, Any] | None,
    security_schemes: dict[str, Any],
    auth_secrets: dict[str, dict[str, Any]],
) -> None:
    if step.get("skip_auth"):
        return
    sec_req = (op or {}).get("security") if op else None
    scheme_names: list[str] = []
    if isinstance(sec_req, list) and sec_req:
        for req in sec_req:
            if isinstance(req, dict):
                scheme_names.extend(req.keys())
    elif security_schemes:
        scheme_names = sorted(
            security_schemes.keys(),
            key=lambda n: 0
            if (auth_secrets.get(n) or {}).get("api_key")
            or (auth_secrets.get(n) or {}).get("access_token")
            or (auth_secrets.get(n) or {}).get("bearer_token")
            else 1,
        )
    applied = False
    for sn in scheme_names:
        if sn in security_schemes:
            ok = apply_security(
                headers,
                query,
                sn,
                security_schemes[sn],
                auth_secrets.get(sn) or {},
            )
            applied = applied or ok
    if not applied:
        for sn, scheme in security_schemes.items():
            if (scheme.get("type") or "").lower() == "apikey":
                if apply_security(headers, query, sn, scheme, auth_secrets.get(sn) or {}):
                    break


def _integrity_checks(
    *,
    kind: str,
    method: str,
    status_code: int,
    resp_body: Any,
    variables: dict[str, Any],
    step: dict[str, Any],
) -> list[dict[str, Any]]:
    """Cross-step data integrity: captured/seeded IDs must appear on successful reads."""
    out: list[dict[str, Any]] = []
    if kind not in ("e2e", "happy", "contract"):
        return out
    # Only enforce when the read succeeded — 404 means resource missing, already covered by status
    if not (200 <= int(status_code) < 300):
        return out
    expect = step.get("expect_vars") or []
    if method == "GET" and isinstance(resp_body, (dict, list)):
        blob = resp_body if isinstance(resp_body, dict) else {"items": resp_body}
        flat_vals: set[Any] = set()

        def walk(x: Any) -> None:
            if isinstance(x, dict):
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
            else:
                flat_vals.add(x)
                flat_vals.add(str(x))

        walk(blob)
        keys = list(expect) if expect else [
            k for k in variables if k == "id" or k.endswith("_id") or k.startswith("extracted_")
        ]
        checked = False
        for vk in keys[:8]:
            vv = variables.get(vk)
            if vv is None:
                continue
            checked = True
            found = vv in flat_vals or str(vv) in flat_vals
            if isinstance(blob, dict) and any(blob.get(k) == vv for k in blob):
                found = True
            out.append(
                {
                    "name": "data_integrity",
                    "pass": found,
                    "detail": f"{vk}={vv} {'present' if found else 'MISSING'} in response",
                }
            )
            if found:
                break
        if not checked and expect:
            out.append(
                {
                    "name": "data_integrity",
                    "pass": True,
                    "detail": "no bound variables to verify yet",
                }
            )
    return out


class _MockResponse:
    """Minimal response stand-in for mock-mode API tests."""

    def __init__(self, status_code: int, body: Any):
        self.status_code = int(status_code)
        self._body = body
        if isinstance(body, (dict, list)):
            self.text = json.dumps(body)
        else:
            self.text = "" if body is None else str(body)

    def json(self) -> Any:
        if isinstance(self._body, (dict, list)):
            return self._body
        if isinstance(self._body, str) and self._body.strip():
            return json.loads(self._body)
        raise ValueError("mock body is not JSON")


def seed_service_env_vars(
    variables: dict[str, Any], services: dict[str, str] | None
) -> dict[str, Any]:
    """Seed {{backendUrl}} / {{BACKEND_BASE_URL}} style vars from named service bases."""
    out = dict(variables or {})
    for key, svc_base in (services or {}).items():
        if not key or not svc_base:
            continue
        base = str(svc_base).rstrip("/")
        out.setdefault(f"{key}Url", base)
        out.setdefault(f"{key.upper()}_BASE_URL", base)
    return out


def resolve_step_base(
    *,
    default_base: str,
    step: dict[str, Any],
    services: dict[str, str] | None,
) -> str:
    sk = str(step.get("service_key") or "").strip()
    if sk and services and services.get(sk):
        return str(services[sk]).rstrip("/")
    return (default_base or "").rstrip("/")


async def _execute_one(
    client: httpx.AsyncClient,
    *,
    base: str,
    step: dict[str, Any],
    flow_name: str,
    idx: int,
    variables: dict[str, Any],
    ops_by_id: dict[str, dict[str, Any]],
    security_schemes: dict[str, Any],
    auth_secrets: dict[str, dict[str, Any]],
    allow_private: bool,
    latency_budget_ms: int,
    mutate_vars: bool = True,
    enable_heal: bool = True,
    mock_mode: bool = False,
    mock_data: dict[str, Any] | None = None,
    services: dict[str, str] | None = None,
) -> dict[str, Any]:
    kind = step.get("kind") or "e2e"
    method = step["method"]
    step_base = resolve_step_base(default_base=base, step=step, services=services)
    path = _interpolate(step.get("path") or "/", variables)
    if isinstance(path, str) and "{{" in path and step.get("path_fallback"):
        path = _interpolate(step.get("path_fallback") or path, variables)
    if isinstance(path, str) and "{{" in path:
        return {
            "flow": flow_name,
            "index": idx,
            "method": method,
            "path": path,
            "status": "fail",
            "error": "Unresolved path variables",
            "latency_ms": 0,
            "assertions": [{"name": "variables", "pass": False, "detail": path}],
            "captures": {},
            "request": {"method": method, "path": path},
            "response": None,
            "operation_id": step.get("operation_id"),
            "kind": kind,
            "healed": False,
            "service_key": step.get("service_key"),
        }

    if isinstance(path, str) and path.startswith(("http://", "https://")):
        url = path
    else:
        url = step_base + (path if str(path).startswith("/") else "/" + str(path))
    if not mock_mode:
        try:
            assert_safe_url(url, allow_private=allow_private)
        except Exception as exc:
            return {
                "flow": flow_name,
                "index": idx,
                "method": method,
                "path": path,
                "status": "fail",
                "error": str(exc),
                "latency_ms": 0,
                "assertions": [],
                "captures": {},
                "request": {"method": method, "url": url},
                "response": None,
                "operation_id": step.get("operation_id"),
                "kind": kind,
                "healed": False,
            }

    headers = {str(k): str(v) for k, v in (_interpolate(step.get("headers") or {}, variables) or {}).items()}
    query = {str(k): str(v) for k, v in (_interpolate(step.get("query") or {}, variables) or {}).items()}
    body = _interpolate(step.get("body"), variables)
    op = ops_by_id.get(step.get("operation_id") or "")
    if not mock_mode:
        _apply_auth(
            headers,
            query,
            step=step,
            op=op,
            security_schemes=security_schemes,
            auth_secrets=auth_secrets,
        )

    heal_actions: list[str] = []
    healed = False
    total_latency = 0.0
    resp = None
    resp_body: Any = None
    attempts = 0
    max_attempts = 2 if enable_heal and kind not in ("negative", "security", "edge") else 1
    mocked = False

    while attempts < max_attempts:
        attempts += 1
        t0 = time.perf_counter()
        try:
            if mock_mode:
                from .postman import lookup_mock_response

                mock_resp = lookup_mock_response(
                    mock_data,
                    operation_id=step.get("operation_id"),
                    method=method,
                    path_template=str(step.get("path_template") or step.get("path") or path),
                )
                if not mock_resp:
                    total_latency += (time.perf_counter() - t0) * 1000
                    return {
                        "flow": flow_name,
                        "index": idx,
                        "method": method,
                        "path": path,
                        "status": "fail",
                        "error": "No mock response for this operation — import Postman examples or mock data",
                        "latency_ms": round(total_latency, 2),
                        "assertions": [
                            {
                                "name": "mock",
                                "pass": False,
                                "detail": "missing fixture",
                            }
                        ],
                        "captures": {},
                        "request": {
                            "method": method,
                            "url": url,
                            "headers": headers,
                            "query": query,
                            "body": body,
                        },
                        "response": None,
                        "operation_id": step.get("operation_id"),
                        "kind": kind,
                        "healed": False,
                        "mock": True,
                    }
                resp = _MockResponse(
                    int(mock_resp.get("status") or 200),
                    mock_resp.get("body"),
                )
                mocked = True
                total_latency += max((time.perf_counter() - t0) * 1000, 1.0)
                try:
                    resp_body = resp.json()
                except Exception:
                    resp_body = resp.text[:2000]
            else:
                resp = await client.request(
                    method,
                    url,
                    headers=headers,
                    params=query or None,
                    json=body if body is not None and method in ("POST", "PUT", "PATCH") else None,
                )
                total_latency += (time.perf_counter() - t0) * 1000
                try:
                    resp_body = resp.json()
                except Exception:
                    resp_body = resp.text[:2000]
        except Exception as exc:
            total_latency += (time.perf_counter() - t0) * 1000
            return {
                "flow": flow_name,
                "index": idx,
                "method": method,
                "path": path,
                "status": "fail",
                "error": str(exc)[:400],
                "latency_ms": round(total_latency, 2),
                "assertions": [{"name": "transport", "pass": False, "detail": str(exc)[:200]}],
                "captures": {},
                "request": {"method": method, "url": url, "body": body},
                "response": None,
                "operation_id": step.get("operation_id"),
                "kind": kind,
                "healed": healed,
                "heal_actions": heal_actions,
            }

        # Self-heal on schema/type client errors, then retry once (skip in mock mode)
        if (
            not mocked
            and attempts < max_attempts
            and resp is not None
            and resp.status_code in (400, 422, 415)
            and method in ("POST", "PUT", "PATCH")
            and isinstance(body, dict)
        ):
            new_body, actions = heal_payload(
                body,
                status_code=resp.status_code,
                resp_body=resp_body,
                request_schema=(op or {}).get("request_schema"),
            )
            if actions and new_body != body:
                body = new_body
                heal_actions.extend(actions)
                healed = True
                logger.info("self-heal %s: %s", step.get("operation_id"), actions)
                continue
            # LLM fallback when heuristic coercion finds nothing
            try:
                from .ai import llm_heal_payload

                ai_body = await llm_heal_payload(
                    body,
                    status_code=resp.status_code,
                    error_text=error_text_from_response(resp_body),
                    request_schema=(op or {}).get("request_schema"),
                )
                if isinstance(ai_body, dict) and ai_body != body:
                    body = ai_body
                    heal_actions.append("llm_heal_payload")
                    healed = True
                    logger.info("AI self-heal %s", step.get("operation_id"))
                    continue
            except Exception as heal_exc:
                logger.debug("AI self-heal skipped: %s", heal_exc)
        break

    assert resp is not None
    expected = step.get("expected_status") or [200, 201, 202, 204]
    assertions: list[dict[str, Any]] = []
    status_ok = resp.status_code in expected
    assertions.append(
        {
            "name": "status_code",
            "pass": status_ok,
            "detail": f"got {resp.status_code}, expected {expected}",
        }
    )

    budget = latency_budget_ms * 3 if kind == "load" else latency_budget_ms
    latency_ok = total_latency <= budget
    assertions.append(
        {
            "name": "latency",
            "pass": latency_ok,
            "detail": f"{round(total_latency, 1)}ms (budget {budget}ms)",
        }
    )

    if step.get("assert_schema") and op and isinstance(resp_body, (dict, list)):
        schema_ok, schema_detail = _validate_schema(resp_body, op.get("response_schema"))
        hard = kind == "contract"
        assertions.append(
            {
                "name": "json_schema",
                "pass": schema_ok if hard else True,
                "detail": (schema_detail or "ok")
                if schema_ok
                else f"{'FAIL' if hard else 'soft'}: {schema_detail}",
            }
        )

    if heal_actions:
        assertions.append(
            {
                "name": "self_heal",
                "pass": True,
                "detail": "; ".join(heal_actions),
            }
        )

    if step.get("security_probe") == "missing_auth":
        rejected = resp.status_code in (401, 403)
        assertions.append(
            {
                "name": "auth_enforcement",
                "pass": True,
                "detail": (
                    f"rejected unauthenticated ({resp.status_code})"
                    if rejected
                    else f"accepted unauthenticated ({resp.status_code}) — soft probe"
                ),
            }
        )
    if step.get("security_probe") == "injection":
        handled = resp.status_code < 500
        assertions.append(
            {
                "name": "injection_resilience",
                "pass": handled,
                "detail": f"status {resp.status_code} after injection payload",
            }
        )

    captures = _capture(resp_body, step.get("captures") or [], variables) if mutate_vars else {}
    if mutate_vars and isinstance(step.get("seed_var"), dict):
        for sk, sv in step["seed_var"].items():
            if sk not in captures:
                variables.setdefault(sk, sv)
                captures.setdefault(sk, sv)
            # aliases for injection templates
            variables.setdefault("extracted_post_id", sv)
            if str(sk).endswith("_id") or sk == "id":
                variables.setdefault("extracted_post_id", sv)

    assertions.extend(
        _integrity_checks(
            kind=kind,
            method=method,
            status_code=resp.status_code,
            resp_body=resp_body,
            variables=variables,
            step=step,
        )
    )

    ok = all(a["pass"] for a in assertions)
    return {
        "flow": flow_name,
        "index": idx,
        "method": method,
        "path": path,
        "status": "pass" if ok else "fail",
        "error": None if ok else next((a["detail"] for a in assertions if not a["pass"]), None),
        "latency_ms": round(total_latency, 2),
        "assertions": assertions,
        "captures": captures,
        "request": {
            "method": method,
            "url": url,
            "query": query,
            "body": body,
            "headers": {
                k: ("***" if k.lower() in ("authorization", "api_key") else v)
                for k, v in headers.items()
            },
        },
        "response": {
            "status_code": resp.status_code,
            "body": resp_body if not isinstance(resp_body, str) else resp_body[:2000],
        },
        "operation_id": step.get("operation_id"),
        "kind": kind,
        "healed": healed,
        "heal_actions": heal_actions,
        "mock": mocked,
        "service_key": step.get("service_key"),
    }


async def run_suite(
    *,
    base_url: str,
    flows: list[dict[str, Any]],
    ops_by_id: dict[str, dict[str, Any]],
    security_schemes: dict[str, Any],
    auth_secrets: dict[str, dict[str, Any]],
    allow_private: bool = False,
    latency_budget_ms: int = 5000,
    emit: EmitFn | None = None,
    mock_mode: bool = False,
    mock_data: dict[str, Any] | None = None,
    initial_variables: dict[str, Any] | None = None,
    services: dict[str, str] | None = None,
) -> dict[str, Any]:
    base = (base_url or "mock://local").rstrip("/")
    services_by_key = {k: str(v).rstrip("/") for k, v in (services or {}).items() if k and v}
    if not mock_mode:
        bases_to_check = [base] if base and base != "mock://local" else []
        bases_to_check.extend(services_by_key.values())
        seen: set[str] = set()
        for b in bases_to_check:
            if not b or b in seen:
                continue
            seen.add(b)
            assert_safe_url(b if "://" in b else f"https://{b}", allow_private=allow_private)

    if not mock_mode:
        for name, scheme in security_schemes.items():
            secrets = auth_secrets.get(name) or {}
            try:
                auth_secrets[name] = await ensure_access_token(
                    scheme, secrets, allow_private=allow_private
                )
            except Exception as exc:
                logger.warning("auth ensure failed for %s: %s", name, exc)

    variables: dict[str, Any] = seed_service_env_vars(dict(initial_variables or {}), services_by_key)
    step_results: list[dict[str, Any]] = []
    passed = failed = healed_count = 0
    latencies: list[float] = []
    spectrum_counts = {"contract": 0, "e2e": 0, "edge": 0, "negative": 0, "security": 0, "load": 0}
    load_metrics: dict[str, Any] = {}

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        for flow in flows:
            flow_name = flow.get("name") or "flow"
            kind = flow.get("kind") or "e2e"
            if kind in spectrum_counts:
                spectrum_counts[kind] += 1
            elif kind == "happy":
                spectrum_counts["e2e"] += 1
            if emit:
                await emit("flow_start", {"flow": flow_name, "kind": kind})

            if kind == "load" and flow.get("steps"):
                vus = int(flow.get("load_vus") or 10)
                step = flow["steps"][0]

                async def one_vu(i: int) -> dict[str, Any]:
                    return await _execute_one(
                        client,
                        base=base,
                        step=step,
                        flow_name=flow_name,
                        idx=i,
                        variables=dict(variables),
                        ops_by_id=ops_by_id,
                        security_schemes=security_schemes,
                        auth_secrets=auth_secrets,
                        allow_private=allow_private,
                        latency_budget_ms=latency_budget_ms,
                        mutate_vars=False,
                        enable_heal=False,
                        mock_mode=mock_mode,
                        mock_data=mock_data,
                        services=services_by_key,
                    )

                t0 = time.perf_counter()
                results = await asyncio.gather(*[one_vu(i) for i in range(vus)])
                wall = (time.perf_counter() - t0) * 1000
                vu_lats = [float(r.get("latency_ms") or 0) for r in results]
                vu_lats_sorted = sorted(vu_lats)
                p95 = vu_lats_sorted[int(0.95 * (len(vu_lats_sorted) - 1))] if vu_lats_sorted else 0
                load_metrics = {
                    "vus": vus,
                    "wall_ms": round(wall, 2),
                    "p50_ms": vu_lats_sorted[len(vu_lats_sorted) // 2] if vu_lats_sorted else 0,
                    "p95_ms": p95,
                    "rps": round(vus / (wall / 1000), 2) if wall else 0,
                }
                for r in results:
                    r["kind"] = "load"
                    r["assertions"] = list(r.get("assertions") or []) + [
                        {
                            "name": "load_batch",
                            "pass": True,
                            "detail": f"p95={p95}ms rps={load_metrics['rps']} wall={wall:.0f}ms",
                        }
                    ]
                    latencies.append(float(r.get("latency_ms") or 0))
                    if r.get("status") == "pass":
                        passed += 1
                    else:
                        failed += 1
                    step_results.append(r)
                    if emit:
                        await emit("step", r)
                continue

            for idx, step in enumerate(flow.get("steps") or []):
                # Wire expect_vars for integrity on consumers
                if step.get("kind") in ("e2e", "happy") and step.get("path") and "{{" in str(step.get("path")):
                    used = _VAR_RE.findall(str(step.get("path")))
                    step = {**step, "expect_vars": used}
                result = await _execute_one(
                    client,
                    base=base,
                    step=step,
                    flow_name=flow_name,
                    idx=idx,
                    variables=variables,
                    ops_by_id=ops_by_id,
                    security_schemes=security_schemes,
                    auth_secrets=auth_secrets,
                    allow_private=allow_private,
                    latency_budget_ms=latency_budget_ms,
                    mock_mode=mock_mode,
                    mock_data=mock_data,
                    services=services_by_key,
                )
                latencies.append(float(result.get("latency_ms") or 0))
                if result.get("healed"):
                    healed_count += 1
                if result.get("status") == "pass":
                    passed += 1
                else:
                    failed += 1
                step_results.append(result)
                if emit:
                    await emit("step", result)

    summary = {
        "passed": passed,
        "failed": failed,
        "total": passed + failed,
        "avg_latency_ms": round(sum(latencies) / len(latencies), 2) if latencies else 0,
        "variables": {k: v for k, v in variables.items() if not str(k).startswith("_")},
        "spectrum": spectrum_counts,
        "load": load_metrics,
        "self_healed_steps": healed_count,
        "mock_mode": bool(mock_mode),
    }
    if emit:
        await emit("done", summary)
    return {"summary": summary, "steps": step_results}
