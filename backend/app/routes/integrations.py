"""Jira / Confluence integration endpoints (Server/DC or Cloud)."""

from __future__ import annotations

import html
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException

from .. import atlassian, db
from ..llm_factory import effective_settings
from ..models import (
    ConfluencePageRequest,
    IntegrationTestRequest,
    JiraIssueRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

Deployment = Literal["server", "cloud"]


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


def _deployment(s: dict[str, str]) -> Deployment:
    return "cloud" if s["atlassian_deployment"] == "cloud" else "server"


def _product_auth_ready(
    s: dict[str, str],
    *,
    token_key: str,
    email_key: str,
    auth_type_key: str,
) -> bool:
    if not s.get(token_key):
        return False
    if _deployment(s) == "cloud":
        return bool(s.get(email_key))
    if s.get(auth_type_key) == "pat":
        return True
    return bool(s.get(email_key))


def _jira_auth_ready(s: dict[str, str]) -> bool:
    return _product_auth_ready(
        s, token_key="jira_api_token", email_key="jira_email", auth_type_key="jira_auth_type"
    )


def _confluence_auth_ready(s: dict[str, str]) -> bool:
    return _product_auth_ready(
        s,
        token_key="confluence_api_token",
        email_key="confluence_email",
        auth_type_key="confluence_auth_type",
    )


def _jira_auth_user(s: dict[str, str]) -> str:
    return atlassian.resolve_auth_username(s)


def _confluence_auth_user(s: dict[str, str]) -> str:
    return atlassian.resolve_confluence_auth_username(s)


# Back-compat aliases used by tests
def _auth_ready(s: dict[str, str]) -> bool:
    return _jira_auth_ready(s)


def _auth_user(s: dict[str, str]) -> str:
    return _jira_auth_user(s)


@router.get("/status")
async def integration_status():
    from .. import keycloak

    raw = await effective_settings()
    s = _cfg(raw)
    jira_ready = bool(
        s["jira_base_url"] and s["jira_project_key"] and _jira_auth_ready(s)
    )
    conf_ready = bool(
        s["confluence_base_url"]
        and s["confluence_space_key"]
        and _confluence_auth_ready(s)
    )
    return {
        "deployment": s["atlassian_deployment"],
        "jira": {
            "configured": jira_ready,
            "base_url": s["jira_base_url"] or None,
            "project_key": s["jira_project_key"] or None,
            "username": s["jira_email"] or None,
        },
        "confluence": {
            "configured": conf_ready,
            "base_url": s["confluence_base_url"] or None,
            "space_key": s["confluence_space_key"] or None,
        },
        "keycloak": {
            "configured": keycloak.is_configured(raw),
            "enabled": bool(raw.get("keycloak_enabled")),
            "base_url": str(raw.get("keycloak_base_url") or "") or None,
            "realm": str(raw.get("keycloak_realm") or "") or None,
            "client_id": str(raw.get("keycloak_client_id") or "") or None,
            "username": str(raw.get("keycloak_username") or "") or None,
        },
    }


@router.post("/test")
async def test_connection(body: IntegrationTestRequest):
    if body.service == "keycloak":
        from .. import keycloak

        cfg = await effective_settings()
        try:
            return await keycloak.test_password_grant(cfg)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        except Exception as e:
            logger.exception("keycloak test failed")
            raise HTTPException(502, str(e)) from e

    s = _cfg(await effective_settings())
    dep = _deployment(s)
    try:
        if body.service == "jira":
            if not _jira_auth_ready(s):
                raise HTTPException(
                    400,
                    "Set Jira username + password/PAT (Server) or email + API token (Cloud) in Settings",
                )
            base = s["jira_base_url"]
            if not base:
                raise HTTPException(400, "Set Jira base URL in Settings")
            return await atlassian.test_jira(
                base, _jira_auth_user(s), s["jira_api_token"], deployment=dep
            )
        if not _confluence_auth_ready(s):
            raise HTTPException(
                400,
                "Set Confluence username + password/PAT (Server) or email + API token (Cloud) in Settings",
            )
        base = s["confluence_base_url"]
        if not base:
            raise HTTPException(400, "Set Confluence base URL in Settings")
        return await atlassian.test_confluence(
            base,
            _confluence_auth_user(s),
            s["confluence_api_token"],
            deployment=dep,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("integration test failed")
        raise HTTPException(502, str(e)) from e


@router.post("/jira/issues")
async def create_jira_issue(body: JiraIssueRequest):
    s = _cfg(await effective_settings())
    if not (s["jira_base_url"] and s["jira_api_token"] and _jira_auth_ready(s)):
        raise HTTPException(
            400,
            "Configure Jira in Settings (URL, username, password/PAT, project key)",
        )
    project = (body.project_key or s["jira_project_key"] or "").strip()
    if not project:
        raise HTTPException(400, "Jira project key is required")

    description = body.description.strip()
    if body.session_id:
        sess = await db.get_session(body.session_id)
        msgs = await db.list_messages(body.session_id)
        bits = [description] if description else []
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
        description = "\n\n".join(bits)

    try:
        result = await atlassian.create_jira_issue(
            base_url=s["jira_base_url"],
            username=_jira_auth_user(s),
            token=s["jira_api_token"],
            project_key=project,
            summary=body.summary,
            description=description,
            issue_type=body.issue_type or "Bug",
            labels=body.labels or ["agentbrowser"],
            deployment=_deployment(s),
        )
        if body.session_id:
            await db.add_message(
                body.session_id,
                "assistant",
                f"Logged Jira issue **{result['key']}**: {result['url']}",
            )
            await db.add_event(
                body.session_id,
                "integration",
                {"service": "jira", **result},
            )
        return result
    except Exception as e:
        logger.exception("create jira issue failed")
        raise HTTPException(502, str(e)) from e


@router.post("/confluence/pages")
async def create_confluence_page(body: ConfluencePageRequest):
    s = _cfg(await effective_settings())
    if not (
        s["confluence_base_url"]
        and s["confluence_api_token"]
        and _confluence_auth_ready(s)
    ):
        raise HTTPException(
            400,
            "Configure Confluence in Settings (URL, username, password/PAT, space key)",
        )
    space = (body.space_key or s["confluence_space_key"] or "").strip()
    if not space:
        raise HTTPException(400, "Confluence space key is required")

    content_html = (body.body_html or "").strip()
    if not content_html and body.session_id:
        sess = await db.get_session(body.session_id)
        msgs = await db.list_messages(body.session_id)
        parts = [f"<h2>{html.escape(body.title)}</h2>"]
        if sess:
            parts.append(f"<p><strong>Task:</strong> {html.escape(str(sess.get('task') or ''))}</p>")
            if sess.get("current_url"):
                url = html.escape(str(sess["current_url"]))
                parts.append(f'<p><strong>URL:</strong> <a href="{url}">{url}</a></p>')
        parts.append("<h3>Chat</h3><ul>")
        for m in (msgs or [])[-20:]:
            role = html.escape(str(m.get("role") or ""))
            content = html.escape((m.get("content") or "")[:2000])
            parts.append(f"<li><strong>{role}:</strong> {content}</li>")
        parts.append("</ul>")
        content_html = "\n".join(parts)

    try:
        result = await atlassian.create_confluence_page(
            base_url=s["confluence_base_url"],
            username=_confluence_auth_user(s),
            token=s["confluence_api_token"],
            space_key=space,
            title=body.title,
            body_storage=content_html or f"<p>{html.escape(body.title)}</p>",
            deployment=_deployment(s),
        )
        if body.session_id:
            await db.add_message(
                body.session_id,
                "assistant",
                f"Created Confluence page **{result['title']}**: {result['url']}",
            )
            await db.add_event(
                body.session_id,
                "integration",
                {"service": "confluence", **result},
            )
        return result
    except Exception as e:
        logger.exception("create confluence page failed")
        raise HTTPException(502, str(e)) from e
