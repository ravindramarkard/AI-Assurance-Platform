from __future__ import annotations

from fastapi import APIRouter

from .. import db
from ..config import settings as env_settings
from ..llm_factory import public_settings
from ..models import SettingsUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])

ALLOWED = {
    "llm_provider",
    "llm_base_url",
    "llm_api_key",
    "llm_model",
    "browser_use_api_key",
    "openai_api_key",
    "anthropic_api_key",
    "headless",
    "browser_engine",
    "browser_executable",
    "application_url",
    "max_concurrent_agents",
    "ui_theme",
    "ui_locale",
    "atlassian_deployment",
    "jira_base_url",
    "jira_email",
    "jira_api_token",
    "jira_project_key",
    "confluence_base_url",
    "confluence_space_key",
    "keycloak_enabled",
    "keycloak_base_url",
    "keycloak_realm",
    "keycloak_client_id",
    "keycloak_client_secret",
    "keycloak_username",
    "keycloak_password",
    "keycloak_redirect_uri",
}


@router.get("")
async def get_settings():
    return await public_settings()


@router.put("")
async def update_settings(body: SettingsUpdate):
    data = body.model_dump(exclude_none=True)
    for k, v in data.items():
        if k not in ALLOWED:
            continue
        if k == "headless":
            await db.set_setting(k, "true" if v else "false")
            env_settings.headless = bool(v)
        elif k == "keycloak_enabled":
            await db.set_setting(k, "true" if v else "false")
            env_settings.keycloak_enabled = bool(v)
        elif k == "max_concurrent_agents":
            n = max(1, min(int(v), 8))
            await db.set_setting(k, str(n))
            env_settings.max_concurrent_agents = n
            from ..queue import scale_workers

            await scale_workers(n)
        else:
            await db.set_setting(k, str(v))
            if hasattr(env_settings, k):
                setattr(env_settings, k, v)
    return await public_settings()
