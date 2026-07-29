from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]  # ~/browser-use
BACKEND = Path(__file__).resolve().parents[1]

# Export .env into process env so browser-use TIMEOUT_* / CHROME_PATH are visible
load_dotenv(BACKEND / ".env", override=False)
# Disable browser-use telemetry noise by default
os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")



class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    llm_provider: Literal["local", "browser_use", "openai", "anthropic"] = "local"
    llm_base_url: str = "http://localhost:1234/v1"
    llm_api_key: str = "lm-studio"
    llm_model: str = "local-model"
    llm_vision_mode: Literal["auto", "on", "off"] = "auto"
    llm_temperature: float = 0.1

    browser_use_api_key: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    host: str = "127.0.0.1"
    port: int = 8742
    max_concurrent_agents: int = 2
    data_dir: Path = ROOT / "data"
    headless: bool = True
    # chromium = Playwright Chrome-for-Testing / headless-shell
    # chrome   = installed Google Chrome
    # custom   = BROWSER_EXECUTABLE / CHROME_PATH
    browser_engine: Literal["chromium", "chrome", "custom"] = "chromium"
    browser_executable: str = ""
    # Default start URL for tasks that omit a link (overridable per run via runtime_url)
    application_url: str = ""
    ui_theme: Literal[
        "dark",
        "light",
        "system",
        "midnight",
        "ocean",
        "nord",
        "ember",
        "rose",
        "solar",
        "matcha",
    ] = "dark"
    ui_locale: Literal["en", "ar", "hi"] = "en"

    # Atlassian — server/Data Center (default) or cloud
    atlassian_deployment: Literal["server", "cloud"] = "server"
    jira_base_url: str = ""
    jira_email: str = ""  # username (Server) or email (Cloud)
    jira_api_token: str = ""  # password / PAT (Server) or API token (Cloud)
    jira_project_key: str = ""
    confluence_base_url: str = ""
    confluence_space_key: str = ""

    # Keycloak — SSO login for Application URL (browser form + optional token test)
    keycloak_enabled: bool = False
    keycloak_base_url: str = ""
    keycloak_realm: str = ""
    keycloak_client_id: str = ""
    keycloak_client_secret: str = ""
    keycloak_username: str = ""
    keycloak_password: str = ""
    keycloak_redirect_uri: str = ""  # optional; defaults to application_url


settings = Settings()
settings.data_dir = Path(settings.data_dir).expanduser().resolve()
settings.data_dir.mkdir(parents=True, exist_ok=True)
(settings.data_dir / "sessions").mkdir(parents=True, exist_ok=True)

# Default shared folder for scheduled jobs (no workspace picker)
SCHEDULAR_DIR = ROOT / "schedular"
SCHEDULAR_DIR.mkdir(parents=True, exist_ok=True)


def session_dir(session_id: str) -> Path:
    path = settings.data_dir / "sessions" / session_id
    path.mkdir(parents=True, exist_ok=True)
    (path / "screenshots").mkdir(exist_ok=True)
    (path / "workspace").mkdir(exist_ok=True)
    return path


def schedular_dir() -> Path:
    SCHEDULAR_DIR.mkdir(parents=True, exist_ok=True)
    return SCHEDULAR_DIR
