# Auto Vision Probe Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace boolean Vision override with Auto/On/Off and live-probe local OpenAI-compatible endpoints so Vision turns off automatically when image payloads are rejected.

**Architecture:** New `vision_probe.py` owns probe HTTP + cache key + `ensure_vision_for_cfg`. Settings persist `llm_vision_mode` and probe cache fields; migrate old `llm_use_vision`. Agent start and Test connection refresh the probe for local Auto. Cloud Auto skips probe and enables vision.

**Tech Stack:** FastAPI, httpx/urllib, aiosqlite settings, React Settings UI, unittest with mocked HTTP.

## Global Constraints

- Modes: `auto` | `on` | `off` (default `auto`)
- Auto + local → live tiny-PNG probe; cache by `provider|base_url|model`
- Auto + openai/anthropic/browser_use → True without probe
- Probe timeout 20s; failure/timeout → unsupported (False)
- Supported iff HTTP 200, non-empty `choices`, no gateway `error`
- Probe on Test connection + agent start (cache miss/stale key); never per step
- Migrate `llm_use_vision` true/false → on/off; delete old key
- Temperature unchanged
- TDD; commit per task

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/vision_probe.py` | Probe, cache key, ensure_vision_for_cfg, response classification |
| `backend/tests/test_vision_probe.py` | Unit tests for classification + ensure logic (mocked HTTP) |
| `backend/app/local_llm.py` | Keep temperature helpers; deprecate override-only resolve or thin-wrap |
| `backend/app/config.py` / `models.py` / `routes/settings.py` / `llm_factory.py` | Mode + cache settings API + migration |
| `backend/app/agent_runner.py` | await ensure_vision_for_cfg before Agent |
| `backend/app/llm_factory.py` | test_llm returns vision_supported; public_settings fields |
| `frontend/src/api.ts` / `SettingsPanel.tsx` / i18n | Auto/On/Off UI + status |

---

### Task 1: Vision probe module (pure logic + mocked HTTP)

**Files:**
- Create: `backend/app/vision_probe.py`
- Create: `backend/tests/test_vision_probe.py`

**Interfaces:**
- Produces:
  - `VISION_PROBE_TIMEOUT_S = 20`
  - `TINY_PNG_B64: str` (1×1 png)
  - `vision_probe_key(provider: str, base_url: str | None, model: str) -> str`
  - `classify_vision_probe_response(status: int, body: Any) -> bool`
  - `needs_live_vision_probe(provider: str | None) -> bool`  # True only for local
  - `async def probe_vision_support(cfg: dict[str, Any]) -> bool`
  - `def resolve_vision_mode(mode: str | None) -> Literal["auto","on","off"]`
  - `async def ensure_vision_for_cfg(cfg: dict[str, Any], *, force_refresh: bool = False, persist: bool = True) -> bool`

- [ ] **Step 1: Write failing tests**

`backend/tests/test_vision_probe.py`:

```python
import unittest
from app.vision_probe import (
    classify_vision_probe_response,
    needs_live_vision_probe,
    resolve_vision_mode,
    vision_probe_key,
)


class TestClassify(unittest.TestCase):
    def test_ok_choices(self):
        self.assertTrue(
            classify_vision_probe_response(
                200, {"choices": [{"message": {"content": "ok"}}]}
            )
        )

    def test_gateway_error(self):
        self.assertFalse(
            classify_vision_probe_response(200, {"error": "Failed to connect to Dest API"})
        )

    def test_null_choices(self):
        self.assertFalse(classify_vision_probe_response(200, {"choices": None}))

    def test_http_error(self):
        self.assertFalse(classify_vision_probe_response(400, {"choices": [{"message": {}}]}))


class TestModeAndNeeds(unittest.TestCase):
    def test_resolve_mode(self):
        self.assertEqual(resolve_vision_mode(None), "auto")
        self.assertEqual(resolve_vision_mode("ON"), "on")
        self.assertEqual(resolve_vision_mode("off"), "off")
        self.assertEqual(resolve_vision_mode("nope"), "auto")

    def test_needs_live(self):
        self.assertTrue(needs_live_vision_probe("local"))
        self.assertFalse(needs_live_vision_probe("openai"))
        self.assertFalse(needs_live_vision_probe("anthropic"))

    def test_probe_key(self):
        self.assertEqual(
            vision_probe_key("local", "http://x/v1", "m1"),
            "local|http://x/v1|m1",
        )
```

Also add async tests with `unittest.IsolatedAsyncioTestCase` mocking `httpx.AsyncClient.post` or injecting a transport — implement `probe_vision_support` to call an internal `_post_chat` that tests can patch:

```python
class TestEnsure(unittest.IsolatedAsyncioTestCase):
    async def test_off_forces_false(self):
        from app.vision_probe import ensure_vision_for_cfg
        ok = await ensure_vision_for_cfg(
            {"llm_provider": "local", "llm_vision_mode": "off", "llm_base_url": "http://x", "llm_model": "m"},
            persist=False,
        )
        self.assertFalse(ok)

    async def test_on_forces_true(self):
        from app.vision_probe import ensure_vision_for_cfg
        ok = await ensure_vision_for_cfg(
            {"llm_provider": "local", "llm_vision_mode": "on"},
            persist=False,
        )
        self.assertTrue(ok)

    async def test_auto_cloud_true(self):
        from app.vision_probe import ensure_vision_for_cfg
        ok = await ensure_vision_for_cfg(
            {"llm_provider": "openai", "llm_vision_mode": "auto"},
            persist=False,
        )
        self.assertTrue(ok)
```

- [ ] **Step 2: Run — expect ImportError**

`cd backend && uv run python -m unittest tests.test_vision_probe -v`

- [ ] **Step 3: Implement `vision_probe.py`**

Key pieces:

```python
# classify: if status != 200: False
# if body is str: try json.loads
# if dict.get("error"): False
# choices = body.get("choices"); return bool(choices)

# needs_live_vision_probe: (provider or "local").lower() == "local"

# probe_vision_support: POST f"{base.rstrip('/')}/chat/completions"
# headers Authorization Bearer api_key
# body model + messages with text + image_url data:image/png;base64,{TINY_PNG_B64}
# max_completion_tokens 32, timeout 20
# classify response

# ensure_vision_for_cfg:
#   mode = resolve_vision_mode(cfg.get("llm_vision_mode"))
#   if mode == "off": return False
#   if mode == "on": return True
#   # auto
#   if not needs_live_vision_probe(cfg.get("llm_provider")): return True
#   key = vision_probe_key(...)
#   if not force_refresh and cfg cache key matches and probe_ok is bool: return that
#   ok = await probe_vision_support(cfg)
#   if persist: await db.set_setting for ok/at/key
#   return ok
```

Use `httpx.AsyncClient` with `timeout=VISION_PROBE_TIMEOUT_S`.

For cache reads inside ensure when `persist=True`, import `db.get_setting` / `set_setting`. When `persist=False`, only use values already on `cfg` (`llm_vision_probe_ok`, `llm_vision_probe_key`).

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add backend/app/vision_probe.py backend/tests/test_vision_probe.py
git commit -m "Add vision capability probe helpers."
```

---

### Task 2: Settings API — mode, cache, migration

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/routes/settings.py`
- Modify: `backend/app/llm_factory.py`
- Modify: `backend/tests/test_llm_settings_vision_temp.py` (update contracts)
- Test: add migration unit in `backend/tests/test_vision_migration.py`

**Interfaces:**
- Consumes: `ensure_vision_for_cfg`, `resolve_vision_mode`, `needs_live_vision_probe`
- Produces: public fields `llm_vision_mode`, `llm_vision_effective`, `llm_vision_probe_ok`, `llm_vision_probe_at`

- [ ] **Step 1: Failing migration test**

```python
import unittest
from app.vision_probe import migrate_llm_use_vision_value

class TestMigrate(unittest.TestCase):
    def test_true_to_on(self):
        self.assertEqual(migrate_llm_use_vision_value("true"), "on")
    def test_false_to_off(self):
        self.assertEqual(migrate_llm_use_vision_value("false"), "off")
    def test_unset(self):
        self.assertIsNone(migrate_llm_use_vision_value(None))
```

Add `migrate_llm_use_vision_value` in `vision_probe.py`.

- [ ] **Step 2: Config/models**

`config.py`:

```python
llm_vision_mode: Literal["auto", "on", "off"] = "auto"
# remove or keep llm_use_vision unused — prefer remove from Settings defaults
```

`SettingsUpdate`:

```python
llm_vision_mode: Literal["auto", "on", "off"] | None = None
# Keep llm_use_vision / llm_use_vision_reset for one-release compat: map in route
```

- [ ] **Step 3: Migration in `effective_settings`**

After loading stored:

```python
if "llm_use_vision" in stored and "llm_vision_mode" not in stored:
    mode = migrate_llm_use_vision_value(stored.get("llm_use_vision"))
    if mode:
        await db.set_setting("llm_vision_mode", mode)
        await db.delete_setting("llm_use_vision")
        stored = await db.get_all_settings()
```

`out["llm_vision_mode"] = resolve_vision_mode(stored.get("llm_vision_mode") or settings.llm_vision_mode)`

Also load probe cache strings into out as bool/None + timestamp.

- [ ] **Step 4: routes ALLOWED**

Add `llm_vision_mode`. On update of old `llm_use_vision` bool → write mode on/off. Prefer new key.

- [ ] **Step 5: public_settings**

```python
mode = resolve_vision_mode(s.get("llm_vision_mode"))
# effective without forcing a new probe (use cache / cloud rule):
effective = await ensure_vision_for_cfg({**s, "llm_vision_mode": mode}, force_refresh=False, persist=False)
# For public GET, avoid network: compute sync helper:

def effective_vision_from_cache(cfg) -> bool | None:
    mode = resolve_vision_mode(cfg.get("llm_vision_mode"))
    if mode == "off": return False
    if mode == "on": return True
    if not needs_live_vision_probe(cfg.get("llm_provider")): return True
    # auto local: if cache key matches, return probe_ok; else None (unknown)
```

Expose:
- `llm_vision_mode`
- `llm_vision_effective` (bool — if unknown local auto, False for safe display OR null — **locked: use null when not probed yet**, bool when known)
- `llm_vision_probe_ok: bool | null`
- `llm_vision_probe_at: str | null`

Deprecate returning `llm_use_vision` / `llm_use_vision_effective` or map them for compat: `llm_use_vision` = null if auto else on→true/off→false.

- [ ] **Step 6: Update old tests** that import override-only resolve — keep `resolve_use_vision` as thin wrapper for override bool OR update tests to mode API. Prefer updating tests to `resolve_vision_mode` + `effective_vision_from_cache`.

- [ ] **Step 7: Commit**

```bash
git commit -m "Persist llm_vision_mode and migrate bool vision setting."
```

---

### Task 3: Wire Test LLM + agent runner

**Files:**
- Modify: `backend/app/llm_factory.py` (`test_llm_connection`)
- Modify: `backend/app/agent_runner.py`
- Modify: `backend/app/routes/settings.py` if test route needs mode from body

**Interfaces:**
- Consumes: `ensure_vision_for_cfg(..., force_refresh=True)` on test; `force_refresh=False` on agent with persist True

- [ ] **Step 1: test_llm_connection**

After ping succeeds (or even if ping runs first), for local Auto/always local:

```python
vision_ok = await ensure_vision_for_cfg(cfg, force_refresh=True, persist=True)
return {..., "vision_supported": vision_ok, "llm_vision_mode": resolve_vision_mode(cfg.get("llm_vision_mode"))}
```

For cloud: `vision_supported: True` without probe when mode auto/on; False when off.

- [ ] **Step 2: LlmTestRequest** — allow optional `llm_vision_mode` override in body.

- [ ] **Step 3: agent_runner**

Replace resolve_use_vision block:

```python
from .vision_probe import ensure_vision_for_cfg, resolve_vision_mode

use_vision = await ensure_vision_for_cfg(cfg, force_refresh=False, persist=True)
mode = resolve_vision_mode(cfg.get("llm_vision_mode"))
if mode == "auto" and not use_vision and needs_live_vision_probe(...):
    await _emit(session_id, "status", {
        "status": "thinking",
        "message": "Vision auto-disabled: endpoint rejected image input.",
    })
```

- [ ] **Step 4: Run unit tests**

`uv run python -m unittest discover -s tests -p 'test_*.py' -v`

- [ ] **Step 5: Commit**

```bash
git commit -m "Probe vision on Test connection and agent start."
```

---

### Task 4: Frontend Auto/On/Off UI

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/SettingsPanel.tsx`
- Modify: `frontend/src/i18n/locales/en.ts`, `ar.ts`, `hi.ts`

**Interfaces:**
- Consumes: `llm_vision_mode`, `llm_vision_effective`, `llm_vision_probe_ok`, `llm_vision_probe_at`, test response `vision_supported`

- [ ] **Step 1: AppSettings type**

```typescript
llm_vision_mode?: 'auto' | 'on' | 'off'
llm_vision_effective?: boolean | null
llm_vision_probe_ok?: boolean | null
llm_vision_probe_at?: string | null
// keep optional legacy fields optional
```

- [ ] **Step 2: Form**

Replace `llm_use_vision: boolean | null` with `llm_vision_mode: 'auto' | 'on' | 'off'` default `'auto'`.

Save: `body.llm_vision_mode = form.llm_vision_mode` (remove reset/bool).

- [ ] **Step 3: UI** — three buttons radio Auto/On/Off under model.

Status when Auto:
- probe_ok === true → `t('llmVisionAvailable')`
- probe_ok === false → `t('llmVisionUnsupported')`
- else → `t('llmVisionNotProbed')`

Warning when mode === 'on' && provider === 'local'.

- [ ] **Step 4: i18n keys**

```
llmVisionMode: 'Vision'
llmVisionAuto: 'Auto'
llmVisionOn: 'On'
llmVisionOff: 'Off'
llmVisionAvailable: 'Vision available (endpoint accepted a test image).'
llmVisionUnsupported: 'Not supported (endpoint rejected image input).'
llmVisionNotProbed: 'Not probed yet — run Test connection.'
llmVisionForcedOnWarning: '...' // reuse/adapt local warning
```

Show vision_supported in test connection message when present.

- [ ] **Step 5: Commit**

```bash
git commit -m "Add Auto/On/Off Vision control with probe status in Settings."
```

---

### Task 5: Verification

- [ ] **Step 1: Unit suite** — all `tests/test_*.py` OK

- [ ] **Step 2: API**

```bash
curl -s -X PUT http://127.0.0.1:8742/api/settings -H 'Content-Type: application/json' \
  -d '{"llm_vision_mode":"auto"}' | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("llm_vision_mode"), d.get("llm_vision_probe_ok"))'

curl -s -X POST http://127.0.0.1:8742/api/settings/test-llm -H 'Content-Type: application/json' \
  -d '{}' | python3 -m json.tool | head -40
# expect vision_supported false for Vitruvian local
```

- [ ] **Step 3: Mode force**

PUT `on` / `off` → `llm_vision_effective` true/false without depending on probe.

- [ ] **Step 4: Ledger / done**

---

## Spec coverage

| Requirement | Task |
|-------------|------|
| Auto/On/Off mode | 2, 4 |
| Tiny PNG probe | 1, 3 |
| Cache key | 1, 2 |
| Test connection + agent start | 3 |
| Cloud Auto no probe | 1 |
| Migrate bool | 2 |
| UI status + warning | 4 |
| Temperature unchanged | (no change) |

## Self-review notes

- `ensure_vision_for_cfg` is the single runtime entry for agent/test
- `effective_vision_from_cache` avoids network on GET settings
- Legacy `llm_use_vision` accepted on PUT mapped to mode for one release
