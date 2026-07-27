#!/usr/bin/env python3
"""Ingest Petstore OpenAPI, generate full spectrum flows, run suite, emit Allure report."""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import db  # noqa: E402
from app.api_test import service  # noqa: E402

PETSTORE_URL = "https://petstore.swagger.io/v2/swagger.json"
BASE_URL = "https://petstore.swagger.io/v2"


async def main() -> int:
    await db.init_db()
    project = await db.create_api_project(
        name="Swagger Petstore",
        base_url=BASE_URL,
        openapi_url=PETSTORE_URL,
        config={
            "generation_budget": 48,
            "include_negative": True,
            "include_edge": True,
            "include_security": True,
            "include_load": True,
            "load_vus": 10,
            "latency_budget_ms": 10000,
            "allow_private_urls": False,
        },
    )
    pid = project["id"]
    print(f"project={pid}")

    ingest = await service.ingest_project(pid, url=PETSTORE_URL)
    print(f"ingested endpoints={ingest['endpoint_count']}")
    print(f"security={[s['name'] for s in ingest['security_schemes']]}")

    # Petstore documents api_key = special-key
    await service.save_auth(pid, "api_key", {"api_key": "special-key"})

    gen = await service.generate_project_flows(pid)
    print(f"flows={gen['count']} spectrum={gen.get('spectrum')}")

    run = await service.execute_run(pid, wait=True)
    summary = run.get("summary") or {}
    print("run status=", run.get("status"))
    print("summary=", json.dumps({k: summary.get(k) for k in (
        "passed", "failed", "total", "avg_latency_ms", "spectrum", "load", "report_html", "allure_results"
    )}, indent=2))

    report_html = summary.get("report_html")
    allure_results = summary.get("allure_results")
    report_dir = Path(summary.get("report_dir") or ".")

    # Prefer classic Allure UI if CLI available via npx
    classic = report_dir / "allure-report-classic"
    if allure_results and shutil.which("npx"):
        try:
            subprocess.run(
                [
                    "npx",
                    "--yes",
                    "allure-commandline",
                    "generate",
                    allure_results,
                    "-o",
                    str(classic),
                    "--clean",
                ],
                check=True,
                cwd=str(report_dir),
            )
            print(f"allure_classic={classic / 'index.html'}")
        except Exception as exc:
            print(f"allure CLI generate skipped: {exc}")

    print(f"report_html={report_html}")
    # copy a stable convenience path
    stable = Path(db.DB_PATH).parent / "api_test_reports" / "latest"
    if report_html:
        stable.mkdir(parents=True, exist_ok=True)
        src = Path(report_html)
        if src.exists():
            dest = stable / "index.html"
            dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
            # copy allure-results too
            ar = Path(allure_results) if allure_results else None
            if ar and ar.exists():
                target = stable / "allure-results"
                if target.exists():
                    shutil.rmtree(target)
                shutil.copytree(ar, target)
            print(f"stable_report={dest}")

    return 0 if (summary.get("failed") or 0) == 0 or (summary.get("passed") or 0) > 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
