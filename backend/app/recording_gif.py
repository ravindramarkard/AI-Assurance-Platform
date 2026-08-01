"""Build an animated GIF from sequential session screenshots."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from PIL import Image

# Prefer live preview frames when present (legacy sessions); else per-step shots.
_FRAME_RE = re.compile(r"^(live|step)_(\d+)\.png$", re.IGNORECASE)
_MAX_FRAMES = 150
_MAX_WIDTH = 960
_DEFAULT_DURATION_MS = 280


def _collect_frames(shots_dir: Path) -> list[Path]:
    if not shots_dir.is_dir():
        return []

    live: list[tuple[int, Path]] = []
    step: list[tuple[int, Path]] = []
    for p in shots_dir.iterdir():
        if not p.is_file():
            continue
        m = _FRAME_RE.match(p.name)
        if not m:
            continue
        idx = int(m.group(2))
        if m.group(1).lower() == "live":
            live.append((idx, p))
        else:
            step.append((idx, p))

    chosen = live if live else step
    chosen.sort(key=lambda t: t[0])
    paths = [p for _, p in chosen]
    if len(paths) <= _MAX_FRAMES:
        return paths
    # Evenly subsample to keep GIF size / encode time reasonable
    step_n = max(1, len(paths) / _MAX_FRAMES)
    out: list[Path] = []
    i = 0.0
    while int(i) < len(paths) and len(out) < _MAX_FRAMES:
        out.append(paths[int(i)])
        i += step_n
    if out[-1] != paths[-1]:
        out.append(paths[-1])
    return out


def _prepare_frame(path: Path) -> Image.Image:
    with Image.open(path) as im:
        rgb = im.convert("RGB")
    if rgb.width > _MAX_WIDTH:
        ratio = _MAX_WIDTH / float(rgb.width)
        rgb = rgb.resize(
            (_MAX_WIDTH, max(1, int(rgb.height * ratio))),
            Image.Resampling.LANCZOS,
        )
    # Adaptive palette per-frame keeps memory lower than one huge RGB stack
    return rgb.convert("P", palette=Image.Palette.ADAPTIVE, colors=128)


def build_recording_gif(
    session_root: Path,
    *,
    duration_ms: int = _DEFAULT_DURATION_MS,
    out_name: str = "recording.gif",
) -> dict[str, Any]:
    """
    Write screenshots/recording.gif from step_####.png (or legacy live_####.png) in order.
    Returns metadata including relative path under the session.
    """
    shots = session_root / "screenshots"
    frames_paths = _collect_frames(shots)
    if not frames_paths:
        raise FileNotFoundError(
            "No sequential screenshots found (expected step_0000.png, …)."
        )

    duration = max(80, min(2000, int(duration_ms)))
    out_path = shots / out_name
    shots.mkdir(parents=True, exist_ok=True)

    prepared: list[Image.Image] = []
    try:
        for p in frames_paths:
            prepared.append(_prepare_frame(p))
        first, rest = prepared[0], prepared[1:]
        first.save(
            out_path,
            format="GIF",
            save_all=bool(rest),
            append_images=rest,
            duration=duration,
            loop=0,
            disposal=2,
            optimize=False,
        )
    finally:
        for im in prepared:
            try:
                im.close()
            except Exception:
                pass

    return {
        "path": f"screenshots/{out_name}",
        "frames": len(frames_paths),
        "duration_ms": duration,
        "size": out_path.stat().st_size if out_path.exists() else 0,
    }
