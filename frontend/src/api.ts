export type Session = {
  id: string
  title: string
  task: string
  status: string
  model?: string | null
  created_at: string
  updated_at: string
  error?: string | null
  step_count: number
  current_url?: string | null
}

export type Message = {
  id: string
  session_id: string
  role: string
  content: string
  created_at: string
}

export type Event = {
  id?: string
  session_id?: string
  type: string
  payload: Record<string, unknown>
  created_at?: string
}

export type BrowserEngine = 'chromium' | 'chrome' | 'custom'

export type AppSettings = {
  llm_provider: string
  llm_base_url: string
  llm_model: string
  llm_api_key?: string | null
  browser_use_api_key?: string | null
  openai_api_key?: string | null
  anthropic_api_key?: string | null
  headless: boolean
  browser_engine?: BrowserEngine | string
  browser_executable?: string
  /** Default start URL when a task omits a link (overridable per run). */
  application_url?: string
  /** How many agent sessions can run at the same time (1–8). */
  max_concurrent_agents?: number
  ui_theme?: 'dark' | 'light' | 'system' | string
  ui_locale?: 'en' | 'ar' | 'hi' | string
  atlassian_deployment?: 'server' | 'cloud' | string
  jira_base_url?: string
  jira_email?: string
  jira_api_token?: string | null
  jira_project_key?: string
  confluence_base_url?: string
  confluence_space_key?: string
  keycloak_enabled?: boolean
  keycloak_base_url?: string
  keycloak_realm?: string
  keycloak_client_id?: string
  keycloak_client_secret?: string | null
  keycloak_username?: string
  keycloak_password?: string | null
  keycloak_redirect_uri?: string
  has_jira_api_token?: boolean
  has_keycloak_password?: boolean
  has_keycloak_client_secret?: boolean
  jira_configured?: boolean
  keycloak_configured?: boolean
  confluence_configured?: boolean
  detected_browsers?: {
    chromium?: string | null
    headless_shell?: string | null
    chrome?: string | null
  }
  has_llm_api_key?: boolean
  has_browser_use_api_key?: boolean
  has_openai_api_key?: boolean
  has_anthropic_api_key?: boolean
}

export type FileEntry = {
  path: string
  name: string
  is_dir: boolean
  size?: number | null
}

export type SchedulePreset = 'every_hour' | 'every_day' | 'every_week'

export type ScheduledJob = {
  id: string
  name?: string | null
  task: string
  schedule: SchedulePreset | string
  model?: string | null
  max_steps: number
  start_url?: string | null
  system_prompt?: string | null
  enabled: boolean
  status: string
  last_run_at?: string | null
  next_run_at?: string | null
  last_session_id?: string | null
  last_error?: string | null
  created_at: string
  updated_at: string
  workspace?: string
  workspace_path?: string
}

export type CreateScheduledJobBody = {
  task: string
  name?: string
  schedule?: SchedulePreset
  model?: string
  max_steps?: number
  start_url?: string
  system_prompt?: string
}

export type IntegrationStatus = {
  deployment?: 'server' | 'cloud' | string
  jira: {
    configured: boolean
    base_url?: string | null
    project_key?: string | null
    username?: string | null
    email?: string | null
  }
  confluence: {
    configured: boolean
    base_url?: string | null
    space_key?: string | null
  }
}

export type JiraIssueResult = {
  ok: boolean
  key: string
  id?: string
  url: string
}

export type ConfluencePageResult = {
  ok: boolean
  id?: string
  title: string
  url: string
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json()
}

export const api = {
  health: () =>
    fetch('/api/health').then((r) => json<{ ok: boolean; service?: string; username?: string }>(r)),
  listSessions: () => fetch('/api/sessions').then((r) => json<Session[]>(r)),
  deleteSession: (id: string) =>
    fetch(`/api/sessions/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  clearHistory: () =>
    fetch('/api/sessions', { method: 'DELETE' }).then((r) => json<{ ok: boolean; deleted: number }>(r)),
  createSession: (task: string, model?: string, files?: File[], runtimeUrl?: string) => {
    const runtime_url = (runtimeUrl || '').trim() || undefined
    if (files && files.length > 0) {
      const fd = new FormData()
      fd.append('task', task)
      if (model) fd.append('model', model)
      if (runtime_url) fd.append('runtime_url', runtime_url)
      for (const f of files) fd.append('files', f)
      return fetch('/api/sessions/with-files', {
        method: 'POST',
        body: fd,
      }).then((r) => json<Session & { attachments?: string[] }>(r))
    }
    return fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, model, runtime_url }),
    }).then((r) => json<Session>(r))
  },
  getSession: (id: string) => fetch(`/api/sessions/${id}`).then((r) => json<Session>(r)),
  getMessages: (id: string) => fetch(`/api/sessions/${id}/messages`).then((r) => json<Message[]>(r)),
  getEvents: (id: string) => fetch(`/api/sessions/${id}/events`).then((r) => json<Event[]>(r)),
  postMessage: (id: string, content: string) =>
    fetch(`/api/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }).then((r) => json<{ ok: boolean }>(r)),
  control: (id: string, action: 'pause' | 'resume' | 'stop') =>
    fetch(`/api/sessions/${id}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).then((r) => json<{ ok: boolean }>(r)),
  listFiles: (id: string) => fetch(`/api/sessions/${id}/files`).then((r) => json<FileEntry[]>(r)),
  readFile: (id: string, path: string) =>
    fetch(`/api/sessions/${id}/files/content?path=${encodeURIComponent(path)}`).then((r) =>
      json<{ path: string; content: string }>(r),
    ),
  /** Stitch live_####.png screenshots into screenshots/recording.gif */
  createRecordingGif: (id: string, durationMs = 280) =>
    fetch(`/api/sessions/${id}/files/recording-gif?duration_ms=${durationMs}`, {
      method: 'POST',
    }).then((r) =>
      json<{ path: string; frames: number; duration_ms: number; size: number }>(r),
    ),
  /** Direct URL to serve a workspace file (HTML/images) with correct Content-Type. */
  fileRawUrl: (id: string, path: string) =>
    `/api/sessions/${id}/files/raw?path=${encodeURIComponent(path)}`,
  getSettings: () => fetch('/api/settings').then((r) => json<AppSettings>(r)),
  updateSettings: (body: Partial<AppSettings> & Record<string, unknown>) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<AppSettings>(r)),
  browsers: () =>
    fetch('/api/browsers').then((r) =>
      json<{
        browsers: Array<{
          id: string
          name: string
          engine?: string
          status: string
          active_sessions: number
        }>
        queued: number
      }>(r),
    ),
  screenshotUrl: (sessionId: string, rel: string) => {
    const name = rel.split('/').pop() || rel
    return `/api/sessions/${sessionId}/screenshot/${name}`
  },
  listScheduledJobs: () => fetch('/api/scheduled-jobs').then((r) => json<ScheduledJob[]>(r)),
  createScheduledJob: (body: CreateScheduledJobBody) =>
    fetch('/api/scheduled-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<ScheduledJob>(r)),
  updateScheduledJob: (id: string, body: Partial<CreateScheduledJobBody> & { enabled?: boolean }) =>
    fetch(`/api/scheduled-jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<ScheduledJob>(r)),
  deleteScheduledJob: (id: string) =>
    fetch(`/api/scheduled-jobs/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  runScheduledJob: (id: string) =>
    fetch(`/api/scheduled-jobs/${id}/run`, { method: 'POST' }).then((r) =>
      json<{ ok: boolean; session_id: string; job: ScheduledJob }>(r),
    ),
  integrationStatus: () =>
    fetch('/api/integrations/status').then((r) => json<IntegrationStatus>(r)),
  testIntegration: (service: 'jira' | 'confluence' | 'keycloak') =>
    fetch('/api/integrations/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service }),
    }).then((r) => json<{ ok: boolean; display_name?: string }>(r)),
  createJiraIssue: (body: {
    summary: string
    description?: string
    issue_type?: string
    project_key?: string
    session_id?: string
  }) =>
    fetch('/api/integrations/jira/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<JiraIssueResult>(r)),
  createConfluencePage: (body: {
    title: string
    body_html?: string
    space_key?: string
    session_id?: string
  }) =>
    fetch('/api/integrations/confluence/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<ConfluencePageResult>(r)),
}
