"""QA test-case table builders for API Spectrum HTML reports."""

from __future__ import annotations

from typing import Any

QA_TABLE_HEADERS = [
    "TC ID",
    "Feature",
    "Test Scenario",
    "Preconditions",
    "Test Steps",
    "Expected Result",
    "Actual Result",
    "Priority",
]

FEATURE_LABELS = {
    "contract": "Contract / Schema",
    "e2e": "End-to-End (E2E)",
    "happy": "End-to-End (E2E)",
    "edge": "Boundary & Data Edge",
    "negative": "Negative & Error Handling",
    "security": "Security & Auth",
    "load": "Performance & Load",
}


def format_tc_id(prefix: str, index: int) -> str:
    return f"{prefix}-TC-{int(index):03d}"


def api_priority(kind: str | None) -> str:
    k = (kind or "").strip().lower()
    if k == "security":
        return "High"
    if k in {"contract", "e2e", "happy"}:
        return "Medium"
    if k in {"edge", "negative", "load"}:
        return "Low"
    return "Medium"


def actual_result_from_evidence(
    status: str | None, detail: str | None, *, executed: bool
) -> str:
    if not executed:
        return "Not executed"
    st = (status or "").strip().lower()
    detail_s = (detail or "").strip()
    if st in {"pass", "passed", "ok"}:
        return f"Pass — {detail_s}" if detail_s else "Pass"
    if st in {"fail", "failed", "error", "broken"}:
        return f"Fail — {detail_s}" if detail_s else "Fail"
    if detail_s:
        return detail_s
    return "N/A"


def _step_detail(step: dict[str, Any]) -> dict[str, Any]:
    d = step.get("detail")
    return d if isinstance(d, dict) else step


def build_api_qa_rows(steps: list[dict[str, Any]], *, base_url: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for i, step in enumerate(steps or [], start=1):
        d = _step_detail(step)
        kind = str(d.get("kind") or step.get("kind") or "e2e")
        method = str(d.get("method") or step.get("method") or "").upper()
        path = str(d.get("path") or step.get("path") or d.get("endpoint") or "")
        op = str(d.get("operation_id") or step.get("operation_id") or "")
        flow = str(step.get("flow") or d.get("flow") or op or path or f"step-{i}")
        if op and op not in flow:
            scenario = f"{flow} ({op})"
        else:
            scenario = flow
        expected = d.get("expected_status") or step.get("expected_status") or []
        if isinstance(expected, list) and expected:
            expected_s = "HTTP in [" + ", ".join(str(x) for x in expected) + "]"
        else:
            expected_s = "N/A"
        code = d.get("status_code") if d.get("status_code") is not None else step.get("status_code")
        status = str(d.get("status") or step.get("status") or "")
        executed = status != "" or code is not None
        err = str(d.get("error") or step.get("error") or "").strip()
        evidence = f"HTTP {code}" if code is not None else (err or None)
        pre_parts = [(base_url or "").strip() or "N/A"]
        if d.get("skip_auth") or step.get("skip_auth"):
            pre_parts.append("auth skipped")
        rows.append(
            {
                "TC ID": format_tc_id("API", i),
                "Feature": FEATURE_LABELS.get(kind, kind),
                "Test Scenario": scenario,
                "Preconditions": "; ".join(pre_parts),
                "Test Steps": f"{method} {path}".strip() or "N/A",
                "Expected Result": expected_s,
                "Actual Result": actual_result_from_evidence(status, evidence, executed=executed),
                "Priority": api_priority(kind),
            }
        )
    return rows


def build_api_observations(insights: dict[str, Any]) -> tuple[list[str], list[str]]:
    insights = insights or {}
    failures = insights.get("failures") or []
    themes = insights.get("themes") or []
    obs: list[str] = []
    rec: list[str] = []
    if not failures:
        obs.append("Suite completed with no failed steps.")
        rec.append("Retain current spectrum coverage; re-run after API or contract changes.")
        return obs, rec
    prc = (insights.get("primary_root_cause") or "").strip()
    if prc:
        obs.append(prc)
    for t in themes:
        title = (t.get("title") or "").strip()
        rc = (t.get("root_cause") or "").strip()
        line = f"{title}: {rc}".strip(": ").strip()
        if line:
            obs.append(line)
        sol = (t.get("solution") or "").strip()
        if sol:
            rec.append(sol)
    ps = (insights.get("primary_solution") or "").strip()
    if ps and ps not in rec:
        rec.insert(0, ps)
    if not obs:
        obs.append(f"{len(failures)} failed step(s) detected.")
    if not rec:
        rec.append("Inspect failed endpoints and align expected_status or fix the API.")
    return obs, rec
