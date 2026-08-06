# Self-test Report + Failure Screenshots for Bug Raise — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape AgentBrowser HTML/PDF exports to a self-test-style header + executive summary counts (keep 8-column QA table; Evidence = failed-step screenshots only), and attach those failure PNGs when logging a Jira bug from a session.

**Architecture:** Frontend pure helpers in `qaReport.ts` drive counts + failure-filtered Evidence; `messageExport.ts` renders the self-test field block. Backend reuses `step_looks_failed`, collects session `screenshots/*.png` for failed steps, and uploads via new `attach_jira_file` after issue create.

**Tech Stack:** TypeScript / Vitest (frontend), Python 3 / unittest + httpx (backend Atlassian), existing Log Issue modal / integrations route

## Global Constraints

- Keep QA columns exactly: `TC ID | Feature | Test Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Priority`
- Evidence appendix: **failed steps only** (with screenshot); Detailed steps section unchanged
- Jira: attach PNG files (max **5**, last failures preferred); never fail issue create on attach errors
- Do not regenerate `frontend/AI_Assistant_Self_Test_Report.pdf`
- Do not change Excel columns or Confluence PNG attach
- Do not commit unless the user explicitly asks

---

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/qaReport.ts` | Pass/fail/not-executed counts + verdict; failure-only Evidence HTML |
| `frontend/src/qaReport.test.ts` | Vitest for counts + Evidence filter |
| `frontend/src/messageExport.ts` | Self-test header fields + summary counts strip in HTML |
| `backend/app/screenshot_archive.py` | `collect_failed_screenshot_files` from step events + disk |
| `backend/tests/test_screenshot_archive.py` | Unit tests for collector |
| `backend/app/atlassian.py` | `attach_jira_file` multipart upload |
| `backend/tests/test_jira_attach.py` | Unit tests for attach helper (mocked httpx) |
| `backend/app/routes/integrations.py` | After create issue, attach collected PNGs |
| `frontend/src/components/LogIssueModal.tsx` | Hint copy for failure screenshot attach |
| `frontend/src/i18n/locales/{en,ar,hi}.ts` | i18n string for hint |

---

### Task 1: QA counts + failure-only Evidence

**Files:**
- Modify: `frontend/src/qaReport.ts`
- Modify: `frontend/src/qaReport.test.ts`

**Interfaces:**
- Produces:
  - `export type QaCounts = { passed: number; failed: number; notExecuted: number; total: number; verdict: 'PASS' | 'FAIL' | 'N/A' }`
  - `export function summarizeQaRows(rows: Record<string, string>[]): QaCounts`
  - `export function renderEvidenceHtml(steps: AgentReportStep[]): string` — **failed + screenshot only**; heading `Evidence — Failed steps`; empty → `''` (omit section)
- Consumes: existing `AgentReportStep`, private `stepHasError`, `truncate`, `escapeHtml`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/qaReport.test.ts`:

```typescript
import {
  // ...existing imports...
  summarizeQaRows,
  renderEvidenceHtml,
} from './qaReport'

describe('summarizeQaRows', () => {
  it('counts pass fail not-executed and verdict', () => {
    const rows = [
      { 'Actual Result': 'Pass — ok' },
      { 'Actual Result': 'Fail — timeout' },
      { 'Actual Result': 'Not executed' },
    ] as Record<string, string>[]
    expect(summarizeQaRows(rows)).toEqual({
      passed: 1,
      failed: 1,
      notExecuted: 1,
      total: 3,
      verdict: 'FAIL',
    })
  })

  it('PASS when only passes', () => {
    expect(summarizeQaRows([{ 'Actual Result': 'Pass — x' } as Record<string, string>]).verdict).toBe(
      'PASS',
    )
  })

  it('N/A when empty', () => {
    expect(summarizeQaRows([]).verdict).toBe('N/A')
  })
})

describe('renderEvidenceHtml', () => {
  it('includes only failed steps with screenshots', () => {
    const html = renderEvidenceHtml([
      {
        step: 1,
        actions: ['Click — ok'],
        details: [],
        thought: 'ok',
        screenshotDataUrl: 'data:image/png;base64,AAA',
      },
      {
        step: 2,
        actions: ['error: boom'],
        details: [],
        thought: 'Failed.',
        screenshotDataUrl: 'data:image/png;base64,BBB',
      },
      {
        step: 3,
        actions: ['error: missing shot'],
        details: [],
        thought: 'Failed.',
      },
    ])
    expect(html).toContain('Evidence — Failed steps')
    expect(html).toContain('data:image/png;base64,BBB')
    expect(html).not.toContain('data:image/png;base64,AAA')
    expect(html).toMatch(/Step 2/)
  })

  it('returns empty when no failure screenshots', () => {
    expect(
      renderEvidenceHtml([
        { step: 1, actions: ['Click'], details: [], screenshotDataUrl: 'data:image/png;base64,AAA' },
      ]),
    ).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- --run src/qaReport.test.ts`

Expected: FAIL — `summarizeQaRows` not exported / Evidence still includes all shots

- [ ] **Step 3: Implement helpers**

In `frontend/src/qaReport.ts`:

1. Add `summarizeQaRows`:

```typescript
export type QaCounts = {
  passed: number
  failed: number
  notExecuted: number
  total: number
  verdict: 'PASS' | 'FAIL' | 'N/A'
}

export function summarizeQaRows(rows: Record<string, string>[]): QaCounts {
  let passed = 0
  let failed = 0
  let notExecuted = 0
  for (const r of rows || []) {
    const a = (r['Actual Result'] || '').trim()
    if (/^pass\b/i.test(a)) passed += 1
    else if (/^fail\b/i.test(a)) failed += 1
    else if (/^not executed$/i.test(a)) notExecuted += 1
  }
  const total = (rows || []).length
  let verdict: QaCounts['verdict'] = 'N/A'
  if (failed > 0) verdict = 'FAIL'
  else if (passed > 0) verdict = 'PASS'
  return { passed, failed, notExecuted, total, verdict }
}
```

2. Replace `renderEvidenceHtml` body to filter with `stepHasError(s) && s.screenshotDataUrl`, use heading `Evidence — Failed steps`, return `''` when none.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- --run src/qaReport.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (only if user asked)

```bash
git add frontend/src/qaReport.ts frontend/src/qaReport.test.ts
git commit -m "feat: failure-only evidence and QA summary counts"
```

---

### Task 2: Self-test header + executive summary strip in HTML export

**Files:**
- Modify: `frontend/src/messageExport.ts` (`buildHtmlDocument`)
- Modify: `frontend/src/qaReport.test.ts` (existing `buildHtmlDocument uses QA sections` test)

**Interfaces:**
- Consumes: `summarizeQaRows`, `renderEvidenceHtml` from Task 1
- Produces: HTML with Field/Value rows: Project, Document, Author, Date, Total Test Cases, Target; executive summary counts strip before body

- [ ] **Step 1: Extend failing assertion**

In `frontend/src/qaReport.test.ts`, update the `buildHtmlDocument uses QA sections` test (or add):

```typescript
  it('buildHtmlDocument self-test header and failure evidence', () => {
    const html = buildHtmlDocument('## Done\nAll good', {
      title: 'Login check',
      username: 'qa',
      prompt: 'Test login',
      timestamp: '2026-08-06',
      steps: [
        {
          step: 1,
          url: 'https://app.example/login',
          thought: 'Failed. button missing',
          actions: ['error: selector'],
          details: [],
          screenshotDataUrl: 'data:image/png;base64,FAILSHOT',
        },
      ],
    })
    expect(html).toContain('Functional Test Report')
    expect(html).toContain('Total Test Cases')
    expect(html).toMatch(/Verdict|FAIL/)
    expect(html).toContain('Evidence — Failed steps')
    expect(html).toContain('FAILSHOT')
    expect(html).toContain('TC ID')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run src/qaReport.test.ts`

Expected: FAIL — missing Functional Test Report / verdict strip

- [ ] **Step 3: Update `buildHtmlDocument`**

In `frontend/src/messageExport.ts`:

1. Import `summarizeQaRows`.
2. After `qaRows` / evidence:

```typescript
  const counts = summarizeQaRows(qaRows)
  const targetUrl = steps.find((s) => s.url)?.url || ''
  const author = username !== 'Unknown' ? username : 'AgentBrowser'
```

3. Replace meta-table rows (Title/User/Prompt/Timestamp) with self-test fields:

| Field | Value |
|-------|--------|
| Project | `title` |
| Document | `Functional Test Report` |
| Author | `author` |
| Date | `timestamp` |
| Total Test Cases | `String(counts.total)` |
| Target | `targetUrl || '—'` |
| Prompt | keep prompt row (useful context) — optional; **include Prompt** as extra row under Target |

4. Under `<h2>Executive Summary</h2>`, insert a counts strip **before** `${body}`:

```html
<p><strong>Verdict:</strong> ${counts.verdict}
 · Passed: ${counts.passed}
 · Failed: ${counts.failed}
 · Not executed: ${counts.notExecuted}</p>
```

5. Keep Test Cases / Observations / `${evidenceHtml}` / Detailed steps as today.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm test -- --run src/qaReport.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (only if user asked)

```bash
git add frontend/src/messageExport.ts frontend/src/qaReport.test.ts
git commit -m "feat: self-test-style header and summary counts in report export"
```

---

### Task 3: Collect failed screenshot files (backend)

**Files:**
- Modify: `backend/app/screenshot_archive.py`
- Modify: `backend/tests/test_screenshot_archive.py`

**Interfaces:**
- Produces:
  - `def collect_failed_screenshot_files(events: list[dict], session_root: Path, *, max_files: int = 5) -> list[Path]`
  - Returns existing files only; order = chronological failed-with-file; if more than `max_files`, return the **last** `max_files`
  - Skips `screenshots/latest.png` when a numbered `step_*.png` / `live_*.png` exists for that step; if screenshot field is only `latest.png`, include it once (last occurrence wins via path set → prefer keeping last failed latest as fallback only when no numbered file)

Prefer simpler rule:

```python
# For each step event in order:
#   if not step_looks_failed(...): continue
#   rel = payload.get("screenshot")  # e.g. screenshots/step_0003.png
#   if not rel or not isinstance(rel, str): continue
#   clean = rel.replace("\\", "/").lstrip("/")
#   if clean == "screenshots/latest.png":
#       continue  # skip live-only pointer unless no other shot this step — YAGNI: always skip latest.png
#   path = (session_root / clean).resolve()
#   if path.is_file() and path.suffix.lower() == ".png":
#       accumulate
# return last max_files
```

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_screenshot_archive.py`:

```python
from pathlib import Path
import tempfile

from app.screenshot_archive import collect_failed_screenshot_files


class TestCollectFailedScreenshots(unittest.TestCase):
    def test_collects_last_failed_pngs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shots = root / "screenshots"
            shots.mkdir()
            for name in ("step_0001.png", "step_0002.png", "step_0003.png"):
                (shots / name).write_bytes(b"\x89PNG")
            events = [
                {
                    "type": "step",
                    "payload": {
                        "actions": ["Click ok"],
                        "thought": "ok",
                        "screenshot": "screenshots/step_0001.png",
                    },
                },
                {
                    "type": "step",
                    "payload": {
                        "actions": ["error: a"],
                        "thought": "Failed.",
                        "screenshot": "screenshots/step_0002.png",
                    },
                },
                {
                    "type": "step",
                    "payload": {
                        "actions": ["error: b"],
                        "thought": "Failed.",
                        "screenshot": "screenshots/step_0003.png",
                    },
                },
            ]
            got = collect_failed_screenshot_files(events, root, max_files=5)
            self.assertEqual([p.name for p in got], ["step_0002.png", "step_0003.png"])

    def test_caps_to_last_five(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shots = root / "screenshots"
            shots.mkdir()
            events = []
            for i in range(1, 8):
                name = f"step_{i:04d}.png"
                (shots / name).write_bytes(b"x")
                events.append(
                    {
                        "type": "step",
                        "payload": {
                            "actions": ["error: x"],
                            "thought": "Failed.",
                            "screenshot": f"screenshots/{name}",
                        },
                    }
                )
            got = collect_failed_screenshot_files(events, root, max_files=5)
            self.assertEqual(len(got), 5)
            self.assertEqual(got[0].name, "step_0003.png")
            self.assertEqual(got[-1].name, "step_0007.png")

    def test_skips_missing_and_latest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "screenshots").mkdir()
            events = [
                {
                    "type": "step",
                    "payload": {
                        "actions": ["error: x"],
                        "thought": "Failed.",
                        "screenshot": "screenshots/latest.png",
                    },
                },
                {
                    "type": "step",
                    "payload": {
                        "actions": ["error: y"],
                        "thought": "Failed.",
                        "screenshot": "screenshots/missing.png",
                    },
                },
            ]
            self.assertEqual(collect_failed_screenshot_files(events, root), [])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m unittest tests.test_screenshot_archive.TestCollectFailedScreenshots -v`

Expected: FAIL — `collect_failed_screenshot_files` missing

- [ ] **Step 3: Implement collector**

Add to `backend/app/screenshot_archive.py`:

```python
from pathlib import Path


def collect_failed_screenshot_files(
    events: list[dict[str, Any]] | None,
    session_root: Path,
    *,
    max_files: int = 5,
) -> list[Path]:
    root = Path(session_root)
    found: list[Path] = []
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "step":
            continue
        payload = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
        actions = payload.get("actions")
        action_list = [str(a) for a in actions] if isinstance(actions, list) else []
        thought = payload.get("thought")
        thought_s = thought if isinstance(thought, str) else None
        if not step_looks_failed(actions=action_list, thought=thought_s):
            continue
        rel = payload.get("screenshot")
        if not isinstance(rel, str) or not rel.strip():
            continue
        clean = rel.replace("\\", "/").lstrip("/")
        if clean == "screenshots/latest.png" or clean.endswith("/latest.png"):
            continue
        path = (root / clean).resolve()
        try:
            path.relative_to(root.resolve())
        except ValueError:
            continue
        if path.is_file() and path.suffix.lower() == ".png":
            found.append(path)
    cap = max(1, min(int(max_files or 5), 20))
    return found[-cap:]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m unittest tests.test_screenshot_archive -v`

Expected: PASS

- [ ] **Step 5: Commit** (only if user asked)

```bash
git add backend/app/screenshot_archive.py backend/tests/test_screenshot_archive.py
git commit -m "feat: collect failed step screenshot files for bug evidence"
```

---

### Task 4: `attach_jira_file`

**Files:**
- Modify: `backend/app/atlassian.py`
- Create: `backend/tests/test_jira_attach.py`

**Interfaces:**
- Produces:
  - `async def attach_jira_file(*, base_url, username, token, issue_key, filename, content: bytes, deployment: Deployment = "server", content_type: str = "image/png") -> dict[str, Any]`
  - POST `{jira_api_root}/issue/{key}/attachments` with `X-Atlassian-Token: no-check` (same pattern as `attach_confluence_file`)

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_jira_attach.py`:

```python
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app import atlassian


class TestAttachJiraFile(unittest.IsolatedAsyncioTestCase):
    async def test_attach_posts_multipart(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = b'[{"filename":"step_0001_fail.png"}]'
        mock_resp.json.return_value = [{"filename": "step_0001_fail.png", "id": "1"}]
        mock_resp.text = "ok"

        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = None
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("app.atlassian.httpx.AsyncClient", return_value=mock_client):
            result = await atlassian.attach_jira_file(
                base_url="https://jira.example",
                username="u",
                token="t",
                issue_key="AB-1",
                filename="step_0001_fail.png",
                content=b"\x89PNG",
                deployment="server",
            )
        self.assertTrue(result["ok"])
        self.assertEqual(result["issue_key"], "AB-1")
        mock_client.post.assert_awaited()
        args, kwargs = mock_client.post.await_args
        self.assertIn("/issue/AB-1/attachments", args[0])
        self.assertEqual(kwargs["headers"].get("X-Atlassian-Token"), "no-check")
        self.assertIn("file", kwargs["files"])

    async def test_attach_requires_key_and_bytes(self):
        with self.assertRaises(ValueError):
            await atlassian.attach_jira_file(
                base_url="https://jira.example",
                username="u",
                token="t",
                issue_key="",
                filename="a.png",
                content=b"x",
            )
        with self.assertRaises(ValueError):
            await atlassian.attach_jira_file(
                base_url="https://jira.example",
                username="u",
                token="t",
                issue_key="AB-1",
                filename="a.png",
                content=b"",
            )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run python -m unittest tests.test_jira_attach -v`

Expected: FAIL — `attach_jira_file` missing

- [ ] **Step 3: Implement**

Add after `create_jira_issue` in `backend/app/atlassian.py` (near Confluence attach):

```python
async def attach_jira_file(
    *,
    base_url: str,
    username: str,
    token: str,
    issue_key: str,
    filename: str,
    content: bytes,
    deployment: Deployment = "server",
    content_type: str = "image/png",
) -> dict[str, Any]:
    base = _normalize_base(base_url)
    key = (issue_key or "").strip().upper()
    if not key:
        raise ValueError("Jira issue key is required")
    if not content:
        raise ValueError("Attachment content is empty")
    root = _jira_api_root(base, deployment)
    headers = _auth_headers(username, token, deployment=deployment)
    headers.pop("Content-Type", None)
    headers["X-Atlassian-Token"] = "no-check"
    url = f"{root}/issue/{key}/attachments"
    safe_name = (filename or "evidence.png").replace("/", "_")[-120:]
    files = {"file": (safe_name, content, content_type or "image/png")}
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        resp = await client.post(url, headers=headers, files=files)
    if resp.status_code >= 400:
        raise RuntimeError(f"Atlassian API {resp.status_code}: {resp.text[:800]}")
    data = resp.json() if resp.content else {}
    first = data[0] if isinstance(data, list) and data else data
    return {
        "ok": True,
        "issue_key": key,
        "attachment_id": (first or {}).get("id") if isinstance(first, dict) else None,
        "filename": (first or {}).get("filename") if isinstance(first, dict) else safe_name,
        "deployment": deployment,
    }
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run python -m unittest tests.test_jira_attach -v`

Expected: PASS

- [ ] **Step 5: Commit** (only if user asked)

```bash
git add backend/app/atlassian.py backend/tests/test_jira_attach.py
git commit -m "feat: attach files to Jira issues"
```

---

### Task 5: Wire Jira create → attach failure PNGs

**Files:**
- Modify: `backend/app/routes/integrations.py` (`create_jira_issue` handler)
- Create: `backend/tests/test_jira_issue_attach_route.py` (unit-style with mocks) **or** extend an existing integrations test if present

**Interfaces:**
- Consumes: `collect_failed_screenshot_files`, `attach_jira_file`, `db.list_events`, `session_dir`
- Produces: issue create response includes `attachments: { attached: [...], skipped: [...], errors: [...] }` when `session_id` set

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_jira_issue_attach_route.py`:

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.routes.integrations import attach_session_failure_screenshots


class TestAttachSessionFailures(unittest.IsolatedAsyncioTestCase):
    async def test_attaches_collected_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            png = Path(tmp) / "step_0002.png"
            png.write_bytes(b"\x89PNG")
            with (
                patch(
                    "app.routes.integrations.db.list_events",
                    new_callable=AsyncMock,
                    return_value=[],
                ),
                patch(
                    "app.routes.integrations.session_dir",
                    return_value=Path(tmp),
                ),
                patch(
                    "app.routes.integrations.collect_failed_screenshot_files",
                    return_value=[png],
                ),
                patch(
                    "app.routes.integrations.atlassian.attach_jira_file",
                    new_callable=AsyncMock,
                    return_value={"ok": True, "filename": "step_0002.png"},
                ) as att,
            ):
                s = {
                    "jira_base_url": "https://jira.example",
                    "jira_api_token": "t",
                    "jira_email": "u@x",
                    "jira_auth_type": "password",
                    "atlassian_deployment": "server",
                }
                summary = await attach_session_failure_screenshots(
                    "sess1", "AB-9", s
                )
                self.assertEqual(summary["attached"], ["step_0002.png"])
                self.assertEqual(summary["errors"], [])
                att.assert_awaited()

    async def test_attach_error_does_not_raise(self):
        with tempfile.TemporaryDirectory() as tmp:
            png = Path(tmp) / "step_0002.png"
            png.write_bytes(b"\x89PNG")
            with (
                patch(
                    "app.routes.integrations.db.list_events",
                    new_callable=AsyncMock,
                    return_value=[],
                ),
                patch(
                    "app.routes.integrations.session_dir",
                    return_value=Path(tmp),
                ),
                patch(
                    "app.routes.integrations.collect_failed_screenshot_files",
                    return_value=[png],
                ),
                patch(
                    "app.routes.integrations.atlassian.attach_jira_file",
                    new_callable=AsyncMock,
                    side_effect=RuntimeError("boom"),
                ),
            ):
                s = {
                    "jira_base_url": "https://jira.example",
                    "jira_api_token": "t",
                    "jira_email": "u@x",
                    "jira_auth_type": "password",
                    "atlassian_deployment": "server",
                }
                summary = await attach_session_failure_screenshots(
                    "sess1", "AB-9", s
                )
                self.assertEqual(summary["attached"], [])
                self.assertTrue(summary["errors"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run python -m unittest tests.test_jira_issue_attach_route -v`

Expected: FAIL — `attach_session_failure_screenshots` missing

- [ ] **Step 3: Implement helper + wire route**

In `backend/app/routes/integrations.py`:

1. Imports: `session_dir` from config, `collect_failed_screenshot_files` from screenshot_archive.

2. Add:

```python
async def attach_session_failure_screenshots(
    session_id: str,
    issue_key: str,
    s: dict[str, str],
) -> dict[str, list[str]]:
    attached: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []
    try:
        events = await db.list_events(session_id)
        root = session_dir(session_id)
        paths = collect_failed_screenshot_files(events, root, max_files=5)
    except Exception as e:
        logger.warning("collect failure screenshots failed: %s", e)
        return {"attached": [], "skipped": [], "errors": [str(e)]}
    for path in paths:
        try:
            raw = path.read_bytes()
            # Prefer readable Jira name: step_0002_fail.png
            stem = path.stem
            fname = f"{stem}_fail.png" if not stem.endswith("_fail") else f"{stem}.png"
            await atlassian.attach_jira_file(
                base_url=s["jira_base_url"],
                username=_jira_auth_user(s),
                token=s["jira_api_token"],
                issue_key=issue_key,
                filename=fname,
                content=raw,
                deployment=_deployment(s),
            )
            attached.append(fname)
        except Exception as e:
            logger.warning("jira attach %s failed: %s", path, e)
            errors.append(f"{path.name}: {e}")
    return {"attached": attached, "skipped": skipped, "errors": errors}
```

3. In `create_jira_issue` handler, after successful `atlassian.create_jira_issue(...)`:

```python
        attach_summary = {"attached": [], "skipped": [], "errors": []}
        if body.session_id and result.get("key"):
            attach_summary = await attach_session_failure_screenshots(
                body.session_id, str(result["key"]), s
            )
            result = {**result, "attachments": attach_summary}
            # extend assistant message if any attached
            note = ""
            if attach_summary["attached"]:
                note = f" Attached: {', '.join(attach_summary['attached'])}."
            ...
```

Update the assistant chat message / event payload to include `attachments` when present.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run python -m unittest tests.test_jira_issue_attach_route tests.test_jira_attach tests.test_screenshot_archive -v`

Expected: PASS

- [ ] **Step 5: Commit** (only if user asked)

```bash
git add backend/app/routes/integrations.py backend/tests/test_jira_issue_attach_route.py
git commit -m "feat: attach failure screenshots when logging Jira bugs"
```

---

### Task 6: Log Issue modal hint + i18n

**Files:**
- Modify: `frontend/src/components/LogIssueModal.tsx`
- Modify: `frontend/src/i18n/locales/en.ts`
- Modify: `frontend/src/i18n/locales/ar.ts`
- Modify: `frontend/src/i18n/locales/hi.ts`

**Interfaces:**
- Produces: muted hint on Jira tab when `jiraOk`: `t('jiraAttachFailureShotsHint')`

- [ ] **Step 1: Add i18n keys**

`en.ts`:

```typescript
  jiraAttachFailureShotsHint: 'Failed step screenshots will be attached when available.',
```

`ar.ts` / `hi.ts`: equivalent translations (short, same meaning).

- [ ] **Step 2: Show hint in modal**

In `LogIssueModal.tsx`, inside Jira tab content (near description / before Create button), when `tab === 'jira' && jiraOk`:

```tsx
<p className="text-[11px] text-slate-500">{t('jiraAttachFailureShotsHint')}</p>
```

- [ ] **Step 3: Typecheck / build**

Run: `cd frontend && npm run build`

Expected: success (tsc + vite)

- [ ] **Step 4: Commit** (only if user asked)

```bash
git add frontend/src/components/LogIssueModal.tsx frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/ar.ts frontend/src/i18n/locales/hi.ts
git commit -m "feat: hint that Jira bugs attach failure screenshots"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Self-test header field block | Task 2 |
| Executive summary counts + verdict | Tasks 1–2 |
| Keep 8-column QA table | Task 2 (unchanged builders) |
| Evidence failed-only screenshots | Task 1 |
| Detailed steps unchanged | Task 2 (no change to `stepsToHtml`) |
| `attach_jira_file` | Task 4 |
| Collect failed PNGs max 5 last | Task 3 |
| Wire create issue → attach; partial success | Task 5 |
| Log Issue hint | Task 6 |
| No static PDF / Excel / Confluence PNG | Out of scope (no tasks) |

## Plan self-review

- No TBD/placeholder steps remaining after fixing Task 5 test to use real temp files.
- `collect_failed_screenshot_files` / `attach_jira_file` / `attach_session_failure_screenshots` / `summarizeQaRows` names consistent across tasks.
- Skip `latest.png` is explicit (avoids attaching the live pointer instead of step archives).
