"""Root-cause analysis, executive summary, and remediation for API test runs."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any


def _detail(step: dict[str, Any]) -> dict[str, Any]:
    d = step.get("detail")
    return d if isinstance(d, dict) else step


def _classify_failure(step: dict[str, Any]) -> dict[str, str]:
    """Map a failed step to root_cause + solution."""
    d = _detail(step)
    err = str(d.get("error") or "")
    err_l = err.lower()
    method = str(d.get("method") or step.get("method") or "")
    path = str(d.get("path") or step.get("path") or "")
    kind = str(d.get("kind") or step.get("kind") or "e2e")
    resp = d.get("response") or {}
    code = resp.get("status_code")
    assertions = d.get("assertions") or []
    failed_asserts = [a for a in assertions if isinstance(a, dict) and not a.get("pass")]

    op = f"{method} {path}".strip()

    # Unresolved variables / binding
    if "unresolved path variables" in err_l or "{{" in path:
        return {
            "category": "variable_binding",
            "title": "Missing upstream ID / variable binding",
            "root_cause": (
                f"Step {op} still contains unresolved template variables. "
                "The create/login step likely did not capture an id (empty response, wrong JSONPath, or create failed)."
            ),
            "solution": (
                "1) Ensure the create step returns 2xx and includes an id. "
                "2) Verify JSONPath capture (e.g. $.id or $.data.id). "
                "3) Seed a client-generated id in the POST body when the API omits response ids. "
                "4) Confirm auth is applied so create is not rejected."
            ),
            "endpoint": op,
            "kind": kind,
        }

    # Transport / SSRF
    if "private" in err_l or "blocked" in err_l or "cannot resolve" in err_l:
        return {
            "category": "connectivity",
            "title": "URL blocked or unreachable",
            "root_cause": f"Outbound request to {op} was blocked or could not be resolved: {err[:240]}",
            "solution": (
                "Use a public HTTPS base URL, or enable 'Allow private/localhost URLs' in Configuration "
                "for local targets. Verify DNS and that the OpenAPI server URL matches the live API."
            ),
            "endpoint": op,
            "kind": kind,
        }

    # Auth
    if code in (401, 403) or "auth" in err_l or any(
        "auth" in str(a.get("name", "")).lower() for a in failed_asserts
    ):
        if kind == "security":
            return {
                "category": "security_probe",
                "title": "Security probe observed auth behavior",
                "root_cause": (
                    f"{op} returned {code} without credentials (or with a weak token). "
                    "This may be expected for protected routes."
                ),
                "solution": (
                    "If the endpoint must be public, fix server auth config. "
                    "If protected, document expected 401/403 and keep the probe. "
                    "Configure apiKey/OAuth credentials in the Configuration tab for authenticated suites."
                ),
                "endpoint": op,
                "kind": kind,
            }
        return {
            "category": "authentication",
            "title": "Authentication / authorization failure",
            "root_cause": (
                f"{op} returned HTTP {code}. Credentials are missing, expired, or lack the required scope/role."
            ),
            "solution": (
                "1) Open Configuration → Authentication and set api_key / bearer / OAuth client credentials. "
                "2) Run Client credentials or Exchange auth code. "
                "3) Confirm the OpenAPI security scheme matches what the server expects "
                "(header name, Bearer vs api_key)."
            ),
            "endpoint": op,
            "kind": kind,
        }

    # Server errors
    if code is not None and int(code) >= 500:
        return {
            "category": "server_error",
            "title": "Upstream API server error (5xx)",
            "root_cause": (
                f"{op} returned HTTP {code}. The target service threw an unhandled error "
                f"(payload shape, null deref, or demo API instability). Detail: {err[:200]}"
            ),
            "solution": (
                "1) Inspect the response body for stack/messages. "
                "2) Re-run with a valid, schema-conformant payload (check required fields/types). "
                "3) If using a public demo (e.g. Petstore), treat intermittent 500s as environmental. "
                "4) File a defect against the API if reproducible with a minimal payload."
            ),
            "endpoint": op,
            "kind": kind,
        }

    # Schema
    if any(a.get("name") == "json_schema" for a in failed_asserts) or "schema" in err_l:
        detail = next(
            (str(a.get("detail")) for a in failed_asserts if a.get("name") == "json_schema"),
            err,
        )
        return {
            "category": "contract_schema",
            "title": "Response schema / contract mismatch",
            "root_cause": (
                f"{op} response does not match the OpenAPI response schema. {detail[:280]}"
            ),
            "solution": (
                "1) Diff the live response against the OpenAPI definition (Schema tab). "
                "2) Update the API implementation or refresh the OpenAPI baseline. "
                "3) Re-ingest the spec after publishing a corrected schema."
            ),
            "endpoint": op,
            "kind": kind,
        }

    # Latency
    if any(a.get("name") == "latency" for a in failed_asserts) or "budget" in err_l:
        return {
            "category": "performance",
            "title": "Latency budget exceeded",
            "root_cause": f"{op} exceeded the configured latency budget. {err[:200]}",
            "solution": (
                "1) Raise latency_budget_ms in Configuration if the SLA allows. "
                "2) Profile the endpoint (DB, N+1, cold start). "
                "3) For load flows, reduce VUs or scale the target."
            ),
            "endpoint": op,
            "kind": kind,
        }

    # Data integrity
    if any(a.get("name") == "data_integrity" for a in failed_asserts) or "missing" in err_l:
        return {
            "category": "data_integrity",
            "title": "Cross-step data integrity failure",
            "root_cause": (
                f"Captured id from an earlier step was not present in {op}. "
                "Create may have succeeded without persisting, or the wrong resource was fetched."
            ),
            "solution": (
                "1) Confirm the create response id matches the GET path parameter. "
                "2) Check eventual consistency / caching. "
                "3) Align JSONPath capture with the real response shape."
            ),
            "endpoint": op,
            "kind": kind,
        }

    # Status code mismatch (incl. negative expecting error but got success or wrong code)
    status_assert = next((a for a in failed_asserts if a.get("name") == "status_code"), None)
    if status_assert or re.search(r"got \d+", err_l):
        got_m = re.search(r"got (\d+)", str(status_assert.get("detail") if status_assert else err), re.I)
        got = got_m.group(1) if got_m else str(code or "?")
        if kind == "negative":
            return {
                "category": "negative_expectation",
                "title": "Negative test did not get an expected error",
                "root_cause": (
                    f"Negative probe for {op} got HTTP {got} instead of a client/validation error. "
                    "The API may accept invalid input or return a different error code."
                ),
                "solution": (
                    "1) Tighten server-side validation if invalid payloads should be rejected. "
                    "2) Update expected_status in the flow if the API documents a different error code. "
                    "3) Review whether the synthetic negative payload still hits a required-field check."
                ),
                "endpoint": op,
                "kind": kind,
            }
        return {
            "category": "status_mismatch",
            "title": f"Unexpected HTTP status ({got})",
            "root_cause": (
                f"{op} returned HTTP {got}, outside the expected success/error set for a '{kind}' flow. "
                f"{err[:200]}"
            ),
            "solution": (
                "1) Compare with OpenAPI documented responses. "
                "2) Fix request payload/headers (Content-Type, auth). "
                "3) Enable self-heal retry logs — type coercion may be needed for array/object fields."
            ),
            "endpoint": op,
            "kind": kind,
        }

    return {
        "category": "unknown",
        "title": "Step failed",
        "root_cause": err[:400] or f"{op} failed without a detailed assertion message.",
        "solution": (
            "Open the step request/response in the report attachment, verify payload against the schema, "
            "and re-run after fixing auth or binding issues."
        ),
        "endpoint": op,
        "kind": kind,
    }


def build_run_insights(
    steps: list[dict[str, Any]],
    summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Produce executive summary + per-failure root cause/solution + top themes."""
    summary = summary or {}
    passed = int(summary.get("passed") or 0)
    failed = int(summary.get("failed") or 0)
    total = int(summary.get("total") or (passed + failed) or 0)
    avg = summary.get("avg_latency_ms") or 0
    healed = int(summary.get("self_healed_steps") or 0)
    spectrum = summary.get("spectrum") or {}
    load = summary.get("load") or {}

    failures: list[dict[str, Any]] = []
    for step in steps:
        d = _detail(step)
        if (d.get("status") or step.get("status")) == "pass":
            continue
        info = _classify_failure(step)
        failures.append(
            {
                **info,
                "flow": d.get("flow") or step.get("flow_name") or "",
                "error": d.get("error"),
                "status_code": (d.get("response") or {}).get("status_code"),
                "latency_ms": d.get("latency_ms") or step.get("latency_ms"),
            }
        )

    # Deduplicate similar failures by category+endpoint for "top themes"
    theme_counter: Counter[str] = Counter()
    theme_examples: dict[str, dict[str, Any]] = {}
    for f in failures:
        key = f"{f['category']}|{f.get('title')}"
        theme_counter[key] += 1
        theme_examples.setdefault(key, f)

    themes = []
    for key, count in theme_counter.most_common(8):
        ex = theme_examples[key]
        themes.append(
            {
                "count": count,
                "category": ex["category"],
                "title": ex["title"],
                "root_cause": ex["root_cause"],
                "solution": ex["solution"],
                "example_endpoint": ex.get("endpoint"),
            }
        )

    pass_rate = round(100 * passed / total, 1) if total else 0.0
    if failed == 0 and total > 0:
        verdict = "healthy"
        headline = "All executed steps passed."
    elif pass_rate >= 70:
        verdict = "degraded"
        headline = f"Suite mostly passing ({pass_rate}%) with {failed} failing step(s)."
    else:
        verdict = "critical"
        headline = f"High failure rate ({pass_rate}% pass). {failed} of {total} steps failed."

    top = themes[0] if themes else None
    exec_summary = (
        f"{headline} "
        f"Avg latency {avg}ms. Self-healed steps: {healed}. "
        + (
            f"Primary theme: {top['title']} ({top['count']}×)."
            if top
            else "No failure themes."
        )
    )

    layers = ", ".join(f"{k}={v}" for k, v in spectrum.items() if v) or "n/a"
    load_line = ""
    if load:
        load_line = (
            f" Load: {load.get('vus')} VUs, p95={load.get('p95_ms')}ms, rps={load.get('rps')}."
        )

    return {
        "verdict": verdict,
        "headline": headline,
        "summary": exec_summary + load_line,
        "pass_rate": pass_rate,
        "spectrum_line": layers,
        "themes": themes,
        "failures": failures[:40],
        "recommendations": [t["solution"] for t in themes[:5]],
        "primary_root_cause": top["root_cause"] if top else "No failures detected.",
        "primary_solution": top["solution"] if top else "Keep monitoring; re-run after OpenAPI changes.",
    }
