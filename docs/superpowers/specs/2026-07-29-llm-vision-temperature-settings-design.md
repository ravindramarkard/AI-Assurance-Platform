# LLM Vision & Temperature settings — design

**Date:** 2026-07-29  
**Status:** Approved (Approach 1 — persist user overrides)  
**Scope:** Global Settings → LLM controls for Vision enable/disable and Temperature

## Problem

Agent runs hard-code vision and temperature behavior:

- Vision was forced ON, then provider-defaulted OFF for `local` after Vitruvian/GLM rejected screenshot payloads (`HTTP 200` + `{"error":"Failed to connect to Dest API"}` → null `choices`).
- Temperature is fixed at `0.1` in `build_local_chat_openai` with no Settings control.

Users need explicit, global toggles in Settings without per-run overrides.

## Goals

- Add **Vision** enable/disable and **Temperature** controls in Settings → LLM section
- Persist overrides in `app_settings`; unset falls back to safe provider defaults
- Wire values into agent runs (`use_vision`) and LLM construction (`temperature`)
- Warn when Vision is ON with a local provider (screenshot-rejection risk)
- i18n for en / ar / hi

## Non-goals

- Per-agent or per-session overrides
- Changing frequency_penalty, max_completion_tokens, or other sampling knobs
- New provider types or model-capability auto-detection beyond current provider defaults
- Changing how screenshots are saved for the UI preview (browser preview stays; only LLM vision input is gated)

## Approach

**Approach 1 — Persist user overrides (chosen)**

Store `llm_use_vision` and `llm_temperature` when the user sets them. Unset keys keep provider-based vision defaults and temperature `0.1`. Explicit values win for all providers.

Rejected:

- Always-explicit-only (switching providers can leave a bad Vision value)
- Env-only (no Settings UI)

## Data model

| Key | Storage | Unset meaning |
|-----|---------|---------------|
| `llm_use_vision` | `"true"` / `"false"` in `app_settings` | Provider default |
| `llm_temperature` | float string e.g. `"0.1"` | `0.1` |

### Effective vision

```
if llm_use_vision is set:
  use stored bool
else:
  OFF for local
  ON for openai / anthropic / browser_use
```

### Effective temperature

```
value = parse float(llm_temperature) if set else 0.1
clamp to [0.0, 1.0]
```

Optional env mirrors in `config.py` (`LLM_USE_VISION`, `LLM_TEMPERATURE`); DB overrides win (existing settings pattern).

## Backend

### API surface

- `SettingsUpdate`: `llm_use_vision: bool | None`, `llm_temperature: float | None`
- Allow-list both keys in settings routes
- `effective_settings`: merge env + DB; coerce bool/float like `headless`
- `public_settings`:
  - `llm_use_vision: bool | null` (null = unset / use provider default)
  - `llm_use_vision_effective: bool` (resolved for current provider — UI display)
  - `llm_temperature: number` (effective, default 0.1)

Clearing vision override: client may send a dedicated reset (e.g. omit + `llm_use_vision_reset: true`) or DELETE-style clear via putting empty and a reset flag. Prefer a boolean `llm_use_vision_reset: true` on update that deletes the `llm_use_vision` key so provider default returns.

### Runtime wiring

- `agent_runner`: `use_vision = cfg["llm_use_vision"] if set else use_vision_for_provider(provider)`
- `build_llm` / `build_local_chat_openai`: pass `temperature` from cfg (default 0.1)
- Cloud `ChatOpenAI` / `ChatAnthropic`: pass temperature when the constructor supports it; ignore quietly if not
- Keep improved `_fix_missing_choices` gateway-error message for vision failures

### Tests

- Unit: unset → provider defaults; set true/false wins; temperature clamp; gateway error still surfaces `error` field
- Extend `tests/test_local_llm.py` (or sibling) for effective helpers

## Frontend

### Placement

Settings → LLM section, under the model field.

### Controls

1. **Vision** — toggle bound to effective display when unset; first flip writes explicit bool. **Reset to provider default** when an override is stored (`llm_use_vision !== null`).
2. **Temperature** — range slider `0–1`, step `0.05`, synced with number input (same range). Saved with Save Settings.
3. **Warning** — if `llm_provider === 'local'` and Vision effective ON: short copy that some GLM/local gateways reject screenshots.

### i18n

Add keys in `en.ts` / `ar.ts` / `hi.ts` for: Vision label, Vision help, Reset default, Temperature label, Temperature help, local+vision warning.

## Error handling

- Temperature on write: reject with 422 if outside `0.0–1.0`. On read/effective: clamp malformed DB values into range (and fall back to `0.1` if unparseable).
- Vision ON + local gateway failure → existing clearer RuntimeError mentioning vision/screenshots
- Test LLM uses configured temperature; vision does not apply to the ping prompt

## Success criteria

- User can enable/disable Vision and set Temperature in Settings; values persist across reload
- Unset Vision uses provider defaults (local OFF, cloud ON)
- New agent runs honor effective Vision and Temperature
- Local + Vision ON shows warning in Settings
- Existing agent/browser behavior otherwise unchanged
