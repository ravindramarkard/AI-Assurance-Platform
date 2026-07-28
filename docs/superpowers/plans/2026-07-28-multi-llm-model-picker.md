# Multi-LLM Model Catalog + Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save multiple models per LLM provider in Settings, pick the global default from a Cursor-style status-bar dropdown, and optionally override provider+model per New Agent / Schedule run.

**Architecture:** Persist `llm_models` JSON in `app_settings`. Keep shared credentials per provider. Active pair remains `llm_provider` + `llm_model`. Snapshot `llm_provider` onto sessions at create time; `agent_runner` applies session provider+model onto `cfg` before `build_llm`. Shared `ModelPicker` for status bar (global save) and New Agent (per-run override).

**Tech Stack:** FastAPI + aiosqlite (`backend/`), React 19 + TypeScript + Vite + Tailwind (`frontend/`). Verify backend helpers with `python -m unittest`; frontend with `cd frontend && npx tsc -b --noEmit`.

**Spec:** `docs/superpowers/specs/2026-07-28-multi-llm-model-picker-design.md`

## Global Constraints

- Shared credentials per provider — no per-model Base URL / API key
- Manual model add/remove only (no fetch-from-provider APIs in v1)
- No Auto / MAX toggles
- `browser_use` stays out of Settings UI and picker catalogs
- Status-bar pick → `PUT /api/settings`; New Agent pick → session override only
- Session stores snapshot of provider+model at create so follow-ups ignore later status-bar changes
- `llm_models` stored as one JSON string in `app_settings`

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/llm_models_catalog.py` | **Create** — normalize, migrate, dedupe catalog helpers |
| `backend/app/llm_factory.py` | Parse/migrate `llm_models` in `effective_settings` / expose in `public_settings` |
| `backend/app/models.py` | `SettingsUpdate.llm_models`; session create `llm_provider`; `SessionOut.llm_provider`; schedule `llm_provider` |
| `backend/app/routes/settings.py` | Allow `llm_models`; JSON encode on save |
| `backend/app/db.py` | `sessions.llm_provider` column; `create_session(..., llm_provider=)` |
| `backend/app/routes/sessions.py` | Pass `llm_provider` on create (+ with-files) |
| `backend/app/agent_runner.py` | Apply session `llm_provider` + `model` onto `cfg` before `build_llm` |
| `backend/app/scheduler.py` | Pass job `llm_provider` into `create_session` |
| `backend/tests/test_llm_models_catalog.py` | **Create** — unit tests for helpers |
| `frontend/src/api.ts` | `LlmModelsCatalog`, `AppSettings.llm_models`, `Session.llm_provider`, `createSession` provider arg |
| `frontend/src/components/SettingsPanel.tsx` | Per-provider model list UI |
| `frontend/src/components/ModelPicker.tsx` | **Create** — shared Cursor-style picker |
| `frontend/src/App.tsx` | Status-bar picker; pass provider through `onCreate` |
| `frontend/src/components/AgentPage.tsx` | Replace read-only chip with `ModelPicker` override |
| `frontend/src/components/ScheduleJobModal.tsx` | Optional: provider+model via picker (or keep model text + add provider) |

---

### Task 1: Catalog helpers + unit tests

**Files:**
- Create: `backend/app/llm_models_catalog.py`
- Create: `backend/tests/__init__.py` (empty)
- Create: `backend/tests/test_llm_models_catalog.py`

**Interfaces:**
- Produces:
  - `PROVIDERS = ("local", "openai", "anthropic")`
  - `empty_catalog() -> dict[str, list[str]]`
  - `normalize_catalog(raw: Any) -> dict[str, list[str]]`
  - `migrate_catalog(catalog: dict[str, list[str]], *, provider: str, model: str) -> tuple[dict[str, list[str]], bool]` — returns `(catalog, changed)`; seeds only when catalog was empty for that provider and model is non-empty? **Per spec:** migrate only when catalog key was absent at settings layer; helper should support `ensure_model_in_catalog(catalog, provider, model) -> dict` and `dedupe_list(items) -> list[str]`
  - Prefer these exact signatures:

```python
def empty_catalog() -> dict[str, list[str]]:
    ...

def normalize_catalog(raw: object | None) -> dict[str, list[str]]:
    """Always returns all three keys; trims, drops empties, dedupes (keep first)."""

def ensure_model_in_catalog(
    catalog: dict[str, list[str]], provider: str, model: str
) -> dict[str, list[str]]:
    """Append model to provider list if non-empty and not already present."""

def parse_catalog_json(text: str | None) -> dict[str, list[str]]:
    """Parse JSON string from DB; invalid/missing → empty_catalog()."""
```

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_llm_models_catalog.py
import unittest
from app.llm_models_catalog import (
    empty_catalog,
    ensure_model_in_catalog,
    normalize_catalog,
    parse_catalog_json,
)


class TestLlmModelsCatalog(unittest.TestCase):
    def test_empty_catalog_has_three_providers(self):
        c = empty_catalog()
        self.assertEqual(set(c), {"local", "openai", "anthropic"})
        self.assertEqual(c["local"], [])

    def test_normalize_dedupes_and_trims(self):
        c = normalize_catalog({"local": [" a ", "a", "", "b"], "openai": "nope"})
        self.assertEqual(c["local"], ["a", "b"])
        self.assertEqual(c["openai"], [])
        self.assertEqual(c["anthropic"], [])

    def test_ensure_model_appends_once(self):
        c = empty_catalog()
        c = ensure_model_in_catalog(c, "local", "gemma")
        c = ensure_model_in_catalog(c, "local", "gemma")
        self.assertEqual(c["local"], ["gemma"])

    def test_parse_catalog_json(self):
        self.assertEqual(parse_catalog_json(None), empty_catalog())
        self.assertEqual(
            parse_catalog_json('{"local":["x"],"openai":[],"anthropic":[]}'),
            {"local": ["x"], "openai": [], "anthropic": []},
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests — expect fail**

Run: `cd backend && python -m unittest tests.test_llm_models_catalog -v`  
Expected: FAIL (module not found / import error)

- [ ] **Step 3: Implement helpers**

```python
# backend/app/llm_models_catalog.py
from __future__ import annotations

import json
from typing import Any

PROVIDERS = ("local", "openai", "anthropic")


def empty_catalog() -> dict[str, list[str]]:
    return {p: [] for p in PROVIDERS}


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in items:
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def normalize_catalog(raw: object | None) -> dict[str, list[str]]:
    base = empty_catalog()
    if not isinstance(raw, dict):
        return base
    for p in PROVIDERS:
        val = raw.get(p)
        if not isinstance(val, list):
            continue
        cleaned: list[str] = []
        for item in val:
            if not isinstance(item, str):
                continue
            s = item.strip()
            if s:
                cleaned.append(s)
        base[p] = _dedupe(cleaned)
    return base


def ensure_model_in_catalog(
    catalog: dict[str, list[str]], provider: str, model: str
) -> dict[str, list[str]]:
    out = normalize_catalog(catalog)
    p = provider if provider in PROVIDERS else "local"
    m = (model or "").strip()
    if not m:
        return out
    if m not in out[p]:
        out[p] = [*out[p], m]
    return out


def parse_catalog_json(text: str | None) -> dict[str, list[str]]:
    if not text or not str(text).strip():
        return empty_catalog()
    try:
        raw = json.loads(text)
    except Exception:
        return empty_catalog()
    return normalize_catalog(raw)
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && python -m unittest tests.test_llm_models_catalog -v`  
Expected: PASS (all 4 tests)

If import fails because `app` is not on path, run:
`cd backend && PYTHONPATH=. python -m unittest tests.test_llm_models_catalog -v`

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm_models_catalog.py backend/tests/__init__.py backend/tests/test_llm_models_catalog.py
git commit -m "Add llm_models catalog normalize helpers and unit tests."
```

---

### Task 2: Persist `llm_models` in settings API

**Files:**
- Modify: `backend/app/llm_factory.py`
- Modify: `backend/app/models.py` (`SettingsUpdate`)
- Modify: `backend/app/routes/settings.py`
- Modify: `backend/app/config.py` (optional default unused — skip env field if not needed; DB-only is fine)

**Interfaces:**
- Consumes: `parse_catalog_json`, `normalize_catalog`, `ensure_model_in_catalog`, `empty_catalog`
- Produces: `effective_settings()["llm_models"]` as `dict[str, list[str]]`; `public_settings()` includes same; `PUT` accepts `llm_models`

- [ ] **Step 1: Extend `SettingsUpdate`**

In `backend/app/models.py`, add to `SettingsUpdate`:

```python
    llm_models: dict[str, list[str]] | None = None
```

- [ ] **Step 2: Parse + migrate in `effective_settings`**

In `llm_factory.py` after merging stored keys into `out`:

```python
from .llm_models_catalog import (
    empty_catalog,
    ensure_model_in_catalog,
    normalize_catalog,
    parse_catalog_json,
)

# inside effective_settings, after the stored merge loop:
raw_models = stored.get("llm_models")
if raw_models is None:
    catalog = empty_catalog()
    migrated = True
else:
    catalog = parse_catalog_json(raw_models)
    migrated = False
provider = str(out.get("llm_provider") or "local")
model = str(out.get("llm_model") or "")
if migrated and model.strip():
    catalog = ensure_model_in_catalog(catalog, provider, model)
    await db.set_setting("llm_models", json.dumps(catalog))
out["llm_models"] = catalog
```

Add `import json` at top of `llm_factory.py`.

**Important:** Only auto-seed + persist when `llm_models` key was **absent** (`raw_models is None`), not when the user saved empty lists.

Also: when stored value exists as a Python `str` from `get_all_settings`, `parse_catalog_json` handles it. Do **not** leave the raw JSON string on `out` from the generic merge — after the loop, if `out.get("llm_models")` is a string, replace with parsed catalog (the block above should set `out["llm_models"]` last and overwrite any string).

Fix the merge loop so `llm_models` from stored is not left as a raw string: either skip assigning `llm_models` in the generic `else: out[k] = v` branch, or always overwrite afterward (preferred: always overwrite afterward as shown).

- [ ] **Step 3: Expose in `public_settings`**

Add to the returned dict:

```python
"llm_models": normalize_catalog(s.get("llm_models")),
```

- [ ] **Step 4: Save path in `routes/settings.py`**

Add `"llm_models"` to `ALLOWED`.

In `update_settings`, special-case:

```python
elif k == "llm_models":
    from ..llm_models_catalog import normalize_catalog
    import json
    catalog = normalize_catalog(v)
    # If llm_model also in this payload (or already in DB), ensure it is listed
    provider = data.get("llm_provider")
    model = data.get("llm_model")
    if provider is None or model is None:
        cur = await effective_settings()
        provider = provider or cur.get("llm_provider") or "local"
        model = model if model is not None else (cur.get("llm_model") or "")
    from ..llm_models_catalog import ensure_model_in_catalog
    catalog = ensure_model_in_catalog(catalog, str(provider), str(model or ""))
    await db.set_setting(k, json.dumps(catalog))
```

Do **not** `setattr(env_settings, "llm_models", ...)` unless `config.Settings` gains the field — skip setattr for this key.

- [ ] **Step 5: Smoke-check helpers still pass**

Run: `cd backend && PYTHONPATH=. python -m unittest tests.test_llm_models_catalog -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/llm_factory.py backend/app/models.py backend/app/routes/settings.py
git commit -m "Persist llm_models catalog in settings API with one-time migration."
```

---

### Task 3: Session `llm_provider` + create API

**Files:**
- Modify: `backend/app/db.py`
- Modify: `backend/app/models.py` (`CreateSessionRequest`, `SessionOut`, schedule request models)
- Modify: `backend/app/routes/sessions.py`
- Modify: `backend/app/scheduler.py`

**Interfaces:**
- Produces: `create_session(task, model=None, llm_provider=None) -> dict`; sessions row includes `llm_provider`; API accepts `llm_provider` on create

- [ ] **Step 1: Add column**

In `init_db` (near other `_ensure_column` calls for sessions — if none, after sessions table create), add:

```python
await _ensure_column(db, "sessions", "llm_provider", "TEXT")
```

Also ensure scheduled_jobs can store provider:

```python
await _ensure_column(db, "scheduled_jobs", "llm_provider", "TEXT")
```

- [ ] **Step 2: Update `create_session`**

```python
async def create_session(
    task: str, model: str | None = None, llm_provider: str | None = None
) -> dict[str, Any]:
    ...
            INSERT INTO sessions (id, title, task, status, model, llm_provider, created_at, updated_at)
            VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)
    ...
            (sid, title, task, model, llm_provider, now, now),
```

- [ ] **Step 3: Update request/response models**

```python
class CreateSessionRequest(BaseModel):
    task: str = Field(min_length=1)
    model: str | None = None
    llm_provider: Literal["local", "openai", "anthropic"] | None = None
    runtime_url: str | None = None

class SessionOut(BaseModel):
    ...
    model: str | None = None
    llm_provider: str | None = None
    ...
```

Add `llm_provider: str | None = None` to `CreateScheduledJobRequest` / `ScheduledJobOut` / update models that already have `model` (mirror existing `model` fields in `models.py`).

- [ ] **Step 4: Wire routes**

`create_session` route:

```python
session = await db.create_session(body.task, body.model, body.llm_provider)
```

In `create_session_with_files`, read form field `llm_provider` (optional string) and pass through.

Update `db.create_scheduled_job` / update job to accept and store `llm_provider` if those functions take `model` today — mirror the `model` parameter pattern.

In `scheduler.py` where it calls `create_session`:

```python
session = await db.create_session(task_text, job.get("model"), job.get("llm_provider"))
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/db.py backend/app/models.py backend/app/routes/sessions.py backend/app/scheduler.py
git commit -m "Store llm_provider on sessions and accept it on create."
```

---

### Task 4: Apply session provider+model in `agent_runner`

**Files:**
- Modify: `backend/app/agent_runner.py`

**Interfaces:**
- Consumes: session row `llm_provider`, `model`
- Produces: `cfg["llm_provider"]` / `cfg["llm_model"]` set before any `build_llm(cfg)` / chat-only paths that use model name

- [ ] **Step 1: Helper at top of `run_session` (and follow-up entry if separate)**

Right after `cfg = await effective_settings()`:

```python
session_row = await db.get_session(session_id) or {}
sess_provider = (session_row.get("llm_provider") or "").strip()
sess_model = (session_row.get("model") or "").strip()
if sess_provider in ("local", "openai", "anthropic"):
    cfg["llm_provider"] = sess_provider
if sess_model:
    cfg["llm_model"] = sess_model
```

Apply the same block in the follow-up / `continue_session` path if it also does `cfg = await effective_settings()` independently (search for `effective_settings` in this file and apply at each entry that builds an LLM).

- [ ] **Step 2: Avoid clobbering session snapshot**

Where the runner currently does `await db.update_session(session_id, model=str(model_name))`, keep updating `model` to the cfg model actually used; also set `llm_provider` if missing:

```python
await db.update_session(
    session_id,
    model=str(model_name),
    llm_provider=str(cfg.get("llm_provider") or "local"),
)
```

Only if this does not fight the create-time snapshot — overwriting with the same values is fine.

- [ ] **Step 3: Commit**

```bash
git add backend/app/agent_runner.py
git commit -m "Honor session llm_provider and model when building the LLM."
```

---

### Task 5: Frontend types + `createSession` provider arg

**Files:**
- Modify: `frontend/src/api.ts`

**Interfaces:**
- Produces:

```ts
export type LlmProvider = 'local' | 'openai' | 'anthropic'

export type LlmModelsCatalog = {
  local: string[]
  openai: string[]
  anthropic: string[]
}

export type AppSettings = {
  ...
  llm_models?: LlmModelsCatalog
  ...
}

export type Session = {
  ...
  llm_provider?: string | null
  ...
}
```

`createSession(task, model?, files?, runtimeUrl?, llmProvider?)` — append `llm_provider` to JSON body and FormData.

- [ ] **Step 1: Update types and `createSession`**

```ts
  createSession: (
    task: string,
    model?: string,
    files?: File[],
    runtimeUrl?: string,
    llmProvider?: string,
  ) => {
    const runtime_url = (runtimeUrl || '').trim() || undefined
    const llm_provider = (llmProvider || '').trim() || undefined
    if (files && files.length > 0) {
      const fd = new FormData()
      fd.append('task', task)
      if (model) fd.append('model', model)
      if (runtime_url) fd.append('runtime_url', runtime_url)
      if (llm_provider) fd.append('llm_provider', llm_provider)
      for (const f of files) fd.append('files', f)
      return fetch('/api/sessions/with-files', {
        method: 'POST',
        body: fd,
      }).then((r) => json<Session & { attachments?: string[] }>(r))
    }
    return fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, model, runtime_url, llm_provider }),
    }).then((r) => json<Session>(r))
  },
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`  
Expected: PASS (or only pre-existing errors unrelated to this change)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "Add llm_models types and createSession llm_provider argument."
```

---

### Task 6: SettingsPanel model list UI

**Files:**
- Modify: `frontend/src/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `settings.llm_models`
- Produces: save body includes `llm_models` + active `llm_provider` / `llm_model`

- [ ] **Step 1: Extend form state**

Add to form type and defaults:

```ts
llm_models: LlmModelsCatalog
```

Default: `{ local: [], openai: [], anthropic: [] }`

When hydrating from `settings`, set:

```ts
llm_models: {
  local: settings.llm_models?.local || [],
  openai: settings.llm_models?.openai || [],
  anthropic: settings.llm_models?.anthropic || [],
},
```

If lists are empty but `settings.llm_model` is set, seed the active provider’s list in local form state (UI-only; server also migrates).

- [ ] **Step 2: Replace single Model text field**

Where `{field(t('model'), 'llm_model')}` is today, render for the active provider:

- Heading: Model list
- For each model in `form.llm_models[form.llm_provider]`: row with model id, “Use” (sets `llm_model`), remove button
- Input + Add button: trim, no-op if duplicate, append to that provider’s array; optionally set as `llm_model` when list was empty
- Show active model badge when `form.llm_model === row`

On remove: filter out; if removed was `form.llm_model`, set `llm_model` to first remaining for that provider or `''`.

- [ ] **Step 3: Include in save body**

```ts
llm_models: form.llm_models,
llm_model: form.llm_model,
llm_provider: form.llm_provider,
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SettingsPanel.tsx
git commit -m "Add per-provider model list editor in Settings."
```

---

### Task 7: `ModelPicker` component

**Files:**
- Create: `frontend/src/components/ModelPicker.tsx`

**Interfaces:**
- Produces:

```tsx
export type ModelPick = { provider: LlmProvider; model: string }

type Props = {
  catalog: LlmModelsCatalog | null | undefined
  value: ModelPick
  onChange: (next: ModelPick) => void
  onManageSettings?: () => void
  /** Compact trigger for status bar vs New Agent */
  compact?: boolean
  className?: string
  disabled?: boolean
}
```

- [ ] **Step 1: Implement picker**

Behavior:
- Trigger button shows `{provider} · {model}` (truncate) + chevron
- Popover: search input; groups Local / OpenAI / Anthropic with models; omit empty groups
- Row click → `onChange`; checkmark on matching `value`
- Footer button “Manage in Settings…” calls `onManageSettings`
- Empty: “Add models in Settings” + same CTA
- Click-outside closes; Escape closes
- Match existing dark UI (`bg-ink-900`, `border-line`, accent orange for active)

Keep file focused (~150–220 lines). No Auto/MAX.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ModelPicker.tsx
git commit -m "Add shared ModelPicker dropdown component."
```

---

### Task 8: Wire status bar (global) + New Agent (override)

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AgentPage.tsx`
- Modify: `frontend/src/components/AgentBrowserPage.tsx` (if it threads `onCreate` props)

**Interfaces:**
- Consumes: `ModelPicker`, `api.updateSettings`, `settings.llm_models`
- `onCreate: (task, model?, files?, runtimeUrl?, llmProvider?) => Promise<void>`

- [ ] **Step 1: Status bar in `App.tsx`**

Replace the static provider/model spans (~lines with `settings?.llm_provider` / `settings?.llm_model`) with:

```tsx
<ModelPicker
  compact
  catalog={settings?.llm_models}
  value={{
    provider: (settings?.llm_provider as LlmProvider) || 'local',
    model: settings?.llm_model || '',
  }}
  onChange={async (next) => {
    const s = await api.updateSettings({
      llm_provider: next.provider,
      llm_model: next.model,
    })
    setSettings(s)
    void probeLlm(s)
  }}
  onManageSettings={() => setView('settings')}
/>
```

Import `ModelPicker` and `LlmProvider`.

- [ ] **Step 2: Update `onCreate` signature**

```ts
const onCreate = async (
  task: string,
  model?: string,
  files?: File[],
  runtimeUrl?: string,
  llmProvider?: string,
) => {
  ...
  const s = await api.createSession(task, model, files, runtimeUrl, llmProvider)
  ...
}
```

Thread the new arity through any wrappers (`AgentBrowserPage` props) unchanged except the type.

- [ ] **Step 3: AgentPage override state**

```ts
const [pick, setPick] = useState<ModelPick>({
  provider: (settings?.llm_provider as LlmProvider) || 'local',
  model: settings?.llm_model || 'local-model',
})

useEffect(() => {
  setPick({
    provider: (settings?.llm_provider as LlmProvider) || 'local',
    model: settings?.llm_model || 'local-model',
  })
}, [settings?.llm_provider, settings?.llm_model])
```

Replace the read-only model dropdown UI with:

```tsx
<ModelPicker
  catalog={settings?.llm_models}
  value={pick}
  onChange={setPick}
  onManageSettings={onOpenSettings}
/>
```

On submit:

```ts
await onCreate(
  task.trim(),
  pick.model,
  attachments.map((a) => a.file),
  runtimeUrl.trim() || undefined,
  pick.provider,
)
```

Remove obsolete `modelOpen` state if unused.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit`  
Expected: PASS

- [ ] **Step 5: Manual acceptance (checklist)**

- [ ] Reload app → current model appears under active provider in Settings
- [ ] Add a second local model → Save → appears in status-bar picker
- [ ] Status-bar select switches global provider/model and probe
- [ ] New Agent pick different model → session header shows it; run uses that model (not only label)
- [ ] Change status bar after session created → follow-up in old session still uses session snapshot
- [ ] Empty catalog → picker CTA opens Settings

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/AgentPage.tsx frontend/src/components/AgentBrowserPage.tsx
git commit -m "Wire ModelPicker into status bar and New Agent."
```

---

### Task 9: Schedule job provider (light)

**Files:**
- Modify: `frontend/src/components/ScheduleJobModal.tsx`
- Modify: `frontend/src/api.ts` (scheduled job create/update types if they list `model` only)
- Modify: backend schedule create already done in Task 3

- [ ] **Step 1: Add optional `llm_provider` to schedule payload**

If modal has a free-text model field, add a small provider `<select>` (`local` / `openai` / `anthropic`) defaulting to `settings.llm_provider`, and include `llm_provider` in the create/update body next to `model`. Prefer reusing `ModelPicker` if the modal layout allows; otherwise select + existing model input is enough for v1.

- [ ] **Step 2: Typecheck + commit**

```bash
git add frontend/src/components/ScheduleJobModal.tsx frontend/src/api.ts
git commit -m "Pass llm_provider when creating scheduled agent jobs."
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `llm_models` catalog shape | 1–2 |
| One-time migration when key absent | 2 |
| Settings GET/PUT | 2 |
| Manual add/remove in Settings | 6 |
| Status-bar global picker | 7–8 |
| New Agent per-run override | 8 |
| Session `llm_provider` snapshot | 3–4 |
| Runner applies before `build_llm` | 4 |
| Schedule override | 3, 9 |
| Empty / remove-active edge cases | 6–7 |
| No fetch APIs / no Auto-MAX / no browser_use in picker | Constraints + 7 |

## Placeholder / consistency check

- Helper names: `empty_catalog`, `normalize_catalog`, `ensure_model_in_catalog`, `parse_catalog_json` — used consistently.
- API field name: `llm_provider` (session + create) — not `provider`.
- Frontend pick type: `ModelPick { provider, model }`.
