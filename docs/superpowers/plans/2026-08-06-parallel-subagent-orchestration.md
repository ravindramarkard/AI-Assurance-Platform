# Parallel Subagent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split large AgentBrowser tasks into phased parallel child browser-use sessions, collect results, and merge them into one parent report — Cursor-style subagents.

**Architecture:** Pure planner/heuristic modules decide whether to fan out. An orchestrator upgrades the parent session, spawns child sessions through the existing queue (each with its own Chromium + auth bootstrap), releases the parent worker while waiting (avoids pool deadlock), retries failed branches once, then aggregates. Configuration + New Agent UI expose mode / caps / force-parallel.

**Tech Stack:** FastAPI, aiosqlite, asyncio queue workers, browser-use (children only), React + Vite + Tailwind, unittest.

**Spec:** `docs/superpowers/specs/2026-08-06-parallel-subagent-orchestration-design.md`

## Global Constraints

- Terminal success status for agents is **`completed`** (existing codebase), not `done`. Orchestrator success → `completed`; mixed → `partial`; hard fail → `failed`.
- Children are real sessions (`role=child`) enqueued via `queue.enqueue`; they run `agent_runner.run_session` unchanged (auth injection already exists).
- **Parent must not hold a queue worker while awaiting children** — after planning/spawn, orchestrator continues as a background `asyncio.Task`; the worker returns so children can claim slots under `max_concurrent_agents`.
- Default `parallel_execution_mode=auto`, `max_subagents_per_task=4` (clamp 1–8).
- Force parallel allowed even when mode is `off`.
- Invalid planner JSON: one repair; fallback to single-agent unless `force_parallel` or mode `always` → parent `failed`.
- Default `GET /api/sessions` **excludes** `role=child` rows (keep Agents list clean); children via `GET /api/sessions/{id}/children`.
- A2A / Red Team / API Test unchanged.
- Prefer Application + Keycloak `sensitive_data` already wired in `agent_runner` — no new auth mechanism.

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/parallel_plan.py` | Heuristic, plan parse/validate/truncate, mode resolution |
| `backend/app/planner.py` | LLM planner + repair + aggregator prompts/calls |
| `backend/app/orchestrator.py` | Parent lifecycle: plan → spawn → wait → retry → aggregate |
| `backend/tests/test_parallel_plan.py` | Heuristic + validation unit tests |
| `backend/tests/test_orchestrator.py` | Orchestrator unit tests with mocks |
| `backend/app/db.py` | Session columns + child helpers |
| `backend/app/config.py` | Defaults for new settings |
| `backend/app/models.py` | Settings + CreateSessionRequest fields |
| `backend/app/routes/settings.py` | ALLOWED keys |
| `backend/app/llm_factory.py` | effective/public settings |
| `backend/app/routes/sessions.py` | force_parallel, children API, enriched get, stop cascade |
| `backend/app/queue.py` | Dispatch to orchestrator; recover planning/aggregating |
| `backend/app/agent_runner.py` | Stop cascade hook for orchestrator parents (minimal) |
| `frontend/src/api.ts` | Types + API helpers |
| `frontend/src/components/AgentBrowserConfiguration.tsx` | Mode + max subagents |
| `frontend/src/components/AgentPage.tsx` | Force parallel checkbox |
| `frontend/src/App.tsx` | Pass forceParallel into createSession |
| `frontend/src/components/AgentSessionsPage.tsx` | Orchestrator badge + `partial` status |
| `frontend/src/components/ChatPanel.tsx` | Plan / children / aggregate UI |
| `frontend/src/i18n/locales/{en,ar,hi}.ts` | Strings |

---

### Task 1: Plan heuristic + validation (TDD)

**Files:**
- Create: `backend/app/parallel_plan.py`
- Create: `backend/tests/test_parallel_plan.py`

**Interfaces:**
- Produces:
  - `resolve_parallel_intent(mode: str, force_parallel: bool, task: str) -> Literal["skip", "plan"]`
  - `task_looks_large(task: str) -> bool`
  - `parse_plan(raw: str | dict, *, max_branches: int) -> dict` — raises `PlanValidationError` or returns normalized plan; sets `should_parallelize=False` if &lt;2 branches remain
  - `PlanValidationError(Exception)`

- [ ] **Step 1: Write the failing tests**

```python
"""Parallel plan heuristic and validation."""

import unittest

from app import parallel_plan


class TestHeuristic(unittest.TestCase):
    def test_short_task_not_large(self):
        self.assertFalse(parallel_plan.task_looks_large("Open homepage and describe it."))

    def test_long_task_large(self):
        self.assertTrue(parallel_plan.task_looks_large("x" * 400))

    def test_two_urls_large(self):
        self.assertTrue(
            parallel_plan.task_looks_large(
                "Check https://a.example and https://b.example for outages."
            )
        )

    def test_checklist_large(self):
        task = "\n".join(
            [
                "Do these:",
                "1. Login",
                "2. Open dashboard",
                "3. Export report",
            ]
        )
        self.assertTrue(parallel_plan.task_looks_large(task))

    def test_keywords_large(self):
        self.assertTrue(
            parallel_plan.task_looks_large(
                "Verify Jira ticket and also verify Confluence page."
            )
        )


class TestResolveIntent(unittest.TestCase):
    def test_off_without_force_skips(self):
        self.assertEqual(
            parallel_plan.resolve_parallel_intent("off", False, "x" * 500),
            "skip",
        )

    def test_off_with_force_plans(self):
        self.assertEqual(
            parallel_plan.resolve_parallel_intent("off", True, "short"),
            "plan",
        )

    def test_always_plans(self):
        self.assertEqual(
            parallel_plan.resolve_parallel_intent("always", False, "short"),
            "plan",
        )

    def test_auto_short_skips(self):
        self.assertEqual(
            parallel_plan.resolve_parallel_intent("auto", False, "Open home."),
            "skip",
        )

    def test_auto_large_plans(self):
        self.assertEqual(
            parallel_plan.resolve_parallel_intent("auto", False, "x" * 400),
            "plan",
        )


class TestParsePlan(unittest.TestCase):
    def test_valid_parallel_plan(self):
        raw = {
            "should_parallelize": True,
            "reason": "two checks",
            "phases": [
                {
                    "id": "p1",
                    "mode": "serial",
                    "branches": [
                        {"id": "p1.b1", "title": "Login", "task": "Log in"},
                    ],
                },
                {
                    "id": "p2",
                    "mode": "parallel",
                    "branches": [
                        {"id": "p2.b1", "title": "A", "task": "Do A"},
                        {"id": "p2.b2", "title": "B", "task": "Do B"},
                    ],
                },
            ],
        }
        plan = parallel_plan.parse_plan(raw, max_branches=4)
        self.assertTrue(plan["should_parallelize"])
        self.assertEqual(len(plan["phases"]), 2)

    def test_single_branch_disables_parallel(self):
        raw = {
            "should_parallelize": True,
            "reason": "only one",
            "phases": [
                {
                    "id": "p1",
                    "mode": "serial",
                    "branches": [
                        {"id": "p1.b1", "title": "Only", "task": "Do it"},
                    ],
                }
            ],
        }
        plan = parallel_plan.parse_plan(raw, max_branches=4)
        self.assertFalse(plan["should_parallelize"])

    def test_truncates_to_max_branches(self):
        branches = [
            {"id": f"p1.b{i}", "title": f"T{i}", "task": f"Do {i}"} for i in range(6)
        ]
        raw = {
            "should_parallelize": True,
            "reason": "many",
            "phases": [{"id": "p1", "mode": "parallel", "branches": branches}],
        }
        plan = parallel_plan.parse_plan(raw, max_branches=4)
        total = sum(len(p["branches"]) for p in plan["phases"])
        self.assertEqual(total, 4)
        self.assertTrue(plan.get("truncated"))

    def test_invalid_raises(self):
        with self.assertRaises(parallel_plan.PlanValidationError):
            parallel_plan.parse_plan({"should_parallelize": True, "phases": []}, max_branches=4)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m unittest tests.test_parallel_plan -v`  
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `parallel_plan.py`**

```python
from __future__ import annotations

import json
import re
from typing import Any, Literal

_URL_RE = re.compile(r"https?://[^\s]+", re.I)
_CHECK_RE = re.compile(r"(?m)^\s*(?:\d+[\.)]|[-*•])\s+\S+")
_KEYWORD_RE = re.compile(
    r"\b(and then|in parallel|also verify|jira\b.*\bconfluence|confluence\b.*\bjira)\b",
    re.I,
)


class PlanValidationError(ValueError):
    pass


def task_looks_large(task: str) -> bool:
    text = (task or "").strip()
    if len(text) >= 400:
        return True
    urls = {m.group(0).rstrip(".,);]") for m in _URL_RE.finditer(text)}
    if len(urls) >= 2:
        return True
    if len(_CHECK_RE.findall(text)) >= 3:
        return True
    if _KEYWORD_RE.search(text):
        return True
    return False


def resolve_parallel_intent(
    mode: str, force_parallel: bool, task: str
) -> Literal["skip", "plan"]:
    mode = (mode or "auto").strip().lower()
    if force_parallel:
        return "plan"
    if mode == "off":
        return "skip"
    if mode == "always":
        return "plan"
    # auto
    return "plan" if task_looks_large(task) else "skip"


def _as_dict(raw: str | dict[str, Any]) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise PlanValidationError(f"invalid JSON: {e}") from e
    if not isinstance(data, dict):
        raise PlanValidationError("plan root must be object")
    return data


def parse_plan(raw: str | dict[str, Any], *, max_branches: int) -> dict[str, Any]:
    max_branches = max(1, min(int(max_branches), 8))
    data = _as_dict(raw)
    phases_in = data.get("phases")
    if not isinstance(phases_in, list) or not phases_in:
        if data.get("should_parallelize"):
            raise PlanValidationError("phases required when should_parallelize")
        return {
            "should_parallelize": False,
            "reason": str(data.get("reason") or "no phases"),
            "phases": [],
        }

    phases: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    total = 0
    truncated = False

    for ph in phases_in:
        if not isinstance(ph, dict):
            raise PlanValidationError("phase must be object")
        pid = str(ph.get("id") or "").strip()
        mode = str(ph.get("mode") or "").strip().lower()
        if mode not in ("serial", "parallel"):
            raise PlanValidationError(f"bad phase mode: {mode}")
        branches_in = ph.get("branches")
        if not isinstance(branches_in, list) or not branches_in:
            raise PlanValidationError(f"phase {pid} needs branches")
        branches: list[dict[str, Any]] = []
        for br in branches_in:
            if total >= max_branches:
                truncated = True
                break
            if not isinstance(br, dict):
                raise PlanValidationError("branch must be object")
            bid = str(br.get("id") or "").strip()
            title = str(br.get("title") or "").strip()
            task = str(br.get("task") or "").strip()
            if not bid or not title or not task:
                raise PlanValidationError("branch needs id, title, task")
            if bid in seen_ids:
                raise PlanValidationError(f"duplicate branch id {bid}")
            seen_ids.add(bid)
            branches.append({"id": bid, "title": title, "task": task})
            total += 1
        if branches:
            phases.append({"id": pid or f"p{len(phases)+1}", "mode": mode, "branches": branches})
        if truncated:
            break

    should = bool(data.get("should_parallelize")) and total >= 2
    return {
        "should_parallelize": should,
        "reason": str(data.get("reason") or ""),
        "phases": phases if should else phases,
        "truncated": truncated,
    }
```

Note: when `should` is False after parse, callers treat as single-agent; keep phases for debugging optional — orchestrator ignores if not parallelizing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m unittest tests.test_parallel_plan -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/parallel_plan.py backend/tests/test_parallel_plan.py
git commit -m "feat: add parallel plan heuristic and validation"
```

---

### Task 2: Settings keys (backend)

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/routes/settings.py`
- Modify: `backend/app/llm_factory.py`
- Test: extend or add asserts via existing settings path — add unit checks in `backend/tests/test_parallel_plan.py` or new `backend/tests/test_parallel_settings.py`

**Interfaces:**
- Produces settings keys:
  - `parallel_execution_mode: Literal["off","auto","always"]` default `"auto"`
  - `max_subagents_per_task: int` default `4` (ge=1, le=8)
- Consumes: existing `effective_settings` / `public_settings` / `SettingsUpdate` / ALLOWED patterns

- [ ] **Step 1: Add failing test for defaults shape**

```python
# backend/tests/test_parallel_settings.py
import unittest
from unittest.mock import AsyncMock, patch

class TestParallelSettings(unittest.IsolatedAsyncioTestCase):
    async def test_effective_includes_parallel_defaults(self):
        from app.llm_factory import effective_settings
        with patch("app.llm_factory.db.get_settings", new=AsyncMock(return_value={})):
            cfg = await effective_settings()
        self.assertEqual(cfg.get("parallel_execution_mode"), "auto")
        self.assertEqual(int(cfg.get("max_subagents_per_task") or 0), 4)
```

Adjust import/patch targets to match how `effective_settings` actually loads (read `llm_factory.py` and mirror `test_llm_settings_vision_temp.py` patterns).

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd backend && uv run python -m unittest tests.test_parallel_settings -v`

- [ ] **Step 3: Wire settings**

In `config.py` Settings class:

```python
parallel_execution_mode: Literal["off", "auto", "always"] = "auto"
max_subagents_per_task: int = 4
```

In `models.SettingsUpdate`:

```python
parallel_execution_mode: Literal["off", "auto", "always"] | None = None
max_subagents_per_task: int | None = Field(default=None, ge=1, le=8)
```

Add both keys to `routes/settings.py` ALLOWED list.  
In `llm_factory.effective_settings` / env overlay / public_settings: include both; clamp `max_subagents_per_task` to 1–8; default mode `auto`.

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/app/models.py backend/app/routes/settings.py backend/app/llm_factory.py backend/tests/test_parallel_settings.py
git commit -m "feat: add parallel execution settings keys"
```

---

### Task 3: DB session columns + child helpers

**Files:**
- Modify: `backend/app/db.py`
- Create: `backend/tests/test_orchestrator_db.py` (async DB tests if project has pattern; otherwise sync helpers tested via aiosqlite temp — prefer simple functions that don't need full server)

**Interfaces:**
- Produces:
  - Columns via `_ensure_column`: `parent_id`, `role`, `branch_id`, `plan_json`, `force_parallel`, `aggregate_report`, `attempt`
  - `create_session(..., force_parallel: bool = False, parent_id=None, role="root", branch_id=None, attempt=1) -> dict`
  - `list_sessions(limit=100, *, include_children: bool = False)`
  - `list_child_sessions(parent_id: str) -> list[dict]`
  - `child_stats(parent_id: str) -> dict`
  - `get_session` returns new columns as stored

- [ ] **Step 1: Write failing tests for list filter + child_stats**

Use in-memory or temp DB if the suite already does; otherwise test pure SQL helpers after `init_db` with patched `DB_PATH`. Mirror `test_human_input` / other DB tests if present. Minimal:

```python
# Prefer testing list_child_sessions + child_stats with mocked rows via thin wrappers,
# or full init_db against tempfile — implementer chooses matching existing style.
```

Concrete approach used elsewhere: if no DB test harness exists, add:

```python
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

class TestSessionChildren(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db_path = Path(self.tmp.name) / "app.db"
        import app.db as dbmod
        self._prev = dbmod.DB_PATH
        dbmod.DB_PATH = db_path
        await dbmod.init_db()

    async def asyncTearDown(self):
        import app.db as dbmod
        dbmod.DB_PATH = self._prev
        self.tmp.cleanup()

    async def test_create_child_and_stats(self):
        from app import db
        parent = await db.create_session("parent task")
        child = await db.create_session(
            "child task",
            parent_id=parent["id"],
            role="child",
            branch_id="p1.b1",
            attempt=1,
        )
        kids = await db.list_child_sessions(parent["id"])
        self.assertEqual(len(kids), 1)
        self.assertEqual(kids[0]["id"], child["id"])
        listed = await db.list_sessions(include_children=False)
        self.assertTrue(all(s.get("role") != "child" for s in listed))
        stats = await db.child_stats(parent["id"])
        self.assertEqual(stats["total"], 1)
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement columns + APIs in `db.py`**

In `init_db` after sessions table / migration block, `_ensure_column` for:

- `parent_id TEXT`
- `role TEXT NOT NULL DEFAULT 'root'` (ensure existing rows get default via column default)
- `branch_id TEXT`
- `plan_json TEXT`
- `force_parallel INTEGER NOT NULL DEFAULT 0`
- `aggregate_report TEXT`
- `attempt INTEGER NOT NULL DEFAULT 1`

Update `INSERT` in `create_session` to set role/parent_id/force_parallel/attempt/branch_id.  
`list_sessions`: `WHERE role IS NULL OR role != 'child'` unless `include_children`.  
`list_child_sessions`: `WHERE parent_id=? ORDER BY created_at DESC`.  
`child_stats`: count by status buckets (`queued`,`running`,`completed`,`failed`,`stopped`, plus `waiting_for_input` under running).

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/app/db.py backend/tests/test_orchestrator_db.py
git commit -m "feat: session parent/child columns for orchestration"
```

---

### Task 4: Planner + aggregator LLM helpers

**Files:**
- Create: `backend/app/planner.py`
- Create: `backend/tests/test_planner.py`

**Interfaces:**
- Produces:
  - `async def plan_task(task: str, *, cfg: dict, max_branches: int, force: bool) -> dict`
  - `async def aggregate_results(parent_task: str, branch_results: list[dict], *, cfg: dict) -> str`
- Consumes: `build_llm`, `parallel_plan.parse_plan`, `PlanValidationError`
- `branch_results` items: `{branch_id, title, status, summary, error}`

- [ ] **Step 1: Failing tests with mocked LLM**

```python
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app import planner


class TestPlanner(unittest.IsolatedAsyncioTestCase):
    async def test_plan_task_parses_llm_json(self):
        payload = {
            "should_parallelize": True,
            "reason": "two",
            "phases": [
                {
                    "id": "p1",
                    "mode": "parallel",
                    "branches": [
                        {"id": "p1.b1", "title": "A", "task": "Do A"},
                        {"id": "p1.b2", "title": "B", "task": "Do B"},
                    ],
                }
            ],
        }
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=MagicMock(content=json.dumps(payload)))
        with patch("app.planner.build_llm", return_value=llm):
            plan = await planner.plan_task(
                "Do A and B in parallel",
                cfg={"llm_provider": "local"},
                max_branches=4,
                force=False,
            )
        self.assertTrue(plan["should_parallelize"])

    async def test_plan_task_repairs_once(self):
        bad = MagicMock(content="not-json")
        good = {
            "should_parallelize": False,
            "reason": "simple",
            "phases": [],
        }
        llm = MagicMock()
        llm.ainvoke = AsyncMock(
            side_effect=[bad, MagicMock(content=json.dumps(good))]
        )
        with patch("app.planner.build_llm", return_value=llm):
            plan = await planner.plan_task(
                "x", cfg={}, max_branches=4, force=False
            )
        self.assertEqual(llm.ainvoke.await_count, 2)
        self.assertFalse(plan["should_parallelize"])

    async def test_force_invalid_raises(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=MagicMock(content="nope"))
        with patch("app.planner.build_llm", return_value=llm):
            with self.assertRaises(planner.PlannerError):
                await planner.plan_task(
                    "x", cfg={}, max_branches=4, force=True
                )

    async def test_aggregate_returns_text(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=MagicMock(content="## Report\nOK"))
        with patch("app.planner.build_llm", return_value=llm):
            text = await planner.aggregate_results(
                "parent",
                [{"branch_id": "p1.b1", "title": "A", "status": "completed", "summary": "ok", "error": None}],
                cfg={},
            )
        self.assertIn("Report", text)
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `planner.py`**

- System prompt: output JSON only; independent work → `parallel`; prerequisites → earlier `serial`; respect max_branches.
- Extract content from LLM result (`content` attr or str).
- On `PlanValidationError`, one repair call with error message; then raise `PlannerError` if `force` else return `{should_parallelize: False, reason: "planner_failed", phases: []}`.
- Aggregator: markdown report combining branch summaries/errors.

Use `browser_use.llm.messages.SystemMessage, UserMessage` like `followup_chat.py`.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/app/planner.py backend/tests/test_planner.py
git commit -m "feat: add parallel planner and aggregator LLM helpers"
```

---

### Task 5: Orchestrator runtime (spawn / wait / retry / aggregate)

**Files:**
- Create: `backend/app/orchestrator.py`
- Create: `backend/tests/test_orchestrator.py`

**Interfaces:**
- Produces:
  - `async def maybe_start(session_id: str, task: str) -> bool`  
    Returns `True` if this session is handled by orchestration (caller must **not** also `run_session`). Returns `False` → caller runs single agent.
  - Background: after `True`, either ran single-path handoff internally OR scheduled `_run_orchestrator` task.
- Prefer: `maybe_start` does intent+plan synchronously; if not parallelizing return `False`; if parallelizing, set role/plan, spawn first wave logic inside `asyncio.create_task(_run_orchestrator(...))`, return `True` immediately so queue worker frees.

**Critical wait loop:** poll `db.get_session(child_id)` every 0.5s until status in `completed|failed|stopped`; respect parent stop via `queue.is_cancelled(parent_id)` or parent status `stopped`.

- [ ] **Step 1: Failing tests**

```python
import unittest
from unittest.mock import AsyncMock, patch, MagicMock

from app import orchestrator


class TestOrchestrator(unittest.IsolatedAsyncioTestCase):
    async def test_maybe_start_skips_when_intent_skip(self):
        with patch("app.orchestrator.effective_settings", new=AsyncMock(return_value={
            "parallel_execution_mode": "off",
            "max_subagents_per_task": 4,
        })):
            with patch("app.orchestrator.db.get_session", new=AsyncMock(return_value={
                "id": "p1", "force_parallel": 0, "task": "short", "role": "root",
            })):
                handled = await orchestrator.maybe_start("p1", "short")
        self.assertFalse(handled)

    async def test_child_task_envelope(self):
        text = orchestrator.build_child_task(
            parent_task="Parent big task",
            branch_title="Login",
            branch_task="Log into app",
            runtime_url="https://app.example",
        )
        self.assertIn("Log into app", text)
        self.assertIn("Login", text)
        self.assertIn("do not expand", text.lower())
```

Add a test that `_await_children` retries once on failure using mocked `db` + `enqueue` (implementer expands with AsyncMock side effects).

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement orchestrator**

Sketch:

```python
async def maybe_start(session_id: str, task: str) -> bool:
    sess = await db.get_session(session_id)
    if not sess:
        return False
    if sess.get("role") == "child":
        return False  # children always single-agent
    cfg = await effective_settings()
    force = bool(sess.get("force_parallel"))
    mode = str(cfg.get("parallel_execution_mode") or "auto")
    if resolve_parallel_intent(mode, force, task) == "skip":
        return False
    await db.update_session(session_id, status="planning")
    await _emit(session_id, "status", {"status": "planning"})
    max_b = int(cfg.get("max_subagents_per_task") or 4)
    try:
        plan = await plan_task(task, cfg=cfg, max_branches=max_b, force=force or mode == "always")
    except PlannerError as e:
        await db.update_session(session_id, status="failed", error=str(e))
        await _emit(...)
        return True  # handled (failed)
    if not plan.get("should_parallelize"):
        await db.update_session(session_id, status="queued", role="root")
        return False
    await db.update_session(
        session_id,
        role="orchestrator",
        plan_json=json.dumps(plan),
        status="running",
    )
    await _emit(session_id, "plan_ready", {"plan": plan})
    asyncio.create_task(_run_orchestrator(session_id, task, plan, cfg))
    return True
```

`_run_orchestrator`: for each phase, spawn children (`create_session` + update linkage fields if create doesn't take all kwargs + `enqueue`), await, retry failed attempt==1 once, then aggregate, set `completed`/`partial`/`failed`, write `aggregate_report` + `db.add_message` assistant.

`build_child_task(...)` as tested.

Emit `child_spawned`, `child_finished`, `child_retry`, `aggregate_ready`.

Copy runtime_url from parent `run_opts` onto children via `set_run_opts`.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestrator.py backend/tests/test_orchestrator.py
git commit -m "feat: add parallel subagent orchestrator runtime"
```

---

### Task 6: Queue dispatch, recovery, stop cascade

**Files:**
- Modify: `backend/app/queue.py`
- Modify: `backend/app/agent_runner.py` (`control_agent` stop path)
- Modify: `backend/app/routes/sessions.py` (optional thin wrapper)
- Test: `backend/tests/test_orchestrator.py` additions or `backend/tests/test_queue_orchestrator.py`

**Interfaces:**
- Consumes: `orchestrator.maybe_start`
- Produces: worker calls maybe_start before `run_session`; recover includes `planning`/`aggregating`/`running` orchestrators; stop parent stops children

- [ ] **Step 1: Failing test — worker dispatch mock**

```python
async def test_worker_skips_run_session_when_orchestrator_handles(self):
    # patch queue internals or test a new dispatch_session helper
    ...
```

Prefer extracting:

```python
# queue.py
async def dispatch_session(session_id: str, task: str) -> None:
    from . import orchestrator
    handled = await orchestrator.maybe_start(session_id, task)
    if handled:
        return
    await agent_runner.run_session(session_id, task)
```

Worker calls `dispatch_session`.

- [ ] **Step 2: Implement recovery**

In `recover_stuck_sessions`, also re-enqueue sessions with status in `planning`, `aggregating`, and orchestrator `running` (role=orchestrator). Children `queued`/`running` as today.

For resume: `maybe_start` / `_run_orchestrator` must reload `plan_json` if present and skip completed phases (track by existing children per `branch_id` with terminal success). Minimum viable resume: if `plan_json` exists and role=orchestrator, jump into `_run_orchestrator` without re-planning; skip branches that already have `completed` child attempt.

- [ ] **Step 3: Stop cascade**

In `control_agent` when `action=="stop"` and session role is orchestrator (or has children):

```python
children = await db.list_child_sessions(session_id)
for ch in children:
    if ch["status"] in ("queued", "running", "waiting_for_input", "paused", "planning"):
        await control_agent(ch["id"], "stop")  # careful: avoid recursion loops — only cascade from parent
```

Implement `stop_session_tree(session_id)` that stops parent then children without re-entering cascade on child.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/app/queue.py backend/app/agent_runner.py backend/tests/test_queue_orchestrator.py
git commit -m "feat: wire orchestrator into queue, recovery, and stop"
```

---

### Task 7: Sessions API (create + get + children)

**Files:**
- Modify: `backend/app/models.py` (`CreateSessionRequest.force_parallel`)
- Modify: `backend/app/routes/sessions.py`
- Modify: `backend/app/models.py` `SessionOut` optional fields if used

**Interfaces:**
- `POST /api/sessions` + `/with-files` accept `force_parallel`
- `GET /api/sessions/{id}` adds orchestration fields + `child_stats`
- `GET /api/sessions/{id}/children`
- List endpoint uses `include_children=False`

- [ ] **Step 1: Extend create paths**

```python
# CreateSessionRequest
force_parallel: bool = False

# create_session handler
session = await db.create_session(
    body.task, body.model, body.llm_provider, force_parallel=body.force_parallel
)
```

Multipart: `force_parallel: bool = Form(False)`.

- [ ] **Step 2: Enrich get + children route**

```python
@router.get("/{session_id}/children")
async def get_children(session_id: str):
    if not await db.get_session(session_id):
        raise HTTPException(404, "Session not found")
    return await db.list_child_sessions(session_id)
```

In `get_session`, attach `child_stats` when role is orchestrator; parse `plan_json` to object `plan` in response (keep raw too if useful).

Ensure `_public_session` does not strip new fields.

- [ ] **Step 3: Manual smoke** (or unittest with TestClient if available)

Run API if easy; otherwise commit after code review of handlers.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/routes/sessions.py
git commit -m "feat: session API for force_parallel and children"
```

---

### Task 8: Configuration + New Agent UI

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/AgentBrowserConfiguration.tsx`
- Modify: `frontend/src/components/AgentPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n/locales/en.ts` (and `ar.ts`, `hi.ts`)

**Interfaces:**
- `AppSettings.parallel_execution_mode`, `max_subagents_per_task`
- `api.createSession(..., forceParallel?: boolean)`
- Config UI select + number; New Agent checkbox

- [ ] **Step 1: Types + API**

```typescript
// AppSettings
parallel_execution_mode?: 'off' | 'auto' | 'always'
max_subagents_per_task?: number

// Session
parent_id?: string | null
role?: 'root' | 'orchestrator' | 'child' | string
branch_id?: string | null
force_parallel?: boolean | number
aggregate_report?: string | null
plan?: unknown
plan_json?: string | null
child_stats?: { total: number; done?: number; completed?: number; failed: number; running: number; queued: number }

// api
listSessionChildren: (id: string) => fetch(`/api/sessions/${id}/children`).then(...)
createSession: (task, model?, files?, runtimeUrl?, forceParallel?) => {
  // JSON body includes force_parallel
  // FormData append force_parallel: 'true'|'false'
}
```

- [ ] **Step 2: Configuration fields**

Under Concurrency section in `AgentBrowserConfiguration.tsx`:

- Select: Off / Auto / Always (`parallel_execution_mode`)
- Number: Max subagents per task (1–8)
- Update help text on max concurrent agents: caps all live browsers including subagents

- [ ] **Step 3: New Agent checkbox**

In `AgentPage.tsx`, checkbox “Force parallel”; pass to `onCreate`. Update `App.onCreate` signature and `api.createSession`.

- [ ] **Step 4: i18n keys** in en/ar/hi (`parallelExecution`, `forceParallel`, `maxSubagents`, help strings)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/components/AgentBrowserConfiguration.tsx frontend/src/components/AgentPage.tsx frontend/src/App.tsx frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/ar.ts frontend/src/i18n/locales/hi.ts
git commit -m "feat: UI for parallel mode, subagent cap, force parallel"
```

---

### Task 9: Parent/child UX in sessions list + ChatPanel

**Files:**
- Modify: `frontend/src/components/AgentSessionsPage.tsx`
- Modify: `frontend/src/components/ChatPanel.tsx`
- Modify: `frontend/src/i18n/locales/{en,ar,hi}.ts`

**Interfaces:**
- Consumes: `session.role`, `child_stats`, `api.listSessionChildren`, `aggregate_report`, plan events
- Produces: badge, `partial` status styling, children table, aggregate report block, link to parent on child

- [ ] **Step 1: Sessions list**

- Status label/class for `partial` (amber/warning) and `planning` / `aggregating`
- If `role === 'orchestrator'`, show badge e.g. `${child_stats?.total ?? 0} subagents`

- [ ] **Step 2: ChatPanel parent view**

When `session.role === 'orchestrator'`:

- Fetch children on load + refresh on WS `child_*` events
- Render plan outline from `session.plan` / `plan_json`
- Table: title, branch_id, attempt, status, open child button (`onOpenSession(child.id)`)
- Show aggregate_report (markdown) when present
- List any child with `waiting_for_input` / hitl

When `session.role === 'child'` && `parent_id`:

- Banner: “Subagent of …” linking to parent

- [ ] **Step 3: Treat `partial` as terminal in ChatPanel** (like completed/failed for follow-ups / controls)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AgentSessionsPage.tsx frontend/src/components/ChatPanel.tsx frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/ar.ts frontend/src/i18n/locales/hi.ts
git commit -m "feat: show parallel subagents and aggregate report in UI"
```

---

### Task 10: End-to-end verification

**Files:** none new (manual + unit suite)

- [ ] **Step 1: Run backend unit tests**

Run: `cd backend && uv run python -m unittest tests.test_parallel_plan tests.test_parallel_settings tests.test_planner tests.test_orchestrator tests.test_orchestrator_db -v`  
Expected: all PASS

- [ ] **Step 2: Manual checklist (from spec)**

- Small task + auto → single agent, no children  
- Large checklist + auto → children ≤ cap, aggregate on parent  
- Force parallel → plans even if short (if planner returns ≥2 branches)  
- Mode off without force → never plans  
- Kill one child path (mock or stop child) → retry once → `partial` if still failing  
- Stop parent → children stopped  
- `max_concurrent_agents=1` → children queue; parent does not block pool (worker freed)

- [ ] **Step 3: Final commit if fixes needed**

```bash
git commit -m "fix: parallel orchestration edge cases from verification"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Auto/heuristic + force + modes | 1, 2, 8 |
| Plan JSON validate + truncate | 1 |
| Settings UI + defaults | 2, 8 |
| DB parent/child fields | 3 |
| Planner + repair + aggregator | 4 |
| Orchestrator phases + retry | 5 |
| Queue / no worker deadlock | 5, 6 |
| Recovery planning/aggregating | 6 |
| Stop cascade | 6 |
| API force_parallel + children | 7 |
| Auth reuse | (existing agent_runner — no new task; children inherit) |
| HITL per child | 9 (surface) + existing HITL |
| Agents list badge / partial / UI | 9 |
| Exclude children from main list | 3, 7 |
| Status `completed` not `done` | Global + 5 |

## Placeholder scan

No TBD/TODO left in tasks; implementers must still align `effective_settings` patch paths and ChatPanel prop names with live code when editing.

## Type consistency

- Intent: `"skip" | "plan"`
- Roles: `root | orchestrator | child`
- Settings: `parallel_execution_mode`, `max_subagents_per_task`
- Entry: `orchestrator.maybe_start(session_id, task) -> bool`
- Success status: `completed` | `partial` | `failed`
