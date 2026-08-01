"""Chat intents that create Jira issues / Confluence pages without a browser."""

from __future__ import annotations

import html
import logging
import re

from . import atlassian, db
from .llm_factory import effective_settings

logger = logging.getLogger(__name__)

_JIRA_INTENT = re.compile(
    r"(?:"
    # Explicit Jira product name
    r"\b(?:log|create|file|open|raise|report)\b.{0,48}\bjira\b"
    r"|"
    r"\bjira\b.{0,48}\b(?:issue|ticket|bug|log|create|file)\b"
    r"|"
    # Generic ticket only when clearly a ticket workflow (not "quality issues")
    r"\b(?:log|create|file|open|raise|report)\b.{0,48}\bticket\b"
    r")",
    re.IGNORECASE | re.DOTALL,
)
_CONFLUENCE_INTENT = re.compile(
    r"\b(?:log|create|publish|post|write|save)\b.{0,48}\bconfluence\b",
    re.IGNORECASE | re.DOTALL,
)

_SUMMARY_AFTER = re.compile(
    r"(?:jira|ticket|issue|confluence)\b\s*[:\-]\s*(.+)$",
    re.IGNORECASE | re.DOTALL,
)


def integration_kind(text: str) -> str | None:
    t = (text or "").strip()
    if not t:
        return None
    if _CONFLUENCE_INTENT.search(t):
        return "confluence"
    if _JIRA_INTENT.search(t):
        return "jira"
    return None


def is_integration_chat(text: str) -> bool:
    return integration_kind(text) is not None


def _extract_summary(text: str, fallback: str) -> str:
    m = _SUMMARY_AFTER.search(text or "")
    if m and m.group(1).strip():
        return m.group(1).strip()[:255]
    return (fallback or "Issue from AgentBrowser")[:255]


def _cfg(s: dict) -> dict[str, str]:
    dep = str(s.get("atlassian_deployment") or "server").strip().lower()
    if dep not in ("server", "cloud"):
        dep = "server"
    auth_type = str(s.get("jira_auth_type") or "password").strip().lower()
    if auth_type not in ("password", "pat"):
        auth_type = "password"
    return {
        "atlassian_deployment": dep,
        "jira_auth_type": auth_type,
        "jira_base_url": str(s.get("jira_base_url") or "").strip(),
        "jira_email": str(s.get("jira_email") or "").strip(),
        "jira_api_token": str(s.get("jira_api_token") or "").strip(),
        "jira_project_key": str(s.get("jira_project_key") or "").strip(),
        "confluence_base_url": str(
            s.get("confluence_base_url") or s.get("jira_base_url") or ""
        ).strip(),
        "confluence_space_key": str(s.get("confluence_space_key") or "").strip(),
    }


async def _session_description(session_id: str, extra: str) -> str:
    sess = await db.get_session(session_id)
    msgs = await db.list_messages(session_id)
    bits: list[str] = []
    if extra.strip():
        bits.append(extra.strip())
    if sess:
        bits.append(f"Session: {sess.get('title') or sess.get('id')}")
        bits.append(f"Task: {sess.get('task') or ''}")
        if sess.get("current_url"):
            bits.append(f"URL: {sess['current_url']}")
        if sess.get("error"):
            bits.append(f"Error: {sess['error']}")
        bits.append(f"Status: {sess.get('status')} · steps: {sess.get('step_count')}")
    if msgs:
        bits.append("--- Chat ---")
        for m in msgs[-12:]:
            role = m.get("role") or "?"
            content = (m.get("content") or "").strip()
            if content:
                bits.append(f"{role}: {content[:1200]}")
    return "\n\n".join(bits) or extra


async def try_integration_from_chat(session_id: str, content: str) -> str | None:
    """If content is a Jira/Confluence log request, create it and return a reply."""
    kind = integration_kind(content)
    if not kind:
        return None

    s = _cfg(await effective_settings())
    user = atlassian.resolve_auth_username(s)
    token = s["jira_api_token"]
    dep = "cloud" if s["atlassian_deployment"] == "cloud" else "server"
    auth_ok = bool(token) and (
        (dep == "cloud" and bool(s["jira_email"]))
        or (dep == "server" and (s["jira_auth_type"] == "pat" or bool(s["jira_email"])))
    )
    if not auth_ok:
        return (
            "Jira/Confluence is optional and is not configured in this workspace. "
            "You can keep working without it. To enable logging later, open "
            "Settings → Jira & Confluence and add your Server/Cloud details."
        )

    sess = await db.get_session(session_id)
    fallback_title = (sess or {}).get("title") or (sess or {}).get("task") or "AgentBrowser session"
    summary = _extract_summary(content, str(fallback_title))

    try:
        if kind == "jira":
            if not s["jira_base_url"] or not s["jira_project_key"]:
                return (
                    "Jira needs a base URL and project key in Settings → Jira & Confluence."
                )
            desc = await _session_description(session_id, summary)
            result = await atlassian.create_jira_issue(
                base_url=s["jira_base_url"],
                username=user,
                token=token,
                project_key=s["jira_project_key"],
                summary=summary,
                description=desc,
                issue_type="Bug",
                labels=["agentbrowser"],
                deployment=dep,
            )
            await db.add_event(session_id, "integration", {"service": "jira", **result})
            return f"Logged Jira issue {result['key']}: {result['url']}"

        if not s["confluence_base_url"] or not s["confluence_space_key"]:
            return (
                "Confluence needs a base URL and space key in Settings → Jira & Confluence."
            )
        msgs = await db.list_messages(session_id)
        parts = [f"<h2>{html.escape(summary)}</h2>"]
        if sess:
            parts.append(
                f"<p><strong>Task:</strong> {html.escape(str(sess.get('task') or ''))}</p>"
            )
            if sess.get("current_url"):
                url = html.escape(str(sess["current_url"]))
                parts.append(f'<p><strong>URL:</strong> <a href="{url}">{url}</a></p>')
        parts.append("<h3>Chat</h3><ul>")
        for m in (msgs or [])[-20:]:
            role = html.escape(str(m.get("role") or ""))
            body = html.escape((m.get("content") or "")[:2000])
            parts.append(f"<li><strong>{role}:</strong> {body}</li>")
        parts.append("</ul>")
        result = await atlassian.create_confluence_page(
            base_url=s["confluence_base_url"],
            username=user,
            token=token,
            space_key=s["confluence_space_key"],
            title=summary,
            body_storage="\n".join(parts),
            deployment=dep,
        )
        await db.add_event(session_id, "integration", {"service": "confluence", **result})
        return f"Created Confluence page {result['title']}: {result['url']}"
    except Exception as e:
        logger.exception("integration chat action failed")
        return f"Could not create the {kind} item: {e}"
