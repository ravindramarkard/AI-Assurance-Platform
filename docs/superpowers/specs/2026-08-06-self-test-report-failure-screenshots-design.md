# Self-test-style report + failure screenshots for bug raise

**Date:** 2026-08-06  
**Status:** Approved  
**Goal:** AgentBrowser HTML/PDF exports match the self-test report shell (header fields + executive summary counts) while keeping the 8-column QA table; Evidence shows **failed-step screenshots only**. When logging a Jira bug from a session, attach those failure PNGs to the issue.

## Decisions (locked)

| Topic | Choice |
|--------|--------|
| Scope | **C** — both report export and Jira bug raise |
| QA table | **A** — keep 8-column unified QA table; add self-test-style shell |
| Jira evidence | **A** — attach PNG files (not description image URLs) |
| Implementation approach | **1** — extend existing HTML export + Log Issue / `create_jira_issue` |

## Reference

Style inspiration: `frontend/AI_Assistant_Self_Test_Report.pdf` (header field block, executive summary with counts, evidence-oriented detail). This work does **not** regenerate that static PDF; it reshapes live AgentBrowser session reports.

## Document structure (AgentBrowser HTML/PDF)

1. **Header (self-test field block)** — Field / Value table:
   - Project — session title or `AgentBrowser`
   - Document — `Functional Test Report`
   - Author — `AgentBrowser` (or export username when present)
   - Date — export timestamp
   - Total Test Cases — count of QA table rows
   - Target — start / current URL when known
2. **Executive Summary** — verdict + passed / failed / not-executed counts derived from QA rows (`Actual Result` Pass/Fail/Not executed); short overview (existing assistant markdown body, 2–4 sentences when long)
3. **Test cases table** — unchanged columns:

   | TC ID | Feature | Test Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Priority |

4. **Evidence — Failed steps** — screenshots **only** for steps classified as failed that have an embedded `screenshotDataUrl` (or fetchable path). Caption: step number + truncated thought/error. If none: omit section or show “No failure screenshots captured.”
5. **Observations & Recommendations** — existing rule-based lists
6. **Footer** — existing product branding

### Evidence rules

| Rule | Detail |
|------|--------|
| Failure classification | Same as QA row / `stepHasError` (error/fail signals in thought, actions, details) |
| Include | Failed steps with screenshot data/path |
| Exclude | Passed steps; failed steps with no shot |
| Detailed steps section | **Keep** existing detailed step cards unchanged (including any pass screenshots). Only the **Evidence** appendix is failure-only (no change to Excel). |

### Counts

- **Passed** — Actual Result starts with `Pass`
- **Failed** — Actual Result starts with `Fail`
- **Not executed** — `Not executed` / empty suite
- Verdict: `PASS` if failed=0 and passed>0; `FAIL` if failed>0; `N/A` if no rows

## Adapter: Jira attach failure PNGs

**Touchpoints:**

- `backend/app/atlassian.py` — add `attach_jira_file` (mirror Confluence attach pattern; Jira requires `X-Atlassian-Token: no-check`)
- `backend/app/routes/integrations.py` — after successful `create_jira_issue` with `session_id`, resolve and attach failure screenshots
- `backend/app/screenshot_archive.py` (or small helper) — list failed-step screenshot paths from session events / workspace
- `frontend/src/components/LogIssueModal.tsx` — hint that failed-step screenshots will be attached when available
- Optional i18n string for the hint

**Flow:**

```
Log Issue (Jira) + session_id
  → create_jira_issue (text description as today)
  → collect failed-step PNG paths (cap 5, prefer most recent failures)
  → for each file: attach_jira_file(issue_key, path)
  → return issue result + attachments summary (attached / skipped / errors)
```

**Attachment selection:**

| Rule | Detail |
|------|--------|
| Source | Session step events with failure + screenshot filename under session workspace (`screenshots/…`) |
| Cap | Max **5** PNGs; if more failures, take the **last** 5 failed with files |
| Missing file | Skip; do not fail issue create |
| Attach API failure | Log warning; issue remains created; surface partial success in API/event payload |
| Naming | Prefer `step_{n}_fail.png` or original filename so Jira lists are readable |

**UI:**

- Log Issue modal (Jira tab): short muted hint when integrations ready — e.g. “Failed step screenshots will be attached when available.”
- No new required fields; Confluence path unchanged (no PNG attach in this spec)

## Out of scope

- Regenerating or editing `frontend/AI_Assistant_Self_Test_Report.pdf`
- Changing Excel/CSV column set
- Confluence PNG attach for failures
- Embedding platform screenshot URLs in Jira description instead of file attach
- LLM-polished Observations for AgentBrowser
- Raising bugs automatically without user opening Log Issue

## Success criteria

- HTML/PDF preview shows self-test-style header fields + executive summary counts + 8-column QA table + failure-only Evidence screenshots when present
- Creating a Jira bug from a session with failed-step PNGs results in those files attached on the issue (up to 5)
- Issue create still succeeds if no screenshots or attach fails
- Existing pass/fail QA row logic and screenshot archive modes remain compatible (`on_failure` archives are the primary source for attaches)

## Touchpoints (report)

- `frontend/src/qaReport.ts` — failure-only `renderEvidenceHtml`; optional pass/fail/not-executed count helpers
- `frontend/src/messageExport.ts` — header field block + executive summary counts in `buildHtmlDocument`
- `frontend/src/qaReport.test.ts` / export tests — Evidence filters failures; counts
