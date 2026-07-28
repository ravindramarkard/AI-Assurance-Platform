# Multi-LLM model catalog + picker — design

**Date:** 2026-07-28  
**Status:** Approved (Approach 1)  
**Scope:** Settings model catalogs, shared model picker UI, global active model, per-run override on New Agent / Schedule

## Problem

Settings allows only one active LLM provider and one model string at a time. Users who keep Local (LM Studio / Ollama), OpenAI, and Anthropic credentials must re-enter the model (and flip provider) to switch. There is no Cursor-style dropdown to choose among saved models. Session/job `model` is stored for display but the agent runner always uses global `effective_settings()` — per-run selection cannot work today.

## Goals

- Keep **one shared credential set per provider** (Local / OpenAI / Anthropic)
- Let users **manually add multiple models per provider** in Settings
- Provide a **Cursor-style model picker** in the **status bar** (global default) and on **New Agent** (per-run override; Schedule optional same override)
- Persist catalogs and active choice in app settings; apply per-run provider/model in `agent_runner` before `build_llm`
- Migrate existing `llm_model` into the active provider’s catalog so current setups keep working

## Non-goals (v1)

- Fetching / refreshing model lists from LM Studio, OpenAI, or Anthropic APIs
- Named profiles with separate Base URL / API key per entry
- Auto / MAX Mode toggles
- Changing how `build_llm` constructs clients beyond selecting provider + model from config
- Multi-model routing or fallback chains

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Catalog shape | Shared credentials + models list per provider (option C) |
| Picker effect | Global default **and** per-run override (option C) |
| Picker locations | Status bar + New Agent (option C) |
| How models are added | Manual add/remove in Settings (option A) |
| Architecture | Approach 1 — model catalog + active selection |

## Data model

### Existing fields (unchanged role)

| Field | Role |
|-------|------|
| `llm_provider` | Active provider: `local` \| `openai` \| `anthropic` |
| `llm_model` | Active model id string |
| `llm_base_url`, `llm_api_key` | Local credentials |
| `openai_api_key` | OpenAI credentials |
| `anthropic_api_key` | Anthropic credentials |

### New field

```ts
llm_models: {
  local: string[]
  openai: string[]
  anthropic: string[]
}
```

- Arrays are ordered (UI display order = array order).
- Entries are trimmed non-empty model id strings; duplicates within a provider are deduped on save (keep first occurrence).
- `llm_model` for the active `llm_provider` should normally appear in that provider’s array. If the user saves a model that is not in the list, append it.

### Migration

When `llm_models` is **absent** from stored settings (not when the user has intentionally cleared lists):

1. Initialize `llm_models` to `{ local: [], openai: [], anthropic: [] }`.
2. If `llm_model` is non-empty, append it to `llm_models[llm_provider]` (dedupe).
3. Persist the seeded `llm_models` so migration does not re-run.
4. Do not invent models for inactive providers.

Storage remains the existing `app_settings` key/value table via `effective_settings()` / `PUT /api/settings`. Serialize `llm_models` as a single JSON value.

### API

- `GET /api/settings` / `public_settings()`: include `llm_models` (no secrets).
- `PUT /api/settings` (`SettingsUpdate`): accept optional `llm_models` and existing LLM fields.
- `POST /api/settings/test-llm`: unchanged behavior — uses request overrides or active provider + model + credentials.
- Session create / schedule: accept optional **provider** override in addition to existing `model` (see Runtime).

Frontend `AppSettings` in `frontend/src/api.ts` mirrors the new field.

## Runtime behavior

### Global default (status bar)

Selecting a model in the status-bar picker:

1. Sets `llm_provider` to that model’s provider.
2. Sets `llm_model` to that model id.
3. Persists via `PUT /api/settings`.
4. Existing LLM probe (`testLlm` / status strip) refreshes against the new active pair.

### Per-run override (New Agent / Schedule)

- New Agent picker defaults to the global active pair.
- Choosing another catalog entry is a **session override only** (does not rewrite Settings unless the user also changes the status-bar picker).
- `createSession` (and schedule job create) send optional `provider` + `model`.
- **`agent_runner` must apply session/job `provider` + `model` onto `cfg` before `build_llm(cfg)`.** Today `model` is metadata only — this gap is in scope and must be fixed.
- Session header / `session.model` continues to display the model actually used for the run.
- If override provider/model is missing or invalid, fall back to global Settings.

### Chat follow-ups

Add nullable `session.llm_provider` alongside existing `session.model`.

- On create with override: store both provider and model on the session.
- On create without override: store global `llm_provider` + `llm_model` at create time (snapshot), so later status-bar changes do not alter an in-flight session’s LLM.
- Every turn (first and follow-ups) in `agent_runner` applies `session.llm_provider` + `session.model` onto `cfg` before `build_llm` when set; otherwise falls back to global Settings.

## Settings UI

File: `frontend/src/components/SettingsPanel.tsx` (LLM section).

- Keep provider button group and credential fields as today.
- Replace single Model text field with a **per-provider model list** for the selected provider:
  - List rows with remove control
  - Text input + **Add** to append a model id
- Active model: selecting a row (or a small “Use” control) sets form `llm_model` for that provider; saving persists active pair + catalogs.
- **Test connection** uses current form credentials + selected/typed model (same as today).

## Model picker UI

Shared component (e.g. `ModelPicker.tsx`) used in:

1. **Status bar** (`App.tsx` status strip) — label `provider · model`; selection = global save
2. **New Agent** (`AgentPage.tsx`) — replaces read-only model chip; selection = local override for that create

### Dropdown behavior (Cursor-like)

- Search filter over model ids (and optionally provider name)
- Grouped sections: Local / OpenAI / Anthropic — omit empty groups
- Row: model id (primary) + dim provider label; checkmark on current selection
- Footer: “Manage in Settings…” → navigates to Settings LLM section
- No Auto / MAX toggles

### Empty / edge states

| Case | Behavior |
|------|----------|
| No models in any catalog | Picker empty state: “Add models in Settings”; CTA opens Settings |
| Remove active model from list | Set `llm_model` to the first remaining model for that provider; if none remain, clear `llm_model` and show empty selection in the picker |
| Provider has models but missing API key | Allow selection; probe/run fail with existing error messaging |
| Duplicate add | No-op (dedupe); do not insert a second copy |

## Components / files (expected touch points)

| Area | Files (indicative) |
|------|-------------------|
| Settings schema | `backend/app/config.py`, `models.py`, `llm_factory.py` (`public_settings` / `effective_settings`) |
| Persistence / routes | `backend/app/routes/settings.py`, `db.py` if needed for JSON |
| Runner override | `backend/app/agent_runner.py`, session create models, `db.create_session` |
| Frontend types/API | `frontend/src/api.ts` |
| Settings UI | `SettingsPanel.tsx` |
| Picker | new `ModelPicker.tsx`; wire in `App.tsx`, `AgentPage.tsx`; optionally `ScheduleJobModal.tsx` |
| Schedule | pass provider+model override if modal already has model field |

## Testing / acceptance

- [ ] After upgrade, current `llm_model` appears under the active provider’s catalog
- [ ] Add/remove models per provider; Save; reload persists `llm_models`
- [ ] Status-bar pick changes global provider+model and status strip / probe
- [ ] New Agent override creates a session that runs with that provider+model (not only display)
- [ ] Follow-up in that session keeps the same provider+model
- [ ] Empty catalog shows Settings CTA; “Manage in Settings…” navigates correctly
- [ ] Test connection still works for Local / OpenAI / Anthropic
- [ ] Providers without catalog entries do not appear as empty noise in the picker (groups omitted)

## Open implementation notes

- Prefer JSON column/value for `llm_models` over three parallel string settings.
- Masking of API keys unchanged (`has_*` flags).
- `browser_use` remains out of Settings UI and out of the picker catalogs.
