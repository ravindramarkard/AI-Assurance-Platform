export type HitlPending = {
  request_id: string
  prompt: string
  input_type: 'otp' | 'text' | string
}

export type Session = {
  id: string
  title: string
  task: string
  status: string
  model?: string | null
  llm_provider?: string | null
  created_at: string
  updated_at: string
  error?: string | null
  step_count: number
  current_url?: string | null
  hitl_pending?: HitlPending | string | null
  parent_id?: string | null
  role?: 'root' | 'orchestrator' | 'child' | string
  branch_id?: string | null
  attempt?: number | null
  force_parallel?: boolean | number
  aggregate_report?: string | null
  plan?: unknown
  plan_json?: string | null
  child_stats?: {
    total: number
    queued: number
    running: number
    waiting_for_input?: number
    paused?: number
    completed?: number
    failed: number
    stopped?: number
  }
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

export type LlmProvider = 'local' | 'openai' | 'anthropic'

export type LlmModelsCatalog = {
  local: string[]
  openai: string[]
  anthropic: string[]
}

export type AppSettings = {
  llm_provider: string
  llm_base_url: string
  llm_model: string
  llm_models?: LlmModelsCatalog
  llm_api_key?: string | null
  llm_vision_mode?: 'auto' | 'on' | 'off'
  llm_vision_effective?: boolean | null
  llm_vision_probe_ok?: boolean | null
  llm_vision_probe_at?: string | null
  llm_use_vision?: boolean | null
  llm_use_vision_effective?: boolean
  llm_temperature?: number
  browser_use_api_key?: string | null
  openai_api_key?: string | null
  anthropic_api_key?: string | null
  headless: boolean
  screenshot_archive?: 'always' | 'on_failure' | 'never'
  screenshot_archive_user_set?: boolean
  browser_engine?: BrowserEngine | string
  browser_executable?: string
  /** Default start URL when a task omits a link (overridable per run). */
  application_url?: string
  application_username?: string
  application_password?: string | null
  has_application_password?: boolean
  /** How many agent sessions can run at the same time (1–8). */
  max_concurrent_agents?: number
  /** How subagents are allowed to run within a task (off/auto/always). */
  parallel_execution_mode?: 'off' | 'auto' | 'always'
  /** Cap on how many subagents a task may spawn (1–8). */
  max_subagents_per_task?: number
  ui_theme?: 'dark' | 'light' | 'system' | string
  ui_locale?: 'en' | 'ar' | 'hi' | string
  atlassian_deployment?: 'server' | 'cloud' | string
  jira_auth_type?: 'password' | 'pat' | string
  jira_base_url?: string
  jira_email?: string
  jira_api_token?: string | null
  jira_project_key?: string
  confluence_auth_type?: 'password' | 'pat' | string
  confluence_base_url?: string
  confluence_email?: string
  confluence_api_token?: string | null
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
  has_confluence_api_token?: boolean
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
  last_run_id?: string | null
  last_error?: string | null
  job_type?: 'agent' | 'api_test' | string
  payload?: Record<string, unknown>
  created_at: string
  updated_at: string
  workspace?: string
  workspace_path?: string
}

export type CreateScheduledJobBody = {
  task?: string
  name?: string
  schedule?: SchedulePreset
  model?: string
  max_steps?: number
  start_url?: string
  system_prompt?: string
  job_type?: 'agent' | 'api_test'
  payload?: Record<string, unknown>
  enabled?: boolean
}

export type ApiProjectSchedule = {
  enabled: boolean
  schedule: SchedulePreset | string
  flow_ids?: string[] | null
  job_id?: string | null
  job_type?: string
  next_run_at?: string | null
  last_run_at?: string | null
  last_run_id?: string | null
  last_error?: string | null
  status?: string
  reuses_scheduled_jobs?: boolean
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

export type ApiProjectConfig = {
  generation_budget?: number
  flaky_threshold?: number
  allow_private_urls?: boolean
  latency_budget_ms?: number
  include_negative?: boolean
  include_edge?: boolean
  mock_mode?: boolean
  source?: string
  mock_data?: Record<string, unknown>
  collection_steps?: unknown[]
  postman_filename?: string
  schedule_job_id?: string
  schedule?: {
    enabled?: boolean
    schedule?: SchedulePreset | string
    flow_ids?: string[] | null
    job_id?: string
    next_run_at?: string | null
    last_run_at?: string | null
    last_run_id?: string | null
  }
}

export type ApiProject = {
  id: string
  name: string
  base_url: string
  openapi_url: string
  config: ApiProjectConfig
  security_schemes?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ApiService = {
  id: string
  project_id: string
  key: string
  name: string
  base_url: string
  openapi_url: string
  security_schemes?: Record<string, unknown>
  sort_order: number
  created_at?: string
  updated_at?: string
  synthetic?: boolean
}

export type ApiEndpoint = {
  id: string
  project_id: string
  method: string
  path: string
  operation_id: string
  tags: string[]
  summary?: string
  last_status?: string | null
  meta?: {
    service_id?: string
    service_key?: string
    path_params?: string[]
    has_body?: boolean
    source?: string
  }
}

export type ApiSecurityScheme = {
  name: string
  type: string
  description?: string
  flows: string[]
  in?: string | null
  param_name?: string | null
  scheme?: string | null
  authorize_url?: string | null
  token_url?: string | null
  scopes?: string[]
  configured?: boolean
  has_access_token?: boolean
  has_refresh_token?: boolean
  has_client_secret?: boolean
  has_password?: boolean
  has_api_key?: boolean
  token_expires_at?: number | null
}

export type ApiFlow = {
  id: string
  project_id: string
  name: string
  kind: string
  resource?: string
  steps: Array<Record<string, unknown>>
  created_at: string
}

export type ApiRun = {
  id: string
  project_id: string
  status: string
  summary: {
    passed?: number
    failed?: number
    total?: number
    avg_latency_ms?: number
    report_html?: string
    allure_results?: string
    report_dir?: string
    self_healed_steps?: number
    spectrum?: Record<string, number>
    insights?: {
      verdict?: string
      headline?: string
      summary?: string
      primary_root_cause?: string
      primary_solution?: string
      pass_rate?: number
      themes?: Array<{
        count?: number
        title?: string
        root_cause?: string
        solution?: string
      }>
    }
  }
  error?: string | null
  started_at?: string | null
  finished_at?: string | null
  created_at: string
}

export type ApiRunStep = {
  id: string
  run_id: string
  idx: number
  flow_name: string
  method: string
  path: string
  operation_id?: string | null
  status: string
  latency_ms: number
  detail: Record<string, unknown>
}

export type ApiAnomaly = {
  id: string
  project_id: string
  run_id?: string | null
  endpoint?: string | null
  finding: string
  confidence: number
  created_at: string
}

export type ApiDrift = {
  changes: Array<{ op: string; kind: string; detail: string }>
  added: number
  removed: number
  modified: number
  baseline_ops?: number
  current_ops?: number
  has_baseline?: boolean
  has_current?: boolean
  baseline_at?: string | null
  openapi_url?: string
  in_sync?: boolean
  is_first_baseline?: boolean
  message?: string
}

export type ApiOverview = {
  project: ApiProject
  health: 'healthy' | 'degraded' | 'critical' | string
  total_endpoints: number
  passing: number
  failing: number
  drifting: number
  coverage: number
  ai_generated_tests: number
  flow_count: number
  schema_drift: number
  avg_response_ms: number
  flaky_tests: number
  flaky: Array<{ endpoint: string; fail_rate: number; runs: number; failures: number }>
  anomalies: ApiAnomaly[]
  endpoints: ApiEndpoint[]
  recent_runs: ApiRun[]
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    let message = text || res.statusText
    try {
      const parsed = JSON.parse(text) as { detail?: unknown }
      if (typeof parsed.detail === 'string') message = parsed.detail
    } catch {
      /* keep raw */
    }
    throw new Error(message)
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
  createSession: (
    task: string,
    model?: string,
    files?: File[],
    runtimeUrl?: string,
    forceParallel?: boolean,
    llmProvider?: string,
  ) => {
    const runtime_url = (runtimeUrl || '').trim() || undefined
    const llm_provider = (llmProvider || '').trim() || undefined
    if (files && files.length > 0) {
      const fd = new FormData()
      fd.append('task', task)
      if (model) fd.append('model', model)
      if (runtime_url) fd.append('runtime_url', runtime_url)
      if (forceParallel !== undefined) fd.append('force_parallel', forceParallel ? 'true' : 'false')
      if (llm_provider) fd.append('llm_provider', llm_provider)
      for (const f of files) fd.append('files', f)
      return fetch('/api/sessions/with-files', {
        method: 'POST',
        body: fd,
      }).then((r) => json<Session & { attachments?: string[] }>(r))
    }
    return fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task,
        model,
        runtime_url,
        force_parallel: forceParallel,
        llm_provider,
      }),
    }).then((r) => json<Session>(r))
  },
  getSession: (id: string) => fetch(`/api/sessions/${id}`).then((r) => json<Session>(r)),
  listSessionChildren: (id: string) =>
    fetch(`/api/sessions/${id}/children`).then((r) => json<Session[]>(r)),
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
  submitHumanInput: (id: string, body: { value: string; request_id?: string }) =>
    fetch(`/api/sessions/${id}/human-input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
  testLlm: (body?: {
    llm_provider?: string
    llm_base_url?: string
    llm_api_key?: string
    llm_model?: string
    llm_vision_mode?: string
    openai_api_key?: string
    anthropic_api_key?: string
  }) =>
    fetch('/api/settings/test-llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then((r) =>
      json<{
        ok: boolean
        provider?: string
        model?: string
        reply?: string | null
        vision_supported?: boolean
        llm_vision_mode?: string
      }>(r),
    ),
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
      json<{ ok: boolean; session_id?: string | null; run_id?: string | null; job: ScheduledJob }>(r),
    ),
  integrationStatus: () =>
    fetch('/api/integrations/status').then((r) => json<IntegrationStatus>(r)),
  testIntegration: (service: 'jira' | 'confluence' | 'keycloak') =>
    fetch('/api/integrations/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service }),
    }).then((r) =>
      json<{
        ok: boolean
        display_name?: string
        projects?: { key: string; name: string }[]
        spaces?: { key: string; name: string }[]
      }>(r),
    ),
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

  // API Test Console
  listApiProjects: () => fetch('/api/api-test/projects').then((r) => json<ApiProject[]>(r)),
  createApiProject: (body: {
    name: string
    base_url?: string
    openapi_url?: string
    config?: ApiProjectConfig
  }) =>
    fetch('/api/api-test/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<ApiProject>(r)),
  getApiProject: (id: string) =>
    fetch(`/api/api-test/projects/${id}`).then((r) => json<ApiProject>(r)),
  updateApiProject: (
    id: string,
    body: Partial<{ name: string; base_url: string; openapi_url: string; config: ApiProjectConfig }>,
  ) =>
    fetch(`/api/api-test/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<ApiProject>(r)),
  deleteApiProject: (id: string) =>
    fetch(`/api/api-test/projects/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  listApiServices: (projectId: string) =>
    fetch(`/api/api-test/projects/${projectId}/services`).then((r) => json<ApiService[]>(r)),
  createApiService: (
    projectId: string,
    body: { key: string; name?: string; base_url?: string; openapi_url?: string; sort_order?: number },
  ) =>
    fetch(`/api/api-test/projects/${projectId}/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<ApiService>(r)),
  updateApiService: (
    projectId: string,
    serviceId: string,
    body: Partial<{ key: string; name: string; base_url: string; openapi_url: string; sort_order: number }>,
  ) =>
    fetch(`/api/api-test/projects/${projectId}/services/${serviceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<ApiService>(r)),
  deleteApiService: (projectId: string, serviceId: string) =>
    fetch(`/api/api-test/projects/${projectId}/services/${serviceId}`, { method: 'DELETE' }).then((r) =>
      json<{ ok: boolean }>(r),
    ),
  ingestApiService: (projectId: string, serviceId: string, url?: string) =>
    fetch(`/api/api-test/projects/${projectId}/services/${serviceId}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then((r) =>
      json<{
        project: ApiProject
        service?: ApiService
        endpoint_count: number
        security_schemes: ApiSecurityScheme[]
        drift: ApiDrift
        source?: string
      }>(r),
    ),
  ingestApiServiceUpload: (projectId: string, serviceId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`/api/api-test/projects/${projectId}/services/${serviceId}/ingest/upload`, {
      method: 'POST',
      body: fd,
    }).then((r) =>
      json<{
        project: ApiProject
        service?: ApiService
        endpoint_count: number
        security_schemes: ApiSecurityScheme[]
        drift: ApiDrift
        source?: string
        mock_fixtures?: number
        collection_steps?: number
      }>(r),
    )
  },
  ingestApiProject: (id: string, url?: string) =>
    fetch(`/api/api-test/projects/${id}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then((r) =>
      json<{
        project: ApiProject
        endpoint_count: number
        security_schemes: ApiSecurityScheme[]
        drift: ApiDrift
      }>(r),
    ),
  ingestApiUpload: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`/api/api-test/projects/${id}/ingest/upload`, { method: 'POST', body: fd }).then((r) =>
      json<{
        project: ApiProject
        endpoint_count: number
        security_schemes: ApiSecurityScheme[]
        drift: ApiDrift
        source?: string
        mock_fixtures?: number
        collection_steps?: number
      }>(r),
    )
  },
  ingestApiPostman: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`/api/api-test/projects/${id}/ingest/postman`, { method: 'POST', body: fd }).then((r) =>
      json<{
        project: ApiProject
        endpoint_count: number
        security_schemes: ApiSecurityScheme[]
        drift: ApiDrift
        source: string
        mock_fixtures: number
        collection_steps: number
      }>(r),
    )
  },
  exportApiPostmanCollection: async (id: string) => {
    const r = await fetch(`/api/api-test/projects/${id}/export/postman`)
    if (!r.ok) {
      let detail = r.statusText
      try {
        const body = await r.json()
        detail = body?.detail || body?.message || detail
      } catch {
        /* ignore */
      }
      throw new Error(typeof detail === 'string' ? detail : 'Export failed')
    }
    const blob = await r.blob()
    const cd = r.headers.get('Content-Disposition') || ''
    const match = /filename="?([^"]+)"?/i.exec(cd)
    const filename = match?.[1] || 'api-assurance.postman_collection.json'
    return { blob, filename }
  },
  saveApiMockData: (id: string, mock_data: Record<string, unknown>) =>
    fetch(`/api/api-test/projects/${id}/mock-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mock_data }),
    }).then((r) => json<{ ok: boolean; fixture_count: number; mock_mode?: boolean }>(r)),
  saveApiRequestEdit: (
    id: string,
    body: {
      method: string
      path?: string
      path_template?: string
      operation_id?: string
      flow_name?: string
      headers?: Record<string, unknown> | null
      query?: Record<string, unknown> | null
      body?: unknown
      update_mock?: boolean
    },
  ) =>
    fetch(`/api/api-test/projects/${id}/request-edit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) =>
      json<{
        ok: boolean
        updated_steps: number
        updated_flows: string[]
        mock_updated: boolean
      }>(r),
    ),
  runApiStep: (
    id: string,
    body: {
      method: string
      path: string
      path_template?: string
      operation_id?: string
      flow_name?: string
      headers?: Record<string, unknown> | null
      query?: Record<string, unknown> | null
      body?: unknown
      captures?: Array<Record<string, unknown>>
      seed_var?: Record<string, unknown>
      expected_status?: number[]
      kind?: string
      use_auth?: boolean
      skip_auth?: boolean
    },
  ) =>
    fetch(`/api/api-test/projects/${id}/run-step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) =>
      json<{
        ok: boolean
        status: string
        auth_applied: boolean
        auth_schemes_ready: string[]
        use_auth: boolean
        mock_mode?: boolean
        warning?: string | null
        result: {
          status?: string
          latency_ms?: number
          error?: string | null
          assertions?: Array<Record<string, unknown>>
          request?: Record<string, unknown>
          response?: Record<string, unknown> | null
          captures?: Record<string, unknown>
        }
      }>(r),
    ),
  listApiEndpoints: (id: string) =>
    fetch(`/api/api-test/projects/${id}/endpoints`).then((r) => json<ApiEndpoint[]>(r)),
  getApiDrift: (id: string) =>
    fetch(`/api/api-test/projects/${id}/drift`).then((r) => json<ApiDrift>(r)),
  resetApiBaseline: (id: string) =>
    fetch(`/api/api-test/projects/${id}/baseline/reset`, { method: 'POST' }).then((r) =>
      json<{ ok: boolean; baseline_at?: string; drift: ApiDrift }>(r),
    ),
  listApiSecurity: (id: string) =>
    fetch(`/api/api-test/projects/${id}/security`).then((r) => json<ApiSecurityScheme[]>(r)),
  saveApiAuth: (
    id: string,
    body: {
      scheme_name: string
      type?: string
      client_id?: string
      client_secret?: string
      username?: string
      password?: string
      api_key?: string
      bearer_token?: string
      access_token?: string
      refresh_token?: string
      scope?: string
      redirect_uri?: string
    },
  ) =>
    fetch(`/api/api-test/projects/${id}/auth`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) =>
      json<{
        scheme_name: string
        configured: boolean
        scheme_type?: string
        security?: ApiSecurityScheme[]
      }>(r),
    ),
  testApiConnection: (id: string, scheme_name?: string) =>
    fetch(`/api/api-test/projects/${id}/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheme_name: scheme_name || undefined }),
    }).then((r) =>
      json<{
        ok: boolean
        reachable: boolean
        auth_applied: boolean
        auth_ok: boolean | null
        status_code: number | null
        latency_ms: number
        url: string
        method: string
        scheme_name?: string | null
        message: string
        error?: string | null
        body_preview?: string
        base_url?: string
      }>(r),
    ),
  exchangeApiToken: (
    id: string,
    body: { scheme_name: string; grant?: string; code?: string; redirect_uri?: string },
  ) =>
    fetch(`/api/api-test/projects/${id}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<{ ok: boolean; has_access_token?: boolean }>(r)),
  getApiAuthorizeUrl: (
    id: string,
    body: { scheme_name: string; redirect_uri: string; state?: string },
  ) =>
    fetch(`/api/api-test/projects/${id}/auth/authorize-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<{ authorize_url: string }>(r)),
  apiOAuthCallback: (
    id: string,
    body: { scheme_name: string; code: string; redirect_uri: string; state?: string },
  ) =>
    fetch(`/api/api-test/projects/${id}/oauth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<{ ok: boolean }>(r)),
  generateApiFlows: (id: string) =>
    fetch(`/api/api-test/projects/${id}/generate`, { method: 'POST' }).then((r) =>
      json<{
        count: number
        flows: ApiFlow[]
        spectrum?: Record<string, number>
        llm_used?: boolean
        ai_flows?: number
        ai_steps?: number
        ai_batches?: number
        ai_journeys?: number
        bodies_filled?: number
        source?: string
      }>(r),
    ),
  listApiFlows: (id: string) =>
    fetch(`/api/api-test/projects/${id}/flows`).then((r) => json<ApiFlow[]>(r)),
  startApiRun: (id: string, flow_ids?: string[]) =>
    fetch(`/api/api-test/projects/${id}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow_ids }),
    }).then((r) => json<ApiRun>(r)),
  getApiSchedule: (id: string) =>
    fetch(`/api/api-test/projects/${id}/schedule`).then((r) => json<ApiProjectSchedule>(r)),
  saveApiSchedule: (
    id: string,
    body: { enabled: boolean; schedule?: SchedulePreset; flow_ids?: string[] | null },
  ) =>
    fetch(`/api/api-test/projects/${id}/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<ApiProjectSchedule>(r)),
  runApiScheduleNow: (id: string) =>
    fetch(`/api/api-test/projects/${id}/schedule/run`, { method: 'POST' }).then((r) =>
      json<{ ok: boolean; run_id?: string | null; schedule: ApiProjectSchedule }>(r),
    ),
  listApiHistory: (id: string) =>
    fetch(`/api/api-test/projects/${id}/history`).then((r) => json<ApiRun[]>(r)),
  deleteApiRun: (projectId: string, runId: string) =>
    fetch(`/api/api-test/projects/${projectId}/runs/${runId}`, { method: 'DELETE' }).then((r) =>
      json<{ ok: boolean; id: string }>(r),
    ),
  clearApiHistory: (projectId: string) =>
    fetch(`/api/api-test/projects/${projectId}/history`, { method: 'DELETE' }).then((r) =>
      json<{ ok: boolean; deleted: number }>(r),
    ),
  getApiOverview: (id: string) =>
    fetch(`/api/api-test/projects/${id}/overview`).then((r) => json<ApiOverview>(r)),
  listApiAnomalies: (id: string) =>
    fetch(`/api/api-test/projects/${id}/anomalies`).then((r) => json<ApiAnomaly[]>(r)),
  getApiRun: (runId: string) =>
    fetch(`/api/api-test/runs/${runId}`).then((r) => json<ApiRun>(r)),
  getApiRunSteps: (runId: string) =>
    fetch(`/api/api-test/runs/${runId}/steps`).then((r) => json<ApiRunStep[]>(r)),
  getApiRunInsights: (runId: string) =>
    fetch(`/api/api-test/runs/${runId}/insights`).then((r) =>
      json<{
        run_id: string
        cached: boolean
        insights: NonNullable<ApiRun['summary']['insights']> & {
          recommendations?: string[]
        }
      }>(r),
    ),
  getApiRunReport: (runId: string) =>
    fetch(`/api/api-test/runs/${runId}/report`).then((r) =>
      json<{
        run_id: string
        status: string
        summary: Record<string, unknown>
        insights?: NonNullable<ApiRun['summary']['insights']>
        report_html?: string
        allure_results?: string
        report_dir?: string
        report_url?: string
        has_report?: boolean
      }>(r),
    ),
  apiRunReportViewUrl: (runId: string) => `/api/api-test/runs/${runId}/report/view`,
  apiRunReportDownloadUrl: (runId: string) => `/api/api-test/runs/${runId}/report/download`,
}
