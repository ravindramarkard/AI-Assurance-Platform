"""Answer questions about attached workspace files without launching a browser."""

from __future__ import annotations

import csv
import io
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_MAX_CHARS_PER_FILE = 24_000
_MAX_FILES = 8
_TEXT_SUFFIXES = {
    ".csv",
    ".tsv",
    ".txt",
    ".md",
    ".json",
    ".jsonl",
    ".xml",
    ".yaml",
    ".yml",
    ".log",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".html",
    ".css",
    ".sql",
}


def _paths_from_task(task: str) -> list[Path]:
    """Absolute paths listed under the Attached files block."""
    found: list[Path] = []
    for m in re.finditer(r"(?m)^-\s+(/[^\n]+)\s*$", task or ""):
        p = Path(m.group(1).strip())
        if p.is_file():
            found.append(p)
    return found


def list_attachment_files(workspace: Path, task: str = "") -> list[Path]:
    """Prefer paths from the task; fall back to workspace/uploads."""
    from_task = _paths_from_task(task)
    if from_task:
        return from_task[:_MAX_FILES]
    upload_dir = workspace / "uploads"
    if not upload_dir.is_dir():
        return []
    files = sorted(
        (p for p in upload_dir.iterdir() if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return files[:_MAX_FILES]


def _csv_preview(raw: str, *, max_rows: int = 40) -> str:
    try:
        reader = csv.reader(io.StringIO(raw))
        rows = list(reader)
    except Exception:
        return raw[:_MAX_CHARS_PER_FILE]
    if not rows:
        return "(empty CSV)"
    header = rows[0]
    body = rows[1:]
    out = [
        f"Columns ({len(header)}): {', '.join(header) if header else '(none)'}",
        f"Data rows: {len(body)}",
        "",
        "Preview:",
    ]
    sample = rows[: max_rows + 1]
    for i, row in enumerate(sample):
        label = "header" if i == 0 else f"row {i}"
        out.append(f"  [{label}] " + " | ".join(row))
    if len(rows) > max_rows + 1:
        out.append(f"  … {len(rows) - max_rows - 1} more rows omitted")
    return "\n".join(out)


def _read_file_excerpt(path: Path) -> str:
    suffix = path.suffix.lower()
    size = path.stat().st_size
    if suffix not in _TEXT_SUFFIXES:
        return f"(binary or unsupported type · {size} bytes — describe from filename/metadata only)"
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"(could not read: {e})"
    if suffix in {".csv", ".tsv"}:
        return _csv_preview(raw)
    if len(raw) > _MAX_CHARS_PER_FILE:
        return raw[:_MAX_CHARS_PER_FILE] + f"\n… [truncated · {len(raw)} chars total]"
    return raw


def build_attachment_context(workspace: Path, task: str = "") -> str | None:
    files = list_attachment_files(workspace, task)
    if not files:
        return None
    parts: list[str] = []
    for path in files:
        try:
            excerpt = _read_file_excerpt(path)
        except Exception as e:
            excerpt = f"(error reading file: {e})"
        parts.append(f"### {path.name}\nPath: `{path}`\n\n{excerpt}")
    return "\n\n".join(parts)


async def answer_from_attachments(
    *,
    task: str,
    workspace: Path,
    cfg: dict[str, Any],
) -> str | None:
    """
    Use the configured LLM to describe/analyze attached files.
    Returns None if there are no readable attachments or the model call fails.
    """
    from browser_use.llm.messages import SystemMessage, UserMessage

    from .chat_gate import normalize_task
    from .llm_factory import build_llm

    context = build_attachment_context(workspace, task)
    if not context:
        return None

    ask = normalize_task(task) or "Describe the attached file(s)."
    system = (
        "You analyze attached local files. Do not open a browser or claim you visited a website. "
        "Use ONLY the file contents provided. Lead with the answer — tables/bullets when helpful. "
        "For CSVs, report columns and exact record counts from the preview metadata."
    )
    user_prompt = (
        f"## User request\n{ask}\n\n"
        f"## Attached file contents\n{context}\n"
    )

    try:
        llm = build_llm(cfg)
        if hasattr(llm, "dont_force_structured_output"):
            try:
                llm.dont_force_structured_output = True  # type: ignore[attr-defined]
            except Exception:
                pass
        result = await llm.ainvoke(
            [
                SystemMessage(content=system),
                UserMessage(content=user_prompt),
            ]
        )
        text = getattr(result, "completion", None) or getattr(result, "content", None) or result
        reply = str(text or "").strip()
        return reply or None
    except Exception:
        logger.exception("answer_from_attachments failed")
        return None
