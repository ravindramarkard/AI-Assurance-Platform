# LLM Vision & Temperature Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global Settings controls for LLM Vision (enable/disable) and Temperature (0–1), persist overrides in `app_settings`, and wire them into agent runs and LLM construction.

**Architecture:** Store optional `llm_use_vision` / `llm_temperature` in SQLite via existing settings API. Unset vision falls back to provider defaults (local OFF; openai/anthropic/browser_use ON). Explicit overrides win for all providers. Temperature defaults to `0.1`, clamped to `[0.0, 1.0]`. Frontend LLM section gets a toggle + slider/number pair.

**Tech Stack:** FastAPI, aiosqlite, Pydantic, React + TypeScript, existing i18n locales (en/ar/hi), unittest.

## Global Constraints

- Vision unset → OFF for `local`, ON for `openai` / `anthropic` / `browser_use`
- Vision set → stored boolean wins for every provider
- Temperature unset → `0.1`; set → clamp to `0.0–1.0`
- Temperature write outside `0.0–1.0` → HTTP 422
- No per-agent overrides; no frequency_penalty / max_tokens UI
- UI preview screenshots stay; only LLM vision input is gated
- Follow TDD: failing test → implement → pass → commit per task

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/local_llm.py` | `use_vision_for_provider`, `resolve_use_vision`, `resolve_temperature`, `build_local_chat_openai(temperature=…)` |
| `backend/app/db.py` | `delete_setting(key)` for vision reset |
| `backend/app/config.py` | Optional env defaults `llm_use_vision` / `llm_temperature` |
| `backend/app/models.py` | `SettingsUpdate` fields + reset flag |
| `backend/app/routes/settings.py` | Allow-list, coerce, validate, reset |
| `backend/app/llm_factory.py` | Merge/coerce in effective/public; pass temperature into `build_llm` |
| `backend/app/agent_runner.py` | Honor resolved vision from cfg |
| `backend/tests/test_local_llm.py` | Helpers + gateway error (extend) |
| `frontend/src/api.ts` | `AppSettings` fields |
| `frontend/src/components/SettingsPanel.tsx` | Vision toggle, temperature slider+input, warning, save/reset |
| `frontend/src/i18n/locales/{en,ar,hi}.ts` | Labels / help / warning |

---

### Task 1: Resolve helpers (vision + temperature)

**Files:**
- Modify: `backend/app/local_llm.py`
- Test: `backend/tests/test_local_llm.py`

**Interfaces:**
- Consumes: existing `use_vision_for_provider(provider: str | None) -> bool`
- Produces:
  - `resolve_use_vision(*, provider: str | None, override: bool | None) -> bool`
  - `resolve_temperature(value: Any, *, default: float = 0.1) -> float`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_local_llm.py`:

```python
from app.local_llm import resolve_temperature, resolve_use_vision, use_vision_for_provider


class TestResolveUseVision(unittest.TestCase):
    def test_unset_uses_provider_default(self):
        self.assertFalse(resolve_use_vision(provider="local", override=None))
        self.assertTrue(resolve_use_vision(provider="openai", override=None))
        self.assertTrue(resolve_use_vision(provider="anthropic", override=None))
        self.assertTrue(resolve_use_vision(provider="browser_use", override=None))

    def test_override_wins(self):
        self.assertTrue(resolve_use_vision(provider="local", override=True))
        self.assertFalse(resolve_use_vision(provider="openai", override=False))


class TestResolveTemperature(unittest.TestCase):
    def test_default_and_clamp(self):
        self.assertEqual(resolve_temperature(None), 0.1)
        self.assertEqual(resolve_temperature("0.5"), 0.5)
        self.assertEqual(resolve_temperature(2.0), 1.0)
        self.assertEqual(resolve_temperature(-1), 0.0)
        self.assertEqual(resolve_temperature("nope"), 0.1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m unittest tests.test_local_llm.TestResolveUseVision tests.test_local_llm.TestResolveTemperature -v`

Expected: FAIL with `ImportError` / `cannot import name 'resolve_use_vision'`

- [ ] **Step 3: Implement helpers**

In `backend/app/local_llm.py`, after `use_vision_for_provider`:

```python
def resolve_use_vision(*, provider: str | None, override: bool | None) -> bool:
    if override is not None:
        return bool(override)
    return use_vision_for_provider(provider)


def resolve_temperature(value: Any, *, default: float = 0.1) -> float:
    if value is None or value == "":
        return default
    try:
        t = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, t))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run python -m unittest tests.test_local_llm -v`

Expected: OK (all tests pass)

- [ ] **Step 5: Commit**

```bash
git add backend/app/local_llm.py backend/tests/test_local_llm.py
git commit -m "Add resolve helpers for LLM vision and temperature."
```

---

### Task 2: Persist settings (DB delete + models + routes + factory)

**Files:**
- Modify: `backend/app/db.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/routes/settings.py`
- Modify: `backend/app/llm_factory.py`
- Test: `backend/tests/test_llm_settings_vision_temp.py` (create)

**Interfaces:**
- Consumes: `resolve_use_vision`, `resolve_temperature`
- Produces:
  - `db.delete_setting(key: str) -> None`
  - Settings keys `llm_use_vision`, `llm_temperature`; update flag `llm_use_vision_reset: bool | None`
  - `effective_settings()` includes `llm_use_vision: bool | None`, `llm_temperature: float`
  - `public_settings()` includes `llm_use_vision: bool | null`, `llm_use_vision_effective: bool`, `llm_temperature: float`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_llm_settings_vision_temp.py`:

```python
import unittest
from app.local_llm import resolve_temperature, resolve_use_vision


class TestPublicShapeContract(unittest.TestCase):
    """Pure contract for how effective values are derived (no DB)."""

    def test_effective_vision_null_override(self):
        self.assertFalse(resolve_use_vision(provider="local", override=None))
        self.assertTrue(resolve_use_vision(provider="openai", override=None))

    def test_temperature_bounds_for_api(self):
        self.assertEqual(resolve_temperature(0.0), 0.0)
        self.assertEqual(resolve_temperature(1.0), 1.0)
        self.assertEqual(resolve_temperature(1.5), 1.0)
```

Also add an async DB unit if feasible; minimum is the contract above plus a small test that `delete_setting` exists:

```python
class TestDeleteSettingApi(unittest.TestCase):
    def test_delete_setting_callable(self):
        from app import db
        self.assertTrue(callable(getattr(db, "delete_setting", None)))
```

- [ ] **Step 2: Run tests to verify fail**

Run: `cd backend && uv run python -m unittest tests.test_llm_settings_vision_temp -v`

Expected: FAIL on `delete_setting` missing (after Task 1 helpers exist, first two tests pass; delete test fails)

- [ ] **Step 3: Add `delete_setting`**

In `backend/app/db.py` after `set_setting`:

```python
async def delete_setting(key: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM app_settings WHERE key = ?", (key,))
        await db.commit()
```

- [ ] **Step 4: Config + models**

In `backend/app/config.py` `Settings` class, add:

```python
llm_use_vision: bool | None = None  # None = provider default
llm_temperature: float = 0.1
```

In `backend/app/models.py` `SettingsUpdate`, add:

```python
llm_use_vision: bool | None = None
llm_temperature: float | None = Field(default=None, ge=0.0, le=1.0)
llm_use_vision_reset: bool | None = None
```

(Pydantic `ge`/`le` gives 422 on out-of-range temperature.)

- [ ] **Step 5: Routes allow-list + update handling**

In `backend/app/routes/settings.py`:

1. Add `"llm_use_vision"`, `"llm_temperature"` to `ALLOWED`.
2. Do **not** add `llm_use_vision_reset` to ALLOWED (handle separately).
3. At start of `update_settings`, after `model_dump`:

```python
data = body.model_dump(exclude_none=True)
if body.llm_use_vision_reset:
    await db.delete_setting("llm_use_vision")
    data.pop("llm_use_vision", None)
```

4. In the loop, handle:

```python
elif k == "llm_use_vision":
    await db.set_setting(k, "true" if v else "false")
elif k == "llm_temperature":
    t = max(0.0, min(1.0, float(v)))
    await db.set_setting(k, str(t))
```

- [ ] **Step 6: effective_settings + public_settings + build_llm**

In `backend/app/llm_factory.py` `effective_settings` base `out`:

```python
"llm_use_vision": settings.llm_use_vision,  # may be None
"llm_temperature": float(settings.llm_temperature),
```

When merging stored:

```python
if k == "llm_use_vision":
    out[k] = v.lower() in ("1", "true", "yes")
elif k == "llm_temperature":
    from .local_llm import resolve_temperature
    out[k] = resolve_temperature(v)
elif k in ("headless", "keycloak_enabled"):
    ...
```

Important: if `llm_use_vision` is **absent** from `stored`, leave env value (often `None`). Do not force False.

In `public_settings`:

```python
from .local_llm import resolve_temperature, resolve_use_vision

override = s.get("llm_use_vision")  # bool | None
# Distinguish unset: if key missing from DB and env is None → null
stored = await db.get_all_settings()
vision_set = "llm_use_vision" in stored or settings.llm_use_vision is not None
vision_override = bool(override) if vision_set and override is not None else (
    bool(override) if vision_set else None
)
# Simpler approach:
raw_vision = stored.get("llm_use_vision")
if raw_vision is None and settings.llm_use_vision is None:
    vision_public = None
else:
    vision_public = bool(s.get("llm_use_vision"))

provider = str(s.get("llm_provider") or "local")
temp = resolve_temperature(s.get("llm_temperature"))
...
"llm_use_vision": vision_public,
"llm_use_vision_effective": resolve_use_vision(provider=provider, override=vision_public),
"llm_temperature": temp,
```

In `build_llm`, pass temperature into local builder; for openai/anthropic try:

```python
temp = resolve_temperature(cfg.get("llm_temperature"))
...
return build_local_chat_openai(..., temperature=temp)
...
try:
    return ChatOpenAI(model=model or "gpt-4o", temperature=temp)
except TypeError:
    return ChatOpenAI(model=model or "gpt-4o")
```

Update `build_local_chat_openai` signature:

```python
def build_local_chat_openai(*, model: str, api_key: str, base_url: str | None, temperature: float = 0.1):
    ...
    "temperature": resolve_temperature(temperature),
```

- [ ] **Step 7: Run tests**

Run: `cd backend && uv run python -m unittest tests.test_local_llm tests.test_llm_settings_vision_temp -v`

Expected: OK

Manual smoke (optional): `curl -s http://127.0.0.1:8742/api/settings | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("llm_use_vision"), d.get("llm_use_vision_effective"), d.get("llm_temperature"))'`

Expected: `None <provider-default-bool> 0.1` (JSON `null` for vision)

- [ ] **Step 8: Commit**

```bash
git add backend/app/db.py backend/app/config.py backend/app/models.py \
  backend/app/routes/settings.py backend/app/llm_factory.py backend/app/local_llm.py \
  backend/tests/test_llm_settings_vision_temp.py
git commit -m "Persist LLM vision and temperature in settings API."
```

---

### Task 3: Agent runner uses resolved vision

**Files:**
- Modify: `backend/app/agent_runner.py`
- Test: `backend/tests/test_local_llm.py` (already covers resolve; add thin runner-helper test if extracting)

**Interfaces:**
- Consumes: `resolve_use_vision(provider=..., override=cfg.get("llm_use_vision"))`
- Produces: `Agent(..., use_vision=<resolved>)`

- [ ] **Step 1: Write failing assertion via helper test**

If `agent_runner` currently calls `use_vision_for_provider` only, add:

```python
class TestAgentVisionResolution(unittest.TestCase):
    def test_cfg_override_true_on_local(self):
        from app.local_llm import resolve_use_vision
        cfg_override = True
        self.assertTrue(resolve_use_vision(provider="local", override=cfg_override))
```

(This documents the contract the runner must call.)

- [ ] **Step 2: Update agent_runner**

Replace the vision block with:

```python
from .local_llm import resolve_use_vision

provider = str(cfg.get("llm_provider") or "local")
vision_override = cfg.get("llm_use_vision")  # bool | None
if isinstance(vision_override, str):
    vision_override = vision_override.lower() in ("1", "true", "yes")
use_vision = resolve_use_vision(provider=provider, override=vision_override if isinstance(vision_override, bool) else None)
logger.info("Agent vision provider=%s override=%s effective=%s", provider, vision_override, use_vision)
...
"use_vision": use_vision,
```

Remove direct `use_vision_for_provider` usage for the Agent kwargs (keep import of `resolve_use_vision` only).

- [ ] **Step 3: Run tests**

Run: `cd backend && uv run python -m unittest tests.test_local_llm -v`

Expected: OK

- [ ] **Step 4: Commit**

```bash
git add backend/app/agent_runner.py backend/tests/test_local_llm.py
git commit -m "Honor settings vision override in agent runner."
```

---

### Task 4: Frontend Settings UI + i18n

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/SettingsPanel.tsx`
- Modify: `frontend/src/i18n/locales/en.ts`
- Modify: `frontend/src/i18n/locales/ar.ts`
- Modify: `frontend/src/i18n/locales/hi.ts`

**Interfaces:**
- Consumes: `GET/PUT /api/settings` fields from Task 2
- Produces: UI controls that save `llm_use_vision`, `llm_temperature`, and `llm_use_vision_reset`

- [ ] **Step 1: Extend `AppSettings`**

In `frontend/src/api.ts`:

```typescript
llm_use_vision?: boolean | null
llm_use_vision_effective?: boolean
llm_temperature?: number
```

- [ ] **Step 2: i18n keys**

In `en.ts` (and matching ar/hi):

```typescript
llmVision: 'Vision',
llmVisionHelp: 'Send page screenshots to the model. Disable for text-only local/GLM gateways.',
llmVisionReset: 'Reset to provider default',
llmTemperature: 'Temperature',
llmTemperatureHelp: 'Lower is more deterministic (0–1).',
llmVisionLocalWarning: 'Some local/GLM servers reject screenshot payloads. Leave Vision off unless your endpoint supports images.',
```

Arabic/Hindi: provide natural translations of the same six keys.

- [ ] **Step 3: Form state + load**

In `SettingsPanel.tsx` `FormState` add:

```typescript
llm_use_vision: boolean | null  // null = use provider default (display effective)
llm_temperature: number
```

Initialize defaults: `llm_use_vision: null`, `llm_temperature: 0.1`.

In `useEffect` from settings:

```typescript
llm_use_vision:
  settings.llm_use_vision === null || settings.llm_use_vision === undefined
    ? null
    : !!settings.llm_use_vision,
llm_temperature:
  typeof settings.llm_temperature === 'number' ? settings.llm_temperature : 0.1,
```

Display toggle checked as:

```typescript
const visionOn =
  form.llm_use_vision === null
    ? !!settings?.llm_use_vision_effective
    : !!form.llm_use_vision
```

When user toggles:

```typescript
onChange={(e) => setForm({ ...form, llm_use_vision: e.target.checked })}
```

Reset button (only if `form.llm_use_vision !== null`):

```typescript
onClick={() => setForm({ ...form, llm_use_vision: null })}
```

Temperature: slider + number input both bound to `form.llm_temperature`, clamp on change:

```typescript
const setTemp = (n: number) =>
  setForm({ ...form, llm_temperature: Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.1)) })
```

```tsx
<input type="range" min={0} max={1} step={0.05} value={form.llm_temperature}
  onChange={(e) => setTemp(parseFloat(e.target.value))} />
<input type="number" min={0} max={1} step={0.05} value={form.llm_temperature}
  onChange={(e) => setTemp(parseFloat(e.target.value))} />
```

Warning when `form.llm_provider === 'local' && visionOn`.

Place controls after `{field(t('model'), 'llm_model')}` and before the Test connection row.

- [ ] **Step 4: Save payload**

In `save()`:

```typescript
body.llm_temperature = form.llm_temperature
if (form.llm_use_vision === null) {
  body.llm_use_vision_reset = true
} else {
  body.llm_use_vision = form.llm_use_vision
}
```

- [ ] **Step 5: Manual UI check**

1. Open Settings → LLM
2. Confirm Vision shows OFF for local (effective), Temperature 0.1
3. Enable Vision → see local warning → Save → reload → stays ON
4. Reset to provider default → Save → reload → OFF again for local
5. Set temperature to 0.4 via slider and number → Save → persists

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.ts frontend/src/components/SettingsPanel.tsx \
  frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/ar.ts frontend/src/i18n/locales/hi.ts
git commit -m "Add Vision and Temperature controls to Settings LLM section."
```

---

### Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Backend unit suite**

Run: `cd backend && uv run python -m unittest tests.test_local_llm tests.test_llm_settings_vision_temp tests.test_llm_models_catalog -v`

Expected: OK

- [ ] **Step 2: API round-trip**

```bash
# Enable vision + temp
curl -s -X PUT http://127.0.0.1:8742/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"llm_use_vision":true,"llm_temperature":0.4}' | python3 -m json.tool | head

# Reset vision
curl -s -X PUT http://127.0.0.1:8742/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"llm_use_vision_reset":true}' | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["llm_use_vision"], d["llm_use_vision_effective"], d["llm_temperature"])'
```

Expected after reset (local provider): `None False 0.4` (temperature still 0.4)

- [ ] **Step 3: Reject bad temperature**

```bash
curl -s -o /tmp/t422.json -w "%{http_code}\n" -X PUT http://127.0.0.1:8742/api/settings \
  -H 'Content-Type: application/json' -d '{"llm_temperature":1.5}'
```

Expected: `422`

- [ ] **Step 4: Final commit if any fixes**

Only if verification required code fixes; otherwise done.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Persist `llm_use_vision` / `llm_temperature` | 2 |
| Unset vision → provider defaults | 1, 2, 3 |
| Explicit vision wins | 1, 3 |
| Temperature default 0.1, clamp 0–1 | 1, 2 |
| Write validation 422 | 2 (Pydantic Field) |
| `llm_use_vision_effective` in public settings | 2 |
| Reset to provider default | 2, 4 |
| Agent `use_vision` wiring | 3 |
| `build_llm` temperature | 2 |
| Settings UI toggle + slider/number | 4 |
| Local+vision warning | 4 |
| i18n en/ar/hi | 4 |
| Keep gateway error message | already in `local_llm` (no change) |
| No per-agent overrides | Global Constraints |

## Placeholder / consistency self-review

- Helper names consistent: `resolve_use_vision`, `resolve_temperature` across Tasks 1–3
- Reset flag name consistent: `llm_use_vision_reset`
- Public null vs effective bool documented in Task 2
- No TBD/TODO left in steps
