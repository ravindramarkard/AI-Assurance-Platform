from __future__ import annotations

import os
from typing import Any

from . import db
from .config import settings


async def effective_settings() -> dict[str, Any]:
    """Merge env settings with DB overrides (DB wins when set)."""
    stored = await db.get_all_settings()
    out: dict[str, Any] = {
        "llm_provider": settings.llm_provider,
        "llm_base_url": settings.llm_base_url,
        "llm_api_key": settings.llm_api_key,
        "llm_model": settings.llm_model,
        "browser_use_api_key": settings.browser_use_api_key,
        "openai_api_key": settings.openai_api_key,
        "anthropic_api_key": settings.anthropic_api_key,
        "headless": settings.headless,
        "browser_engine": settings.browser_engine,
        "browser_executable": settings.browser_executable,
        "application_url": settings.application_url,
        "max_concurrent_agents": settings.max_concurrent_agents,
        "ui_theme": settings.ui_theme,
        "ui_locale": settings.ui_locale,
        "atlassian_deployment": settings.atlassian_deployment,
        "jira_base_url": settings.jira_base_url,
        "jira_email": settings.jira_email,
        "jira_api_token": settings.jira_api_token,
        "jira_project_key": settings.jira_project_key,
        "confluence_base_url": settings.confluence_base_url,
        "confluence_space_key": settings.confluence_space_key,
        "keycloak_enabled": settings.keycloak_enabled,
        "keycloak_base_url": settings.keycloak_base_url,
        "keycloak_realm": settings.keycloak_realm,
        "keycloak_client_id": settings.keycloak_client_id,
        "keycloak_client_secret": settings.keycloak_client_secret,
        "keycloak_username": settings.keycloak_username,
        "keycloak_password": settings.keycloak_password,
        "keycloak_redirect_uri": settings.keycloak_redirect_uri,
    }
    for k, v in stored.items():
        if k in ("headless", "keycloak_enabled"):
            out[k] = v.lower() in ("1", "true", "yes")
        elif k == "max_concurrent_agents":
            try:
                out[k] = max(1, min(int(v), 8))
            except (TypeError, ValueError):
                pass
        else:
            out[k] = v
    return out


def _mask(key: str | None) -> str | None:
    if not key:
        return None
    if len(key) <= 8:
        return "••••"
    return key[:3] + "••••" + key[-2:]


async def public_settings() -> dict[str, Any]:
    from .browser_factory import detect_browsers

    s = await effective_settings()
    detected = detect_browsers()
    return {
        "llm_provider": s["llm_provider"],
        "llm_base_url": s["llm_base_url"],
        "llm_model": s["llm_model"],
        "llm_api_key": _mask(s.get("llm_api_key")),
        "browser_use_api_key": _mask(s.get("browser_use_api_key")),
        "openai_api_key": _mask(s.get("openai_api_key")),
        "anthropic_api_key": _mask(s.get("anthropic_api_key")),
        "headless": s["headless"],
        "browser_engine": s.get("browser_engine") or "chromium",
        "browser_executable": s.get("browser_executable") or "",
        "application_url": s.get("application_url") or "",
        "max_concurrent_agents": int(s.get("max_concurrent_agents") or 2),
        "ui_theme": (
            "light"
            if (s.get("ui_theme") or "") == "contrast"
            else (s.get("ui_theme") or "dark")
        ),
        "ui_locale": s.get("ui_locale") or "en",
        "atlassian_deployment": s.get("atlassian_deployment") or "server",
        "jira_base_url": s.get("jira_base_url") or "",
        "jira_email": s.get("jira_email") or "",
        "jira_api_token": _mask(s.get("jira_api_token")),
        "jira_project_key": s.get("jira_project_key") or "",
        "confluence_base_url": s.get("confluence_base_url") or "",
        "confluence_space_key": s.get("confluence_space_key") or "",
        "keycloak_enabled": bool(s.get("keycloak_enabled")),
        "keycloak_base_url": s.get("keycloak_base_url") or "",
        "keycloak_realm": s.get("keycloak_realm") or "",
        "keycloak_client_id": s.get("keycloak_client_id") or "",
        "keycloak_client_secret": _mask(s.get("keycloak_client_secret")),
        "keycloak_username": s.get("keycloak_username") or "",
        "keycloak_password": _mask(s.get("keycloak_password")),
        "keycloak_redirect_uri": s.get("keycloak_redirect_uri") or "",
        "detected_browsers": detected,
        "has_llm_api_key": bool(s.get("llm_api_key")),
        "has_browser_use_api_key": bool(s.get("browser_use_api_key")),
        "has_openai_api_key": bool(s.get("openai_api_key")),
        "has_anthropic_api_key": bool(s.get("anthropic_api_key")),
        "has_jira_api_token": bool(s.get("jira_api_token")),
        "has_keycloak_password": bool(s.get("keycloak_password")),
        "has_keycloak_client_secret": bool(s.get("keycloak_client_secret")),
        "jira_configured": bool(
            s.get("jira_base_url")
            and s.get("jira_api_token")
            and s.get("jira_project_key")
            and (
                s.get("jira_email")
                or (s.get("atlassian_deployment") or "server") == "server"
            )
        ),
        "keycloak_configured": bool(
            s.get("keycloak_enabled")
            and s.get("keycloak_base_url")
            and s.get("keycloak_realm")
            and s.get("keycloak_client_id")
            and s.get("keycloak_username")
            and s.get("keycloak_password")
        ),
        "confluence_configured": bool(
            (s.get("confluence_base_url") or s.get("jira_base_url"))
            and s.get("jira_api_token")
            and s.get("confluence_space_key")
            and (
                s.get("jira_email")
                or (s.get("atlassian_deployment") or "server") == "server"
            )
        ),
    }


def build_llm(cfg: dict[str, Any]):
    """Construct a browser-use compatible chat model from config."""
    provider = cfg.get("llm_provider") or "local"
    model = cfg.get("llm_model") or "local-model"

    if provider == "browser_use":
        key = cfg.get("browser_use_api_key") or os.environ.get("BROWSER_USE_API_KEY", "")
        if key:
            os.environ["BROWSER_USE_API_KEY"] = key
        from browser_use import ChatBrowserUse

        return ChatBrowserUse(model=model) if model and model != "local-model" else ChatBrowserUse()

    if provider == "anthropic":
        key = cfg.get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY", "")
        if key:
            os.environ["ANTHROPIC_API_KEY"] = key
        try:
            from browser_use import ChatAnthropic
        except ImportError:
            from browser_use.llm import ChatAnthropic  # type: ignore
        return ChatAnthropic(model=model or "claude-sonnet-4-0")

    if provider == "openai":
        key = cfg.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
        if key:
            os.environ["OPENAI_API_KEY"] = key
        try:
            from browser_use import ChatOpenAI
        except ImportError:
            from browser_use.llm import ChatOpenAI  # type: ignore
        return ChatOpenAI(model=model or "gpt-4o")

    # local OpenAI-compatible (LM Studio / Ollama)
    # Qwen reasoning models often put AgentOutput JSON in reasoning_content
    # with empty content — LocalChatOpenAI hoists it so browser-use can parse.
    from .local_llm import build_local_chat_openai

    return build_local_chat_openai(
        model=model,
        api_key=str(cfg.get("llm_api_key") or "lm-studio"),
        base_url=cfg.get("llm_base_url"),
    )
