# Parallel subagent orchestration — design

**Date:** 2026-08-06  
**Status:** Approved (Approach 1)  
**Scope:** AgentBrowser — auto-split large automation tasks into parallel browser-use child agents; collect and merge outputs

## Problem

`max_concurrent_agents` only allows multiple *independent* sessions to run at once. A single large automation prompt still runs as one browser-use agent. Operators need Cursor-like subagents: analyze a big task, fan out independent work across isolated browsers, then merge results.

## Goals

- Automatically (or on demand) split large tasks into phased plans with parallel branches
- Run each branch as its own browser-use agent + Chromium instance
- Respect existing worker-pool concurrency (`max_concurrent_agents`)
- Shared auth bootstrap (Keycloak / app login credentials) without sharing cookie jars
- Retry failed branches once; continue siblings; merge into one parent report
- Configuration UI for parallel mode + fan-out cap; New Agent “Force parallel” toggle

## Non-goals (v1)

- Shared single browser / multi-tab multi-agent
- Nested subagents of subagents
- Cross-parent priority scheduling beyond the existing FIFO queue
- Changing LLM provider settings or browser engine launch paths beyond reuse

## Decisions locked

| Topic | Choice |
|-------|--------|
| Split style | Automatic planner (Approach A) |
| Trigger | Hybrid: auto on “large” tasks + Force parallel toggle (Approach C) |
| Browser/auth | Isolated browsers + shared credential bootstrap (Approach C) |
| Dependencies | Phased DAG: serial → parallel → serial (Approach A) |
| Failure | Continue siblings; retry failed branch once; then `partial` / `failed` (Approach C) |
| Architecture | Orchestrator parent session + child sessions via existing queue (Approach 1) |

### Project-fit defaults (locked for this codebase)

These match how AgentBrowser already works (sessions, queue, WS, Configuration tab, app login / Keycloak):

1. **Default mode `auto`** — avoid wasting Chromium on short one-page tasks; Force parallel for power users.
2. **Children are real sessions** — reuse `create_session` + `enqueue` + WS events so Agents list, stop, HITL, screenshots, and Browsers view keep working without a second execution path.
3. **Parent does not drive a browser during parallel phases** — only children do; parent plans, waits, retries, aggregates. Serial one-branch phases still spawn a child (same auth path) rather than special-casing parent browser runs.
4. **`max_subagents_per_task` default 4** (clamp 1–8) — below global pool max so one parent cannot starve the whole machine; pool still hard-caps live browsers.
5. **Invalid planner JSON** — one repair attempt, then single-agent fallback; if `force_parallel` or mode `always` and repair fails → parent `failed` with clear error (no silent single-agent).
6. **Outcome status `partial`** — new terminal status for “some children failed after retry”; UI treats it as warning, not success.
7. **HITL** — per-child wait; siblings keep running; parent surfaces which child is waiting.

## Architecture

```
User task (New Agent ± force_parallel)
        │
        ▼
 Parent session (role=orchestrator)
   1. Resolve mode: off | auto | always | force
   2. Heuristic (auto) and/or planner LLM → plan_json
   3. For each phase in order:
        serial  → spawn 1 child, await
        parallel → spawn N children (≤ max_subagents_per_task), await all
   4. Children use existing queue workers (max_concurrent_agents)
   5. Each child = own Browser + Agent; inject existing sensitive_data / app login
   6. Failed child → one retry (new child session, same branch_id)
   7. Aggregator LLM → aggregate_report on parent → status done | partial | failed
```

```
AgentBrowser Configuration
  parallel_execution_mode: off | auto | always
  max_subagents_per_task: 1–8 (default 4)
  max_concurrent_agents: 1–8 (unchanged — global live browser cap)

New Agent
  force_parallel: bool (per-run)
```

## Data model

### Session columns (additive)

| Column | Type | Purpose |
|--------|------|---------|
| `parent_id` | TEXT NULL | Child → parent session id |
| `role` | TEXT | `root` \| `orchestrator` \| `child` (existing single agents stay `root`) |
| `branch_id` | TEXT NULL | Plan branch id (e.g. `p2.b1`); stable across retry |
| `plan_json` | TEXT NULL | Planner output on orchestrator |
| `force_parallel` | INTEGER | 0/1 per-run override |
| `aggregate_report` | TEXT NULL | Final merged report on parent |
| `attempt` | INTEGER | 1 for first child run; 2 for retry |

When a normal (non-orchestrated) session is created today, `role='root'`, `parent_id=NULL`. When orchestration engages, the same session is upgraded to `role='orchestrator'` after planning decides to parallelize (or immediately if `always` / `force_parallel` and planner returns ≥2 branches). If planning declines parallelization, leave `role='root'` and run `agent_runner` as today.

### Statuses

| Actor | Flow |
|-------|------|
| Orchestrator | `queued` → `planning` → `running` → `aggregating` → `done` \| `partial` \| `failed` |
| Child | `queued` → `running` → `done` \| `failed` \| `stopped` (unchanged) |

- `partial`: ≥1 child failed after retry; ≥1 child succeeded.
- `failed`: planning hard-fail (forced parallel), or all branches failed, or parent stopped.

### Plan JSON

```json
{
  "should_parallelize": true,
  "reason": "Multiple independent verification steps",
  "phases": [
    {
      "id": "p1",
      "mode": "serial",
      "branches": [
        { "id": "p1.b1", "title": "Login", "task": "Log into the application and confirm home page." }
      ]
    },
    {
      "id": "p2",
      "mode": "parallel",
      "branches": [
        { "id": "p2.b1", "title": "Jira check", "task": "…" },
        { "id": "p2.b2", "title": "Confluence check", "task": "…" }
      ]
    }
  ]
}
```

Validation rules:

- `phases` non-empty when `should_parallelize` is true
- Each branch has unique `id`, non-empty `title` and `task`
- Total branches across all phases ≤ `max_subagents_per_task` after truncation (planner asked to respect cap; orchestrator enforces by dropping lowest-priority extras or merging — **enforce by truncating later parallel branches and noting omission in parent events**)
- If after validation only one branch remains → treat as single-agent (`should_parallelize=false`)

## API

### Settings

- `parallel_execution_mode`: `off` \| `auto` \| `always` (default `auto`)
- `max_subagents_per_task`: int 1–8 (default 4)
- Persist via existing settings store / `PUT /api/settings`
- Expose on AgentBrowser **Configuration** tab next to concurrency

### Sessions

- `POST /api/sessions` (and multipart variant): optional `force_parallel: bool`
- `GET /api/sessions/{id}`: include `parent_id`, `role`, `branch_id`, `force_parallel`, plan summary, `aggregate_report`, `child_stats` `{ total, done, failed, running, queued }`
- `GET /api/sessions/{id}/children`: children newest-first (include retries); fields: id, title, status, branch_id, attempt, error, updated_at
- Parent **stop**: cancel queued children + stop running children; parent → `failed` (or `stopped` if that status already exists elsewhere — use existing stop semantics and map parent to failed/stopped consistently with current `SessionControlRequest`)
- Child **stop**: that branch counts as failed; parent continues (retry only if attempt==1 and stop was not user-initiated on parent)

### Events (parent WS)

| Type | When |
|------|------|
| `plan_ready` | Plan accepted |
| `child_spawned` | Child session created |
| `child_finished` | Child terminal status |
| `child_retry` | Retry spawned for `branch_id` |
| `aggregate_ready` | Report written |
| Existing `status` / message / screenshot events | Unchanged on child; parent gets orchestration status updates |

## Planner

### Mode resolution

```
if mode == off and not force_parallel → single agent
if force_parallel or mode == always → planner required
if mode == auto → heuristic; if “large” → planner else single agent
```

### Auto heuristic (“large”) — any of:

- Task length ≥ 400 characters
- ≥2 distinct http(s) URLs
- ≥3 numbered / bullet checklist lines
- Keywords suggesting multi-area work: `and then`, `in parallel`, `also verify`, multiple product names (Jira + Confluence, etc.)

Heuristic is intentionally cheap and conservative; false positives only cost a planner call.

### Planner LLM

- Same provider/model as the session
- System prompt: produce only JSON matching the schema; mark only *independent* work as `parallel`; put prerequisites in earlier `serial` phases
- One repair pass on invalid JSON
- Fallback rules per locked defaults above

## Runtime

New module `backend/app/orchestrator.py` (name flexible):

1. Entry from queue worker: if session should orchestrate, call orchestrator instead of (or wrapping) `agent_runner.run_session`
2. Write `plan_json`, emit `plan_ready`, set status `planning` then `running`
3. For each phase, create children via `db.create_session` + set parent linkage + `enqueue`
4. Await children by polling DB status and/or completion events (prefer asyncio wait with periodic DB poll to avoid new infra)
5. On child `failed` with `attempt==1`: spawn retry (`attempt=2`), emit `child_retry`
6. After all phases: gather final assistant messages / errors → aggregator LLM → `aggregate_report` + parent assistant message
7. Set terminal status: `done` | `partial` | `failed`

Child task envelope includes: branch title/goal, truncated parent task for context, runtime URL / application URL, instruction not to expand beyond branch scope.

`queue.recover_stuck_sessions` must re-enqueue unfinished orchestrators and children after restart (same as today for `queued`/`running`; also treat `planning`/`aggregating` as resumable — re-enter orchestrator which reloads `plan_json` and continues unfinished phases).

## Auth

- Reuse existing Keycloak placeholders and application username/password injection into browser-use `sensitive_data` (see `app_login.py` / `keycloak.py`)
- No shared CDP profile / cookie jar between children
- Each child may hit HITL OTP independently; UI already has human-input flow — ensure parent detail lists pending child HITL

## UI

### Configuration tab

- Parallel execution: select `off` / `auto` / `always` with short help text
- Max subagents per task: number 1–8
- Keep existing Max concurrent agents help text; clarify it caps *all* live browsers including children

### New Agent

- Checkbox: Force parallel (disabled or no-op hint when mode is `off`? **Decision:** still allow force when mode is `off` so one-off parallel works without changing global config)

### Parent agent detail

- Plan outline (phases / branches)
- Child table: title, branch_id, attempt, status, link to open child
- Aggregate report section when available
- Badge in Agents list for orchestrators: e.g. `3 subagents`

### Child agent detail

- Unchanged live browser / events experience; show “Subagent of …” link back to parent

## Error handling summary

| Case | Behavior |
|------|----------|
| Mode off, no force | Single agent |
| Auto, not large | Single agent |
| Planner says no parallel | Single agent |
| Invalid plan + repair fail, not forced | Single agent |
| Invalid plan + repair fail, forced/always | Parent `failed` |
| Child fail attempt 1 | Retry once |
| Child fail attempt 2 | Keep failure; continue |
| User stops parent | Cancel/stop children; parent failed/stopped |
| User stops child | Branch failed; no retry; parent continues |
| Pool saturated | Children stay `queued` until workers free |

## Testing checklist

- [ ] Small task + `auto` → no children, normal single run
- [ ] Large checklist + `auto` → plan with parallel phase; children ≤ `max_subagents_per_task`; aggregate report on parent
- [ ] Force parallel on multi-step task → children spawned even if short
- [ ] `parallel_execution_mode=off` without force → never plans
- [ ] One child fails → exactly one retry → parent `partial` if still failing and others ok
- [ ] All children succeed → parent `done` with merged report
- [ ] Stop parent cancels/stops children
- [ ] `max_concurrent_agents=1` → at most one live browser; other children queued
- [ ] Child HITL does not block sibling agents
- [ ] Settings persist and reload on Configuration tab
- [ ] Process restart recovers planning/running orchestrator and children

## Approach decision

**Approach 1 (chosen):** Orchestrator parent + child sessions through existing queue.

Rejected:

- **Approach 2** — in-process `asyncio.gather` inside one session (bypasses pool, weak UI/HITL)
- **Approach 3** — config-only concurrency (does not split or merge)

## Implementation notes

- Prefer a thin orchestrator module over bloating `agent_runner.py`
- DB migrations via existing `_ensure_column` pattern
- Frontend: extend `AgentBrowserConfiguration`, New Agent form, and agent detail; no new top-level nav
- Keep changes scoped to AgentBrowser path; A2A / Red Team / API Test unchanged
