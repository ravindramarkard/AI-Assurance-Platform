from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    task: str = Field(min_length=1)
    model: str | None = None
    llm_provider: Literal["local", "openai", "anthropic"] | None = None
    # Per-run override of Settings → Application URL
    runtime_url: str | None = None


class MessageRequest(BaseModel):
    content: str = Field(min_length=1)


class SessionControlRequest(BaseModel):
    action: Literal["pause", "resume", "stop"]


class HumanInputRequest(BaseModel):
    value: str = Field(min_length=1)
    request_id: str | None = None


class SettingsUpdate(BaseModel):
    llm_provider: Literal["local", "browser_use", "openai", "anthropic"] | None = None
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None
    llm_models: dict[str, list[str]] | None = None
    llm_vision_mode: Literal["auto", "on", "off"] | None = None
    llm_use_vision: bool | None = None  # legacy → maps to on/off
    llm_temperature: float | None = Field(default=None, ge=0.0, le=1.0)
    llm_use_vision_reset: bool | None = None  # legacy: treat as auto
    browser_use_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    headless: bool | None = None
    browser_engine: Literal["chromium", "chrome", "custom"] | None = None
    browser_executable: str | None = None
    application_url: str | None = None
    max_concurrent_agents: int | None = Field(default=None, ge=1, le=8)
    ui_theme: (
        Literal[
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
        ]
    | None
    ) = None
    ui_locale: Literal["en", "ar", "hi"] | None = None
    # Atlassian — server/Data Center (default) or cloud
    atlassian_deployment: Literal["server", "cloud"] | None = None
    jira_base_url: str | None = None
    jira_email: str | None = None  # username on Server; email on Cloud
    jira_api_token: str | None = None  # password or PAT on Server; API token on Cloud
    jira_project_key: str | None = None
    confluence_base_url: str | None = None
    confluence_space_key: str | None = None
    # Keycloak SSO
    keycloak_enabled: bool | None = None
    keycloak_base_url: str | None = None
    keycloak_realm: str | None = None
    keycloak_client_id: str | None = None
    keycloak_client_secret: str | None = None
    keycloak_username: str | None = None
    keycloak_password: str | None = None
    keycloak_redirect_uri: str | None = None


class LlmTestRequest(BaseModel):
    """Optional form overrides for testing before save."""

    llm_provider: Literal["local", "openai", "anthropic"] | None = None
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None
    llm_vision_mode: Literal["auto", "on", "off"] | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None


class JiraIssueRequest(BaseModel):
    summary: str = Field(min_length=1, max_length=255)
    description: str = ""
    issue_type: str = "Bug"
    project_key: str | None = None
    labels: list[str] | None = None
    session_id: str | None = None


class ConfluencePageRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body_html: str = ""
    space_key: str | None = None
    session_id: str | None = None


class IntegrationTestRequest(BaseModel):
    service: Literal["jira", "confluence", "keycloak"] = "jira"


class SessionOut(BaseModel):
    id: str
    title: str
    task: str
    status: str
    model: str | None = None
    llm_provider: str | None = None
    created_at: str
    updated_at: str
    error: str | None = None
    step_count: int = 0
    current_url: str | None = None


class EventOut(BaseModel):
    id: str
    session_id: str
    type: str
    payload: dict[str, Any]
    created_at: str


class MessageOut(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    created_at: str


class FileEntry(BaseModel):
    path: str
    name: str
    is_dir: bool
    size: int | None = None


class FileContent(BaseModel):
    path: str
    content: str


SchedulePreset = Literal["every_hour", "every_day", "every_week"]


class CreateScheduledJobRequest(BaseModel):
    task: str = Field(default="", min_length=0)
    name: str | None = None
    schedule: SchedulePreset = "every_hour"
    model: str | None = None
    llm_provider: str | None = None
    max_steps: int = Field(default=100, ge=1, le=500)
    start_url: str | None = None
    system_prompt: str | None = None
    job_type: Literal["agent", "api_test"] = "agent"
    payload: dict[str, Any] | None = None
    enabled: bool = True


class UpdateScheduledJobRequest(BaseModel):
    task: str | None = None
    name: str | None = None
    schedule: SchedulePreset | None = None
    model: str | None = None
    llm_provider: str | None = None
    max_steps: int | None = Field(default=None, ge=1, le=500)
    start_url: str | None = None
    system_prompt: str | None = None
    enabled: bool | None = None
    job_type: Literal["agent", "api_test"] | None = None
    payload: dict[str, Any] | None = None


class ScheduledJobOut(BaseModel):
    id: str
    name: str | None = None
    task: str
    schedule: str
    model: str | None = None
    llm_provider: str | None = None
    max_steps: int = 100
    start_url: str | None = None
    system_prompt: str | None = None
    enabled: bool = True
    status: str = "active"
    last_run_at: str | None = None
    next_run_at: str | None = None
    last_session_id: str | None = None
    last_run_id: str | None = None
    last_error: str | None = None
    job_type: str = "agent"
    payload: dict[str, Any] | None = None
    created_at: str
    updated_at: str
    workspace: str = "schedular"


class ApiProjectScheduleUpdate(BaseModel):
    """Enable/configure nightly (or other) API suite via scheduled_jobs."""

    enabled: bool = True
    schedule: SchedulePreset = "every_day"
    flow_ids: list[str] | None = None


# ── API Test Console ─────────────────────────────────────────────────────────


class ApiProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    base_url: str = ""
    openapi_url: str = ""
    config: dict[str, Any] | None = None


class ApiProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    base_url: str | None = None
    openapi_url: str | None = None
    config: dict[str, Any] | None = None


class ApiIngestRequest(BaseModel):
    url: str | None = None


class ApiServiceCreate(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    name: str = ""
    base_url: str = ""
    openapi_url: str = ""
    sort_order: int | None = None


class ApiServiceUpdate(BaseModel):
    key: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = None
    base_url: str | None = None
    openapi_url: str | None = None
    sort_order: int | None = None


class ApiAuthUpdate(BaseModel):
    scheme_name: str = Field(min_length=1)
    type: str | None = None  # apiKey | http | bearer | basic | oauth2
    client_id: str | None = None
    client_secret: str | None = None
    username: str | None = None
    password: str | None = None
    api_key: str | None = None
    bearer_token: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    scope: str | None = None
    redirect_uri: str | None = None
    param_name: str | None = None


class ApiTokenRequest(BaseModel):
    scheme_name: str = Field(min_length=1)
    grant: str | None = None
    code: str | None = None
    redirect_uri: str | None = None


class ApiTestConnectionRequest(BaseModel):
    scheme_name: str | None = None


class ApiAuthorizeRequest(BaseModel):
    scheme_name: str = Field(min_length=1)
    redirect_uri: str = Field(min_length=1)
    state: str = "api-test"


class ApiOAuthCallback(BaseModel):
    scheme_name: str = Field(min_length=1)
    code: str = Field(min_length=1)
    redirect_uri: str = Field(min_length=1)
    state: str | None = None


class ApiRunRequest(BaseModel):
    flow_ids: list[str] | None = None


class ApiRequestEdit(BaseModel):
    """Edit saved request payload for matching flow step(s)."""

    operation_id: str | None = None
    method: str = Field(min_length=1)
    path: str = ""
    path_template: str | None = None
    flow_name: str | None = None
    headers: dict[str, Any] | None = None
    query: dict[str, Any] | None = None
    body: Any = None
    update_mock: bool = True


class ApiSingleStepRunRequest(BaseModel):
    """Execute one endpoint/step against the project base URL with auth applied."""

    method: str = Field(min_length=1)
    path: str = Field(min_length=1)
    path_template: str | None = None
    operation_id: str | None = None
    flow_name: str | None = None
    headers: dict[str, Any] | None = None
    query: dict[str, Any] | None = None
    body: Any = None
    captures: list[dict[str, Any]] | None = None
    seed_var: dict[str, Any] | None = None
    expected_status: list[int] | None = None
    kind: str | None = "e2e"
    # Default True: single-step runs use configured authorize credentials
    use_auth: bool = True
    skip_auth: bool = False
