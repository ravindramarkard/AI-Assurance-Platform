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


def resolve_auth_username(
    s: dict[str, Any],
    *,
    email_key: str = "jira_email",
    auth_type_key: str = "jira_auth_type",
) -> str:
    """Username for Atlassian auth: empty for Server PAT-only (Bearer)."""
    dep = str(s.get("atlassian_deployment") or "server").strip().lower()
    email = str(s.get(email_key) or "").strip()
    if dep == "cloud":
        return email
    auth_type = str(s.get(auth_type_key) or "password").strip().lower()
    if auth_type == "pat":
        return ""
    return email


def resolve_confluence_auth_username(s: dict[str, Any]) -> str:
    return resolve_auth_username(
        s, email_key="confluence_email", auth_type_key="confluence_auth_type"
    )


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


async def search_jira_issues(
    *,
    base_url: str,
    username: str,
    token: str,
    jql: str,
    deployment: Deployment = "server",
    max_results: int = 20,
) -> dict[str, Any]:
    base = _normalize_base(base_url)
    root = _jira_api_root(base, deployment)
    jql = (jql or "").strip() or "order by updated DESC"
    from urllib.parse import quote

    url = f"{root}/search?jql={quote(jql)}&maxResults={max(1, min(max_results, 50))}&fields=summary,status,assignee,updated"
    data = await _request(
        "GET",
        url,
        username=username,
        token=token,
        deployment=deployment,
    )
    issues_out: list[dict[str, str]] = []
    for row in data.get("issues") or []:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "").strip()
        fields = row.get("fields") or {}
        status = ((fields.get("status") or {}) if isinstance(fields, dict) else {}).get("name") or ""
        summary = (fields.get("summary") if isinstance(fields, dict) else None) or ""
        issues_out.append(
            {
                "key": key,
                "summary": str(summary)[:200],
                "status": str(status),
                "url": f"{base}/browse/{key}" if key else base,
            }
        )
    return {"ok": True, "jql": jql, "issues": issues_out, "deployment": deployment}


async def add_jira_comment(
    *,
    base_url: str,
    username: str,
    token: str,
    issue_key: str,
    body: str,
    deployment: Deployment = "server",
) -> dict[str, Any]:
    base = _normalize_base(base_url)
    key = (issue_key or "").strip().upper()
    if not key:
        raise ValueError("Issue key is required")
    text = (body or "").strip()
    if not text:
        raise ValueError("Comment body is required")
    root = _jira_api_root(base, deployment)
    if deployment == "cloud":
        payload: dict[str, Any] = {
            "body": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": text[:30000]}],
                    }
                ],
            }
        }
    else:
        payload = {"body": text[:30000]}
    data = await _request(
        "POST",
        f"{root}/issue/{key}/comment",
        username=username,
        token=token,
        deployment=deployment,
        json_body=payload,
    )
    return {
        "ok": True,
        "key": key,
        "id": data.get("id"),
        "url": f"{base}/browse/{key}",
        "deployment": deployment,
    }


async def transition_jira_issue(
    *,
    base_url: str,
    username: str,
    token: str,
    issue_key: str,
    status_name: str,
    deployment: Deployment = "server",
) -> dict[str, Any]:
    base = _normalize_base(base_url)
    key = (issue_key or "").strip().upper()
    want = (status_name or "").strip().lower()
    if not key or not want:
        raise ValueError("Issue key and status name are required")
    root = _jira_api_root(base, deployment)
    meta = await _request(
        "GET",
        f"{root}/issue/{key}/transitions",
        username=username,
        token=token,
        deployment=deployment,
    )
    transitions = meta.get("transitions") or []
    match = None
    for tr in transitions:
        if not isinstance(tr, dict):
            continue
        name = str(tr.get("name") or "").strip().lower()
        to_name = str(((tr.get("to") or {}) if isinstance(tr.get("to"), dict) else {}).get("name") or "").strip().lower()
        if want == name or want == to_name or want in name or want in to_name:
            match = tr
            break
    if not match:
        available = ", ".join(
            str(t.get("name") or "") for t in transitions if isinstance(t, dict)
        ) or "(none)"
        raise ValueError(f"No transition matching “{status_name}”. Available: {available}")
    await _request(
        "POST",
        f"{root}/issue/{key}/transitions",
        username=username,
        token=token,
        deployment=deployment,
        json_body={"transition": {"id": match.get("id")}},
    )
    return {
        "ok": True,
        "key": key,
        "transition": str(match.get("name") or status_name),
        "url": f"{base}/browse/{key}",
        "deployment": deployment,
    }


async def attach_confluence_file(
    *,
    base_url: str,
    username: str,
    token: str,
    page_id: str,
    filename: str,
    content: bytes,
    deployment: Deployment = "server",
    content_type: str = "text/html",
) -> dict[str, Any]:
    base = _normalize_base(base_url)
    page_id = str(page_id or "").strip()
    if not page_id:
        raise ValueError("Confluence page id is required")
    if not content:
        raise ValueError("Attachment content is empty")
    root = _confluence_api_root(base, deployment)
    headers = _auth_headers(username, token, deployment=deployment)
    headers.pop("Content-Type", None)
    headers["X-Atlassian-Token"] = "no-check"
    url = f"{root}/content/{page_id}/child/attachment"
    files = {"file": (filename or "report.html", content, content_type)}
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        resp = await client.post(url, headers=headers, files=files)
    if resp.status_code >= 400:
        raise RuntimeError(f"Atlassian API {resp.status_code}: {resp.text[:800]}")
    data = resp.json() if resp.content else {}
    results = data.get("results") if isinstance(data, dict) else None
    first = results[0] if isinstance(results, list) and results else data
    return {
        "ok": True,
        "page_id": page_id,
        "attachment_id": (first or {}).get("id") if isinstance(first, dict) else None,
        "title": (first or {}).get("title") if isinstance(first, dict) else filename,
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
