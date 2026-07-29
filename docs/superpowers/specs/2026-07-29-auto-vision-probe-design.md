# Auto Vision mode (probe-based) — design

**Date:** 2026-07-29  
**Status:** Approved (Approach 1 — tiny image probe; controller locked remaining UI/details)  
**Scope:** Three-way Vision control (Auto / On / Off) with endpoint capability probing and cache

## Problem

Manual Vision On fails against text-only local/GLM gateways (HTTP 200 + `{"error":"Failed to connect to Dest API"}` → null `choices`). Provider heuristics (local OFF / cloud ON) are wrong when a local endpoint *does* support images or a cloud proxy does not. Users need automatic detection while still being able to force On/Off.

## Goals

- Settings control: **Auto / On / Off**
- Auto probes with a tiny image chat-completions request (same failure mode as real agent screenshots)
- Probe on **Test connection** and at **agent start** when cache is missing/stale; never per step
- Persist probe result for UI (“Vision available” / “Not supported”)
- Migrate existing `llm_use_vision` bool overrides to the new mode
- Keep Temperature settings unchanged

## Non-goals

- Per-agent Vision overrides
- Probing every agent step
- Changing screenshot capture for the UI browser preview
- Model-card / catalog-based vision flags without a live probe

## Approach

**Chosen: Approach 1 — Tiny image probe**

Send a 1×1 PNG via OpenAI-compatible `/chat/completions`. Cache supported/unsupported keyed by provider + base_url + model.

Rejected: heuristics-only; fail-open mid-run fallback.

## Data model

### User preference

| Key | Values | Default |
|-----|--------|---------|
| `llm_vision_mode` | `auto` \| `on` \| `off` | `auto` |

### Probe cache

| Key | Values |
|-----|--------|
| `llm_vision_probe_ok` | `true` / `false` / unset |
| `llm_vision_probe_at` | ISO-8601 timestamp |
| `llm_vision_probe_key` | `{provider}\|{base_url}\|{model}` |

### Effective vision

```
mode == off  → False
mode == on   → True
mode == auto → cached probe if probe_key matches current config
               else run probe, write cache, return result
               probe error/timeout → False (safe default)
```

### Migration from `llm_use_vision`

On read (once):

- stored `true` → set `llm_vision_mode=on`, delete `llm_use_vision`
- stored `false` → set `llm_vision_mode=off`, delete `llm_use_vision`
- unset → leave mode default `auto`

Stop writing `llm_use_vision` / `llm_use_vision_reset` from the UI. Keep temporary server-side acceptance of the old keys for one release if needed for in-flight clients, mapping them into mode.

## Probe contract

**Request:** `POST {llm_base_url}/chat/completions` (local) or provider-native equivalent for openai/anthropic when feasible; for cloud, prefer the same client path used by `build_llm` if raw HTTP is awkward — minimum requirement is local OpenAI-compatible probe (covers Vitruvian/GLM). For openai/anthropic in Auto, treat as **supported without probe** unless a custom `llm_base_url` is set (proxy); if base_url is set for openai path in future, probe that URL.

**Practical rule (locked):**

- `provider == local` (or any OpenAI-compatible base_url): always live-probe in Auto
- `provider in {openai, anthropic, browser_use}` with no custom incompatible proxy: Auto → **True** without probe (native vision APIs)
- If later openai gets a custom base_url again: live-probe that base_url

**Payload (local):** 1×1 PNG data-URL + text `"Reply with one word: ok"`, small `max_completion_tokens` (32), current model + API key.

**Supported when:** HTTP 200, `choices` is a non-empty list, and no top-level / message gateway `error` string like Dest API failure.

**Unsupported when:** gateway `error`, null/empty `choices`, HTTP 4xx/5xx, timeout, or connection error.

**Timeout:** 20s for probe only.

## When to probe

Only if `llm_vision_mode == auto` **and** provider requires live probe (local):

1. Settings **Test connection** — always refresh probe for current form/cfg
2. **Agent start** — if cache missing or `llm_vision_probe_key` ≠ current key

Do **not** probe every step.

## Backend wiring

- Module helpers (extend `local_llm.py` or small `vision_probe.py`):
  - `probe_vision_support(cfg) -> bool`
  - `ensure_vision_for_cfg(cfg) -> bool` (mode + cache + optional probe; may persist cache via db)
- `public_settings` exposes:
  - `llm_vision_mode`
  - `llm_vision_effective` (resolved bool for current cfg)
  - `llm_vision_probe_ok` / `llm_vision_probe_at` (nullable)
- `test_llm_connection`: when mode is auto (or always for local), run probe and return `vision_supported` in the test response
- `agent_runner`: before `Agent(...)`, `use_vision = await ensure_vision_for_cfg(cfg)`; if auto disabled vision, emit a single info event/note

## Frontend (Settings → LLM)

- Replace Vision checkbox with a **segmented control / radio**: Auto | On | Off (default Auto)
- Show status line when Auto:
  - “Vision available (probed …)” / “Not supported (probed …)” / “Not probed yet — run Test connection”
- Keep local warning only when **On** is selected (forced) on local provider
- Save writes `llm_vision_mode` only
- Test connection result can show vision probe outcome

i18n: en / ar / hi for mode labels, status strings, forced-on warning.

## Error handling

- Auto + unsupported → vision off; do not fail agent start
- Forced On + unsupported endpoint → allow start (user choice); existing gateway error path still applies if images are sent
- Probe timeout → treat as unsupported; log warning

## Success criteria

- Auto on Vitruvian/GLM local → probe fails → vision off → agent runs without null-choices vision errors
- Auto on OpenAI/Anthropic → vision on without unnecessary probe
- On / Off force regardless of probe
- Test connection refreshes probe cache for local
- Migrated bool settings become on/off correctly
- Temperature behavior unchanged

## Out of scope follow-ups

- Background re-probe TTL without config change
- Per-session Vision override in New Agent form
