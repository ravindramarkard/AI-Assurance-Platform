"""Decide whether a user message needs a browser agent or a chat-only reply."""

from __future__ import annotations

import re

_ATTACH_RE = re.compile(
    r"\[Attached files[^\]]*\]\s*(?:\n-\s+.+\s*)*",
    re.IGNORECASE,
)

# Explicit web / UI work
_BROWSER_HINTS = re.compile(
    r"("
    r"https?://|"
    r"\bwww\.|"
    r"\bgo\s+to\b|"
    r"\bnavigate\b|"
    r"\bvisit\b|"
    r"\bbrowse\b|"
    r"\bclick\b|"
    r"\blog\s?in\b|"
    r"\bsign\s?in\b|"
    r"\bscrape\b|"
    r"\bscreenshot\b|"
    r"\bfill\b|"
    r"\btype\b|"
    r"\bsubmit\b|"
    r"\bdownload\b|"
    r"\bupload\b|"
    r"\btest\s+case|"
    r"\bplaywright\b|"
    r"\bon the (page|site|website|form)\b|"
    r"\bthis (page|site|url|link)\b|"
    r"\b(home\s*page|homepage)\b|"
    r"\borangehrm\b|"
    # "open" only when clearly about the web — not "open the CSV"
    r"\bopen\s+(the\s+)?(page|site|website|url|tab|link|browser|homepage|home\s*page)\b|"
    r"\bopen\s+(?:https?://|www\.)|"
    r"\bopen\s+[\w.-]+\.[a-z]{2,}\b"
    r")",
    re.IGNORECASE,
)

# Concrete asks that usually need the Application / Runtime URL
_ACTION_HINTS = re.compile(
    r"("
    r"\b(get|show|fetch|load|find|search|look\s*up|run|perform|execute)\b|"
    r"\bdo\s+(the|this|that|it|a|an|my|some)\b"
    r")",
    re.IGNORECASE,
)

_SOFT_ACTION = re.compile(
    r"\b(please\s+)?(check|read|list)\b",
    re.IGNORECASE,
)

_PAGE_CONTEXT = re.compile(
    r"\b(page|site|website|form|url|browser|homepage|home\s*page|online|web)\b",
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

# Explicit web / UI work — not satisfied by reading attached files alone
_WEB_ACTION = re.compile(
    r"("
    r"https?://|"
    r"\bwww\.|"
    r"\bgo\s+to\b|"
    r"\bnavigate\b|"
    r"\bvisit\b|"
    r"\bbrowse\b|"
    r"\bclick\b|"
    r"\blog\s?in\b|"
    r"\bsign\s?in\b|"
    r"\bscrape\b|"
    r"\bscreenshot\b|"
    r"\bfill\b|"
    r"\btype\b|"
    r"\bsubmit\b|"
    r"\bupload\b|"
    r"\bdownload\b|"
    r"\bplaywright\b|"
    r"\bon the (page|site|website|form)\b|"
    r"\bthis (page|site|url|link)\b|"
    r"\bopen\s+(the\s+)?(page|site|website|url|tab|link|browser|homepage|home\s*page)\b|"
    r"\bopen\s+(?:https?://|www\.)|"
    r"\bopen\s+[\w.-]+\.[a-z]{2,}\b"
    r")",
    re.IGNORECASE,
)

_LOCAL_FILE_ASK = re.compile(
    r"("
    r"\bdescribe\b|"
    r"\bsummar(y|ize|ise)\b|"
    r"\banaly[sz]e\b|"
    r"\bexplain\b|"
    r"\binspect\b|"
    r"\bpreview\b|"
    r"\bread\b|"
    r"\bcontents?\b|"
    r"\bschema\b|"
    r"\bcolumns?\b|"
    r"\bheaders?\b|"
    r"\bhow many (rows?|records?|lines?|entries?|columns?)\b|"
    r"\bcount (the )?(rows?|records?|lines?|entries?)\b|"
    r"\bwhat('s| is|are) (in|inside|this|the)\b|"
    r"\battached\b|"
    r"\bdocument(s)?\b|"
    r"\bcsv\b|"
    r"\bfile(s)?\b"
    r")",
    re.IGNORECASE,
)

_LOCAL_FILE_TOKEN = re.compile(
    r"\b(file|files|csv|document|documents|attachment|attachments|pdf|xlsx?|json)\b",
    re.IGNORECASE,
)


def has_attached_files_marker(task: str) -> bool:
    return bool(re.search(r"\[Attached files", task or "", re.IGNORECASE))


def normalize_task(task: str) -> str:
    text = (task or "").strip()
    text = _ATTACH_RE.sub("", text).strip()
    text = re.sub(
        r"^Start by opening\s+\S+\.\s*(?:\n+Task:\s*)?",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    return text


# Back-compat alias
_normalize_task = normalize_task


def is_local_attachment_task(task: str) -> bool:
    """
    True when the user attached files and asked to describe/analyze them locally —
    no browser / Application URL should be involved.
    """
    if not has_attached_files_marker(task):
        return False
    text = normalize_task(task)
    if not text:
        return False
    if _WEB_ACTION.search(text):
        return False
    return bool(_LOCAL_FILE_ASK.search(text))


def _task_names_url(text: str) -> bool:
    from .task_url import extract_task_url

    return extract_task_url(text) is not None


def has_web_intent(task: str) -> bool:
    """
    True only when the ask clearly needs a browser.

    URL priority (handled elsewhere): task URL → Runtime URL → Application URL.
    """
    if is_local_attachment_task(task):
        return False

    text = normalize_task(task)
    if not text:
        return False

    if _task_names_url(text):
        return True

    if _BROWSER_HINTS.search(text) or _WEB_ACTION.search(text):
        return True

    if _RESEARCH_HINTS.search(text):
        return True

    if _ACTION_HINTS.search(text):
        return True

    # "read/check/list" → browser only with page/site context (not local files)
    if _SOFT_ACTION.search(text):
        if has_attached_files_marker(task) or _LOCAL_FILE_TOKEN.search(text):
            if not _PAGE_CONTEXT.search(text):
                return False
        if _PAGE_CONTEXT.search(text) or _RESEARCH_HINTS.search(text) or _task_names_url(text):
            return True
        return False

    return False


def _has_real_ask(text: str) -> bool:
    """Used for greeting follow-ons like 'hi, get the AED price'."""
    return has_web_intent(text)


def is_chat_only(task: str) -> bool:
    """True for greetings / help / non-web chat — never launch a browser."""
    text = normalize_task(task)
    if not text:
        return True

    from .integration_actions import is_integration_chat

    if is_integration_chat(text):
        return True

    if is_local_attachment_task(task):
        return False  # handled as attachment path, not generic chat

    if _GREETING.match(text):
        after = _GREETING.sub("", text, count=1).strip(" .?!,-:")
        if not after:
            return True
        return not has_web_intent(after)

    if _THANKS_OK.match(text):
        return True

    if _CAPABILITY.search(text) and not has_web_intent(text):
        return True

    if has_web_intent(text):
        return False

    # No clear web ask → stay in chat (do not open Application URL)
    return True


def needs_browser(task: str, *, start_url: str | None = None) -> bool:
    """
    Open a browser only for clear web intent.
    Default Application URL never forces a browser by itself.
    """
    del start_url
    if is_local_attachment_task(task):
        return False
    if is_chat_only(task):
        return False
    return has_web_intent(task)


def browser_decision(task: str) -> tuple[bool, str]:
    """Return (needs_browser, short reason) for status / debugging."""
    if is_local_attachment_task(task):
        return False, "local attached files"
    if is_chat_only(task):
        return False, "chat only"
    if has_web_intent(task):
        if _task_names_url(normalize_task(task)):
            return True, "task names a URL"
        if _BROWSER_HINTS.search(normalize_task(task)) or _WEB_ACTION.search(normalize_task(task)):
            return True, "web / UI action"
        if _RESEARCH_HINTS.search(normalize_task(task)):
            return True, "live / research ask"
        return True, "browse action"
    return False, "no web intent"


def general_chat_reply(task: str, *, application_url: str | None = None) -> str:
    text = normalize_task(task).lower()
    app = (application_url or "").strip()
    url_bit = f" ({app})" if app else ""
    can_load = (
        f"I am ready to assist with browser automation. Share a URL to open, or ask me to retrieve, "
        f"display, or search online content using the Application URL{url_bit}. "
        "Attached files are analyzed locally without launching a browser."
    )

    if re.match(r"^(thanks|thank you|thx|ty)\b", text):
        return f"You're welcome. {can_load}"
    if re.match(r"^(ok|okay|cool|great|nice|got it)\b", text):
        return f"Understood. {can_load}"
    if _GREETING.match(text):
        return f"Hello. {can_load}"
    if _CAPABILITY.search(text):
        return (
            "I can navigate sites, fill forms, scrape data, and upload files when a web task is needed. "
            + can_load
            + ' For example: "go to example.com and list the navigation links" or '
            + '"get the latest AED to INR exchange rate". '
            + 'For an attached CSV, ask "describe this file" — no browser is required. '
            + "You can also ask me to log work to Jira once Atlassian is configured in Settings."
        )
    return (
        "Please describe a web task"
        + (f" (default site: {app})" if app else "")
        + ", or attach a file and ask me to review it. I will not open the browser until then."
    )
