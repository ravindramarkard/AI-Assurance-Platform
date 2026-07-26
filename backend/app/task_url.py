"""Resolve Application URL (default) vs Runtime URL (per-run override).

Never force a default start URL when the task already names a destination
(e.g. \"go to google.com\" or an https:// link).
"""

from __future__ import annotations

import re

_HTTP_RE = re.compile(r"https?://[^\s)'\"`<>]+", re.IGNORECASE)

# Bare host like google.com / www.news.google.com (not email, not file.ext alone)
_BARE_HOST_RE = re.compile(
    r"(?i)(?:^|[\s(\"'])((?:www\.)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|dev|edu|gov|info|biz|me|tv|news|uk|de|fr|in|ae|us)(?:/[^\s)'\"`<>]*)?)"
)

_GO_TO_RE = re.compile(
    r"(?i)\b(?:go\s+to|open|visit|navigate\s+to|browse\s+to|load)\s+"
    r"(?:https?://)?((?:www\.)?[a-z0-9][-a-z0-9.]*\.[a-z]{2,}(?:/[^\s)'\"`<>]*)?)"
)

# File-like tokens that look like hosts but are not navigation targets
_FILE_EXT = re.compile(
    r"(?i)\.(pdf|md|txt|html?|csv|json|xml|ya?ml|tsx?|jsx?|py|css|png|jpe?g|gif|webp)$"
)


def normalize_url(url: str | None) -> str | None:
    u = (url or "").strip().rstrip(".,;:!?)")
    if not u:
        return None
    if not re.match(r"https?://", u, re.IGNORECASE) and not u.startswith("//"):
        u = "https://" + u
    # Lowercase scheme + host; keep path/query case
    try:
        m = re.match(r"^(https?://)([^/]+)(.*)$", u, re.IGNORECASE)
        if m:
            u = m.group(1).lower() + m.group(2).lower() + m.group(3)
    except Exception:
        pass
    return u


def extract_task_url(task: str) -> str | None:
    """Pick an explicit destination from the task text, if any."""
    text = task or ""

    # Prefer explicit "go to / open / visit …"
    m = _GO_TO_RE.search(text)
    if m:
        host = m.group(1).rstrip(".,;:!?)")
        if host and not _FILE_EXT.search(host):
            return normalize_url(host)

    m = _HTTP_RE.search(text)
    if m:
        return normalize_url(m.group(0).rstrip(".,;:!?)"))

    m = _BARE_HOST_RE.search(text)
    if m:
        host = m.group(1).rstrip(".,;:!?)")
        # Avoid matching things like "e.g." — require a real TLD host
        if "." in host and not host.lower().startswith("e.g") and not _FILE_EXT.search(host):
            return normalize_url(host)
    return None


def task_has_destination(task: str) -> bool:
    return extract_task_url(task) is not None


def is_session_continuation(task: str) -> bool:
    """True when the task is already framed as continuing a prior session page."""
    low = (task or "").strip().lower()
    return (
        low.startswith("continue in the current")
        or low.startswith("continue from the last")
        or low.startswith("reuse the existing")
        or low.startswith("work with the existing session")
    )


def extract_continuation_url(task: str) -> str | None:
    """URL of the page to continue on — not a host mentioned in prior-turn context."""
    text = task or ""
    m = re.search(
        r"(?i)(?:last session page|current browser session\s*\(page:|"
        r"reuse the existing session page at)\s*:?\s*(https?://[^\s)\]>]+)",
        text,
    )
    if m:
        return normalize_url(m.group(1))
    if is_session_continuation(text):
        # First http(s) URL in the continuation header line only
        first_line = text.split("\n", 1)[0]
        m2 = _HTTP_RE.search(first_line)
        if m2:
            return normalize_url(m2.group(0).rstrip(".,;:!?)"))
    return None


def enrich_follow_up(
    content: str,
    *,
    current_url: str | None = None,
    prior_user: str | None = None,
    prior_assistant: str | None = None,
) -> tuple[str, str | None]:
    """
    Frame a follow-up so the agent continues from the last page / last answer.
    Never injects Application URL.
    """
    text = (content or "").strip()
    if not text:
        return text, None

    # Explicit new destination in the follow-up itself
    dest = extract_task_url(text)
    if dest and re.search(
        r"(?i)\b(go\s+to|open|visit|navigate\s+to|browse\s+to)\b",
        text,
    ):
        if not _HTTP_RE.search(text):
            return f"Start by opening {dest}.\n\nTask: {text}", dest
        return text, dest

    page = normalize_url(current_url)
    # Fall back to a URL mentioned in the prior turn (task or assistant answer)
    if not page:
        page = extract_task_url(prior_user or "") or extract_task_url(prior_assistant or "")

    context_bits: list[str] = []
    if page:
        context_bits.append(
            f"Continue from the last session page: {page}. "
            "Do NOT open Application URL or any other default site."
        )
    else:
        context_bits.append(
            "Continue from the previous turn in this session. "
            "Do NOT open Application URL or any other default site."
        )

    if prior_user:
        snippet = re.sub(r"\s+", " ", prior_user).strip()
        if snippet.lower().startswith("start by opening"):
            # Strip earlier URL preamble if present
            snippet = re.sub(
                r"(?is)^start by opening\s+\S+\.\s*(?:task:\s*)?",
                "",
                snippet,
            ).strip()
        if snippet:
            context_bits.append(f"Previous user request: {snippet[:280]}")

    if prior_assistant:
        # Keep a short digest of the last answer so "open the first result" has context
        digest = re.sub(r"\s+", " ", prior_assistant).strip()
        if len(digest) > 500:
            digest = digest[:497] + "…"
        if digest:
            context_bits.append(f"Previous assistant result (use this context):\n{digest}")

    context_bits.append(f"Follow-up task: {text}")
    return "\n\n".join(context_bits), page


def apply_urls(
    task: str,
    *,
    runtime_url: str | None = None,
    application_url: str | None = None,
    prefer_url: str | None = None,
    skip_default_url: bool = False,
) -> tuple[str, str | None]:
    """
    Return (enriched_task, start_url_used).

    Priority (highest first):
    1. URL / domain already in the task — never overridden
    2. prefer_url (e.g. session current_url for continuations)
    3. Runtime URL (per-run override) when the task has no destination
    4. Application URL (Settings default) when the task needs a site but named none
       — skipped when skip_default_url is True

    Callers must already decide that a browser is needed (see chat_gate.needs_browser).
    """
    text = (task or "").strip()

    # Already-framed session follow-ups: keep as-is, never rewrite / inject defaults.
    # (Must run before extract_task_url — prior-turn context may mention other hosts.)
    preferred = normalize_url(prefer_url)
    if skip_default_url and is_session_continuation(text):
        return text, preferred or extract_continuation_url(text)

    task_url = extract_task_url(text)

    # Task already says where to go — do not prepend DuckDuckGo / Application URL.
    if task_url:
        # Soft hint so browser-use directly_open_url / the agent start at the right place
        if not _HTTP_RE.search(text):
            enriched = (
                f"Start by opening {task_url} (URL from the user task — do not open a different default site).\n\n"
                f"Task: {text}"
            )
            return enriched, task_url
        return text, task_url

    if preferred and skip_default_url:
        enriched = (
            f"Reuse the existing session page at {preferred} "
            f"(do not open a different default site).\n\n"
            f"Save outputs into the session workspace with save_as_pdf / write_file.\n\n"
            f"Task: {text}"
        )
        return enriched, preferred

    runtime = normalize_url(runtime_url)
    if runtime and not skip_default_url:
        enriched = (
            f"Start by opening {runtime} (Runtime URL for this run — do not open Application URL instead).\n\n"
            f"Task: {text}"
            if text
            else f"Open {runtime}."
        )
        return enriched, runtime

    if skip_default_url:
        hint = (
            "Work with the existing session content and workspace files. "
            "Do not open Application URL or another default site unless the user named one. "
            "Prefer save_as_pdf / write_file for exports.\n\n"
            f"Task: {text}"
        )
        return hint, preferred

    app = normalize_url(application_url)
    if app and text:
        return (
            f"Start by opening {app} (Application URL from Settings — "
            f"only because the task needs the web and did not name a URL).\n\n"
            f"Task: {text}"
        ), app

    return text, None
