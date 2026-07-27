#!/usr/bin/env python3
"""E2E: dual named services using Petstore v2 + Petstore v3 bases."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import db  # noqa: E402
from app.api_test import service  # noqa: E402
from app.api_test.flows import generate_flows  # noqa: E402
from app.api_test.parser import normalize_operations, parse_spec_text  # noqa: E402

LEGACY_BASE = "https://petstore.swagger.io/v2"
LEGACY_OPENAPI = "https://petstore.swagger.io/v2/swagger.json"

# User doc lists petstore.swagger.io/v3 — that host path 404s today.
# Prefer it when live; otherwise fall back to the official Petstore 3 demo.
DOC_NEXTGEN_BASE = "https://petstore.swagger.io/v3"
FALLBACK_NEXTGEN_BASE = "https://petstore3.swagger.io/api/v3"
FALLBACK_NEXTGEN_OPENAPI = "https://petstore3.swagger.io/api/v3/openapi.json"
SHARED_OPENAPI = LEGACY_OPENAPI  # per user: same data model


async def _probe_base(base: str) -> bool:
    url = f"{base.rstrip('/')}/store/inventory"
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            r = await client.get(url)
            return r.status_code < 500 and r.status_code != 404
    except Exception:
        return False


async def main() -> int:
    await db.init_db()

    nextgen_base = DOC_NEXTGEN_BASE
    nextgen_openapi = SHARED_OPENAPI
    if not await _probe_base(DOC_NEXTGEN_BASE):
        print(
            f"WARN: {DOC_NEXTGEN_BASE} is not serving the Petstore API "
            f"(404). Falling back to {FALLBACK_NEXTGEN_BASE}"
        )
        nextgen_base = FALLBACK_NEXTGEN_BASE
        nextgen_openapi = FALLBACK_NEXTGEN_OPENAPI

    project = await db.create_api_project(
        name="Petstore Dual-Service (v2+v3)",
        base_url=LEGACY_BASE,
        openapi_url=LEGACY_OPENAPI,
        config={
            "generation_budget": 36,
            "include_negative": False,
            "include_edge": False,
            "include_security": False,
            "include_load": False,
            "latency_budget_ms": 15000,
            "allow_private_urls": False,
            "mock_mode": False,
        },
        seed_services=True,
    )
    pid = project["id"]
    print(f"project={pid}")

    svcs = await db.list_api_services(pid, include_raw=False)
    by_key = {s["key"]: s for s in svcs}
    legacy = by_key.get("backend") or svcs[0]
    nextgen = by_key.get("ai") or (svcs[1] if len(svcs) > 1 else None)
    if not nextgen:
        nextgen = await db.create_api_service(
            pid, key="ai", name="Next-Gen", base_url=nextgen_base, openapi_url=nextgen_openapi
        )

    await db.update_api_service(
        legacy["id"],
        key="legacy",
        name="Legacy Petstore v2",
        base_url=LEGACY_BASE,
        openapi_url=LEGACY_OPENAPI,
    )
    await db.update_api_service(
        nextgen["id"],
        key="nextgen",
        name="Next-Gen Petstore v3",
        base_url=nextgen_base,
        openapi_url=nextgen_openapi,
    )
    # Refresh ids/keys after rename
    svcs = await db.list_api_services(pid, include_raw=False)
    by_key = {s["key"]: s for s in svcs}
    legacy = by_key["legacy"]
    nextgen = by_key["nextgen"]

    print(f"service legacy  base={legacy['base_url']} openapi={legacy['openapi_url']}")
    print(f"service nextgen base={nextgen['base_url']} openapi={nextgen['openapi_url']}")

    ing1 = await service.ingest_project(pid, url=LEGACY_OPENAPI, service_id=legacy["id"])
    print(f"ingested legacy endpoints_total={ing1['endpoint_count']}")
    ing2 = await service.ingest_project(pid, url=nextgen_openapi, service_id=nextgen["id"])
    print(f"ingested nextgen endpoints_total={ing2['endpoint_count']}")

    eps = await db.list_api_endpoints(pid)
    keys = sorted({(e.get("meta") or {}).get("service_key") for e in eps})
    print(f"endpoint service_keys={keys} count={len(eps)}")
    assert "legacy" in keys and "nextgen" in keys, f"expected both service keys, got {keys}"

    # Petstore api_key
    await service.save_auth(pid, "api_key", {"api_key": "special-key", "type": "apiKey"})

    ops = await service._load_all_ops(pid)

    async def _pick_live_get(service_key: str, base: str) -> dict:
        """Pick a GET without path params that currently returns 2xx on the service base."""
        candidates = [
            o
            for o in ops
            if o.get("service_key") == service_key
            and o.get("method") == "GET"
            and not (o.get("path_params") or [])
        ]
        # Prefer inventory / findByStatus style reads
        candidates.sort(
            key=lambda o: (
                0
                if "inventory" in (o.get("path") or "").lower()
                else 1
                if "findbystatus" in (o.get("path") or "").lower().replace("_", "")
                else 2,
                len(o.get("path") or ""),
            )
        )
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            for o in candidates:
                path = o["path"]
                url = base.rstrip("/") + (path if path.startswith("/") else f"/{path}")
                # Petstore findByStatus needs a query param
                params = {}
                if "findByStatus" in path:
                    params["status"] = "available"
                try:
                    r = await client.get(url, params=params or None)
                    if 200 <= r.status_code < 300:
                        step_path = path
                        query = dict(params)
                        return {
                            "operation_id": o["operation_id"],
                            "method": "GET",
                            "path": step_path,
                            "path_template": path,
                            "query": query,
                            "headers": {},
                            "body": None,
                            "captures": [],
                            "expected_status": [200, 201, 202, 204],
                            "assert_schema": False,
                            "kind": "e2e",
                            "service_key": service_key,
                        }
                except Exception:
                    continue
        raise RuntimeError(f"No live GET for service {service_key} at {base}")

    dual = {
        "name": "Cross-service inventory smoke",
        "kind": "e2e",
        "resource": "cross",
        "steps": [
            await _pick_live_get("legacy", LEGACY_BASE),
            await _pick_live_get("nextgen", nextgen_base),
        ],
    }
    print(
        "dual_smoke=",
        [(s["service_key"], s["method"], s["path"], s.get("query")) for s in dual["steps"]],
    )

    # Heuristic spectrum (fast/reliable). AI generate is optional — can bias to one service.
    use_ai = "--ai" in sys.argv
    if use_ai:
        try:
            gen = await service.generate_project_flows(pid)
            print(f"flows(ai)={gen['count']} spectrum={gen.get('spectrum')}")
            flows = await db.list_api_flows(pid)
            flow_dicts = [
                {
                    "name": f.get("name"),
                    "kind": f.get("kind"),
                    "resource": f.get("resource") or "",
                    "steps": f.get("steps") or [],
                }
                for f in flows
            ]
        except Exception as exc:
            print(f"WARN: AI generate failed ({exc}); using heuristic flows")
            flow_dicts = generate_flows(
                ops,
                budget=36,
                include_negative=False,
                include_edge=False,
                include_security=False,
                include_load=False,
            )
    else:
        flow_dicts = generate_flows(
            ops,
            budget=36,
            include_negative=False,
            include_edge=False,
            include_security=False,
            include_load=False,
        )
        print(f"flows(heuristic)={len(flow_dicts)}")

    # Ensure per-service contract coverage + dual smoke first
    legacy_ops = [o for o in ops if o.get("service_key") == "legacy"]
    nextgen_ops = [o for o in ops if o.get("service_key") == "nextgen"]
    per_service = []
    for label, subset in (("legacy", legacy_ops), ("nextgen", nextgen_ops)):
        gets = [
            o
            for o in subset
            if o.get("method") == "GET" and not (o.get("path_params") or [])
        ][:3]
        if gets:
            per_service.append(
                {
                    "name": f"{label} contract GETs",
                    "kind": "contract",
                    "resource": label,
                    "steps": [
                        {
                            "operation_id": o["operation_id"],
                            "method": o["method"],
                            "path": o["path"],
                            "path_template": o["path"],
                            "query": {},
                            "headers": {},
                            "body": None,
                            "captures": [],
                            "expected_status": [200, 201, 202, 204],
                            "assert_schema": False,
                            "kind": "contract",
                            "service_key": label,
                        }
                        for o in gets
                    ],
                }
            )
    flow_dicts = [dual, *per_service, *flow_dicts]
    await db.replace_api_flows(pid, flow_dicts)
    print(f"flows(total)={len(flow_dicts)} dual_smoke=1 per_service={len(per_service)}")

    flows = await db.list_api_flows(pid)
    step_hosts: dict[str, int] = {}
    for f in flows:
        for s in f.get("steps") or []:
            sk = str(s.get("service_key") or "?")
            step_hosts[sk] = step_hosts.get(sk, 0) + 1
    print(f"step service_key counts={step_hosts}")

    run = await service.execute_run(pid, wait=True)
    summary = run.get("summary") or {}
    run_id = run.get("id")
    step_rows = await db.list_api_run_steps(run_id) if run_id else []
    steps = []
    for row in step_rows:
        detail = row.get("detail") if isinstance(row.get("detail"), dict) else {}
        steps.append(
            {
                **detail,
                "status": row.get("status") or detail.get("status"),
                "method": row.get("method") or detail.get("method"),
                "path": row.get("path") or detail.get("path"),
                "latency_ms": row.get("latency_ms") or detail.get("latency_ms"),
                "service_key": detail.get("service_key"),
                "request": detail.get("request") or {},
            }
        )

    print("run status=", run.get("status") or summary.get("status"))
    print(
        "summary=",
        json.dumps(
            {
                k: summary.get(k)
                for k in (
                    "passed",
                    "failed",
                    "total",
                    "avg_latency_ms",
                    "spectrum",
                    "report_html",
                )
            },
            indent=2,
        ),
    )

    # Prove dual hosts were actually hit
    hosts_hit: dict[str, int] = {}
    dual_hits = {"legacy": 0, "nextgen": 0}
    for st in steps:
        sk = str(st.get("service_key") or "")
        if sk in dual_hits:
            dual_hits[sk] += 1
        req = st.get("request") or {}
        url = str(req.get("url") or "")
        if url.startswith("http"):
            host = urlparse(url).netloc
            hosts_hit[host] = hosts_hit.get(host, 0) + 1
    print(f"hosts_hit={hosts_hit}")
    print(f"steps_by_service_key={dual_hits}")

    # Sample dual smoke + a few others
    for st in steps[:12]:
        req = st.get("request") or {}
        print(
            f"  [{st.get('status')}] {st.get('service_key')} "
            f"{st.get('method')} {req.get('url') or st.get('path')} "
            f"lat={st.get('latency_ms')}"
        )

    passed = int(summary.get("passed") or 0)
    failed = int(summary.get("failed") or 0)
    multi_host = len(hosts_hit) >= 2 and dual_hits["legacy"] > 0 and dual_hits["nextgen"] > 0
    # Dual smoke must have exercised both bases successfully at least once
    smoke_pass = any(
        st.get("status") == "pass" and st.get("service_key") == "legacy" for st in steps
    ) and any(
        st.get("status") == "pass" and st.get("service_key") == "nextgen" for st in steps
    )
    ok = passed > 0 and multi_host and smoke_pass
    print(
        f"RESULT ok={ok} passed={passed} failed={failed} "
        f"multi_host={multi_host} smoke_pass={smoke_pass}"
    )
    if not multi_host:
        print("FAIL: did not observe requests against both service bases")
        return 2
    if not smoke_pass:
        print("FAIL: dual-service smoke did not pass on both hosts")
        return 3
    if passed == 0:
        print("FAIL: no passing steps")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
