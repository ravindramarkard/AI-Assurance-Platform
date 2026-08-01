# Unified QA Test Report Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AgentBrowser HTML/PDF exports and API Spectrum `index.html` share one QA report shape: Executive Summary, an 8-column test-case table, and Observations & Recommendations.

**Architecture:** Pure helpers build rows + section copy; each pipeline renders HTML from those helpers. API uses `backend/app/api_test/qa_report.py`; AgentBrowser uses `frontend/src/qaReport.ts` wired into `messageExport.ts`. Agent system guidance nudges freeform `report.html` toward the same outline.

**Tech Stack:** Python 3 / unittest, FastAPI api_test module, TypeScript / Vite / Vitest (new, frontend-only), existing `messageExport.ts` HTML shell

## Global Constraints

- Column headers exactly: `TC ID | Feature | Test Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Priority`
- Actual Result always filled from evidence; missing → `Not executed` or `N/A`
- Priority mapping: API `security`→High; `contract`/`e2e`→Medium; `edge`/`negative`/`load`→Low; unknown→Medium. AgentBrowser: error→High else Medium
- TC IDs: `API-TC-{nnn}` / `AB-TC-{nnn}` (1-based, zero-padded to 3)
- Preserve Allure JSON sidecars and download paths
- Prefer single QA table in API HTML (drop duplicate Failed steps / Flows tables)
- No Excel/CSV; no new AgentBrowser LLM polish call
- Do not commit unless the user explicitly asks

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/api_test/qa_report.py` | API row builders, priority, Actual Result, observations copy |
| `backend/app/api_test/allure_report.py` | Render new HTML sections using `qa_report` |
| `backend/tests/test_qa_report.py` | Unit tests for API helpers + HTML headings |
| `frontend/src/qaReport.ts` | AgentBrowser row builders + observations + table HTML |
| `frontend/src/qaReport.test.ts` | Vitest unit tests |
| `frontend/src/messageExport.ts` | Use `qaReport` in `buildHtmlDocument` |
| `frontend/vite.config.ts` / `package.json` | Vitest script (minimal) |
| `backend/app/response_style.py` | Guidance when writing test `report.html` / markdown |

---

### Task 1: API QA report helpers

**Files:**
- Create: `backend/app/api_test/qa_report.py`
- Test: `backend/tests/test_qa_report.py`

**Interfaces:**
- Produces:
  - `QA_TABLE_HEADERS: list[str]` — the eight column names in order
  - `def api_priority(kind: str | None) -> str`
  - `def format_tc_id(prefix: str, index: int) -> str` — `prefix-TC-{nnn}` with `index` 1-based
  - `def actual_result_from_evidence(status: str | None, detail: str | None, *, executed: bool) -> str`
  - `def build_api_qa_rows(steps: list[dict], *, base_url: str) -> list[dict[str, str]]`
  - `def build_api_observations(insights: dict) -> tuple[list[str], list[str]]` — (observations, recommendations)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_qa_report.py`:

```python
import unittest

from app.api_test.qa_report import (
    QA_TABLE_HEADERS,
    actual_result_from_evidence,
    api_priority,
    build_api_observations,
    build_api_qa_rows,
    format_tc_id,
)


class TestQaHelpers(unittest.TestCase):
    def test_headers(self):
        self.assertEqual(
            QA_TABLE_HEADERS,
            [
                "TC ID",
                "Feature",
                "Test Scenario",
                "Preconditions",
                "Test Steps",
                "Expected Result",
                "Actual Result",
                "Priority",
            ],
        )

    def test_format_tc_id(self):
        self.assertEqual(format_tc_id("API", 1), "API-TC-001")
        self.assertEqual(format_tc_id("AB", 12), "AB-TC-012")

    def test_api_priority(self):
        self.assertEqual(api_priority("security"), "High")
        self.assertEqual(api_priority("contract"), "Medium")
        self.assertEqual(api_priority("e2e"), "Medium")
        self.assertEqual(api_priority("edge"), "Low")
        self.assertEqual(api_priority("negative"), "Low")
        self.assertEqual(api_priority("load"), "Low")
        self.assertEqual(api_priority(None), "Medium")

    def test_actual_result(self):
        self.assertEqual(
            actual_result_from_evidence("pass", "HTTP 200", executed=True),
            "Pass — HTTP 200",
        )
        self.assertEqual(
            actual_result_from_evidence("fail", "HTTP 500", executed=True),
            "Fail — HTTP 500",
        )
        self.assertEqual(
            actual_result_from_evidence(None, None, executed=False),
            "Not executed",
        )
        self.assertEqual(
            actual_result_from_evidence(None, None, executed=True),
            "N/A",
        )

    def test_build_rows_from_step(self):
        steps = [
            {
                "flow": "contract GET /pets",
                "status": "pass",
                "detail": {
                    "kind": "contract",
                    "method": "GET",
                    "path": "/pets",
                    "operation_id": "listPets",
                    "expected_status": [200, 201],
                    "status_code": 200,
                    "status": "pass",
                    "skip_auth": False,
                },
            }
        ]
        rows = build_api_qa_rows(steps, base_url="https://api.example")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["TC ID"], "API-TC-001")
        self.assertIn("Contract", rows[0]["Feature"])
        self.assertIn("GET", rows[0]["Test Steps"])
        self.assertIn("200", rows[0]["Expected Result"])
        self.assertIn("Pass", rows[0]["Actual Result"])
        self.assertEqual(rows[0]["Priority"], "Medium")
        self.assertIn("https://api.example", rows[0]["Preconditions"])

    def test_observations_with_failure(self):
        insights = {
            "primary_root_cause": "Auth missing",
            "primary_solution": "Send Bearer token",
            "themes": [
                {
                    "title": "401 Unauthorized",
                    "root_cause": "No token",
                    "solution": "Add Authorization header",
                    "count": 2,
                }
            ],
            "failures": [{"endpoint": "GET /secure"}],
        }
        obs, rec = build_api_observations(insights)
        self.assertTrue(any("Auth missing" in o or "401" in o for o in obs))
        self.assertTrue(any("Bearer" in r or "Authorization" in r for r in rec))

    def test_observations_clean_suite(self):
        obs, rec = build_api_observations({"failures": [], "themes": []})
        self.assertTrue(obs)
        self.assertTrue(rec)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

Run: `cd backend && .venv/bin/python -m unittest tests.test_qa_report -v`  
Expected: ImportError / FAIL

- [ ] **Step 3: Implement `qa_report.py`**

Create `backend/app/api_test/qa_report.py`:

```python
from __future__ import annotations

from typing import Any

from .allure_report import SPECTRUM_LABELS  # or duplicate a small FEATURE_LABELS map to avoid cycle

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

# Prefer local labels copy to avoid import cycles with allure_report:
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
        expected = d.get("expected_status") or step.get("expected_status") or []
        if isinstance(expected, list) and expected:
            expected_s = "HTTP in [" + ", ".join(str(x) for x in expected) + "]"
        else:
            expected_s = "N/A"
        code = d.get("status_code") if d.get("status_code") is not None else step.get("status_code")
        status = str(d.get("status") or step.get("status") or "")
        executed = status != "" or code is not None
        evidence = f"HTTP {code}" if code is not None else (str(d.get("error") or step.get("error") or "").strip() or None)
        pre = [base_url.strip() or "N/A"]
        if d.get("skip_auth") or step.get("skip_auth"):
            pre.append("auth skipped")
        rows.append(
            {
                "TC ID": format_tc_id("API", i),
                "Feature": FEATURE_LABELS.get(kind, kind),
                "Test Scenario": flow if not op else f"{flow} ({op})" if op not in flow else flow,
                "Preconditions": "; ".join(pre) if pre else "N/A",
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
        if title or rc:
            obs.append(f"{title}: {rc}".strip(": ").strip())
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
```

Fix `Test Scenario` line if redundant — keep readable: prefer `f"{op}: {method} {path}"` when op present else flow.

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd backend && .venv/bin/python -m unittest tests.test_qa_report -v`  
Expected: OK

---

### Task 2: Wire API Spectrum HTML to QA template

**Files:**
- Modify: `backend/app/api_test/allure_report.py` (`write_html_report`)
- Test: extend `backend/tests/test_qa_report.py` with HTML assertion using `write_html_report`

**Interfaces:**
- Consumes: `build_api_qa_rows`, `build_api_observations`, `QA_TABLE_HEADERS` from Task 1
- Produces: `index.html` containing `Executive Summary`, table headers, `Observations & Recommendations`

- [ ] **Step 1: Add HTML integration test**

Append to `backend/tests/test_qa_report.py`:

```python
import tempfile
from pathlib import Path

from app.api_test.allure_report import write_html_report


class TestApiHtmlReport(unittest.TestCase):
    def test_html_has_qa_sections(self):
        steps = [
            {
                "flow": "security GET /admin",
                "status": "fail",
                "detail": {
                    "kind": "security",
                    "method": "GET",
                    "path": "/admin",
                    "operation_id": "admin",
                    "expected_status": [401, 403],
                    "status_code": 200,
                    "status": "fail",
                },
            }
        ]
        summary = {"passed": 0, "failed": 1, "avg_latency_ms": 12, "spectrum": {"security": 1}}
        with tempfile.TemporaryDirectory() as td:
            out = write_html_report(
                report_dir=Path(td),
                project_name="Demo",
                base_url="https://api.example",
                openapi_url="https://api.example/openapi.json",
                run_id="run-1",
                steps=steps,
                summary=summary,
                spectrum_counts={"security": 1},
            )
            html = out.read_text(encoding="utf-8")
            self.assertIn("Executive Summary", html)
            self.assertIn("Observations &amp; Recommendations", html)
            for h in (
                "TC ID",
                "Feature",
                "Test Scenario",
                "Preconditions",
                "Test Steps",
                "Expected Result",
                "Actual Result",
                "Priority",
            ):
                self.assertIn(h, html)
            self.assertIn("API-TC-001", html)
            self.assertNotIn("Failed steps (detail)", html)
            self.assertNotIn(">Flows<", html)
```

Note: assert `Observations &amp; Recommendations` **or** raw `Observations & Recommendations` depending on whether the heading is escaped — prefer unescaped heading text in template (`Observations & Recommendations`) and assert that literal.

- [ ] **Step 2: Run test — expect FAIL (old HTML)**

Run: `cd backend && .venv/bin/python -m unittest tests.test_qa_report.TestApiHtmlReport -v`  
Expected: FAIL missing Executive Summary

- [ ] **Step 3: Rewrite `write_html_report` body**

In `write_html_report`:

1. Import helpers from `.qa_report`.
2. Build `qa_rows = build_api_qa_rows(steps, base_url=base_url)`.
3. `obs, rec = build_api_observations(insights)`.
4. Render Executive Summary from `insights['headline']` + `insights['summary']` + counts from `summary`.
5. Keep optional KPI cards strip.
6. Render one QA table from `QA_TABLE_HEADERS` + `qa_rows`.
7. Render Observations & Recommendations as two `<ul>` lists.
8. Remove Failed steps table and Flows table (and theme cards section may fold into Observations — keep KPI + spectrum cards OK).

Example table fragment:

```python
    header_cells = "".join(f"<th>{_esc(h)}</th>" for h in QA_TABLE_HEADERS)
    body_rows = ""
    for r in qa_rows:
        tds = "".join(f"<td>{_esc(r.get(h, ''))}</td>" for h in QA_TABLE_HEADERS)
        body_rows += f"<tr>{tds}</tr>"
    if not body_rows:
        body_rows = f"<tr><td colspan='{len(QA_TABLE_HEADERS)}' class='muted'>No test cases.</td></tr>"

    obs_html = "".join(f"<li>{_esc(x)}</li>" for x in obs) or "<li>None</li>"
    rec_html = "".join(f"<li>{_esc(x)}</li>" for x in rec) or "<li>None</li>"
```

Main body outline:

```html
  <h2>Executive Summary</h2>
  <div class="banner ...">...</div>
  <!-- optional KPI grid -->
  <h2>Test Cases</h2>
  <table>...</table>
  <h2>Observations & Recommendations</h2>
  <div class="two">
    <div class="panel"><h3>Observations</h3><ul>...</ul></div>
    <div class="panel"><h3>Recommendations</h3><ul>...</ul></div>
  </div>
```

- [ ] **Step 4: Run all qa_report tests — PASS**

Run: `cd backend && .venv/bin/python -m unittest tests.test_qa_report -v`  
Expected: OK

---

### Task 3: AgentBrowser `qaReport.ts` + Vitest

**Files:**
- Create: `frontend/src/qaReport.ts`
- Create: `frontend/src/qaReport.test.ts`
- Modify: `frontend/package.json` (add vitest + script)
- Create/Modify: `frontend/vite.config.ts` (test config if needed)

**Interfaces:**
- Consumes: `ReportStep` type from `messageExport.ts` (import type) **or** define a minimal local `AgentReportStep` shape matching `ReportStep` to avoid circular imports — prefer moving `ReportStep` type into `qaReport.ts` and re-export from `messageExport.ts`, OR keep `ReportStep` in messageExport and accept `ReportStep[]` in qaReport.
- Produces:
  - `export const QA_TABLE_HEADERS = [...] as const`
  - `export function formatTcId(prefix: string, index: number): string`
  - `export function agentPriority(hasError: boolean): 'High' | 'Medium'`
  - `export function actualResultFromEvidence(opts: { executed: boolean; error?: string; detail?: string }): string`
  - `export function buildAgentQaRows(steps: ReportStep[], opts?: { taskTheme?: string; startUrl?: string }): Record<string, string>[]`
  - `export function buildAgentObservations(steps: ReportStep[]): { observations: string[]; recommendations: string[] }`
  - `export function renderQaTableHtml(rows: Record<string, string>[]): string`
  - `export function renderObservationsHtml(obs: string[], rec: string[]): string`

- [ ] **Step 1: Add Vitest**

In `frontend/package.json` add devDependency `vitest` and script `"test": "vitest run"`.

In `frontend/vite.config.ts` ensure:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node' },
  // ...existing server/proxy config unchanged
})
```

Run: `cd frontend && npm install -D vitest`

- [ ] **Step 2: Write failing tests**

Create `frontend/src/qaReport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  QA_TABLE_HEADERS,
  actualResultFromEvidence,
  agentPriority,
  buildAgentObservations,
  buildAgentQaRows,
  formatTcId,
  renderQaTableHtml,
} from './qaReport'

describe('qaReport', () => {
  it('headers', () => {
    expect([...QA_TABLE_HEADERS]).toEqual([
      'TC ID',
      'Feature',
      'Test Scenario',
      'Preconditions',
      'Test Steps',
      'Expected Result',
      'Actual Result',
      'Priority',
    ])
  })

  it('formatTcId', () => {
    expect(formatTcId('AB', 1)).toBe('AB-TC-001')
  })

  it('priority', () => {
    expect(agentPriority(true)).toBe('High')
    expect(agentPriority(false)).toBe('Medium')
  })

  it('actual result', () => {
    expect(actualResultFromEvidence({ executed: false })).toBe('Not executed')
    expect(actualResultFromEvidence({ executed: true, error: 'timeout' })).toBe('Fail — timeout')
    expect(actualResultFromEvidence({ executed: true, detail: 'clicked submit' })).toBe(
      'Pass — clicked submit',
    )
    expect(actualResultFromEvidence({ executed: true })).toBe('N/A')
  })

  it('builds rows from steps with actions', () => {
    const rows = buildAgentQaRows(
      [
        {
          step: 1,
          url: 'https://app.example/login',
          thought: 'Open login',
          actions: ['Navigate — https://app.example/login', 'Click — #submit'],
          details: [],
        },
      ],
      { startUrl: 'https://app.example/', taskTheme: 'Login flow' },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]['TC ID']).toBe('AB-TC-001')
    expect(rows[0].Feature).toMatch(/app\.example|Login/)
    expect(rows[0]['Test Steps']).toMatch(/Navigate|Click/)
    expect(rows[0]['Expected Result']).toBe('As specified in prompt')
    expect(rows[0].Priority).toBe('Medium')
  })

  it('skips steps with no actions and no screenshot', () => {
    const rows = buildAgentQaRows([{ step: 1, actions: [], details: [], thought: 'thinking only' }])
    expect(rows).toHaveLength(0)
  })

  it('render table includes headers', () => {
    const html = renderQaTableHtml([
      {
        'TC ID': 'AB-TC-001',
        Feature: 'x',
        'Test Scenario': 'y',
        Preconditions: 'N/A',
        'Test Steps': 'click',
        'Expected Result': 'As specified in prompt',
        'Actual Result': 'Pass — ok',
        Priority: 'Medium',
      },
    ])
    expect(html).toContain('TC ID')
    expect(html).toContain('AB-TC-001')
  })

  it('observations on error', () => {
    const { observations, recommendations } = buildAgentObservations([
      {
        step: 2,
        actions: ['Click — #x'],
        details: ['error: not found'],
        thought: 'Click button',
      },
    ])
    expect(observations.length).toBeGreaterThan(0)
    expect(recommendations.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run tests — FAIL**

Run: `cd frontend && npm test`  
Expected: FAIL cannot find module / functions

- [ ] **Step 4: Implement `frontend/src/qaReport.ts`**

Implement helpers per Interfaces. Error detection: `details` or `actions` containing `/error:/i` or thought starting with Failed. Hostname Feature: `try { new URL(url).hostname } catch { taskTheme || 'Browser' }`. Include step if `actions.length > 0 || screenshotPath || screenshotDataUrl`.

- [ ] **Step 5: Run tests — PASS**

Run: `cd frontend && npm test`  
Expected: all PASS

---

### Task 4: Wire AgentBrowser HTML export + agent report guidance

**Files:**
- Modify: `frontend/src/messageExport.ts` (`buildHtmlDocument`)
- Modify: `backend/app/response_style.py`
- Test: extend frontend test to call `buildHtmlDocument` if exported; else assert via string builder already covered + one integration-style test importing `buildHtmlDocument`

**Interfaces:**
- Consumes: Task 3 render helpers + `ReportStep[]` already passed into export meta
- Produces: HTML with `Executive Summary`, QA table, `Observations & Recommendations`

- [ ] **Step 1: Failing test for document sections**

In `qaReport.test.ts` (or new file), if `buildHtmlDocument` is exported from `messageExport.ts`:

```ts
import { buildHtmlDocument } from './messageExport'

it('buildHtmlDocument uses QA sections', () => {
  const html = buildHtmlDocument('## Done\nAll good', {
    title: 't',
    username: 'u',
    prompt: 'p',
    timestamp: 'now',
    steps: [
      {
        step: 1,
        url: 'https://example.com',
        actions: ['Click — #a'],
        details: [],
        thought: 'Click A',
      },
    ],
  })
  expect(html).toContain('Executive Summary')
  expect(html).toContain('Observations & Recommendations')
  expect(html).toContain('AB-TC-001')
  expect(html).not.toContain('<h2>Summary</h2>')
})
```

Export `buildHtmlDocument` if it is not already exported.

- [ ] **Step 2: Run — FAIL on old Summary heading**

- [ ] **Step 3: Update `buildHtmlDocument`**

Replace main body:

```html
  <h2>Executive Summary</h2>
  ${body}
  <h2>Test Cases</h2>
  ${qaTableHtml}
  <h2>Observations & Recommendations</h2>
  ${observationsHtml}
```

Where `qaTableHtml` / `observationsHtml` come from `buildAgentQaRows` + `buildAgentObservations` + render helpers. Keep optional detailed step cards **out** (YAGNI) unless screenshots are required — spec prefers the QA table; screenshots can remain as a collapsed appendix only if already easy. **Decision:** omit old step-card gallery from the primary report to avoid duplication; screenshots remain available in Artifacts.

If removing screenshots from export is too large a product change, append a small “Evidence” section after Observations with existing step shots — acceptable. Prefer Evidence appendix if `steps` have `screenshotDataUrl`.

- [ ] **Step 4: Add report guidance to `response_style.py`**

Append a section to `RESPONSE_STYLE_MESSAGE`:

```text
## Test reports (when writing report.html / markdown test reports)

Use this structure:
1. Executive Summary
2. Test cases table with columns exactly:
   TC ID | Feature | Test Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Priority
3. Observations & Recommendations

Fill Actual Result from what you observed; use "Not executed" or "N/A" when unknown.
Use TC IDs like AB-TC-001. Do not invent outcomes you did not see.
```

- [ ] **Step 5: Run frontend tests + backend qa tests**

```bash
cd frontend && npm test
cd backend && .venv/bin/python -m unittest tests.test_qa_report -v
```

Expected: all PASS

---

## Spec coverage check

| Spec item | Task |
|-----------|------|
| Shared columns / Actual Result / Priority rules | 1, 3 |
| API HTML Executive Summary + table + Observations | 2 |
| AgentBrowser HTML/PDF same sections | 4 |
| Agent `report.html` guidance | 4 |
| Preserve Allure sidecars | 2 (unchanged writers) |
| No Excel / no new LLM polish | — |
| Tests for helpers + HTML headings | 1–4 |

## Self-review notes

- No placeholders left.
- Avoid importing `SPECTRUM_LABELS` from `allure_report` into `qa_report` (cycle risk) — local `FEATURE_LABELS`.
- Vitest added only because the repo has no frontend test runner today.
- Commits omitted unless user asks.
