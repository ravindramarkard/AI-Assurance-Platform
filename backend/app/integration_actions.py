"""Chat intents for Jira / Confluence API actions (no browser)."""

from __future__ import annotations

import html
import logging
import re
from typing import Any

from . import atlassian, db
from .config import session_dir
from .llm_factory import effective_settings

logger = logging.getLogger(__name__)

_JIRA_COMMENT = re.compile(
    r"\bcomment\s+on\s+([A-Z][A-Z0-9]+-\d+)\s*[:\-]\s*(.+)$",
    re.IGNORECASE | re.DOTALL,
)
_JIRA_TRANSITION = re.compile(
    r"\b(?:set|transition|move)\s+([A-Z][A-Z0-9]+-\d+)\s+(?:to|into)\s+(.+)$",
    re.IGNORECASE | re.DOTALL,
)
_JIRA_SEARCH = re.compile(
    r"\b(?:search|find|list)\b.{0,40}\bjira\b|\bjira\b.{0,40}\b(?:search|find|open issues|my issues)\b",
    re.IGNORECASE | re.DOTALL,
)
_JIRA_CREATE = re.compile(
    r"(?:"
    r"\b(?:log|create|file|open|raise|report)\b.{0,48}\bjira\b"
    r"|"
    r"\bjira\b.{0,48}\b(?:issue|ticket|bug|log|create|file)\b"
    r"|"
    r"\b(?:log|create|file|open|raise|report)\b.{0,48}\bticket\b"
    r")",
    re.IGNORECASE | re.DOTALL,
)
_CONFLUENCE_REPORT = re.compile(
    r"\b(?:post|publish|upload|save)\b.{0,48}\b(?:result\s+)?report\b.{0,32}\bconfluence\b"
    r"|"
    r"\bconfluence\b.{0,32}\b(?:result\s+)?report\b"
    r"|"
    r"\bpost\s+result\s+report\b",
    re.IGNORECASE | re.DOTALL,
)
_CONFLUENCE_CREATE = re.compile(
    r"\b(?:log|create|publish|post|write|save)\b.{0,48}\bconfluence\b",
    re.IGNORECASE | re.DOTALL,
)

_SUMMARY_AFTER = re.compile(
    r"(?:jira|ticket|issue|confluence|report)\b\s*[:\-]\s*(.+)$",
    re.IGNORECASE | re.DOTALL,
)
_SEARCH_QUERY = re.compile(
    r"(?:search|find|list)\s+(?:jira\s+)?(?:for\s+)?(.+)$",
    re.IGNORECASE | re.DOTALL,
)


def integration_kind(text: str) -> str | None:
    """Return fine-grained kind, or legacy 'jira'/'confluence' aliases via mapping."""
    t = (text or "").strip()
    if not t:
        return None
    if _JIRA_COMMENT.search(t):
        return "jira_comment"
    if _JIRA_TRANSITION.search(t):
        return "jira_transition"
    if _CONFLUENCE_REPORT.search(t):
        return "confluence_report"
    if _JIRA_SEARCH.search(t):
        return "jira_search"
    if _CONFLUENCE_CREATE.search(t):
        return "confluence_create"
    if _JIRA_CREATE.search(t):
        return "jira_create"
    return None


def is_integration_chat(text: str) -> bool:
    return integration_kind(text) is not None


def _extract_summary(text: str, fallback: str) -> str:
    m = _SUMMARY_AFTER.search(text or "")
    if m and m.group(1).strip():
        return m.group(1).strip()[:255]
    return (fallback or "Issue from AgentBrowser")[:255]


def _norm_auth_type(raw: object) -> str:
    v = str(raw or "password").strip().lower()
    return "pat" if v == "pat" else "password"


def _cfg(s: dict) -> dict[str, str]:
    dep = str(s.get("atlassian_deployment") or "server").strip().lower()
    if dep not in ("server", "cloud"):
        dep = "server"
    return {
        "atlassian_deployment": dep,
        "jira_auth_type": _norm_auth_type(s.get("jira_auth_type")),
        "jira_base_url": str(s.get("jira_base_url") or "").strip(),
        "jira_email": str(s.get("jira_email") or "").strip(),
        "jira_api_token": str(s.get("jira_api_token") or "").strip(),
        "jira_project_key": str(s.get("jira_project_key") or "").strip(),
        "confluence_auth_type": _norm_auth_type(s.get("confluence_auth_type")),
        "confluence_base_url": str(
            s.get("confluence_base_url") or s.get("jira_base_url") or ""
        ).strip(),
        "confluence_email": str(s.get("confluence_email") or "").strip(),
        "confluence_api_token": str(s.get("confluence_api_token") or "").strip(),
        "confluence_space_key": str(s.get("confluence_space_key") or "").strip(),
    }


def _product_auth_ok(s: dict[str, str], *, kind: str) -> bool:
    dep = "cloud" if s["atlassian_deployment"] == "cloud" else "server"
    if kind == "jira":
        token, email, auth_type = s["jira_api_token"], s["jira_email"], s["jira_auth_type"]
    else:
        token, email, auth_type = (
            s["confluence_api_token"],
            s["confluence_email"],
            s["confluence_auth_type"],
        )
    if not token:
        return False
    if dep == "cloud":
        return bool(email)
    return auth_type == "pat" or bool(email)


def _jira_need(s: dict[str, str]) -> str | None:
    if not _product_auth_ok(s, kind="jira"):
        return (
            "Jira is optional and is not configured in this workspace. "
            "Open Settings → Jira & Confluence to add Jira credentials."
        )
    if not s["jira_base_url"]:
        return "Jira needs a base URL in Settings → Jira & Confluence."
    return None


def _confluence_need(s: dict[str, str]) -> str | None:
    if not _product_auth_ok(s, kind="confluence"):
        return (
            "Confluence is optional and is not configured in this workspace. "
            "Open Settings → Jira & Confluence to add Confluence credentials."
        )
    if not s["confluence_base_url"] or not s["confluence_space_key"]:
        return (
            "Confluence needs a base URL and space key in Settings → Jira & Confluence."
        )
    return None


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


def _session_summary_html(sess: dict[str, Any] | None, msgs: list[dict], title: str) -> str:
    parts = [f"<h1>{html.escape(title)}</h1>"]
    if sess:
        parts.append(
            f"<p><strong>Task:</strong> {html.escape(str(sess.get('task') or ''))}</p>"
        )
        parts.append(
            f"<p><strong>Status:</strong> {html.escape(str(sess.get('status') or ''))} · "
            f"<strong>Steps:</strong> {html.escape(str(sess.get('step_count') or 0))}</p>"
        )
        if sess.get("current_url"):
            url = html.escape(str(sess["current_url"]))
            parts.append(f'<p><strong>URL:</strong> <a href="{url}">{url}</a></p>')
        if sess.get("error"):
            parts.append(f"<p><strong>Error:</strong> {html.escape(str(sess['error']))}</p>")
    parts.append("<h2>Recent chat</h2><ul>")
    for m in (msgs or [])[-20:]:
        role = html.escape(str(m.get("role") or ""))
        body = html.escape((m.get("content") or "")[:2000])
        parts.append(f"<li><strong>{role}:</strong> {body}</li>")
    parts.append("</ul>")
    parts.append(
        "<p><em>Full report attached when available (report.html).</em></p>"
    )
    return "\n".join(parts)


def _find_or_build_report_bytes(session_id: str, sess: dict[str, Any] | None, msgs: list) -> tuple[bytes, str]:
    ws = session_dir(session_id) / "workspace"
    candidates = [
        ws / "report.html",
        ws / "artifacts" / "report.html",
    ]
    for p in candidates:
        if p.is_file():
            return p.read_bytes(), p.name
    # Generate a minimal HTML report from session
    title = str((sess or {}).get("title") or (sess or {}).get("task") or "AgentBrowser report")
    html_doc = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>"
        + html.escape(title)
        + "</title></head><body>"
        + _session_summary_html(sess, msgs, title)
        + "</body></html>"
    )
    return html_doc.encode("utf-8"), "report.html"


def _search_jql(text: str, project_key: str) -> str:
    m = _SEARCH_QUERY.search(text or "")
    q = (m.group(1).strip() if m else "").strip().strip("\"'")
    lower = q.lower()
    if not q or "open issue" in lower or "my issue" in lower or lower in ("open", "mine", "my"):
        base = 'assignee = currentUser() AND resolution = Unresolved'
        if project_key:
            return f'project = {project_key} AND {base} ORDER BY updated DESC'
        return f"{base} ORDER BY updated DESC"
    # If looks like JQL already
    if any(x in q.lower() for x in ("project ", "assignee ", "status ", "order by", "=")):
        return q
    escaped = q.replace('"', '\\"')
    if project_key:
        return f'project = {project_key} AND text ~ "{escaped}" ORDER BY updated DESC'
    return f'text ~ "{escaped}" ORDER BY updated DESC'


async def try_integration_from_chat(session_id: str, content: str) -> str | None:
    """If content is an Atlassian chat request, run it and return a reply."""
    kind = integration_kind(content)
    if not kind:
        return None

    s = _cfg(await effective_settings())
    dep: atlassian.Deployment = "cloud" if s["atlassian_deployment"] == "cloud" else "server"
    sess = await db.get_session(session_id)
    msgs = await db.list_messages(session_id)
    fallback_title = (sess or {}).get("title") or (sess or {}).get("task") or "AgentBrowser session"
    summary = _extract_summary(content, str(fallback_title))

    try:
        if kind.startswith("jira"):
            need = _jira_need(s)
            if need:
                return need
            user = atlassian.resolve_auth_username(s)
            token = s["jira_api_token"]
            base = s["jira_base_url"]

            if kind == "jira_search":
                jql = _search_jql(content, s["jira_project_key"])
                result = await atlassian.search_jira_issues(
                    base_url=base,
                    username=user,
                    token=token,
                    jql=jql,
                    deployment=dep,
                )
                await db.add_event(session_id, "integration", {"service": "jira_search", **result})
                issues = result.get("issues") or []
                if not issues:
                    return f"No Jira issues found for: `{jql}`"
                lines = [f"Found {len(issues)} Jira issue(s):"]
                for iss in issues[:15]:
                    lines.append(
                        f"- **{iss['key']}** [{iss.get('status') or '?'}] {iss.get('summary')} — {iss.get('url')}"
                    )
                return "\n".join(lines)

            if kind == "jira_comment":
                m = _JIRA_COMMENT.search(content)
                if not m:
                    return "Say: `comment on PROJ-123: your comment text`"
                key, body = m.group(1).upper(), m.group(2).strip()
                result = await atlassian.add_jira_comment(
                    base_url=base,
                    username=user,
                    token=token,
                    issue_key=key,
                    body=body,
                    deployment=dep,
                )
                await db.add_event(session_id, "integration", {"service": "jira_comment", **result})
                return f"Commented on {result['key']}: {result['url']}"

            if kind == "jira_transition":
                m = _JIRA_TRANSITION.search(content)
                if not m:
                    return "Say: `set PROJ-123 to Done` or `transition PROJ-123 to In Progress`"
                key, status = m.group(1).upper(), m.group(2).strip()
                result = await atlassian.transition_jira_issue(
                    base_url=base,
                    username=user,
                    token=token,
                    issue_key=key,
                    status_name=status,
                    deployment=dep,
                )
                await db.add_event(
                    session_id, "integration", {"service": "jira_transition", **result}
                )
                return (
                    f"Transitioned {result['key']} via “{result['transition']}”: {result['url']}"
                )

            # jira_create
            if not s["jira_project_key"]:
                return (
                    "Jira needs a project key in Settings → Jira & Confluence "
                    "(Test Jira and pick a project)."
                )
            desc = await _session_description(session_id, summary)
            result = await atlassian.create_jira_issue(
                base_url=base,
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

        # Confluence
        need = _confluence_need(s)
        if need:
            return need
        user = atlassian.resolve_confluence_auth_username(s)
        token = s["confluence_api_token"]
        base = s["confluence_base_url"]
        space = s["confluence_space_key"]

        if kind == "confluence_report":
            title = f"Result report — {summary}"[:255]
            body_html = _session_summary_html(sess, msgs or [], title)
            page = await atlassian.create_confluence_page(
                base_url=base,
                username=user,
                token=token,
                space_key=space,
                title=title,
                body_storage=body_html,
                deployment=dep,
            )
            attach_note = ""
            try:
                raw, fname = _find_or_build_report_bytes(session_id, sess, msgs or [])
                att = await atlassian.attach_confluence_file(
                    base_url=base,
                    username=user,
                    token=token,
                    page_id=str(page.get("id") or ""),
                    filename=fname,
                    content=raw,
                    deployment=dep,
                )
                attach_note = f" Attached `{att.get('title') or fname}`."
                await db.add_event(
                    session_id,
                    "integration",
                    {"service": "confluence_report", **page, "attachment": att},
                )
            except Exception as attach_err:
                logger.warning("confluence attach failed: %s", attach_err)
                attach_note = f" Page created; attachment skipped ({attach_err})."
                await db.add_event(
                    session_id, "integration", {"service": "confluence_report", **page}
                )
            return f"Posted result report to Confluence **{page['title']}**: {page['url']}.{attach_note}"

        # confluence_create
        body_html = _session_summary_html(sess, msgs or [], summary)
        result = await atlassian.create_confluence_page(
            base_url=base,
            username=user,
            token=token,
            space_key=space,
            title=summary,
            body_storage=body_html,
            deployment=dep,
        )
        await db.add_event(session_id, "integration", {"service": "confluence", **result})
        return f"Created Confluence page {result['title']}: {result['url']}"
    except Exception as e:
        logger.exception("integration chat action failed")
        return f"Could not complete the {kind} action: {e}"
