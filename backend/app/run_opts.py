"""Per-session run options (max_steps, file paths, system prompt) for the agent runner."""

from __future__ import annotations

from typing import Any

_opts: dict[str, dict[str, Any]] = {}


def set_run_opts(session_id: str, **kwargs: Any) -> None:
    _opts[session_id] = {k: v for k, v in kwargs.items() if v is not None}


def pop_run_opts(session_id: str) -> dict[str, Any]:
    return _opts.pop(session_id, {})
