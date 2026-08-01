# Action-Only Screenshot Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the ~2s live browser preview, but stop writing numbered `live_####.png` files; only agent step screenshots (`step_####.png`) are archived in Artifacts.

**Architecture:** Split screenshot persistence into (1) overwrite-only `latest.png` for live preview and (2) numbered archive for step callbacks. `_preview_loop` uses (1); `on_step` keeps using (2) with prefix `step`. Recording GIF already falls back to `step_####` when no live frames exist.

**Tech Stack:** Python 3, asyncio, pathlib, unittest, Pillow (existing GIF builder)

## Global Constraints

- Do not change the 2s preview interval or WebSocket `preview` event shape beyond using `screenshots/latest.png` as the path.
- Do not change vision / LLM screenshot token behavior.
- Do not delete existing `live_####` files from old sessions.
- Prefer `step_####` for new sessions; keep accepting `live_####` in the GIF collector for old sessions.
- Do not commit unless the user explicitly asks.

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/agent_runner.py` | `_save_latest`, adjust `_save_shot` / `_preview_loop` |
| `backend/app/recording_gif.py` | Docstring + error message clarity |
| `backend/tests/test_screenshot_save.py` | Unit tests for latest-only vs numbered archive |
| `backend/tests/test_recording_gif.py` | GIF builds from step-only frames |

---

### Task 1: Screenshot save helpers (latest-only vs numbered)

**Files:**
- Modify: `backend/app/agent_runner.py` (`_save_shot`, `_preview_loop`)
- Test: `backend/tests/test_screenshot_save.py`

**Interfaces:**
- Produces:
  - `async def _save_latest(screenshots: Path, b64: str) -> str | None` — writes `latest.png` only; returns `"screenshots/latest.png"` or `None`
  - `async def _save_shot(screenshots: Path, prefix: str, b64: str) -> str | None` — writes `latest.png` + `{prefix}_{n:04d}.png`; returns path of numbered file or `None`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_screenshot_save.py`:

```python
import asyncio
import base64
import tempfile
import unittest
from pathlib import Path

from PIL import Image
import io

from app import agent_runner


def _tiny_png_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color=(10, 20, 30)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


class TestScreenshotSave(unittest.TestCase):
    def test_save_latest_does_not_create_live_files(self):
        with tempfile.TemporaryDirectory() as td:
            shots = Path(td)
            b64 = _tiny_png_b64()
            rel = asyncio.run(agent_runner._save_latest(shots, b64))
            self.assertEqual(rel, "screenshots/latest.png")
            self.assertTrue((shots / "latest.png").is_file())
            self.assertEqual(list(shots.glob("live_*.png")), [])

    def test_save_shot_creates_numbered_step_and_latest(self):
        with tempfile.TemporaryDirectory() as td:
            shots = Path(td)
            b64 = _tiny_png_b64()
            rel = asyncio.run(agent_runner._save_shot(shots, "step", b64))
            self.assertEqual(rel, "screenshots/step_0000.png")
            self.assertTrue((shots / "latest.png").is_file())
            self.assertTrue((shots / "step_0000.png").is_file())
            rel2 = asyncio.run(agent_runner._save_shot(shots, "step", b64))
            self.assertEqual(rel2, "screenshots/step_0001.png")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m unittest tests.test_screenshot_save -v`  
Expected: FAIL — `_save_latest` not defined (or AttributeError)

- [ ] **Step 3: Implement helpers and wire preview loop**

In `backend/app/agent_runner.py`, replace `_save_shot` / update `_preview_loop` as follows:

```python
async def _save_latest(screenshots: Path, b64: str) -> str | None:
    """Overwrite screenshots/latest.png only (live preview; no numbered archive)."""
    try:
        raw = base64.b64decode(b64)
        screenshots.mkdir(parents=True, exist_ok=True)
        (screenshots / "latest.png").write_bytes(raw)
        return "screenshots/latest.png"
    except Exception as e:
        logger.warning("screenshot latest save failed: %s", e)
        return None


async def _save_shot(screenshots: Path, prefix: str, b64: str) -> str | None:
    """Write latest.png plus a numbered archive file (step_#### / legacy live_####)."""
    try:
        raw = base64.b64decode(b64)
        screenshots.mkdir(parents=True, exist_ok=True)
        latest = screenshots / "latest.png"
        latest.write_bytes(raw)
        n = len(list(screenshots.glob(f"{prefix}_*.png")))
        fname = f"{prefix}_{n:04d}.png"
        (screenshots / fname).write_bytes(raw)
        return f"screenshots/{fname}"
    except Exception as e:
        logger.warning("screenshot save failed: %s", e)
        return None


async def _preview_loop(session_id: str, agent: Any, screenshots: Path, stop: asyncio.Event) -> None:
    """Push live preview frames while the agent runs (independent of step callbacks).

    Updates latest.png only — does not archive live_####.png (Artifacts stay lean).
    """
    await asyncio.sleep(1.5)
    while not stop.is_set():
        try:
            url, b64 = await _capture_via_agent(agent)
            if b64:
                rel = await _save_latest(screenshots, b64)
                payload: dict[str, Any] = {"url": url, "screenshot": rel}
                if len(b64) < 400_000:
                    payload["screenshot_b64"] = b64
                await _emit(session_id, "preview", payload)
                if url:
                    await db.update_session(session_id, current_url=url)
        except Exception as e:
            logger.debug("preview loop: %s", e)
        try:
            await asyncio.wait_for(stop.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass
```

Leave `on_step` calling `_save_shot(screenshots, "step", screenshot_b64)` unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m unittest tests.test_screenshot_save -v`  
Expected: PASS (2 tests)

---

### Task 2: Recording GIF messaging + step-only coverage

**Files:**
- Modify: `backend/app/recording_gif.py` (docstring + error message)
- Test: `backend/tests/test_recording_gif.py`

**Interfaces:**
- Consumes: existing `build_recording_gif(session_root: Path, *, duration_ms: int = ..., out_name: str = ...) -> dict`
- Produces: unchanged return shape; clearer errors; still works with only `step_####.png`

- [ ] **Step 1: Write the failing / characterizing test**

Create `backend/tests/test_recording_gif.py`:

```python
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from app.recording_gif import build_recording_gif


def _write_png(path: Path, color: tuple[int, int, int]) -> None:
    Image.new("RGB", (32, 24), color=color).save(path, format="PNG")


class TestRecordingGif(unittest.TestCase):
    def test_builds_from_step_frames_only(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            shots = root / "screenshots"
            shots.mkdir()
            _write_png(shots / "step_0000.png", (255, 0, 0))
            _write_png(shots / "step_0001.png", (0, 255, 0))
            meta = build_recording_gif(root, duration_ms=100)
            self.assertEqual(meta["path"], "screenshots/recording.gif")
            self.assertEqual(meta["frames"], 2)
            self.assertTrue((shots / "recording.gif").is_file())

    def test_error_mentions_step_frames(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "screenshots").mkdir()
            with self.assertRaises(FileNotFoundError) as ctx:
                build_recording_gif(root)
            self.assertIn("step_", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test — step-only may already pass; error text should fail**

Run: `cd backend && python -m unittest tests.test_recording_gif -v`  
Expected: `test_builds_from_step_frames_only` PASS; `test_error_mentions_step_frames` FAIL (message still says `live_0000.png`)

- [ ] **Step 3: Update docstring and error message**

In `backend/app/recording_gif.py`:

```python
# Prefer live preview frames when present (legacy sessions); else per-step shots.
```

Update `build_recording_gif` docstring:

```python
    """
    Write screenshots/recording.gif from step_####.png (or legacy live_####.png) in order.
    Returns metadata including relative path under the session.
    """
```

Update the raise:

```python
        raise FileNotFoundError(
            "No sequential screenshots found (expected step_0000.png, …)."
        )
```

Keep `_collect_frames` logic: `chosen = live if live else step` so old sessions with `live_####` still work.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m unittest tests.test_screenshot_save tests.test_recording_gif -v`  
Expected: all PASS

---

### Task 3: Smoke-check UI contract (no frontend change expected)

**Files:**
- Read-only verify: `frontend/src/App.tsx` (preview / step handlers)
- Read-only verify: `frontend/src/components/RightPanel.tsx` (`shotFrameCount` regex)

- [ ] **Step 1: Confirm preview path `screenshots/latest.png` is acceptable**

`App.tsx` already handles `payload.screenshot` and `screenshot_b64` for `preview` and `step`. No code change if those fields remain.

`RightPanel.tsx` counts only `(live|step)_\\d+\\.png` — `latest.png` is correctly excluded from the frame count.

- [ ] **Step 2: Manual checklist (after deploy / local run)**

1. Start an agent session that opens a browser.
2. Confirm live pane still updates between steps.
3. Open Artifacts → `screenshots/`: expect `latest.png` + `step_####.png` only (no growing `live_####` list).
4. After session ends, recording GIF still builds if ≥2 step frames exist.

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Preview loop no `live_####` | Task 1 |
| Keep WS preview + optional b64 | Task 1 |
| Overwrite `latest.png` from preview | Task 1 |
| `on_step` still writes `step_####` | Task 1 (unchanged call) |
| GIF works with step-only / clearer errors | Task 2 |
| Frontend no required change | Task 3 |
| Out of scope items not implemented | — |

## Self-review notes

- No placeholders.
- `_save_latest` / `_save_shot` signatures consistent across tasks.
- Commit steps omitted per repo user rule (commit only when asked).
