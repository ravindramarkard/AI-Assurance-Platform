# Action-only screenshot archive

**Date:** 2026-07-29  
**Status:** Approved for implementation pending user review of this spec  
**Goal:** Keep the live browser preview smooth, but stop writing hundreds of nearly identical `live_####.png` files into Artifacts.

## Problem

While an agent runs, `_preview_loop` captures the browser about every 2 seconds and archives each frame as `screenshots/live_NNNN.png`. Long sessions produce hundreds of repeated images (e.g. 450+ Artifacts). Those files consume disk and clutter the Artifacts tab. They are not required for LLM tokens; they exist for live UI preview and optional GIF recording.

## Decision

**Option B — live preview without archiving:**

- Continue polling ~every 2s and push WebSocket `preview` events so the live pane stays smooth.
- Do **not** write numbered `live_####.png` files.
- Persist numbered screenshots only from agent step callbacks as `step_####.png` (actions such as click, type, navigate that complete a step).
- Optionally keep overwriting `screenshots/latest.png` from the preview loop for a stable path-based preview fallback.

## Behavior

| Source | Disk | UI |
|--------|------|-----|
| Preview loop (~2s) | Overwrite `latest.png` only; no `live_####` | WS `preview` with path and optional modest `screenshot_b64` |
| Agent `on_step` | Write `step_####.png` + update `latest.png` | Existing step events with screenshot path |
| Workspace files | Unchanged | Unchanged |

## Recording GIF

`build_recording_gif` already prefers `live_####` then falls back to `step_####`. After this change, new sessions will only have `step_####` frames, so GIFs become an **action timeline** rather than a dense filmstrip. That matches the product intent.

Update the “no frames” error message to mention `step_####.png` as the primary expected input (live remains accepted for older sessions).

## Out of scope

- Capturing a PNG per *intra-step* browser action when browser-use batches multiple actions in one step (still one `step_####` per agent step).
- Changing vision / LLM screenshot token behavior.
- Deleting existing `live_####` files from old sessions.
- Changing the 2s preview interval.

## Implementation sketch

1. **`backend/app/agent_runner.py`**
   - Split save helpers or add a flag so preview can update `latest.png` (and return a path) without allocating `live_NNNN.png`.
   - `_preview_loop`: capture → write `latest.png` only → emit `preview` with `screenshot: "screenshots/latest.png"` and optional `screenshot_b64`.
   - `on_step`: keep `_save_shot(..., "step", ...)`.

2. **`backend/app/recording_gif.py`**
   - Prefer `step_####` when building GIFs for new behavior clarity, **or** keep current “live if present else step” so old sessions still work. Recommended: keep live-or-step collection; update docstring/error text to say step frames are the normal case.

3. **Frontend**
   - No required change if preview still sends `screenshot` / `screenshot_b64`.
   - `shotFrameCount` already matches `(live|step)_####`; it will naturally count only step frames for new sessions.

4. **Tests**
   - Unit-level: preview save path does not create `live_*.png`; step save still creates `step_0000.png`.
   - GIF builder still succeeds with only `step_*.png`.

## Success criteria

- During a multi-minute run, Artifacts does not grow by one PNG every ~2 seconds.
- Live pane still updates between steps.
- Each completed agent step that includes a screenshot still produces one `step_####.png`.
- Recording GIF still builds from step frames when lives are absent.
