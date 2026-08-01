"""Jira + Confluence REST helpers.

Supports:
  - server  — Jira/Confluence Server or Data Center (REST API v2, plain description)
  - cloud   — Atlassian Cloud (REST API v3 + ADF, /wiki Confluence paths)

Auth for Server: Basic username:password, or username:personal-access-token.
Auth for Cloud: Basic email:api-token.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Literal

import httpx

logger = logging.getLogger(__name__)

Deployment = Literal["server", "cloud"]


def _normalize_base(url: str) -> str:
    return (url or "").strip().rstrip("/")


def _auth_headers(username: str, token: str, *, deployment: Deployment) -> dict[str, str]:
    user = (username or "").strip()
    secret = (token or "").strip()
    if not secret:
        raise ValueError("Password / API token is required")
    # Server PAT can be sent as Bearer when username is empty
    if deployment == "server" and not user:
        return {
            "Authorization": f"Bearer {secret}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
    if not user:
        raise ValueError("Username (or email for Cloud) is required")
    raw = f"{user}:{secret}".encode()
    return {
        "Authorization": "Basic " + base64.b64encode(raw).decode(),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


async def _request(
    method: str,
    url: str,
    *,
    username: str,
    token: str,
    deployment: Deployment = "server",
    json_body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    headers = _auth_headers(username, token, deployment=deployment)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.request(method, url, headers=headers, json=json_body)
    if resp.status_code >= 400:
        detail = resp.text[:800]
        raise RuntimeError(f"Atlassian API {resp.status_code}: {detail}")
    if not resp.content:
        return {}
    return resp.json()


def _jira_api_root(base: str, deployment: Deployment) -> str:
    # Server/DC: /rest/api/2 — Cloud: /rest/api/3
    ver = "3" if deployment == "cloud" else "2"
    return f"{base}/rest/api/{ver}"


def _confluence_api_root(base: str, deployment: Deployment) -> str:
    if deployment == "cloud":
        return f"{base}/wiki/rest/api"
    return f"{base}/rest/api"


def resolve_auth_username(s: dict[str, Any]) -> str:
    """Username for Atlassian auth: empty for Server PAT-only (Bearer)."""
    dep = str(s.get("atlassian_deployment") or "server").strip().lower()
    email = str(s.get("jira_email") or "").strip()
    if dep == "cloud":
        return email
    auth_type = str(s.get("jira_auth_type") or "password").strip().lower()
    if auth_type == "pat":
        return ""
    return email


def _key_name_items(raw: Any, *, limit: int = 200) -> list[dict[str, str]]:
    rows: list[Any]
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        rows = raw.get("values") or raw.get("results") or []
    else:
        rows = []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        name = str(row.get("name") or key).strip() or key
        out.append({"key": key, "name": name})
        if len(out) >= limit:
            break
    out.sort(key=lambda x: x["key"].lower())
    return out


async def list_jira_projects(
    base_url: str,
    username: str,
    token: str,
    *,
    deployment: Deployment = "server",
    limit: int = 200,
) -> list[dict[str, str]]:
    base = _normalize_base(base_url)
    root = _jira_api_root(base, deployment)
    if deployment == "cloud":
        data = await _request(
            "GET",
            f"{root}/project/search?maxResults={limit}&startAt=0",
            username=username,
            token=token,
            deployment=deployment,
        )
    else:
        data = await _request(
            "GET",
            f"{root}/project",
            username=username,
            token=token,
            deployment=deployment,
        )
    return _key_name_items(data, limit=limit)


async def list_confluence_spaces(
    base_url: str,
    username: str,
    token: str,
    *,
    deployment: Deployment = "server",
    limit: int = 200,
) -> list[dict[str, str]]:
    base = _normalize_base(base_url)
    root = _confluence_api_root(base, deployment)
    collected: list[Any] = []
    start = 0
    page_size = min(50, limit)
    while len(collected) < limit:
        data = await _request(
            "GET",
            f"{root}/space?limit={page_size}&start={start}",
            username=username,
            token=token,
            deployment=deployment,
        )
        if not isinstance(data, dict):
            break
        batch = data.get("results") or []
        if not isinstance(batch, list) or not batch:
            break
        collected.extend(batch)
        links = data.get("_links") or {}
        if not links.get("next"):
            break
        start += len(batch)
    return _key_name_items({"results": collected}, limit=limit)


async def test_jira(
    base_url: str,
    username: str,
    token: str,
    *,
    deployment: Deployment = "server",
) -> dict[str, Any]:
    base = _normalize_base(base_url)
    root = _jira_api_root(base, deployment)
    data = await _request(
        "GET",
        f"{root}/myself",
        username=username,
        token=token,
        deployment=deployment,
    )
    projects = await list_jira_projects(
        base_url, username, token, deployment=deployment
    )
    return {
        "ok": True,
        "deployment": deployment,
        "account_id": data.get("accountId") or data.get("key") or data.get("name"),
        "display_name": data.get("displayName"),
        "email": data.get("emailAddress"),
        "projects": projects,
    }


async def create_jira_issue(
    *,
    base_url: str,
    username: str,
    token: str,
    project_key: str,
    summary: str,
    description: str,
    issue_type: str = "Bug",
    labels: list[str] | None = None,
    deployment: Deployment = "server",
) -> dict[str, Any]:
    base = _normalize_base(base_url)
    project_key = (project_key or "").strip().upper()
    if not project_key:
        raise ValueError("Jira project key is required")
    summary = (summary or "").strip()[:255] or "Issue from AgentBrowser"
    description = (description or "").strip() or summary

    # Cloud API v3 wants ADF; Server/DC API v2 wants a plain string (wiki markup OK).
    if deployment == "cloud":
        desc_field: Any = {
            "type": "doc",
            "version": 1,
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": description[:30000]}],
                }
            ],
        }
    else:
        desc_field = description[:30000]

    body: dict[str, Any] = {
        "fields": {
            "project": {"key": project_key},
            "summary": summary,
            "description": desc_field,
            "issuetype": {"name": issue_type or "Bug"},
        }
    }
    if labels:
        body["fields"]["labels"] = [str(x)[:40] for x in labels[:20]]

    root = _jira_api_root(base, deployment)
    data = await _request(
        "POST",
        f"{root}/issue",
        username=username,
        token=token,
        deployment=deployment,
        json_body=body,
    )
    key = data.get("key") or ""
    return {
        "ok": True,
        "key": key,
        "id": data.get("id"),
        "url": f"{base}/browse/{key}" if key else base,
        "deployment": deployment,
    }


async def test_confluence(
    base_url: str,
    username: str,
    token: str,
    *,
    deployment: Deployment = "server",
) -> dict[str, Any]:
    base = _normalize_base(base_url)
    root = _confluence_api_root(base, deployment)
    data = await _request(
        "GET",
        f"{root}/user/current",
        username=username,
        token=token,
        deployment=deployment,
    )
    spaces = await list_confluence_spaces(
        base_url, username, token, deployment=deployment
    )
    return {
        "ok": True,
        "deployment": deployment,
        "account_id": data.get("accountId") or data.get("userKey") or data.get("username"),
        "display_name": data.get("displayName"),
        "spaces": spaces,
    }


async def create_confluence_page(
    *,
    base_url: str,
    username: str,
    token: str,
    space_key: str,
    title: str,
    body_storage: str,
    deployment: Deployment = "server",
) -> dict[str, Any]:
    base = _normalize_base(base_url)
    space_key = (space_key or "").strip()
    if not space_key:
        raise ValueError("Confluence space key is required")
    title = (title or "").strip()[:255] or "Notes from AgentBrowser"
    html = body_storage.strip() or f"<p>{title}</p>"

    payload = {
        "type": "page",
        "title": title,
        "space": {"key": space_key},
        "body": {
            "storage": {
                "value": html[:200000],
                "representation": "storage",
            }
        },
    }
    root = _confluence_api_root(base, deployment)
    data = await _request(
        "POST",
        f"{root}/content",
        username=username,
        token=token,
        deployment=deployment,
        json_body=payload,
    )
    page_id = data.get("id")
    links = data.get("_links") or {}
    webui = links.get("webui") or ""
    base_link = links.get("base") or base
    if deployment == "cloud":
        page_url = f"{base}/wiki{webui}" if webui else f"{base}/wiki"
    elif webui:
        # Server: webui is often /pages/viewpage.action?pageId=…
        page_url = f"{base_link.rstrip('/')}{webui}" if webui.startswith("/") else f"{base}/{webui}"
    else:
        page_url = f"{base}/pages/viewpage.action?pageId={page_id}" if page_id else base
    return {
        "ok": True,
        "id": page_id,
        "title": data.get("title") or title,
        "url": page_url,
        "deployment": deployment,
    }
