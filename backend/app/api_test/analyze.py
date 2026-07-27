"""Anomaly detection and flaky scoring from run history."""

from __future__ import annotations

from collections import defaultdict
from typing import Any


def detect_anomalies(steps: list[dict[str, Any]], *, avg_latency_ms: float = 0) -> list[dict[str, Any]]:
    anomalies: list[dict[str, Any]] = []
    for step in steps:
        resp = step.get("response") or {}
        body = resp.get("body")
        code = resp.get("status_code")
        method = step.get("method")
        path = step.get("path")
        op = f"{method} {path}"

        if code and int(code) >= 500:
            nullish = False
            if isinstance(body, dict):
                nullish = any(v is None for v in body.values())
            anomalies.append(
                {
                    "finding": f"Server error on {op}"
                    + (" with null field(s)" if nullish else ""),
                    "confidence": 92 if nullish else 85,
                    "operation_id": step.get("operation_id"),
                    "endpoint": op,
                }
            )

        if code in (401, 403) and step.get("kind") != "negative":
            anomalies.append(
                {
                    "finding": f"Auth failure on {op}",
                    "confidence": 88,
                    "operation_id": step.get("operation_id"),
                    "endpoint": op,
                }
            )

        lat = float(step.get("latency_ms") or 0)
        if avg_latency_ms and lat > max(avg_latency_ms * 3, 1000):
            anomalies.append(
                {
                    "finding": f"Latency spike on {op} ({lat:.0f}ms)",
                    "confidence": 81,
                    "operation_id": step.get("operation_id"),
                    "endpoint": op,
                }
            )

        for a in step.get("assertions") or []:
            if a.get("name") == "json_schema" and not a.get("pass"):
                detail = a.get("detail") or ""
                if "enum" in detail.lower():
                    anomalies.append(
                        {
                            "finding": f"Unexpected enum / schema drift on {op}",
                            "confidence": 87,
                            "operation_id": step.get("operation_id"),
                            "endpoint": op,
                        }
                    )
                else:
                    anomalies.append(
                        {
                            "finding": f"Response schema mismatch on {op}",
                            "confidence": 80,
                            "operation_id": step.get("operation_id"),
                            "endpoint": op,
                        }
                    )

    # de-dupe by finding
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for a in anomalies:
        if a["finding"] in seen:
            continue
        seen.add(a["finding"])
        unique.append(a)
    return unique[:40]


def flaky_endpoints(
    run_endpoint_results: list[dict[str, Any]],
    *,
    threshold: float = 0.3,
    min_runs: int = 3,
) -> list[dict[str, Any]]:
    """
    run_endpoint_results: [{endpoint, passed: bool}, ...] across recent runs
    """
    stats: dict[str, list[bool]] = defaultdict(list)
    for row in run_endpoint_results:
        ep = row.get("endpoint") or ""
        if not ep:
            continue
        stats[ep].append(bool(row.get("passed")))

    flaky: list[dict[str, Any]] = []
    for ep, results in stats.items():
        if len(results) < min_runs:
            continue
        fails = sum(1 for r in results if not r)
        rate = fails / len(results)
        if 0 < rate < 1 and rate >= threshold:
            flaky.append(
                {
                    "endpoint": ep,
                    "fail_rate": round(rate, 3),
                    "runs": len(results),
                    "failures": fails,
                }
            )
    flaky.sort(key=lambda x: x["fail_rate"], reverse=True)
    return flaky


def endpoint_status_map(
    latest_steps: list[dict[str, Any]],
    drift_ops: set[str] | None = None,
) -> dict[str, str]:
    """Return {METHOD path: pass|fail|drift}."""
    drift_ops = drift_ops or set()
    out: dict[str, str] = {}
    for step in latest_steps:
        key = f"{step.get('method')} {step.get('path_template') or step.get('path')}"
        # normalize path vars
        import re

        key_norm = re.sub(r"/[0-9a-fA-F-]{8,}", "/{id}", key)
        key_norm = re.sub(r"/\d+", "/{id}", key_norm)
        status = step.get("status") or "fail"
        if key in drift_ops or any(d in key for d in drift_ops):
            out[key_norm] = "drift"
        elif status == "pass":
            out.setdefault(key_norm, "pass")
        else:
            out[key_norm] = "fail"
    return out
