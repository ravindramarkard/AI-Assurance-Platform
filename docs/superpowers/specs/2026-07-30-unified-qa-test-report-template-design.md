# Unified QA test report template

**Date:** 2026-07-30  
**Status:** Draft for user review  
**Goal:** AgentBrowser session exports and API Spectrum HTML reports share one QA report structure: Executive Summary, a fixed test-case table, and Observations & Recommendations.

## Decisions (locked)

| Topic | Choice |
|--------|--------|
| Scope | **C** — both AgentBrowser and API Spectrum |
| Actual Result | **A** — always from run evidence; missing → `Not executed` / `N/A` |
| Priority | **A** — map from spectrum/severity (not blank, not failure-only) |
| Approach | **1** — shared report contract + two adapters |

## Document structure (canonical)

1. **Header** — product name, project/session id, timestamp, target (URL or OpenAPI)
2. **Executive Summary** — verdict + passed/failed/not-executed counts + short overview (2–4 sentences)
3. **Test cases table** — columns **exactly**:

   | TC ID | Feature | Test Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Priority |

4. **Observations & Recommendations** — bullet observations + actionable recommendations
5. **Footer** — product branding

Optional under Executive Summary for API only: existing KPI cards (passed, failed, pass rate, latency, self-healed) may remain as a compact strip; they do not replace the summary section.

## Column rules (both pipelines)

| Column | Rule |
|--------|------|
| TC ID | Stable per-row id: `API-TC-{nnn}` or `AB-TC-{nnn}` (1-based, zero-padded to 3) |
| Feature | API: spectrum layer label. Agent: page host / task theme |
| Test Scenario | Short name of what is being verified |
| Preconditions | Auth, base URL, required vars, or prior context; else `N/A` |
| Test Steps | Concrete actions (method+path or click/type/navigate list) |
| Expected Result | Expected status codes / success criteria; Agent may use `As specified in prompt` when unknown |
| Actual Result | From run evidence; else `Not executed` or `N/A` |
| Priority | Mapped (see below) |

### Priority mapping

**API Spectrum (`kind`):**

| kind | Priority |
|------|----------|
| `security` | High |
| `contract`, `e2e` | Medium |
| `edge`, `negative`, `load` | Low |
| unknown | Medium |

**AgentBrowser:**

| Condition | Priority |
|-----------|----------|
| Step has error / failed action | High |
| Otherwise | Medium |

## Adapter: API Spectrum

**Touchpoints:** `backend/app/api_test/allure_report.py`, optionally `insights.py` for summary/observations copy.

**Row grain:** one table row per executed (or planned) flow step when step detail exists; otherwise one row per flow.

**Field mapping:**

- **TC ID:** `API-TC-{nnn}`
- **Feature:** spectrum label (Contract, E2E, Edge, Negative, Security, Load)
- **Test Scenario:** flow name + operation summary / `operation_id`
- **Preconditions:** base URL; note auth skipped if `skip_auth`; else `N/A` extras as needed
- **Test Steps:** `{METHOD} {path}` (+ brief body/kind note if useful)
- **Expected Result:** `expected_status` list rendered as e.g. `HTTP in [200, 201, …]`
- **Actual Result:** observed status + Pass/Fail text; skipped → `Not executed`
- **Priority:** from `kind` table above

**Executive Summary:** reuse insights headline + summary; lead with pass/fail counts.

**Observations & Recommendations:** map failure themes / primary root cause → Observations; primary solutions + theme solutions → Recommendations. If no failures: observation that suite passed; recommendation to retain coverage / watch flaky signals if any.

**Preserve:** Allure JSON sidecars and download paths. Legacy “Failed steps” / “Flows” tables may be removed or collapsed so the QA table is the primary detail view (prefer single QA table to avoid duplication).

## Adapter: AgentBrowser

**Touchpoints:**

- `frontend/src/messageExport.ts` — HTML/PDF export template (`buildHtmlDocument` / steps)
- `frontend/src/components/MessageActions.tsx` — no UX change beyond content shape
- `backend/app/response_style.py` (or adjacent guidance) — when writing `report.html` / markdown test reports, require the same section + table columns

**Row grain:** one row per agent step that includes browser actions and/or a screenshot/outcome; pure chat-only sessions may produce an empty table with Executive Summary stating no browser cases executed.

**Field mapping:**

- **TC ID:** `AB-TC-{nnn}`
- **Feature:** hostname from step URL, or truncated task theme
- **Test Scenario:** step title / thought (truncated, no secrets)
- **Preconditions:** session start URL or previous step URL; else `N/A`
- **Test Steps:** action list from the step
- **Expected Result:** `As specified in prompt` unless step payload states an expectation
- **Actual Result:** success / error excerpt from step results; missing → `Not executed`
- **Priority:** error → High; else Medium

**Executive Summary:** replace the current lone “Summary” heading; body remains markdown→HTML of the assistant message (or a short derived blurb if empty).

**Observations & Recommendations:** v1 rule-based from step errors and unfinished status (e.g. list failed steps; recommend re-run / fix selectors). No new LLM call required for v1.

**Agent-written `report.html`:** system guidance must instruct the same outline and column headers so Artifacts open with a compatible document. Platform export remains the guaranteed shape for Copy → HTML/PDF.

## Out of scope

- Changing Allure raw result schema beyond what HTML needs
- New LLM polish endpoint for AgentBrowser Observations (API may keep existing optional `ai_polish_insights`)
- Excel/CSV export
- Redesigning unrelated chat UI
- Backfilling old reports already on disk

## Success criteria

- API Spectrum `index.html` shows Executive Summary, the 8-column table, and Observations & Recommendations.
- AgentBrowser HTML/PDF export shows the same three sections and columns.
- Actual Result never left blank (evidence or `Not executed` / `N/A`).
- Priority always filled via the mapping tables.
- TC IDs unique and sequential within a report.

## Testing

- Unit/helpers: priority mapping; Actual Result fallback; TC ID formatting.
- API: build HTML from a tiny fixture run → assert section headings and table headers.
- Frontend: build HTML from fixture events/content → assert headings and column headers.
