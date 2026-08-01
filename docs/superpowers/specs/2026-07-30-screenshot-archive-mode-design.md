# Screenshot archive mode (Configuration)

**Date:** 2026-07-30  
**Status:** Draft for user review  
**Goal:** Let users control whether numbered step screenshots are archived in Artifacts, while keeping live preview available. Especially useful in headless runs.

## Decisions (locked)

| Topic | Choice |
|--------|--------|
| Approach | **A** — Configuration control `Always` \| `On failure only` \| `Never` |
| Live preview | Always allowed (WS + overwrite `latest.png` only; no `live_####` spam) |
| Headless defaults | Turning **Headless on** suggests `On failure only`; turning **off** suggests `Always` — only if the user has not manually overridden archive mode |
| Scope | AgentBrowser session disk archive + effects on GIF / export evidence |
| Out of scope | Changing LLM vision token behavior; deleting historical session files; API Spectrum reports |

## Configuration UI

**Location:** AgentBrowser Configuration (beside Headless).

**Control:** select / segmented control labeled **Screenshot archive**

| Value | Stored setting `screenshot_archive` |
|-------|-------------------------------------|
| Always | `always` |
| On failure only | `on_failure` |
| Never | `never` |

**Help text (approx.):**  
“Live preview still updates while the agent runs. This setting only controls saving numbered `step_####.png` files into Artifacts.”

**Headless coupling:**

- When the user toggles **Headless → on**, if `screenshot_archive_user_set` is false, set archive to `on_failure`.
- When **Headless → off**, if not user-set, set archive to `always`.
- Changing Screenshot archive manually sets `screenshot_archive_user_set` = true so later Headless toggles do not clobber the choice.
- “Reset to default” (optional v1): clear user-set flag and re-apply from current Headless.

**Persistence:** settings DB keys `screenshot_archive`, `screenshot_archive_user_set` (bool). Exposed on `AppSettings` / `SettingsUpdate` like `headless`.

## Runtime behavior

### Live preview (all modes)

- `_preview_loop` continues: capture → `_save_latest` → WS `preview` (optional modest `screenshot_b64`).
- Never writes `live_####.png` (already removed).

### Step archive (`on_step`)

| Mode | Write `step_####.png` via `_save_shot`? | Step event `screenshot` path | Step event `screenshot_b64` |
|------|----------------------------------------|------------------------------|-----------------------------|
| `always` | Yes when b64 present | Rel path | Optional as today (size cap) |
| `on_failure` | Only if step is **failed** (see below) and b64 present | Rel path only when saved | Optional only when saved **or** keep ephemeral b64 for live UI without disk — prefer: disk only on failure; still may emit preview via latest |
| `never` | No | `null` | Do not attach large b64 to persisted step events; live preview uses preview events only |

Also call `_save_latest` on step when a shot exists so the pane stays fresh even if archive is skipped.

### Failed step definition

A step is **failed** if any of:

1. Any action string matches `(?i)\berror\b` or starts with `error:`
2. Model/result payload includes an error field used elsewhere in the runner
3. `thought` / extracted content clearly marks failure (`Failed.`, etc.) when already normalized into actions/details

If failure cannot be determined until after actions are extracted, decide archive **after** building `actions` / results for that step (reorder `on_step` slightly: extract actions → classify → maybe save shot).

Chat-only / no screenshot b64: nothing to archive (all modes).

### Recording GIF

- Build from `step_####` frames only (existing fallback).
- `always`: unchanged when ≥2 frames.
- `on_failure`: GIF only if ≥2 failure frames exist; otherwise skip auto-GIF quietly (log debug).
- `never`: skip auto-GIF (no frames).

### HTML/PDF export

- Embed step images only when that step has an archived file or an in-memory data URL already present.
- Missing shots → table/export without image (no broken links).

## Defaults and resolution

```text
resolve_screenshot_archive(stored, headless) -> always|on_failure|never

if stored in {always, on_failure, never}:
  return stored
# missing / invalid
return on_failure if headless else always
```

New installs: `headless` defaults true today → effective archive default **`on_failure`** once this ships (unless an explicit stored value exists). Migration: if key absent, do **not** write until save; resolve at runtime via rule above.

## Edge cases (must work)

| Case | Expected |
|------|----------|
| Headless on + `on_failure` + all steps pass | Artifacts: `latest.png` only (maybe empty screenshots dir aside from latest); no `step_####` |
| Headless on + `on_failure` + one fail mid-run | Only that failed step (and later failures) get `step_####`; earlier passes not archived |
| `never` + long run | No `step_####`; live pane still updates; Artifacts count stays low |
| `always` | Current step-archive behavior |
| User sets `never`, then toggles Headless | Archive stays `never` (user-set) |
| User never touched archive, toggles Headless off→on | Archive follows `always`↔`on_failure` |
| Invalid setting string | Fall back via resolve rule |
| Setting changed mid-session | Next `on_step` uses new effective settings from `effective_settings()` at session start **or** re-read each step — **prefer re-read each step** so Configuration save applies without restart |
| Vision on/off | Unaffected |
| Concurrent sessions | Each uses current global setting at step time |
| GIF with 0–1 frames | No GIF / existing error path; UI already handles missing recording |
| Export with `never` | Report works; no screenshot column images |
| Preview loop failure | No crash; same as today |
| Step has screenshot but classify false-negative (missed error) | May skip archive — acceptable; prefer slightly broader error detection over missing failures |
| Step has screenshot, classify false-positive | Extra archive file — acceptable |

## Implementation sketch

1. **Settings model / API / llm_factory effective dict** — add fields + resolve helper.
2. **`agent_runner.on_step`** — classify failure; gate `_save_shot`; always `_save_latest` when b64 present.
3. **Auto GIF** — respect frame availability (already); optionally skip early if mode is `never`.
4. **Frontend** — `AgentBrowserConfiguration` control + i18n; `api.ts` types; Headless toggle updates suggested archive when not user-set (track `screenshot_archive_user_set` from server).
5. **Tests** — resolve defaults; `on_failure` saves only on error actions; `never` creates no `step_*.png`; user-set flag blocks headless clobber (unit-test pure helpers).

## Success criteria

- Configuration shows Screenshot archive with three modes and clear help.
- Live preview works in all modes.
- `on_failure` / `never` stop Artifacts flooding with pass-step PNGs.
- Headless default coupling works without overriding a manual choice.
- Unit tests cover resolve + archive gate edge cases above.
