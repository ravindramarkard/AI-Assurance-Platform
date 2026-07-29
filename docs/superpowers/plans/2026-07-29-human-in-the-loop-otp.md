# Human-in-the-loop OTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a live browser agent pause mid-run, ask the operator for a one-time value (OTP/MFA) via a dedicated modal, wait indefinitely, then continue with that value.

**Architecture:** Register a custom browser-use tool `request_human_input` that blocks on an in-process asyncio Future; persist pending prompt on the session for UI restore; expose `POST /api/sessions/{id}/human-input`; emit WS `human_input_required` + status `waiting_for_input`; ChatPanel shows a dedicated banner/modal (not chat composer).

**Tech Stack:** FastAPI, aiosqlite, browser-use `Tools.action`, React + Vite + Tailwind, existing WebSocket session events.

## Global Constraints

- Agent-driven only (no page auto-detect) — tool must be called
- Dedicated modal/banner — not the chat composer
- No auto-timeout — wait until Submit or Stop
- Status `waiting_for_input` distinct from manual `paused`
- One pending HITL request per session
- Scheduled job sessions use the same path (status waits forever)
- Do not log cleartext OTP in event payloads when avoidable
- i18n: en / ar / hi
- Follow existing unittest style under `backend/tests/`

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/human_input.py` | In-process Future registry: create wait, submit, cancel |
| `backend/app/hitl_message.py` | System-message hint for OTP / `request_human_input` |
| `backend/app/db.py` | Column `hitl_pending` (JSON text); clear on resolve/stop |
| `backend/app/models.py` | `HumanInputRequest` body model |
| `backend/app/routes/sessions.py` | `POST /{id}/human-input` |
| `backend/app/agent_runner.py` | Register custom tool; cancel HITL on stop; append HITL hint |
| `backend/tests/test_human_input.py` | Unit tests for waiter + submit/cancel semantics |
| `frontend/src/api.ts` | `submitHumanInput` + optional Session HITL fields |
| `frontend/src/components/HumanInputBanner.tsx` | Dedicated prompt + input + Submit / Stop |
| `frontend/src/components/ChatPanel.tsx` | Render banner when waiting |
| `frontend/src/App.tsx` | Refresh session on `human_input_required`; wire submit |
| `frontend/src/components/AgentsHistoryRail.tsx` | Status dot for `waiting_for_input` |
| `frontend/src/components/AgentSessionsPage.tsx` | Status label/class for `waiting_for_input` |
| `frontend/src/components/AnalyticsView.tsx` | Treat as live if listed with other live statuses |
| `frontend/src/i18n/locales/{en,ar,hi}.ts` | Copy keys |

---

### Task 1: Human-input waiter module

**Files:**
- Create: `backend/app/human_input.py`
- Test: `backend/tests/test_human_input.py`

**Interfaces:**
- Produces:
  - `async def begin_wait(session_id: str, prompt: str, input_type: str = "text") -> tuple[str, str]` → `(request_id, value)` where `value` is the submitted string (blocks until submit/cancel)
  - `def submit(session_id: str, value: str, request_id: str | None = None) -> bool`
  - `def cancel(session_id: str, reason: str = "stopped") -> bool`
  - `def get_pending(session_id: str) -> dict[str, str] | None` → `{request_id, prompt, input_type}` or `None`
  - Raises `HumanInputCancelled` when wait is cancelled (subclass of `Exception`)

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_human_input.py
import asyncio
import unittest

from app.human_input import HumanInputCancelled, begin_wait, cancel, get_pending, submit


class TestHumanInputWaiter(unittest.IsolatedAsyncioTestCase):
    async def test_submit_resolves_wait(self):
        async def waiter():
            rid, value = await begin_wait("s1", "Enter OTP", "otp")
            return rid, value

        task = asyncio.create_task(waiter())
        await asyncio.sleep(0.05)
        pending = get_pending("s1")
        self.assertIsNotNone(pending)
        self.assertEqual(pending["prompt"], "Enter OTP")
        self.assertEqual(pending["input_type"], "otp")
        ok = submit("s1", " 654321 ", pending["request_id"])
        self.assertTrue(ok)
        rid, value = await task
        self.assertEqual(value, "654321")
        self.assertIsNone(get_pending("s1"))

    async def test_empty_submit_rejected(self):
        async def waiter():
            return await begin_wait("s2", "code")

        task = asyncio.create_task(waiter())
        await asyncio.sleep(0.05)
        self.assertFalse(submit("s2", "   "))
        self.assertTrue(submit("s2", "ok"))
        _, value = await task
        self.assertEqual(value, "ok")

    async def test_cancel_raises(self):
        async def waiter():
            return await begin_wait("s3", "code")

        task = asyncio.create_task(waiter())
        await asyncio.sleep(0.05)
        self.assertTrue(cancel("s3"))
        with self.assertRaises(HumanInputCancelled):
            await task
        self.assertIsNone(get_pending("s3"))

    def test_submit_without_pending(self):
        self.assertFalse(submit("missing", "x"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m unittest tests.test_human_input -v`  
Expected: FAIL with `ModuleNotFoundError: No module named 'app.human_input'` (or import error)

- [ ] **Step 3: Implement `human_input.py`**

```python
# backend/app/human_input.py
"""In-process human-in-the-loop waits for live agent sessions."""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import uuid4

_lock = asyncio.Lock()
_futures: dict[str, asyncio.Future[str]] = {}
_meta: dict[str, dict[str, str]] = {}


class HumanInputCancelled(Exception):
    def __init__(self, reason: str = "stopped") -> None:
        self.reason = reason
        super().__init__(reason)


def get_pending(session_id: str) -> dict[str, str] | None:
    meta = _meta.get(session_id)
    return dict(meta) if meta else None


def submit(session_id: str, value: str, request_id: str | None = None) -> bool:
    trimmed = (value or "").strip()
    if not trimmed:
        return False
    fut = _futures.get(session_id)
    meta = _meta.get(session_id)
    if fut is None or meta is None or fut.done():
        return False
    if request_id is not None and request_id != meta.get("request_id"):
        return False
    fut.set_result(trimmed)
    return True


def cancel(session_id: str, reason: str = "stopped") -> bool:
    fut = _futures.get(session_id)
    if fut is None or fut.done():
        _futures.pop(session_id, None)
        _meta.pop(session_id, None)
        return False
    fut.set_exception(HumanInputCancelled(reason))
    return True


async def begin_wait(
    session_id: str, prompt: str, input_type: str = "text"
) -> tuple[str, str]:
    """Block until submit() or cancel(). Returns (request_id, value)."""
    async with _lock:
        # Replace any stale pending wait for this session
        old = _futures.get(session_id)
        if old is not None and not old.done():
            old.set_exception(HumanInputCancelled("replaced"))
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[str] = loop.create_future()
        request_id = str(uuid4())
        itype = input_type if input_type in ("otp", "text") else "text"
        _futures[session_id] = fut
        _meta[session_id] = {
            "request_id": request_id,
            "prompt": (prompt or "").strip() or "Human input required",
            "input_type": itype,
        }

    try:
        value = await fut
        return request_id, value
    finally:
        _futures.pop(session_id, None)
        _meta.pop(session_id, None)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m unittest tests.test_human_input -v`  
Expected: OK (all 4 tests PASS)

- [ ] **Step 5: Commit**

```bash
git add backend/app/human_input.py backend/tests/test_human_input.py
git commit -m "feat: add in-process human-input waiter for HITL OTP"
```

---

### Task 2: Persist pending HITL on session + clear helpers

**Files:**
- Modify: `backend/app/db.py` (`init_db` migrations + helpers)
- Test: `backend/tests/test_human_input.py` (add serialization helpers tests — pure functions)

**Interfaces:**
- Consumes: pending dict shape from Task 1
- Produces:
  - `def hitl_pending_to_json(meta: dict[str, str] | None) -> str | None`
  - `def hitl_pending_from_json(raw: str | None) -> dict[str, str] | None`
  - DB column `sessions.hitl_pending TEXT`
  - Callers use `await db.update_session(sid, hitl_pending=json_or_none)` and clear with `hitl_pending=None` (store SQL NULL)

- [ ] **Step 1: Add failing tests for JSON helpers**

Append to `backend/tests/test_human_input.py`:

```python
from app.db import hitl_pending_from_json, hitl_pending_to_json


class TestHitlPendingJson(unittest.TestCase):
    def test_roundtrip(self):
        meta = {"request_id": "a", "prompt": "OTP", "input_type": "otp"}
        raw = hitl_pending_to_json(meta)
        self.assertIsInstance(raw, str)
        self.assertEqual(hitl_pending_from_json(raw), meta)

    def test_none(self):
        self.assertIsNone(hitl_pending_to_json(None))
        self.assertIsNone(hitl_pending_from_json(None))
        self.assertIsNone(hitl_pending_from_json(""))
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run python -m unittest tests.test_human_input.TestHitlPendingJson -v`  
Expected: FAIL import / attribute error for helpers

- [ ] **Step 3: Implement helpers + migration**

In `backend/app/db.py`:

1. Near other helpers, add:

```python
def hitl_pending_to_json(meta: dict[str, Any] | None) -> str | None:
    if not meta:
        return None
    return json.dumps(
        {
            "request_id": str(meta.get("request_id") or ""),
            "prompt": str(meta.get("prompt") or ""),
            "input_type": str(meta.get("input_type") or "text"),
        }
    )


def hitl_pending_from_json(raw: str | None) -> dict[str, str] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    rid = str(data.get("request_id") or "").strip()
    prompt = str(data.get("prompt") or "").strip()
    if not rid or not prompt:
        return None
    itype = str(data.get("input_type") or "text")
    if itype not in ("otp", "text"):
        itype = "text"
    return {"request_id": rid, "prompt": prompt, "input_type": itype}
```

2. In `init_db` migrations (alongside existing `_ensure_column` calls):

```python
await _ensure_column(db, "sessions", "hitl_pending", "TEXT")
```

3. In `update_session`, allow setting `hitl_pending` to SQL NULL when value is `None`:

```python
async def update_session(session_id: str, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [session_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE sessions SET {cols} WHERE id = ?", values)
        await db.commit()
```

(Existing code already passes Python `None` as NULL — keep that. Callers pass `hitl_pending=None` to clear.)

4. Ensure `get_session` / `list_sessions` return the column via `SELECT *` (already true). Optionally parse in API layer later; for v1 returning raw JSON string on the session object is fine — frontend can `JSON.parse` if needed, **or** parse in `get_session` route. Prefer parsing once in a thin helper used by routes:

Add `def session_public(row: dict) -> dict` only if needed; simpler: in `routes/sessions.py` when returning session, attach `hitl_pending` as object if string. Do that in Task 3.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run python -m unittest tests.test_human_input -v`  
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add backend/app/db.py backend/tests/test_human_input.py
git commit -m "feat: persist session hitl_pending JSON for OTP modal restore"
```

---

### Task 3: API model + `POST /human-input` + stop cancels wait

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/routes/sessions.py`
- Modify: `backend/app/agent_runner.py` (`control_agent` stop path)
- Test: `backend/tests/test_human_input_api.py` (lightweight: model validation + submit/cancel wiring with mocks if HTTP hard; prefer unit-testing route helpers)

**Interfaces:**
- Consumes: `human_input.submit`, `human_input.cancel`, `db.update_session`, `db.hitl_pending_*`
- Produces:
  - `class HumanInputRequest(BaseModel): value: str; request_id: str | None = None`
  - `POST /api/sessions/{session_id}/human-input` → `{ok: true}`
  - On stop: `cancel(session_id)` + clear `hitl_pending`

- [ ] **Step 1: Write failing model/route contract tests**

```python
# backend/tests/test_human_input_api.py
import unittest

from app.models import HumanInputRequest


class TestHumanInputRequestModel(unittest.TestCase):
    def test_requires_value(self):
        m = HumanInputRequest(value="123456")
        self.assertEqual(m.value, "123456")
        self.assertIsNone(m.request_id)

    def test_with_request_id(self):
        m = HumanInputRequest(value="1", request_id="abc")
        self.assertEqual(m.request_id, "abc")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run — expect fail**

Run: `cd backend && uv run python -m unittest tests.test_human_input_api -v`  
Expected: FAIL `ImportError` / missing `HumanInputRequest`

- [ ] **Step 3: Add model**

In `backend/app/models.py` after `SessionControlRequest`:

```python
class HumanInputRequest(BaseModel):
    value: str = Field(min_length=1)
    request_id: str | None = None
```

- [ ] **Step 4: Add route**

In `backend/app/routes/sessions.py`:

```python
from .. import human_input as hitl
from ..models import CreateSessionRequest, HumanInputRequest, MessageRequest, SessionControlRequest


def _public_session(session: dict) -> dict:
    out = dict(session)
    raw = out.get("hitl_pending")
    if isinstance(raw, str):
        out["hitl_pending"] = db.hitl_pending_from_json(raw)
    return out


# Update get_session (and list if desired) to use _public_session
@router.get("/{session_id}")
async def get_session(session_id: str):
    session = await db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return _public_session(session)


@router.post("/{session_id}/human-input")
async def post_human_input(session_id: str, body: HumanInputRequest):
    sess = await db.get_session(session_id)
    if not sess:
        raise HTTPException(404, "Session not found")
    if sess.get("status") != "waiting_for_input":
        raise HTTPException(409, "Session is not waiting for input")
    value = body.value.strip()
    if not value:
        raise HTTPException(400, "Value is required")
    ok = hitl.submit(session_id, value, body.request_id)
    if not ok:
        raise HTTPException(409, "No pending human-input request")
    await db.update_session(session_id, hitl_pending=None, status="running")
    from ..agent_runner import emit_status  # prefer existing _emit — see Step 5
    return {"ok": True}
```

**Important:** Do not invent `emit_status` if it does not exist. Use a small public helper in `agent_runner.py`:

```python
async def notify_human_input_resolved(session_id: str) -> None:
    await db.update_session(session_id, hitl_pending=None, status="running")
    await _emit(session_id, "status", {"status": "running", "message": "Human input received"})
```

Then route calls `hitl.submit` then `await notify_human_input_resolved(session_id)` (avoid double status update — pick one place). Preferred: route only submits Future; the tool’s `begin_wait` finally-block / post-await code in the custom action updates status to running and clears pending. Route should:

```python
ok = hitl.submit(...)
if not ok:
    raise HTTPException(409, "No pending human-input request")
return {"ok": True}
```

Status/DB clear happens inside the tool handler after `begin_wait` returns (Task 4). Route still validates `status == waiting_for_input`.

- [ ] **Step 5: Cancel on stop in `control_agent`**

In `backend/app/agent_runner.py` `control_agent`, for `action == "stop"` (both queued and live paths that set stopped), after/before stop:

```python
from . import human_input as hitl

hitl.cancel(session_id)
await db.update_session(session_id, hitl_pending=None, status="stopped")
```

Ensure every stop branch clears `hitl_pending`.

- [ ] **Step 6: Run model tests**

Run: `cd backend && uv run python -m unittest tests.test_human_input_api tests.test_human_input -v`  
Expected: OK

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/routes/sessions.py backend/app/agent_runner.py backend/tests/test_human_input_api.py
git commit -m "feat: add POST /human-input and cancel HITL on stop"
```

---

### Task 4: Register `request_human_input` tool + system hint

**Files:**
- Create: `backend/app/hitl_message.py`
- Modify: `backend/app/agent_runner.py` (build Tools, pass to Agent, append hint)
- Test: `backend/tests/test_hitl_message.py`

**Interfaces:**
- Consumes: `human_input.begin_wait`, `HumanInputCancelled`, `db`, `_emit`
- Produces: Agent receives custom tool; on call → status `waiting_for_input`, persist pending, WS event, return value to LLM

- [ ] **Step 1: Failing test for system hint content**

```python
# backend/tests/test_hitl_message.py
import unittest

from app.hitl_message import HITL_SYSTEM_MESSAGE


class TestHitlMessage(unittest.TestCase):
    def test_mentions_tool_and_otp(self):
        self.assertIn("request_human_input", HITL_SYSTEM_MESSAGE)
        self.assertIn("OTP", HITL_SYSTEM_MESSAGE)
        self.assertIn("Never invent", HITL_SYSTEM_MESSAGE)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run — expect fail**

Run: `cd backend && uv run python -m unittest tests.test_hitl_message -v`  
Expected: FAIL import

- [ ] **Step 3: Implement hint module**

```python
# backend/app/hitl_message.py
HITL_SYSTEM_MESSAGE = """
# Human input (mandatory)

When a page asks for OTP, MFA, verification codes, or any one-time value only a human can provide:
- Call the **request_human_input** action with a clear prompt (and input_type \"otp\" when appropriate).
- Wait for the returned value, then type it into the correct field and continue.
- Never invent or guess one-time codes.
""".strip()
```

- [ ] **Step 4: Wire tool into `run_session`**

Near Agent construction in `agent_runner.py` (where `agent_kwargs` is built):

```python
from browser_use.tools.service import Tools
from browser_use.agent.views import ActionResult
from pydantic import BaseModel, Field
from . import human_input as hitl
from .hitl_message import HITL_SYSTEM_MESSAGE

extend_system = f"{extend_system}\n\n{HITL_SYSTEM_MESSAGE}"

class RequestHumanInputParams(BaseModel):
    prompt: str = Field(..., description="Message shown to the human operator")
    input_type: str = Field(default="text", description='\"otp\" or \"text\"')

tools = Tools()

@tools.action(
    "Ask the human operator for a value (OTP, MFA code, etc). Blocks until they submit.",
    param_model=RequestHumanInputParams,
)
async def request_human_input(params: RequestHumanInputParams) -> ActionResult:
    itype = params.input_type if params.input_type in ("otp", "text") else "text"
    # Create pending Future metadata first by starting wait in a task pattern:
    # begin_wait both registers meta and awaits — so emit after a short yield.
    # Pattern: register via begin_wait; emit using get_pending after scheduling.
    async def _run_wait() -> str:
        request_id, value = await hitl.begin_wait(session_id, params.prompt, itype)
        return value

    # Persist + notify BEFORE blocking: begin_wait sets meta synchronously before await.
    # So kick off begin_wait carefully:
    wait_task = asyncio.create_task(_run_wait())
    await asyncio.sleep(0)  # let begin_wait acquire lock and set _meta
    pending = hitl.get_pending(session_id)
    if pending:
        await db.update_session(
            session_id,
            status="waiting_for_input",
            hitl_pending=db.hitl_pending_to_json(pending),
        )
        await _emit(
            session_id,
            "human_input_required",
            {
                "request_id": pending["request_id"],
                "prompt": pending["prompt"],
                "input_type": pending["input_type"],
            },
        )
        await _emit(session_id, "status", {"status": "waiting_for_input"})
        await db.add_event(
            session_id,
            "human_input_required",
            {
                "request_id": pending["request_id"],
                "prompt": pending["prompt"],
                "input_type": pending["input_type"],
            },
        )
    try:
        value = await wait_task
    except hitl.HumanInputCancelled as e:
        return ActionResult(error=f"Human input cancelled ({e.reason})")
    await db.update_session(session_id, hitl_pending=None, status="running")
    await _emit(session_id, "status", {"status": "running", "message": "Human input received"})
    await db.add_event(
        session_id,
        "human_input_resolved",
        {"request_id": pending["request_id"] if pending else None, "redacted": True},
    )
    return ActionResult(
        extracted_content=value,
        long_term_memory="Received human input (value redacted from memory display).",
        include_extracted_content_only_once=True,
    )

agent_kwargs["tools"] = tools
```

**Note:** If `Tools()` constructor or `@tools.action` signature differs slightly in the installed browser-use version, adjust to match `Tools.action` / `Registry.action` (verified: `description`, `param_model`). If the decorated function must use kwargs instead of a params model, follow browser-use’s normalized signature.

Also clear `hitl_pending` in `run_session` `finally` / failure paths:

```python
hitl.cancel(session_id)
await db.update_session(session_id, hitl_pending=None)
```

(Only when ending the run — do not cancel mid-success.)

- [ ] **Step 5: Run unit tests**

Run: `cd backend && uv run python -m unittest tests.test_hitl_message tests.test_human_input tests.test_human_input_api -v`  
Expected: OK

- [ ] **Step 6: Commit**

```bash
git add backend/app/hitl_message.py backend/app/agent_runner.py backend/tests/test_hitl_message.py
git commit -m "feat: register request_human_input tool and OTP system hint"
```

---

### Task 5: Frontend API + HumanInputBanner

**Files:**
- Modify: `frontend/src/api.ts`
- Create: `frontend/src/components/HumanInputBanner.tsx`
- Modify: `frontend/src/i18n/locales/en.ts`, `ar.ts`, `hi.ts`

**Interfaces:**
- Consumes: `POST /api/sessions/{id}/human-input`
- Produces: `api.submitHumanInput(id, { value, request_id? })`; banner props

- [ ] **Step 1: Extend Session type + API client**

In `frontend/src/api.ts`:

```typescript
export type HitlPending = {
  request_id: string
  prompt: string
  input_type: 'otp' | 'text' | string
}

export type Session = {
  // ...existing fields...
  hitl_pending?: HitlPending | string | null
}

// on api object:
submitHumanInput: (id: string, body: { value: string; request_id?: string }) =>
  fetch(`/api/sessions/${id}/human-input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => json<{ ok: boolean }>(r)),
```

- [ ] **Step 2: Add i18n keys** (en + ar + hi)

```typescript
// en.ts
waitingForInput: 'Waiting for input',
humanInputTitle: 'Human input required',
humanInputPlaceholder: 'Enter code',
humanInputSubmit: 'Submit',
humanInputHint: 'The agent is paused until you provide this value.',
```

Mirror in `ar.ts` and `hi.ts` with appropriate translations.

- [ ] **Step 3: Create banner component**

```tsx
// frontend/src/components/HumanInputBanner.tsx
import { useState } from 'react'
import { usePreferences } from '../preferences'
import type { HitlPending } from '../api'

type Props = {
  pending: HitlPending
  busy?: boolean
  onSubmit: (value: string) => void | Promise<void>
  onStop: () => void
}

export default function HumanInputBanner({ pending, busy, onSubmit, onStop }: Props) {
  const { t } = usePreferences()
  const [value, setValue] = useState('')
  const canSubmit = value.trim().length > 0 && !busy

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <div className="text-sm font-medium text-amber-200">{t('humanInputTitle')}</div>
      <p className="mt-1 text-sm text-ink-200">{pending.prompt}</p>
      <p className="mt-1 text-xs text-ink-400">{t('humanInputHint')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="flex-1 min-w-[12rem] rounded border border-line bg-ink-950 px-3 py-2 text-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('humanInputPlaceholder')}
          inputMode={pending.input_type === 'otp' ? 'numeric' : 'text'}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void onSubmit(value.trim())
          }}
        />
        <button
          type="button"
          disabled={!canSubmit}
          className="rounded bg-bu-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          onClick={() => void onSubmit(value.trim())}
        >
          {t('humanInputSubmit')}
        </button>
        <button
          type="button"
          className="rounded border border-line px-3 py-2 text-sm"
          onClick={onStop}
        >
          {t('stop')}
        </button>
      </div>
    </div>
  )
}
```

Use existing `t('stop')` if present; otherwise add `stop: 'Stop'`.

- [ ] **Step 4: Typecheck / lint as available**

Run: `cd frontend && npx tsc --noEmit` (or project’s usual check)  
Expected: no errors from new files (may still fail on unrelated WIP — fix only HITL-related)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/components/HumanInputBanner.tsx frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/ar.ts frontend/src/i18n/locales/hi.ts
git commit -m "feat: add HumanInputBanner and submitHumanInput API client"
```

---

### Task 6: Wire banner into ChatPanel + App WebSocket

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: session.status, session.hitl_pending, events `human_input_required`, `api.submitHumanInput`, `onControl('stop')`

- [ ] **Step 1: Helper to normalize pending**

In ChatPanel (or small util):

```typescript
function parseHitlPending(session: Session | null, events: Event[]): HitlPending | null {
  if (!session || session.status !== 'waiting_for_input') return null
  const raw = session.hitl_pending
  if (raw && typeof raw === 'object' && raw.request_id && raw.prompt) return raw as HitlPending
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as HitlPending
      if (p?.request_id && p?.prompt) return p
    } catch { /* ignore */ }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'human_input_required' && e.payload?.prompt) {
      return {
        request_id: String(e.payload.request_id || ''),
        prompt: String(e.payload.prompt),
        input_type: String(e.payload.input_type || 'text'),
      }
    }
  }
  return {
    request_id: '',
    prompt: 'Human input required',
    input_type: 'text',
  }
}
```

- [ ] **Step 2: Render banner at top of chat workspace**

When `parseHitlPending(...)` is non-null, render `<HumanInputBanner />` above the message list (not inside the composer).

```tsx
const pending = parseHitlPending(session, events)
// ...
{pending && (
  <HumanInputBanner
    pending={pending}
    busy={submittingHitl}
    onSubmit={async (value) => {
      setSubmittingHitl(true)
      try {
        await api.submitHumanInput(session!.id, {
          value,
          request_id: pending.request_id || undefined,
        })
      } finally {
        setSubmittingHitl(false)
      }
    }}
    onStop={() => onControl('stop')}
  />
)}
```

Disable composer send while `waiting_for_input` if that prevents confusing follow-ups (optional but recommended).

- [ ] **Step 3: App.tsx WebSocket refresh**

Where events trigger `api.getSession`, also refresh on `human_input_required`:

```typescript
if (
  ev.type === 'status' ||
  ev.type === 'step' ||
  ev.type === 'preview' ||
  ev.type === 'done' ||
  ev.type === 'error' ||
  ev.type === 'human_input_required'
) {
  api.getSession(sessionId).then(setSession).catch(() => {})
}
```

- [ ] **Step 4: Manual smoke (dev)**

1. Start backend + frontend  
2. Run a task that hits OTP (or temporarily call the tool via a prompt: “If you see a verification code field, call request_human_input”)  
3. Confirm modal, Submit, continue  

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/src/App.tsx
git commit -m "feat: show HITL banner on waiting_for_input sessions"
```

---

### Task 7: Status chips in lists + live filters

**Files:**
- Modify: `frontend/src/components/AgentsHistoryRail.tsx`
- Modify: `frontend/src/components/AgentSessionsPage.tsx`
- Modify: `frontend/src/components/AnalyticsView.tsx` (and A2A live filter if it lists agent sessions)
- Modify: `frontend/src/components/ChatPanel.tsx` status label if it shows paused/running text

- [ ] **Step 1: History rail dot**

```typescript
if (status === 'waiting_for_input') return 'bg-amber-400'
```

- [ ] **Step 2: AgentSessionsPage label/class**

```typescript
case 'waiting_for_input':
  return t('waitingForInput')
// class: amber styling similar to paused
case 'waiting_for_input':
  return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
```

- [ ] **Step 3: Live session filters**

Where arrays include `'paused'`, also include `'waiting_for_input'`:

- `AnalyticsView.tsx`
- `ChatPanel.tsx` (busy session checks)
- `A2AConsolePage.tsx` if applicable

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AgentsHistoryRail.tsx frontend/src/components/AgentSessionsPage.tsx frontend/src/components/AnalyticsView.tsx frontend/src/components/ChatPanel.tsx frontend/src/components/A2AConsolePage.tsx
git commit -m "feat: surface waiting_for_input status in session lists"
```

---

### Task 8: End-to-end verification checklist

**Files:** none (manual)

- [ ] **Step 1: Backend unit suite**

Run: `cd backend && uv run python -m unittest tests.test_human_input tests.test_human_input_api tests.test_hitl_message -v`  
Expected: OK

- [ ] **Step 2: Manual checklist from spec**

- [ ] Agent calls `request_human_input` → status `waiting_for_input` → banner appears  
- [ ] Submit → agent continues with value  
- [ ] Stop while waiting → `stopped`, no hang  
- [ ] Refresh/reopen live waiting session → banner restores from `hitl_pending`  
- [ ] Empty submit blocked  
- [ ] Manual pause/resume still works when not waiting  
- [ ] Status chip shows Waiting for input  

- [ ] **Step 3: Final commit if any fixes**

```bash
git add -A  # only HITL-related fixes
git commit -m "fix: polish human-in-the-loop OTP edge cases"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Custom `request_human_input` tool | Task 4 |
| Status `waiting_for_input` | Tasks 4, 6, 7 |
| WS `human_input_required` | Task 4 |
| `POST .../human-input` | Task 3 |
| Dedicated modal/banner | Tasks 5–6 |
| Wait indefinitely | Task 1 (no timeout) |
| Stop cancels wait | Task 3 |
| Persist pending for restore | Task 2 |
| System hint never invent OTP | Task 4 |
| Scheduled same path | Tasks 4+6 (same session status) |
| One pending per session | Task 1 (replace/cancel old) |
| Redact OTP in events | Task 4 (`human_input_resolved` redacted) |
| i18n en/ar/hi | Task 5 |
| Status chips | Task 7 |
| Manual pause distinct | Task 3/4 (no pause required for HITL) |

No TBD placeholders; names consistent: `begin_wait` / `submit` / `cancel` / `get_pending` / `HumanInputCancelled` / `hitl_pending` / `request_human_input`.
