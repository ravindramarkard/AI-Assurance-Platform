"""Write Allure 2 results and a self-contained HTML report with RCA."""

from __future__ import annotations

import html as html_lib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .insights import build_run_insights

SPECTRUM_LABELS = {
    "contract": "1. Contract / Schema",
    "e2e": "2. End-to-End (E2E)",
    "happy": "2. End-to-End (E2E)",
    "edge": "3. Boundary & Data Edge",
    "negative": "4. Negative & Error Handling",
    "security": "5. Security & Auth",
    "load": "6. Performance & Load",
}


def _ms_now() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _esc(s: Any) -> str:
    return html_lib.escape("" if s is None else str(s))


def write_allure_results(
    *,
    out_dir: Path,
    run_id: str,
    project_name: str,
    base_url: str,
    steps: list[dict[str, Any]],
    summary: dict[str, Any],
    openapi_url: str = "",
    insights: dict[str, Any] | None = None,
) -> Path:
    """Write Allure-compatible *-result.json / *-container.json files."""
    results = out_dir / "allure-results"
    results.mkdir(parents=True, exist_ok=True)

    for p in results.glob("*-result.json"):
        p.unlink(missing_ok=True)
    for p in results.glob("*-container.json"):
        p.unlink(missing_ok=True)
    for p in results.glob("*-attachment.txt"):
        p.unlink(missing_ok=True)

    insights = insights or build_run_insights(steps, summary)

    (results / "environment.properties").write_text(
        "\n".join(
            [
                f"Project={project_name}",
                f"Base.URL={base_url}",
                f"OpenAPI={openapi_url}",
                f"Run.ID={run_id}",
                f"Passed={summary.get('passed', 0)}",
                f"Failed={summary.get('failed', 0)}",
                f"Avg.Latency.ms={summary.get('avg_latency_ms', 0)}",
                f"Verdict={insights.get('verdict', '')}",
                f"Primary.RootCause={(insights.get('primary_root_cause') or '')[:180]}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (results / "insights.json").write_text(json.dumps(insights, indent=2), encoding="utf-8")
    (results / "categories.json").write_text(
        json.dumps(
            [
                {"name": "Product defects", "matchedStatuses": ["failed"], "messageRegex": ".*"},
                {"name": "Test defects", "matchedStatuses": ["broken"], "messageRegex": ".*"},
            ],
            indent=2,
        ),
        encoding="utf-8",
    )

    by_flow: dict[str, list[dict[str, Any]]] = {}
    for step in steps:
        by_flow.setdefault(step.get("flow") or "flow", []).append(step)

    # Index insights by endpoint for statusDetails enrichment
    fail_by_ep = {f.get("endpoint"): f for f in insights.get("failures") or []}

    start_all = _ms_now()
    children: list[str] = []

    for flow_name, flow_steps in by_flow.items():
        kind = "e2e"
        for s in flow_steps:
            k = (s.get("detail") or {}).get("kind") or s.get("kind")
            if k:
                kind = str(k)
                break
        lower = flow_name.lower()
        for key in ("contract", "security", "negative", "edge", "load", "e2e"):
            if lower.startswith(key) or f" {key} " in f" {lower} ":
                kind = key
                break

        test_uuid = str(uuid.uuid4())
        children.append(test_uuid)
        t_start = start_all
        t_stop = start_all
        allure_steps = []
        status = "passed"
        status_details = None
        rca_bits: list[str] = []

        for s in flow_steps:
            detail = s.get("detail") if isinstance(s.get("detail"), dict) else s
            s_status = "passed" if (detail.get("status") or s.get("status")) == "pass" else "failed"
            ep = f"{detail.get('method') or s.get('method')} {detail.get('path') or s.get('path')}"
            if s_status == "failed":
                status = "failed"
                insight = fail_by_ep.get(ep) or {}
                msg = insight.get("title") or detail.get("error") or "assertion failed"
                trace_parts = [
                    f"ROOT CAUSE: {insight.get('root_cause') or detail.get('error') or 'n/a'}",
                    f"SOLUTION: {insight.get('solution') or 'n/a'}",
                    "ASSERTIONS:",
                    json.dumps(detail.get("assertions") or [], indent=2)[:3000],
                ]
                status_details = {"message": msg, "trace": "\n\n".join(trace_parts)}
                if insight.get("root_cause"):
                    rca_bits.append(str(insight["root_cause"]))
            lat = float(detail.get("latency_ms") or s.get("latency_ms") or 0)
            step_start = t_stop
            step_stop = step_start + max(1, int(lat))
            t_stop = step_stop

            att_name = None
            req = detail.get("request")
            resp = detail.get("response")
            if req or resp or s_status == "failed":
                att_uuid = str(uuid.uuid4())
                att_name = f"{att_uuid}-attachment.txt"
                payload = {"request": req, "response": resp}
                if s_status == "failed" and ep in fail_by_ep:
                    payload["root_cause"] = fail_by_ep[ep].get("root_cause")
                    payload["solution"] = fail_by_ep[ep].get("solution")
                    payload["summary"] = fail_by_ep[ep].get("title")
                (results / att_name).write_text(
                    json.dumps(payload, indent=2, default=str)[:20000],
                    encoding="utf-8",
                )

            step_obj: dict[str, Any] = {
                "name": ep,
                "status": s_status,
                "stage": "finished",
                "start": step_start,
                "stop": step_stop,
            }
            if att_name:
                step_obj["attachments"] = [
                    {"name": "request/response + RCA", "source": att_name, "type": "text/plain"}
                ]
            allure_steps.append(step_obj)

        description = ""
        if status == "failed" and rca_bits:
            description = f"Root cause: {rca_bits[0][:500]}"

        result = {
            "uuid": test_uuid,
            "historyId": flow_name,
            "name": flow_name,
            "fullName": f"{project_name}.{kind}.{flow_name}",
            "status": status,
            "statusDetails": status_details,
            "description": description,
            "stage": "finished",
            "start": t_start,
            "stop": t_stop,
            "labels": [
                {"name": "suite", "value": project_name},
                {"name": "feature", "value": SPECTRUM_LABELS.get(kind, kind)},
                {"name": "story", "value": flow_name},
                {"name": "tag", "value": kind},
                {"name": "framework", "value": "ai-assurance-api-test"},
                {"name": "language", "value": "python"},
                {"name": "package", "value": f"api_test.{kind}"},
            ],
            "steps": allure_steps,
            "attachments": [],
            "parameters": [
                {"name": "base_url", "value": base_url},
                {"name": "spectrum", "value": SPECTRUM_LABELS.get(kind, kind)},
            ],
        }
        (results / f"{test_uuid}-result.json").write_text(json.dumps(result), encoding="utf-8")

    container_uuid = str(uuid.uuid4())
    (results / f"{container_uuid}-container.json").write_text(
        json.dumps(
            {
                "uuid": container_uuid,
                "name": f"{project_name} — OpenAPI spectrum suite",
                "children": children,
                "befores": [],
                "afters": [],
                "start": start_all,
                "stop": _ms_now(),
            }
        ),
        encoding="utf-8",
    )
    (results / "executor.json").write_text(
        json.dumps(
            {
                "name": "AI Assurance Platform",
                "type": "api-test",
                "buildName": run_id,
                "reportName": f"API Spectrum — {project_name}",
            }
        ),
        encoding="utf-8",
    )
    return results


def write_html_report(
    *,
    report_dir: Path,
    project_name: str,
    base_url: str,
    openapi_url: str,
    run_id: str,
    steps: list[dict[str, Any]],
    summary: dict[str, Any],
    spectrum_counts: dict[str, int] | None = None,
    insights: dict[str, Any] | None = None,
) -> Path:
    """Self-contained HTML report with summary, root cause, and solutions."""
    report_dir.mkdir(parents=True, exist_ok=True)
    spectrum_counts = spectrum_counts or {}
    insights = insights or build_run_insights(steps, summary)

    by_flow: dict[str, list[dict[str, Any]]] = {}
    for step in steps:
        detail = step.get("detail") if isinstance(step.get("detail"), dict) else step
        by_flow.setdefault(detail.get("flow") or step.get("flow_name") or "flow", []).append(step)

    rows = []
    for flow_name, flow_steps in by_flow.items():
        fails = 0
        kind = "e2e"
        for s in flow_steps:
            detail = s.get("detail") if isinstance(s.get("detail"), dict) else s
            if (detail.get("status") or s.get("status")) != "pass":
                fails += 1
            k = detail.get("kind") or s.get("kind")
            if k:
                kind = str(k)
        lower = flow_name.lower()
        for key in ("contract", "security", "negative", "edge", "load", "e2e"):
            if key in lower:
                kind = key
                break
        status = "failed" if fails else "passed"
        lats = [
            float((s.get("detail") or s).get("latency_ms") or s.get("latency_ms") or 0)
            for s in flow_steps
        ]
        avg = sum(lats) / len(lats) if lats else 0.0
        rows.append(
            {
                "name": flow_name,
                "kind": SPECTRUM_LABELS.get(kind, kind),
                "status": status,
                "steps": len(flow_steps),
                "avg_ms": round(avg, 1),
            }
        )

    spectrum_cards = "".join(
        f"<div class='card'><div class='k'>{_esc(SPECTRUM_LABELS.get(k, k))}</div>"
        f"<div class='v'>{_esc(v)}</div></div>"
        for k, v in (spectrum_counts or {}).items()
        if k in ("contract", "e2e", "edge", "negative", "security", "load")
    )

    table_rows = "".join(
        f"<tr class='{r['status']}'><td>{_esc(r['kind'])}</td><td>{_esc(r['name'])}</td>"
        f"<td>{_esc(r['status'])}</td><td>{r['steps']}</td><td>{r['avg_ms']}ms</td></tr>"
        for r in rows
    )

    verdict = insights.get("verdict") or "healthy"
    verdict_cls = {
        "healthy": "ok",
        "degraded": "warn",
        "critical": "bad",
    }.get(str(verdict), "warn")

    theme_cards = ""
    for t in insights.get("themes") or []:
        theme_cards += f"""
        <div class="rca">
          <div class="rca-title">{_esc(t.get('title'))} <span class="count">×{_esc(t.get('count'))}</span></div>
          <div class="rca-ep mono">{_esc(t.get('example_endpoint'))}</div>
          <div class="rca-label">Root cause</div>
          <div class="rca-body">{_esc(t.get('root_cause'))}</div>
          <div class="rca-label">Solution</div>
          <div class="rca-body sol">{_esc(t.get('solution'))}</div>
        </div>"""
    if not theme_cards:
        theme_cards = "<div class='rca'><div class='rca-body'>No failures — no root-cause themes.</div></div>"

    failure_rows = ""
    for f in insights.get("failures") or []:
        failure_rows += (
            f"<tr class='failed'>"
            f"<td>{_esc(f.get('kind'))}</td>"
            f"<td class='mono'>{_esc(f.get('endpoint'))}</td>"
            f"<td>{_esc(f.get('title'))}</td>"
            f"<td>{_esc(f.get('root_cause'))}</td>"
            f"<td>{_esc(f.get('solution'))}</td>"
            f"</tr>"
        )
    if not failure_rows:
        failure_rows = (
            "<tr><td colspan='5' class='muted'>No failed steps — suite is clean.</td></tr>"
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>API Spectrum Report — {_esc(project_name)}</title>
<style>
body {{ font-family: ui-sans-serif, system-ui, sans-serif; background:#0b1220; color:#e2e8f0; margin:0; padding:32px; }}
h1 {{ margin:0 0 8px; font-size:22px; }}
h2 {{ font-size:16px; margin:28px 0 12px; }}
.sub {{ color:#94a3b8; font-size:13px; margin-bottom:24px; line-height:1.5; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:24px; }}
.card {{ background:#111827; border:1px solid #1f2937; border-radius:12px; padding:14px; }}
.card .k {{ color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }}
.card .v {{ font-size:26px; font-weight:700; margin-top:6px; }}
table {{ width:100%; border-collapse:collapse; background:#111827; border:1px solid #1f2937; border-radius:12px; overflow:hidden; }}
th, td {{ text-align:left; padding:10px 12px; font-size:13px; border-bottom:1px solid #1f2937; vertical-align:top; }}
th {{ color:#94a3b8; font-size:11px; text-transform:uppercase; }}
tr.passed td:nth-child(3) {{ color:#6ee7b7; font-weight:600; }}
tr.failed td:nth-child(3) {{ color:#fca5a5; font-weight:600; }}
.badge {{ display:inline-block; padding:2px 8px; border-radius:999px; background:#172554; color:#93c5fd; font-size:12px; }}
.banner {{ border-radius:12px; padding:16px 18px; margin-bottom:20px; border:1px solid; }}
.banner.ok {{ background:#052e1a; border-color:#166534; color:#bbf7d0; }}
.banner.warn {{ background:#422006; border-color:#a16207; color:#fde68a; }}
.banner.bad {{ background:#450a0a; border-color:#b91c1c; color:#fecaca; }}
.banner .hl {{ font-weight:700; font-size:15px; margin-bottom:6px; }}
.rca {{ background:#111827; border:1px solid #1f2937; border-radius:12px; padding:14px 16px; margin-bottom:10px; }}
.rca-title {{ font-weight:700; font-size:14px; margin-bottom:4px; }}
.rca-title .count {{ color:#94a3b8; font-weight:600; }}
.rca-ep {{ color:#64748b; font-size:12px; margin-bottom:10px; }}
.rca-label {{ font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-top:8px; }}
.rca-body {{ font-size:13px; color:#cbd5e1; margin-top:4px; line-height:1.45; }}
.rca-body.sol {{ color:#a7f3d0; }}
.mono {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }}
.muted {{ color:#64748b; }}
.two {{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }}
@media (max-width: 900px) {{ .two {{ grid-template-columns:1fr; }} }}
.panel {{ background:#111827; border:1px solid #1f2937; border-radius:12px; padding:14px 16px; }}
.panel h3 {{ margin:0 0 8px; font-size:13px; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; }}
.panel p {{ margin:0; font-size:13px; line-height:1.5; color:#e2e8f0; }}
</style>
</head>
<body>
  <h1>API Spectrum Report</h1>
  <div class="sub">{_esc(project_name)} · <span class="badge">{_esc(run_id)}</span><br/>
  Base: {_esc(base_url)}<br/>OpenAPI: {_esc(openapi_url)}</div>

  <div class="banner {verdict_cls}">
    <div class="hl">{_esc(insights.get('headline'))}</div>
    <div>{_esc(insights.get('summary'))}</div>
  </div>

  <div class="two" style="margin-bottom:20px">
    <div class="panel">
      <h3>Primary root cause</h3>
      <p>{_esc(insights.get('primary_root_cause'))}</p>
    </div>
    <div class="panel">
      <h3>Recommended solution</h3>
      <p style="color:#a7f3d0">{_esc(insights.get('primary_solution'))}</p>
    </div>
  </div>

  <div class="grid">
    <div class="card"><div class="k">Passed</div><div class="v">{_esc(summary.get('passed', 0))}</div></div>
    <div class="card"><div class="k">Failed</div><div class="v">{_esc(summary.get('failed', 0))}</div></div>
    <div class="card"><div class="k">Pass rate</div><div class="v">{_esc(insights.get('pass_rate', 0))}%</div></div>
    <div class="card"><div class="k">Avg latency</div><div class="v">{_esc(summary.get('avg_latency_ms', 0))}ms</div></div>
    <div class="card"><div class="k">Self-healed</div><div class="v">{_esc(summary.get('self_healed_steps', 0))}</div></div>
  </div>

  <h2>Failure themes — root cause &amp; solution</h2>
  {theme_cards}

  <h2>Failed steps (detail)</h2>
  <table>
    <thead>
      <tr>
        <th>Layer</th><th>Endpoint</th><th>Summary</th><th>Root cause</th><th>Solution</th>
      </tr>
    </thead>
    <tbody>{failure_rows}</tbody>
  </table>

  <h2>Spectrum coverage</h2>
  <div class="grid">{spectrum_cards}</div>

  <h2>Flows</h2>
  <table>
    <thead><tr><th>Layer</th><th>Flow</th><th>Status</th><th>Steps</th><th>Avg</th></tr></thead>
    <tbody>{table_rows}</tbody>
  </table>

  <p class="sub" style="margin-top:24px">
    Allure raw results (including <code>insights.json</code>) are beside this report.
    Spectrum layers: {_esc(insights.get('spectrum_line'))}
  </p>
</body>
</html>
"""
    out = report_dir / "index.html"
    out.write_text(html, encoding="utf-8")
    (report_dir / "insights.json").write_text(json.dumps(insights, indent=2), encoding="utf-8")
    return out
