from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    task: str = Field(min_length=1)
    model: str | None = None
    # Per-run override of Settings → Application URL
    runtime_url: str | None = None


class MessageRequest(BaseModel):
    content: str = Field(min_length=1)


class SessionControlRequest(BaseModel):
    action: Literal["pause", "resume", "stop"]


class SettingsUpdate(BaseModel):
    llm_provider: Literal["local", "browser_use", "openai", "anthropic"] | None = None
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None
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
    service: Literal["jira", "confluence"] = "jira"


class SessionOut(BaseModel):
    id: str
    title: str
    task: str
    status: str
    model: str | None = None
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
    task: str = Field(min_length=1)
    name: str | None = None
    schedule: SchedulePreset = "every_hour"
    model: str | None = None
    max_steps: int = Field(default=100, ge=1, le=500)
    start_url: str | None = None
    system_prompt: str | None = None


class UpdateScheduledJobRequest(BaseModel):
    task: str | None = None
    name: str | None = None
    schedule: SchedulePreset | None = None
    model: str | None = None
    max_steps: int | None = Field(default=None, ge=1, le=500)
    start_url: str | None = None
    system_prompt: str | None = None
    enabled: bool | None = None


class ScheduledJobOut(BaseModel):
    id: str
    name: str | None = None
    task: str
    schedule: str
    model: str | None = None
    max_steps: int = 100
    start_url: str | None = None
    system_prompt: str | None = None
    enabled: bool = True
    status: str = "active"
    last_run_at: str | None = None
    next_run_at: str | None = None
    last_session_id: str | None = None
    last_error: str | None = None
    created_at: str
    updated_at: str
    workspace: str = "schedular"
