"""Decide whether a user message needs a browser agent or a chat-only reply."""

from __future__ import annotations

import re

_ATTACH_RE = re.compile(
    r"\[Attached files saved under the session workspace[^\]]*\]\s*",
    re.IGNORECASE,
)

_BROWSER_HINTS = re.compile(
    r"("
    r"https?://|"
    r"\bwww\.|"
    r"\bgo to\b|"
    r"\bopen\b|"
    r"\bnavigate\b|"
    r"\bvisit\b|"
    r"\bbrowse\b|"
    r"\bclick\b|"
    r"\blog ?in\b|"
    r"\bsign ?in\b|"
    r"\bscrape\b|"
    r"\bscreenshot\b|"
    r"\bfill\b|"
    r"\btype\b|"
    r"\bsubmit\b|"
    r"\bdownload\b|"
    r"\bupload\b|"
    r"\btest case|"
    r"\bplaywright\b|"
    r"\bon the (page|site|website|form)\b|"
    r"\bthis (page|site|url|link)\b|"
    r"\borangehrm\b"
    r")",
    re.IGNORECASE,
)

# Concrete asks → launch browser (use Application / Runtime URL if needed).
_ACTION_HINTS = re.compile(
    r"("
    r"\b(get|show|fetch|load|find|search|look\s*up|run|perform|execute)\b|"
    r"\bdo\s+(the|this|that|it|a|an|my|some)\b|"
    r"\b(please\s+)?(check|read|list)\b"
    r")",
    re.IGNORECASE,
)

_RESEARCH_HINTS = re.compile(
    r"("
    r"\b(price|prices|rate|rates|exchange|convert|conversion)\b|"
    r"\b(latest|today|current|live)\b|"
    r"\b(weather|forecast|news|stock|quote|ticker)\b|"
    r"\b(how\s+much|what\s+is\s+the)\b|"
    r"\b(aed|inr|usd|eur|gbp|jpy)\b"
    r")",
    re.IGNORECASE,
)

_GREETING = re.compile(
    r"^(hi|hello|hey|yo|hola|howdy|hiya|sup|good\s+(morning|afternoon|evening))"
    r"([\s,!.?]|$)",
    re.IGNORECASE,
)

_CAPABILITY = re.compile(
    r"("
    r"\bhow (can|do|would) you help\b|"
    r"\bwhat can you (do|help)\b|"
    r"\bhow (can|do) i use (you|this)\b|"
    r"\bwho are you\b|"
    r"\bwhat are you\b|"
    r"^help[\s?!.]*$"
    r")",
    re.IGNORECASE,
)

_THANKS_OK = re.compile(
    r"^(thanks|thank you|thx|ty|ok|okay|cool|great|nice|got it)[\s!.,]*$",
    re.IGNORECASE,
)


def _normalize_task(task: str) -> str:
    text = (task or "").strip()
    text = _ATTACH_RE.sub("", text).strip()
    text = re.sub(
        r"^Start by opening\s+\S+\.\s*(?:\n+Task:\s*)?",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    return text


def _has_real_ask(text: str) -> bool:
    return bool(
        _BROWSER_HINTS.search(text)
        or _ACTION_HINTS.search(text)
        or _RESEARCH_HINTS.search(text)
    )


def is_chat_only(task: str) -> bool:
    """True for greetings / help — never launch a browser for these."""
    text = _normalize_task(task)
    if not text:
        return True

    # Log to Jira / Confluence from chat — no browser
    from .integration_actions import is_integration_chat

    if is_integration_chat(text):
        return True

    # "hi" or "hi." → chat only; "hi, get the AED price" → browser
    if _GREETING.match(text):
        after = _GREETING.sub("", text, count=1).strip(" .?!,-:")
        if not after:
            return True
        return not _has_real_ask(after)

    if _THANKS_OK.match(text):
        return True

    if _CAPABILITY.search(text) and not _has_real_ask(text):
        return True

    if _has_real_ask(text):
        return False

    # Short filler with no action
    if len(text) <= 24 and not re.search(r"[/.]", text):
        if re.fullmatch(r"[\w\s?!.',-]+", text, flags=re.UNICODE):
            return True

    return False


def needs_browser(task: str, *, start_url: str | None = None) -> bool:
    """False for greetings. Default URL never forces a browser on its own."""
    del start_url
    if is_chat_only(task):
        return False
    return True


def general_chat_reply(task: str, *, application_url: str | None = None) -> str:
    text = _normalize_task(task).lower()
    app = (application_url or "").strip()
    url_bit = f" ({app})" if app else ""
    can_load = (
        f"I can load the default URL{url_bit} when you ask me to get, show, or do something — "
        "I won't open the browser until then."
    )

    if re.match(r"^(thanks|thank you|thx|ty)\b", text):
        return f"You're welcome. {can_load}"
    if re.match(r"^(ok|okay|cool|great|nice|got it)\b", text):
        return f"Ready. {can_load}"
    if _GREETING.match(text):
        if re.match(r"^hi\b", text):
            return f"Hello. {can_load}"
        if re.match(r"^hey\b", text):
            return f"Hey. {can_load}"
        return f"Hello. {can_load}"
    if _CAPABILITY.search(text):
        return (
            "I run browser tasks for you — navigate, fill forms, scrape, and report what I observe. "
            + can_load
            + ' Example: "get the latest AED to INR price" or "show the homepage". '
            + 'You can also say "log this to Jira" or "create a Confluence page" once Atlassian is configured in Settings.'
        )
    return (
        "Tell me what to get, show, or do"
        + (f" on {app}" if app else "")
        + ". I won't open the browser for chat alone."
    )
