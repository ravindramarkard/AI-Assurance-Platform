import { useEffect, useState, type CSSProperties } from 'react'
import { api, type AppSettings, type BrowserEngine } from '../api'
import {
  FONT_LABEL_KEYS,
  FONT_OPTIONS,
  FONT_SIZE_LABEL_KEYS,
  FONT_SIZE_OPTIONS,
  THEME_OPTIONS,
  THEME_SWATCHES,
  usePreferences,
  type Locale,
  type ThemeMode,
  type UiFont,
  type UiFontSize,
} from '../preferences'

type Props = {
  settings: AppSettings | null
  onSaved: (s: AppSettings) => void
}

type FormState = {
  llm_provider: string
  llm_base_url: string
  llm_model: string
  llm_api_key: string
  browser_use_api_key: string
  openai_api_key: string
  anthropic_api_key: string
  headless: boolean
  browser_engine: BrowserEngine
  browser_executable: string
  application_url: string
  max_concurrent_agents: number
  atlassian_deployment: 'server' | 'cloud'
  jira_base_url: string
  jira_email: string
  jira_api_token: string
  jira_project_key: string
  confluence_base_url: string
  confluence_space_key: string
  keycloak_enabled: boolean
  keycloak_base_url: string
  keycloak_realm: string
  keycloak_client_id: string
  keycloak_client_secret: string
  keycloak_username: string
  keycloak_password: string
  keycloak_redirect_uri: string
}

export default function SettingsPanel({ settings, onSaved }: Props) {
  const { theme, setTheme, locale, setLocale, font, setFont, fontSize, setFontSize, t } =
    usePreferences()
  const [form, setForm] = useState<FormState>({
    llm_provider: 'local',
    llm_base_url: 'http://localhost:1234/v1',
    llm_model: 'local-model',
    llm_api_key: '',
    browser_use_api_key: '',
    openai_api_key: '',
    anthropic_api_key: '',
    headless: true,
    browser_engine: 'chromium',
    browser_executable: '',
    application_url: '',
    max_concurrent_agents: 2,
    atlassian_deployment: 'server',
    jira_base_url: '',
    jira_email: '',
    jira_api_token: '',
    jira_project_key: '',
    confluence_base_url: '',
    confluence_space_key: '',
    keycloak_enabled: false,
    keycloak_base_url: '',
    keycloak_realm: '',
    keycloak_client_id: '',
    keycloak_client_secret: '',
    keycloak_username: '',
    keycloak_password: '',
    keycloak_redirect_uri: '',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [testMsg, setTestMsg] = useState('')
  const [keycloakTestMsg, setKeycloakTestMsg] = useState('')

  useEffect(() => {
    if (!settings) return
    const engine = (settings.browser_engine || 'chromium') as BrowserEngine
    setForm((f) => ({
      ...f,
      llm_provider: settings.llm_provider || 'local',
      llm_base_url: settings.llm_base_url || f.llm_base_url,
      llm_model: settings.llm_model || f.llm_model,
      headless: settings.headless,
      browser_engine: ['chromium', 'chrome', 'custom'].includes(engine) ? engine : 'chromium',
      browser_executable: settings.browser_executable || '',
      application_url: settings.application_url || '',
      max_concurrent_agents: Math.max(1, Math.min(8, Number(settings.max_concurrent_agents) || 2)),
      atlassian_deployment:
        settings.atlassian_deployment === 'cloud' ? 'cloud' : 'server',
      jira_base_url: settings.jira_base_url || '',
      jira_email: settings.jira_email || '',
      jira_project_key: settings.jira_project_key || '',
      confluence_base_url: settings.confluence_base_url || '',
      confluence_space_key: settings.confluence_space_key || '',
      keycloak_enabled: !!settings.keycloak_enabled,
      keycloak_base_url: settings.keycloak_base_url || '',
      keycloak_realm: settings.keycloak_realm || '',
      keycloak_client_id: settings.keycloak_client_id || '',
      keycloak_username: settings.keycloak_username || '',
      keycloak_redirect_uri: settings.keycloak_redirect_uri || '',
    }))
    const th = settings.ui_theme === 'contrast' ? 'light' : settings.ui_theme
    if (th && (THEME_OPTIONS as string[]).includes(th)) setTheme(th as ThemeMode)
    const loc = settings.ui_locale
    if (loc === 'en' || loc === 'ar' || loc === 'hi') setLocale(loc)
  }, [settings, setTheme, setLocale])

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const body: Record<string, unknown> = {
        llm_provider: form.llm_provider,
        llm_base_url: form.llm_base_url,
        llm_model: form.llm_model,
        headless: form.headless,
        browser_engine: form.browser_engine,
        browser_executable: form.browser_executable.trim(),
        application_url: form.application_url.trim(),
        max_concurrent_agents: Math.max(1, Math.min(8, Number(form.max_concurrent_agents) || 2)),
        ui_theme: theme,
        ui_locale: locale,
        atlassian_deployment: form.atlassian_deployment,
        jira_base_url: form.jira_base_url.trim(),
        jira_email: form.jira_email.trim(),
        jira_project_key: form.jira_project_key.trim(),
        confluence_base_url: form.confluence_base_url.trim(),
        confluence_space_key: form.confluence_space_key.trim(),
        keycloak_enabled: form.keycloak_enabled,
        keycloak_base_url: form.keycloak_base_url.trim(),
        keycloak_realm: form.keycloak_realm.trim(),
        keycloak_client_id: form.keycloak_client_id.trim(),
        keycloak_username: form.keycloak_username.trim(),
        keycloak_redirect_uri: form.keycloak_redirect_uri.trim(),
      }
      if (form.llm_api_key && !form.llm_api_key.includes('••')) body.llm_api_key = form.llm_api_key
      if (form.browser_use_api_key && !form.browser_use_api_key.includes('••'))
        body.browser_use_api_key = form.browser_use_api_key
      if (form.openai_api_key && !form.openai_api_key.includes('••')) body.openai_api_key = form.openai_api_key
      if (form.anthropic_api_key && !form.anthropic_api_key.includes('••'))
        body.anthropic_api_key = form.anthropic_api_key
      if (form.jira_api_token && !form.jira_api_token.includes('••'))
        body.jira_api_token = form.jira_api_token
      if (form.keycloak_password && !form.keycloak_password.includes('••'))
        body.keycloak_password = form.keycloak_password
      if (form.keycloak_client_secret && !form.keycloak_client_secret.includes('••'))
        body.keycloak_client_secret = form.keycloak_client_secret
      const s = await api.updateSettings(body)
      onSaved(s)
      setMsg(t('saved'))
      setForm((f) => ({
        ...f,
        llm_api_key: '',
        browser_use_api_key: '',
        openai_api_key: '',
        anthropic_api_key: '',
        jira_api_token: '',
        keycloak_password: '',
        keycloak_client_secret: '',
        browser_engine: (s.browser_engine as BrowserEngine) || f.browser_engine,
        browser_executable: s.browser_executable || '',
        application_url: s.application_url || '',
        max_concurrent_agents: Math.max(1, Math.min(8, Number(s.max_concurrent_agents) || 2)),
        atlassian_deployment:
          s.atlassian_deployment === 'cloud' ? 'cloud' : 'server',
        jira_base_url: s.jira_base_url || '',
        jira_email: s.jira_email || '',
        jira_project_key: s.jira_project_key || '',
        confluence_base_url: s.confluence_base_url || '',
        confluence_space_key: s.confluence_space_key || '',
        keycloak_enabled: !!s.keycloak_enabled,
        keycloak_base_url: s.keycloak_base_url || '',
        keycloak_realm: s.keycloak_realm || '',
        keycloak_client_id: s.keycloak_client_id || '',
        keycloak_username: s.keycloak_username || '',
        keycloak_redirect_uri: s.keycloak_redirect_uri || '',
      }))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const themes = THEME_OPTIONS.map((value) => ({
    value,
    label: t(THEME_SWATCHES[value].labelKey),
    swatch: THEME_SWATCHES[value],
  }))
  const locales: { value: Locale; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'ar', label: 'العربية' },
    { value: 'hi', label: 'हिन्दी' },
  ]

  const field = (label: string, key: keyof FormState, type = 'text', placeholder = '') => (
    <label className="block mb-4">
      <span className="text-xs text-slate-400 block mb-1">{label}</span>
      <input
        type={type}
        value={String(form[key] ?? '')}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500"
      />
    </label>
  )

  const detected = settings?.detected_browsers
  const engineStatus = (engine: BrowserEngine): string => {
    if (engine === 'chromium') {
      const path = detected?.headless_shell || detected?.chromium
      return path ? `Found: ${path}` : 'Not found — run: cd backend && uv run browser-use install'
    }
    if (engine === 'chrome') {
      return detected?.chrome
        ? `Found: ${detected.chrome}`
        : 'Google Chrome not found in the usual install locations'
    }
    return 'Provide the full path to a Chrome/Chromium binary'
  }

  const engines: { value: BrowserEngine; label: string; detail: string }[] = [
    { value: 'chromium', label: 'Chromium', detail: 'Playwright / recommended' },
    { value: 'chrome', label: 'Local Chrome', detail: 'Installed Google Chrome' },
    { value: 'custom', label: 'Custom path', detail: 'Your own Chrome/Chromium binary' },
  ]

  const providers: { value: string; label: string }[] = [
    { value: 'local', label: 'Local (LM Studio / Ollama)' },
    { value: 'browser_use', label: 'Browser Use Cloud' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
  ]

  return (
    <main className="flex-1 p-8 bg-ink-900 overflow-y-auto scroll">
      <h1 className="text-lg font-semibold mb-1">{t('settingsTitle')}</h1>
      <p className="text-sm text-slate-400 mb-6">{t('settingsBlurb')}</p>

      <div className="max-w-lg">
        <div className="mb-6 border border-line rounded-xl p-4 bg-ink-850">
          <h2 className="text-sm font-medium text-slate-200 mb-3">{t('appearance')}</h2>
          <fieldset className="block mb-4">
            <legend className="text-xs text-slate-400 block mb-1.5">{t('theme')}</legend>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label={t('theme')}>
              {themes.map((opt) => {
                const active = theme === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setTheme(opt.value)
                      void api
                        .updateSettings({ ui_theme: opt.value })
                        .then((s) => onSaved(s))
                        .catch(() => {})
                    }}
                    className={`text-left px-2.5 py-2 rounded-lg border transition-colors ${
                      active
                        ? 'border-bu-500 bg-bu-500/10 ring-1 ring-bu-500/40'
                        : 'border-line bg-ink-800 hover:border-slate-600'
                    }`}
                  >
                    <div
                      className="theme-swatch mb-1.5"
                      style={
                        {
                          '--swatch-bg': opt.swatch.bg,
                          '--swatch-accent': opt.swatch.accent,
                          '--swatch-fg': opt.swatch.fg,
                        } as CSSProperties
                      }
                    />
                    <div className={`text-[12px] font-medium ${active ? 'text-bu-400' : 'text-slate-300'}`}>
                      {opt.label}
                    </div>
                  </button>
                )
              })}
            </div>
          </fieldset>
          <fieldset className="block mb-4">
            <legend className="text-xs text-slate-400 block mb-1.5">{t('uiFont')}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('uiFont')}>
              {FONT_OPTIONS.map((value) => {
                const active = font === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setFont(value as UiFont)}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      active
                        ? 'border-bu-500 bg-bu-500/10 text-bu-400'
                        : 'border-line bg-ink-800 text-slate-300 hover:border-slate-600'
                    }`}
                    style={{
                      fontFamily:
                        value === 'inter'
                          ? 'Inter, sans-serif'
                          : value === 'system'
                            ? 'system-ui, sans-serif'
                            : value === 'source'
                              ? '"Source Sans 3", sans-serif'
                              : value === 'plex'
                                ? '"IBM Plex Sans", sans-serif'
                                : value === 'serif'
                                  ? 'Georgia, serif'
                                  : '"JetBrains Mono", monospace',
                    }}
                  >
                    {t(FONT_LABEL_KEYS[value])}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <fieldset className="block mb-4">
            <legend className="text-xs text-slate-400 block mb-1.5">{t('uiFontSize')}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('uiFontSize')}>
              {FONT_SIZE_OPTIONS.map((value) => {
                const active = fontSize === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setFontSize(value as UiFontSize)}
                    className={`px-3 py-1.5 rounded-md border transition-colors ${
                      active
                        ? 'border-bu-500 bg-bu-500/10 text-bu-400'
                        : 'border-line bg-ink-800 text-slate-300 hover:border-slate-600'
                    }`}
                    style={{
                      fontSize:
                        value === 'sm' ? 12 : value === 'md' ? 14 : value === 'lg' ? 16 : 18,
                    }}
                  >
                    {t(FONT_SIZE_LABEL_KEYS[value])}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <fieldset className="block mb-1">
            <legend className="text-xs text-slate-400 block mb-1.5">{t('language')}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('language')}>
              {locales.map((opt) => {
                const active = locale === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setLocale(opt.value)}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      active
                        ? 'border-bu-500 bg-bu-500/10 text-bu-400'
                        : 'border-line bg-ink-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <p className="mt-2 text-[11px] text-slate-500">{t('appearanceHint')}</p>
        </div>

        <fieldset className="block mb-4">
          <legend className="text-xs text-slate-400 block mb-1.5">{t('provider')}</legend>
          <div className="space-y-1.5" role="radiogroup" aria-label="Provider">
            {providers.map((p) => {
              const active = form.llm_provider === p.value
              return (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setForm({ ...form, llm_provider: p.value })}
                  className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                    active
                      ? 'border-bu-500 bg-bu-500/10 text-slate-100'
                      : 'border-line bg-ink-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </fieldset>

        {form.llm_provider === 'local' && (
          <>
            {field('Base URL', 'llm_base_url')}
            {field('API key (any non-empty for LM Studio)', 'llm_api_key', 'password', 'lm-studio')}
          </>
        )}
        {form.llm_provider === 'browser_use' &&
          field('Browser Use API key', 'browser_use_api_key', 'password', settings?.browser_use_api_key || '')}
        {form.llm_provider === 'openai' &&
          field('OpenAI API key', 'openai_api_key', 'password', settings?.openai_api_key || '')}
        {form.llm_provider === 'anthropic' &&
          field('Anthropic API key', 'anthropic_api_key', 'password', settings?.anthropic_api_key || '')}

        {field(t('model'), 'llm_model')}

        <div className="mb-6 border-t border-line pt-5">
          <h2 className="text-sm font-medium text-slate-200 mb-3">{t('applicationUrl')}</h2>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('defaultStartUrl')}</span>
            <input
              type="url"
              value={form.application_url}
              placeholder="https://duckduckgo.com"
              onChange={(e) => setForm({ ...form, application_url: e.target.value })}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono text-xs"
            />
          </label>
          <p className="text-[11px] text-slate-500 mb-1">
            Used only when the task has no destination (no{' '}
            <span className="text-slate-400">https://</span> link and no{' '}
            <span className="text-slate-400">go to google.com</span>-style host). Tasks that name a
            site open that site directly — Application URL is skipped. Override for a single run with{' '}
            <span className="text-slate-400">Runtime URL</span> on the home screen.
          </p>
        </div>

        <div className="mb-6 border-t border-line pt-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 className="text-sm font-medium text-slate-200">{t('keycloakTitle')}</h2>
            {settings?.keycloak_configured && (
              <span className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold">
                {t('configured')}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mb-3">{t('keycloakBlurb')}</p>
          <label className="flex items-center gap-2 mb-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.keycloak_enabled}
              onChange={(e) => setForm({ ...form, keycloak_enabled: e.target.checked })}
              className="rounded border-line"
            />
            {t('keycloakEnable')}
          </label>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('keycloakBaseUrl')}</span>
            <input
              type="url"
              value={form.keycloak_base_url}
              placeholder="https://auth.company.com"
              disabled={!form.keycloak_enabled}
              onChange={(e) => setForm({ ...form, keycloak_base_url: e.target.value })}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono text-xs disabled:opacity-50"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
            <label className="block">
              <span className="text-xs text-slate-400 block mb-1">{t('keycloakRealm')}</span>
              <input
                type="text"
                value={form.keycloak_realm}
                placeholder="myrealm"
                disabled={!form.keycloak_enabled}
                onChange={(e) => setForm({ ...form, keycloak_realm: e.target.value })}
                className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400 block mb-1">{t('keycloakClientId')}</span>
              <input
                type="text"
                value={form.keycloak_client_id}
                placeholder="my-app"
                disabled={!form.keycloak_enabled}
                onChange={(e) => setForm({ ...form, keycloak_client_id: e.target.value })}
                className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 disabled:opacity-50"
              />
            </label>
          </div>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('keycloakClientSecret')}</span>
            <input
              type="password"
              value={form.keycloak_client_secret}
              placeholder={
                settings?.has_keycloak_client_secret ? '••••••••' : t('keycloakClientSecretHint')
              }
              disabled={!form.keycloak_enabled}
              onChange={(e) => setForm({ ...form, keycloak_client_secret: e.target.value })}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono text-xs disabled:opacity-50"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
            <label className="block">
              <span className="text-xs text-slate-400 block mb-1">{t('keycloakUsername')}</span>
              <input
                type="text"
                value={form.keycloak_username}
                placeholder="test.user"
                disabled={!form.keycloak_enabled}
                onChange={(e) => setForm({ ...form, keycloak_username: e.target.value })}
                className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400 block mb-1">{t('keycloakPassword')}</span>
              <input
                type="password"
                value={form.keycloak_password}
                placeholder={settings?.has_keycloak_password ? '••••••••' : ''}
                disabled={!form.keycloak_enabled}
                onChange={(e) => setForm({ ...form, keycloak_password: e.target.value })}
                className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono text-xs disabled:opacity-50"
              />
            </label>
          </div>
          <label className="block mb-3">
            <span className="text-xs text-slate-400 block mb-1">{t('keycloakRedirectUri')}</span>
            <input
              type="url"
              value={form.keycloak_redirect_uri}
              placeholder={form.application_url || 'https://app.company.com (optional)'}
              disabled={!form.keycloak_enabled}
              onChange={(e) => setForm({ ...form, keycloak_redirect_uri: e.target.value })}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono text-xs disabled:opacity-50"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">{t('keycloakRedirectHint')}</span>
          </label>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md border border-line text-xs text-slate-300 hover:border-bu-500/50 disabled:opacity-40"
            disabled={!form.keycloak_enabled}
            onClick={() => {
              setKeycloakTestMsg('')
              void api
                .testIntegration('keycloak')
                .then((r) => {
                  const info = r as { realm?: string; client_id?: string; expires_in?: number }
                  setKeycloakTestMsg(
                    `Keycloak OK${info.realm ? ` — realm ${info.realm}` : ''}${
                      info.expires_in ? ` · token ${info.expires_in}s` : ''
                    }`,
                  )
                })
                .catch((e) =>
                  setKeycloakTestMsg(e instanceof Error ? e.message : String(e)),
                )
            }}
          >
            {t('testKeycloak')}
          </button>
          {keycloakTestMsg && (
            <p className="text-[11px] text-slate-400 mt-2 break-all">{keycloakTestMsg}</p>
          )}
          <p className="text-[10px] text-slate-500 mt-2">{t('keycloakTestHint')}</p>
        </div>

        <div className="mb-6 border-t border-line pt-5">
          <h2 className="text-sm font-medium text-slate-200 mb-3">{t('concurrency')}</h2>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('maxAgents')}</span>
            <input
              type="number"
              min={1}
              max={8}
              value={form.max_concurrent_agents}
              onChange={(e) =>
                setForm({
                  ...form,
                  max_concurrent_agents: Math.max(1, Math.min(8, Number(e.target.value) || 1)),
                })
              }
              className="w-28 bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500"
            />
          </label>
          <p className="text-[11px] text-slate-500">
            With 1, a new agent stays <span className="text-slate-400">queued</span> until the current one
            finishes. Raise to 2+ to run multiple agents in parallel.
          </p>
        </div>

        <div className="mb-6 border-t border-line pt-5">
          <h2 className="text-sm font-medium text-slate-200 mb-1">{t('atlassianTitle')}</h2>
          <p className="text-[11px] text-slate-500 mb-3">{t('atlassianBlurb')}</p>
          <fieldset className="block mb-3">
            <legend className="text-xs text-slate-400 block mb-1.5">{t('atlassianDeployment')}</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: 'server' as const, label: t('atlassianServer') },
                  { value: 'cloud' as const, label: t('atlassianCloud') },
                ]
              ).map((opt) => {
                const active = form.atlassian_deployment === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setForm({ ...form, atlassian_deployment: opt.value })}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      active
                        ? 'border-bu-500 bg-bu-500/10 text-bu-400'
                        : 'border-line bg-ink-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {form.atlassian_deployment === 'server'
                ? t('atlassianServerHint')
                : t('atlassianCloudHint')}
            </p>
          </fieldset>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('jiraSiteUrl')}</span>
            <input
              type="url"
              value={form.jira_base_url}
              placeholder={
                form.atlassian_deployment === 'server'
                  ? 'https://jira.company.com'
                  : 'https://your-domain.atlassian.net'
              }
              onChange={(e) => setForm({ ...form, jira_base_url: e.target.value })}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono text-xs"
            />
          </label>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">
              {form.atlassian_deployment === 'server' ? t('atlassianUsername') : t('atlassianEmail')}
            </span>
            <input
              type="text"
              value={form.jira_email}
              placeholder={
                form.atlassian_deployment === 'server' ? 'jdoe' : 'you@company.com'
              }
              onChange={(e) => setForm({ ...form, jira_email: e.target.value })}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500"
            />
          </label>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">
              {form.atlassian_deployment === 'server'
                ? t('atlassianPasswordOrPat')
                : t('atlassianApiToken')}
            </span>
            <input
              type="password"
              value={form.jira_api_token}
              placeholder={
                settings?.has_jira_api_token
                  ? '••••••••'
                  : form.atlassian_deployment === 'server'
                    ? 'Password or personal access token'
                    : 'API token'
              }
              onChange={(e) => setForm({ ...form, jira_api_token: e.target.value })}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono text-xs"
            />
          </label>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('jiraProjectKey')}</span>
            <input
              type="text"
              value={form.jira_project_key}
              placeholder="PROJ"
              onChange={(e) => setForm({ ...form, jira_project_key: e.target.value })}
              className="w-40 bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono uppercase"
            />
          </label>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('confluenceSiteUrl')}</span>
            <input
              type="url"
              value={form.confluence_base_url}
              placeholder="Same as Jira if empty"
              onChange={(e) => setForm({ ...form, confluence_base_url: e.target.value })}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono text-xs"
            />
          </label>
          <label className="block mb-3">
            <span className="text-xs text-slate-400 block mb-1">{t('confluenceSpaceKey')}</span>
            <input
              type="text"
              value={form.confluence_space_key}
              placeholder="TEAM"
              onChange={(e) => setForm({ ...form, confluence_space_key: e.target.value })}
              className="w-40 bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono"
            />
          </label>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              className="px-3 py-1.5 rounded-md border border-line text-xs text-slate-300 hover:border-bu-500/50"
              onClick={() => {
                setTestMsg('')
                void api
                  .testIntegration('jira')
                  .then((r) => setTestMsg(`Jira OK${r.display_name ? ` — ${r.display_name}` : ''}`))
                  .catch((e) => setTestMsg(e instanceof Error ? e.message : String(e)))
              }}
            >
              {t('testJira')}
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md border border-line text-xs text-slate-300 hover:border-bu-500/50"
              onClick={() => {
                setTestMsg('')
                void api
                  .testIntegration('confluence')
                  .then((r) =>
                    setTestMsg(`Confluence OK${r.display_name ? ` — ${r.display_name}` : ''}`),
                  )
                  .catch((e) => setTestMsg(e instanceof Error ? e.message : String(e)))
              }}
            >
              {t('testConfluence')}
            </button>
            {testMsg && <span className="text-[11px] text-slate-400 break-all">{testMsg}</span>}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{t('chatLogHint')}</p>
        </div>

        <div className="mb-6 border-t border-line pt-5">
          <h2 className="text-sm font-medium text-slate-200 mb-3">{t('browser')}</h2>

          <fieldset className="block mb-4">
            <legend className="text-xs text-slate-400 block mb-1.5">{t('browserEngine')}</legend>
            <div className="space-y-1.5" role="radiogroup" aria-label={t('browserEngine')}>
              {engines.map((e) => {
                const active = form.browser_engine === e.value
                return (
                  <button
                    key={e.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setForm({ ...form, browser_engine: e.value })}
                    className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors ${
                      active
                        ? 'border-bu-500 bg-bu-500/10'
                        : 'border-line bg-ink-800 hover:border-slate-600'
                    }`}
                  >
                    <div className={`text-sm ${active ? 'text-slate-100' : 'text-slate-300'}`}>
                      {e.label}
                      <span className="text-slate-500 font-normal"> — {e.detail}</span>
                    </div>
                    {active && (
                      <div className="mt-1 text-[11px] text-slate-500 break-all">
                        {engineStatus(e.value)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {form.browser_engine === 'custom' && (
            <label className="block mb-4">
              <span className="text-xs text-slate-400 block mb-1">Browser executable</span>
              <input
                type="text"
                value={form.browser_executable}
                placeholder="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                onChange={(e) => setForm({ ...form, browser_executable: e.target.value })}
                className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 font-mono text-xs"
              />
            </label>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.headless}
              onChange={(e) => setForm({ ...form, headless: e.target.checked })}
            />
            {t('headless')}
          </label>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Chromium uses headless-shell when available. Local Chrome / custom use{' '}
            <code className="text-slate-400">--headless=new</code>.
          </p>
        </div>

        <button
          onClick={() => void save()}
          disabled={saving}
          className="bg-bu-500 hover:bg-bu-600 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-md text-sm"
        >
          {saving ? t('saving') : t('saveSettings')}
        </button>
        {msg && <span className="ml-3 text-xs text-slate-400">{msg}</span>}

        <div className="mt-8 text-xs text-slate-500 space-y-2 border-t border-line pt-4">
          <p>Local models need tool/function calling and context ≥ 16k.</p>
          <p>
            Or edit <code className="text-slate-400">backend/.env</code> and restart the API.
          </p>
        </div>
      </div>
    </main>
  )
}
