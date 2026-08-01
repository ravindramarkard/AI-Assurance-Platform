# Screenshot Archive Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Configuration setting `Screenshot archive` (`always` | `on_failure` | `never`) that gates numbered `step_####.png` saves while keeping live preview, with Headless-aware defaults and a user-override flag.

**Architecture:** Pure helpers in `screenshot_archive.py` resolve mode and classify failed steps. Settings persist via existing DB keys. `agent_runner.on_step` re-reads effective settings each step, always updates `latest.png`, and only calls `_save_shot` when the mode allows. Configuration UI sits next to Headless.

**Tech Stack:** Python 3 / unittest, FastAPI settings routes, React + TypeScript Configuration page, existing i18n

## Global Constraints

- Modes exactly: `always` | `on_failure` | `never` (stored as `screenshot_archive`)
- Live preview always on: `_save_latest` + WS; no `live_####` archive
- Default when unset/invalid: `on_failure` if headless else `always`
- Headless toggle suggests archive only when `screenshot_archive_user_set` is false
- Manual archive change sets `screenshot_archive_user_set` = true
- Re-read archive mode each `on_step` (mid-run Configuration save applies)
- Do not change LLM vision behavior
- Do not commit unless the user explicitly asks

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/screenshot_archive.py` | resolve mode, suggest from headless, failed-step classify, should_archive |
| `backend/tests/test_screenshot_archive.py` | Unit tests for helpers |
| `backend/app/models.py` | SettingsUpdate fields |
| `backend/app/routes/settings.py` | ALLOWED + persist bool/string |
| `backend/app/llm_factory.py` | effective_settings + public_settings |
| `backend/app/agent_runner.py` | Gate `_save_shot`; always `_save_latest`; GIF skip when never |
| `frontend/src/api.ts` | AppSettings types |
| `frontend/src/components/AgentBrowserConfiguration.tsx` | UI control + headless coupling |
| `frontend/src/i18n/locales/{en,ar,hi}.ts` | Labels / help |

---

### Task 1: Pure helpers (`screenshot_archive.py`)

**Files:**
- Create: `backend/app/screenshot_archive.py`
- Test: `backend/tests/test_screenshot_archive.py`

**Interfaces:**
- Produces:
  - `ARCHIVE_ALWAYS = "always"`, `ARCHIVE_ON_FAILURE = "on_failure"`, `ARCHIVE_NEVER = "never"`
  - `def normalize_screenshot_archive(value: Any) -> str | None` — valid mode or None
  - `def resolve_screenshot_archive(stored: Any, *, headless: bool) -> str`
  - `def suggest_screenshot_archive(*, headless: bool) -> str` — `on_failure` if headless else `always`
  - `def apply_headless_archive_default(*, headless: bool, archive: str, user_set: bool) -> str` — if user_set return archive else suggest
  - `def step_looks_failed(*, actions: list[str] | None, thought: str | None) -> bool`
  - `def should_archive_step_screenshot(mode: str, *, failed: bool) -> bool`

- [ ] **Step 1: Write failing tests**

```python
import unittest

from app.screenshot_archive import (
    apply_headless_archive_default,
    normalize_screenshot_archive,
    resolve_screenshot_archive,
    should_archive_step_screenshot,
    step_looks_failed,
    suggest_screenshot_archive,
)


class TestScreenshotArchive(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(normalize_screenshot_archive("ALWAYS"), "always")
        self.assertEqual(normalize_screenshot_archive("on_failure"), "on_failure")
        self.assertEqual(normalize_screenshot_archive("never"), "never")
        self.assertIsNone(normalize_screenshot_archive("nope"))
        self.assertIsNone(normalize_screenshot_archive(None))

    def test_resolve_defaults(self):
        self.assertEqual(resolve_screenshot_archive(None, headless=True), "on_failure")
        self.assertEqual(resolve_screenshot_archive(None, headless=False), "always")
        self.assertEqual(resolve_screenshot_archive("bogus", headless=True), "on_failure")
        self.assertEqual(resolve_screenshot_archive("never", headless=True), "never")

    def test_suggest_and_apply(self):
        self.assertEqual(suggest_screenshot_archive(headless=True), "on_failure")
        self.assertEqual(suggest_screenshot_archive(headless=False), "always")
        self.assertEqual(
            apply_headless_archive_default(headless=True, archive="always", user_set=False),
            "on_failure",
        )
        self.assertEqual(
            apply_headless_archive_default(headless=True, archive="never", user_set=True),
            "never",
        )

    def test_step_failed(self):
        self.assertTrue(step_looks_failed(actions=["error: timeout"], thought=None))
        self.assertTrue(step_looks_failed(actions=["Click x"], thought="Failed. Selector missing"))
        self.assertFalse(step_looks_failed(actions=["Click — #ok"], thought="Done."))

    def test_should_archive(self):
        self.assertTrue(should_archive_step_screenshot("always", failed=False))
        self.assertTrue(should_archive_step_screenshot("on_failure", failed=True))
        self.assertFalse(should_archive_step_screenshot("on_failure", failed=False))
        self.assertFalse(should_archive_step_screenshot("never", failed=True))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run — expect FAIL (import)**

`cd backend && .venv/bin/python -m unittest tests.test_screenshot_archive -v`

- [ ] **Step 3: Implement helpers**

```python
from __future__ import annotations

import re
from typing import Any

ARCHIVE_ALWAYS = "always"
ARCHIVE_ON_FAILURE = "on_failure"
ARCHIVE_NEVER = "never"
_VALID = {ARCHIVE_ALWAYS, ARCHIVE_ON_FAILURE, ARCHIVE_NEVER}

_ERROR_ACTION = re.compile(r"(?i)^\s*error\b|\berror\b")
_FAILED_THOUGHT = re.compile(r"(?i)^\s*failed\b|\bfailed\.")


def normalize_screenshot_archive(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip().lower()
    return s if s in _VALID else None


def resolve_screenshot_archive(stored: Any, *, headless: bool) -> str:
    n = normalize_screenshot_archive(stored)
    if n:
        return n
    return ARCHIVE_ON_FAILURE if headless else ARCHIVE_ALWAYS


def suggest_screenshot_archive(*, headless: bool) -> str:
    return ARCHIVE_ON_FAILURE if headless else ARCHIVE_ALWAYS


def apply_headless_archive_default(*, headless: bool, archive: str, user_set: bool) -> str:
    if user_set:
        return normalize_screenshot_archive(archive) or suggest_screenshot_archive(headless=headless)
    return suggest_screenshot_archive(headless=headless)


def step_looks_failed(*, actions: list[str] | None, thought: str | None) -> bool:
    for a in actions or []:
        if _ERROR_ACTION.search(str(a) or ""):
            return True
    t = (thought or "").strip()
    if t and _FAILED_THOUGHT.search(t):
        return True
    return False


def should_archive_step_screenshot(mode: str, *, failed: bool) -> bool:
    m = normalize_screenshot_archive(mode) or ARCHIVE_ALWAYS
    if m == ARCHIVE_NEVER:
        return False
    if m == ARCHIVE_ON_FAILURE:
        return bool(failed)
    return True
```

- [ ] **Step 4: Run — PASS**

`cd backend && .venv/bin/python -m unittest tests.test_screenshot_archive -v`

---

### Task 2: Settings API + effective/public settings

**Files:**
- Modify: `backend/app/models.py` (`SettingsUpdate`)
- Modify: `backend/app/routes/settings.py` (`ALLOWED` + persist)
- Modify: `backend/app/llm_factory.py` (`effective_settings`, `public_settings`)
- Test: extend `backend/tests/test_screenshot_archive.py` **or** add assertions in a small settings unit if easy; prefer testing resolve via effective dict construction helper if one exists — otherwise add:

```python
# In test file — pure check that public mapping coerces user_set
from app.screenshot_archive import resolve_screenshot_archive

class TestEffectiveResolve(unittest.TestCase):
    def test_public_shape_keys_documented(self):
        # smoke: resolve used the same way llm_factory will
        self.assertEqual(
            resolve_screenshot_archive("on_failure", headless=False),
            "on_failure",
        )
```

(Full HTTP settings test optional; wire carefully.)

**Interfaces:**
- `SettingsUpdate.screenshot_archive: Literal["always","on_failure","never"] | None`
- `SettingsUpdate.screenshot_archive_user_set: bool | None`
- `effective_settings()` includes `screenshot_archive` (resolved string) and `screenshot_archive_user_set` (bool)
- `public_settings()` exposes both

- [ ] **Step 1: Add model fields**

```python
screenshot_archive: Literal["always", "on_failure", "never"] | None = None
screenshot_archive_user_set: bool | None = None
```

- [ ] **Step 2: ALLOWED + persistence in `update_settings`**

Add `"screenshot_archive"`, `"screenshot_archive_user_set"` to `ALLOWED`.

When saving:
- `screenshot_archive`: normalize; if invalid skip or default; `await db.set_setting("screenshot_archive", mode)`
- `screenshot_archive_user_set`: store `"true"` / `"false"` like headless

- [ ] **Step 3: `effective_settings`**

After loading stored dict:

```python
from .screenshot_archive import resolve_screenshot_archive

# in out defaults:
"screenshot_archive": None,  # raw until resolve
"screenshot_archive_user_set": False,

# when reading stored:
elif k == "screenshot_archive_user_set":
    out[k] = v.lower() in ("1", "true", "yes")
# screenshot_archive stays raw string via else branch

# after loop:
out["screenshot_archive"] = resolve_screenshot_archive(
    out.get("screenshot_archive"),
    headless=bool(out.get("headless", True)),
)
```

- [ ] **Step 4: `public_settings`** — include `screenshot_archive` and `screenshot_archive_user_set` in returned dict (same as other non-secret fields).

- [ ] **Step 5: Run helper tests still PASS**

`cd backend && .venv/bin/python -m unittest tests.test_screenshot_archive -v`

---

### Task 3: Gate `on_step` archive + GIF skip

**Files:**
- Modify: `backend/app/agent_runner.py`
- Test: `backend/tests/test_screenshot_archive_runner.py` — unit-test a small extracted decision block **or** test `_save` gating via a focused helper:

Add to `screenshot_archive.py` (if useful):

```python
def archive_decision(mode: str, *, failed: bool, has_b64: bool) -> bool:
    return bool(has_b64) and should_archive_step_screenshot(mode, failed=failed)
```

Test that; keep runner wiring thin.

- [ ] **Step 1: Failing test for `archive_decision`**

```python
from app.screenshot_archive import archive_decision

def test_archive_decision(self):
    self.assertFalse(archive_decision("always", failed=False, has_b64=False))
    self.assertTrue(archive_decision("always", failed=False, has_b64=True))
    self.assertFalse(archive_decision("on_failure", failed=False, has_b64=True))
    self.assertTrue(archive_decision("on_failure", failed=True, has_b64=True))
    self.assertFalse(archive_decision("never", failed=True, has_b64=True))
```

Implement `archive_decision` in Task 1 file if not already there.

- [ ] **Step 2: Reorder `on_step` in `agent_runner.py`**

Pseudo:

```python
async def on_step(...):
    ...
    screenshot_b64 = _screenshot_from_state(browser_state)
    thought_fields = _thought_fields(model_output)
    thought = _extract_thought(model_output)
    actions = _extract_actions(model_output)
    ...
    cfg_now = await effective_settings()
    mode = resolve_screenshot_archive(
        cfg_now.get("screenshot_archive"),
        headless=bool(cfg_now.get("headless", True)),
    )
    # note: effective_settings already resolves archive — can use cfg_now["screenshot_archive"] directly
    mode = str(cfg_now.get("screenshot_archive") or "always")
    failed = step_looks_failed(actions=actions, thought=thought)

    rel_shot = None
    if screenshot_b64:
        await _save_latest(screenshots, screenshot_b64)
        if should_archive_step_screenshot(mode, failed=failed):
            rel_shot = await _save_shot(screenshots, "step", screenshot_b64)

    payload = {..., "screenshot": rel_shot, ...}
    if rel_shot and screenshot_b64 and len(screenshot_b64) < 1_500_000:
        payload["screenshot_b64"] = screenshot_b64
    # do NOT attach screenshot_b64 when not archived (never / pass under on_failure)
```

Ensure existing preview emit after step still uses latest / b64 for UI as today where appropriate — if step currently emits `preview`, keep updating preview with b64 even when not archived (live preview requirement).

- [ ] **Step 3: `_auto_recording_gif`**

At start:

```python
cfg = await effective_settings()
mode = str(cfg.get("screenshot_archive") or "")
if mode == "never":
    logger.debug("skip recording.gif — screenshot_archive=never")
    return
```

(FileNotFoundError path already handles zero frames for `on_failure` with no fails.)

- [ ] **Step 4: Run tests**

`cd backend && .venv/bin/python -m unittest tests.test_screenshot_archive tests.test_screenshot_save -v`

---

### Task 4: Configuration UI + i18n

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/AgentBrowserConfiguration.tsx`
- Modify: `frontend/src/i18n/locales/en.ts` (and `ar.ts`, `hi.ts` — English strings OK as fallback keys if locale incomplete; add en at minimum, mirror keys in ar/hi)

**Interfaces:**
- `AppSettings.screenshot_archive?: 'always' | 'on_failure' | 'never'`
- `AppSettings.screenshot_archive_user_set?: boolean`

- [ ] **Step 1: Extend `api.ts` types** for settings + update payload.

- [ ] **Step 2: Form state**

```ts
type ScreenshotArchive = 'always' | 'on_failure' | 'never'

type FormState = {
  headless: boolean
  screenshot_archive: ScreenshotArchive
  screenshot_archive_user_set: boolean
  // ...existing
}
```

Load from settings; if missing archive, derive: `settings.headless ? 'on_failure' : 'always'`.

- [ ] **Step 3: Headless checkbox onChange**

```ts
onChange={(e) => {
  const headless = e.target.checked
  setForm((prev) => ({
    ...prev,
    headless,
    screenshot_archive: prev.screenshot_archive_user_set
      ? prev.screenshot_archive
      : headless
        ? 'on_failure'
        : 'always',
  }))
}}
```

- [ ] **Step 4: Screenshot archive `<select>`** next to Headless

Options: Always / On failure only / Never.  
`onChange` → set archive + `screenshot_archive_user_set: true`.

Help text under control (en):  
`Live preview still updates while the agent runs. This only controls saving numbered step_####.png files into Artifacts.`

- [ ] **Step 5: save()**

```ts
await api.updateSettings({
  ...
  headless: form.headless,
  screenshot_archive: form.screenshot_archive,
  screenshot_archive_user_set: form.screenshot_archive_user_set,
})
```

Refresh form from response.

- [ ] **Step 6: i18n keys**

```ts
screenshotArchive: 'Screenshot archive',
screenshotArchiveAlways: 'Always',
screenshotArchiveOnFailure: 'On failure only',
screenshotArchiveNever: 'Never',
screenshotArchiveHelp:
  'Live preview still updates while the agent runs. This only controls saving numbered step screenshots into Artifacts.',
```

- [ ] **Step 7: Manual checklist**

1. Config → Headless on → archive shows On failure only (fresh user-set false).
2. Change archive to Never → toggle Headless off/on → stays Never.
3. Run agent with Never → Artifacts have `latest.png`, no new `step_####`.
4. Run with On failure only → pass steps no PNG; inject/force error step → `step_####` appears.
5. Live pane still updates in Never mode.

---

## Spec coverage

| Spec | Task |
|------|------|
| resolve / defaults | 1 |
| Settings persist + public | 2 |
| on_step gate + latest + no b64 when not archived | 3 |
| GIF skip never | 3 |
| Config UI + headless coupling + user_set | 4 |
| Edge cases in unit tests | 1, 3 |
| Vision unchanged | — |
| Export missing images OK | existing export already optional shots |

## Self-review

- No placeholders.
- `effective_settings` must not double-resolve incorrectly when raw stored is already normalized.
- Frontend user_set must round-trip from API or Headless coupling breaks after reload.
