import { useEffect, useState, type CSSProperties } from 'react'
import { api, type AppSettings } from '../api'
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
  llm_vision_mode: 'auto' | 'on' | 'off'
  llm_temperature: number
  browser_use_api_key: string
  openai_api_key: string
  anthropic_api_key: string
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

type SettingsSection = 'appearance' | 'consoles' | 'llm' | 'keycloak' | 'atlassian'

export default function SettingsPanel({ settings, onSaved }: Props) {
  const {
    theme,
    setTheme,
    locale,
    setLocale,
    font,
    setFont,
    fontSize,
    setFontSize,
    consoles,
    setConsoleEnabled,
    t,
  } = usePreferences()
  const [form, setForm] = useState<FormState>({
    llm_provider: 'local',
    llm_base_url: 'http://localhost:1234/v1',
    llm_model: 'local-model',
    llm_api_key: '',
    llm_vision_mode: 'auto',
    llm_temperature: 0.1,
    browser_use_api_key: '',
    openai_api_key: '',
    anthropic_api_key: '',
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
  const [llmTestMsg, setLlmTestMsg] = useState('')
  const [llmTesting, setLlmTesting] = useState(false)
  const [keycloakTestMsg, setKeycloakTestMsg] = useState('')
  const [section, setSection] = useState<SettingsSection>('appearance')

  useEffect(() => {
    if (!settings) return
    const provider =
      settings.llm_provider === 'openai' || settings.llm_provider === 'anthropic'
        ? settings.llm_provider
        : 'local'
    setForm((f) => ({
      ...f,
      llm_provider: provider,
      llm_base_url: settings.llm_base_url || f.llm_base_url,
      llm_model: settings.llm_model || f.llm_model,
      llm_vision_mode:
        settings.llm_vision_mode === 'on' || settings.llm_vision_mode === 'off'
          ? settings.llm_vision_mode
          : 'auto',
      llm_temperature:
        typeof settings.llm_temperature === 'number' ? settings.llm_temperature : 0.1,
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
        llm_temperature: form.llm_temperature,
        llm_vision_mode: form.llm_vision_mode,
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

  const providers: { value: string; label: string }[] = [
    { value: 'local', label: 'Local (LM Studio / Ollama)' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
  ]

  const testLlmConnection = async () => {
    setLlmTesting(true)
    setLlmTestMsg('')
    try {
      const body: Record<string, string> = {
        llm_provider: form.llm_provider,
        llm_model: form.llm_model,
      }
      if (form.llm_provider === 'local') {
        body.llm_base_url = form.llm_base_url
        if (form.llm_api_key && !form.llm_api_key.includes('••')) body.llm_api_key = form.llm_api_key
      }
      if (form.llm_provider === 'openai' && form.openai_api_key && !form.openai_api_key.includes('••')) {
        body.openai_api_key = form.openai_api_key
      }
      if (
        form.llm_provider === 'anthropic' &&
        form.anthropic_api_key &&
        !form.anthropic_api_key.includes('••')
      ) {
        body.anthropic_api_key = form.anthropic_api_key
      }
      const r = await api.testLlm({ ...body, llm_vision_mode: form.llm_vision_mode })
      const visionBit =
        typeof r.vision_supported === 'boolean'
          ? r.vision_supported
            ? ` · ${t('llmVisionAvailable')}`
            : ` · ${t('llmVisionUnsupported')}`
          : ''
      setLlmTestMsg(
        r.ok
          ? `${t('llmConnectionOk')}${r.model ? ` — ${r.model}` : ''}${
              r.reply ? ` · “${r.reply.slice(0, 80)}”` : ''
            }${visionBit}`
          : t('llmConnectionFailed'),
      )
      try {
        const s = await api.getSettings()
        onSaved(s)
      } catch {
        /* ignore refresh errors */
      }
    } catch (e) {
      let err = e instanceof Error ? e.message : t('llmConnectionFailed')
      try {
        const parsed = JSON.parse(err) as { detail?: unknown }
        if (typeof parsed.detail === 'string') err = parsed.detail
      } catch {
        /* keep raw */
      }
      setLlmTestMsg(err)
    } finally {
      setLlmTesting(false)
    }
  }

  const statusClass = (text: string) => {
    const lower = text.toLowerCase()
    if (
      lower.includes('fail') ||
      lower.includes('error') ||
      lower.includes('unable') ||
      lower.includes('invalid')
    ) {
      return 'text-rose-400'
    }
    if (
      lower.includes('ok') ||
      lower.includes('success') ||
      lower.startsWith('jira ok') ||
      lower.startsWith('confluence ok')
    ) {
      return 'text-emerald-400'
    }
    return 'text-slate-400'
  }

  const navItems: { id: SettingsSection; label: string; blurb: string }[] = [
    { id: 'appearance', label: t('appearance'), blurb: t('appearanceHint') },
    { id: 'consoles', label: t('consolesSection'), blurb: t('consolesSectionHint') },
    { id: 'llm', label: t('settingsNavLlm'), blurb: t('settingsLlmBlurb') },
    { id: 'keycloak', label: t('keycloakTitle'), blurb: t('keycloakBlurb') },
    { id: 'atlassian', label: t('atlassianTitle'), blurb: t('atlassianBlurb') },
  ]
  const activeNav = navItems.find((n) => n.id === section) || navItems[0]

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-ink-900">
      <div className="flex-1 min-h-0 overflow-y-auto scroll">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 pt-8 pb-4">
          <header className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              {t('settingsTitle')}
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">{t('settingsBlurb')}</p>
          </header>

          <div className="md:hidden flex gap-2 overflow-x-auto pb-3 mb-2 -mx-1 px-1">
            {navItems.map((item) => {
              const active = section === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                    active
                      ? 'border-bu-500 bg-bu-500/15 text-bu-400'
                      : 'border-line bg-ink-850 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
          </div>

          <div className="flex gap-6 items-start">
            <nav
              className="hidden md:block w-48 shrink-0 sticky top-4"
              aria-label={t('settingsTitle')}
            >
              <ul className="space-y-0.5">
                {navItems.map((item) => {
                  const active = section === item.id
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSection(item.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors border ${
                          active
                            ? 'border-bu-500/40 bg-bu-500/10 text-slate-100 border-s-[3px] border-s-bu-500'
                            : 'border-transparent text-slate-400 hover:bg-ink-850 hover:text-slate-200'
                        }`}
                      >
                        {item.label}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>

            <div className="flex-1 min-w-0">
              <section className="border border-line rounded-xl bg-ink-850/80 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-line bg-ink-850">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-100">{activeNav.label}</h2>
                      <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
                        {activeNav.blurb}
                      </p>
                    </div>
                    {section === 'keycloak' && settings?.keycloak_configured && (
                      <span className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold shrink-0 mt-0.5">
                        {t('configured')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="px-5 py-5">
                  {section === 'appearance' && (
                    <div>
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
                    </div>
                  )}
                  {section === 'consoles' && (
                    <div>
          <div className="space-y-2.5">
            {(
              [
                {
                  id: 'agentbrowser' as const,
                  label: t('navAgentBrowser'),
                  blurb: t('agentBrowserBlurb'),
                },
                { id: 'a2a' as const, label: t('navA2A'), blurb: t('a2aConsoleBlurb') },
                { id: 'redteam' as const, label: t('navRedTeam'), blurb: t('rtConsoleBlurb') },
                { id: 'apitest' as const, label: t('navApiTest'), blurb: t('apiConsoleBlurb') },
              ] as const
            ).map((item) => (
              <label
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-line bg-ink-800 px-3 py-2.5 cursor-pointer hover:border-slate-600"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent)]"
                  checked={consoles[item.id]}
                  onChange={(e) => setConsoleEnabled(item.id, e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-slate-200">{item.label}</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">{item.blurb}</span>
                </span>
                <span
                  className={`ms-auto text-[11px] font-semibold shrink-0 ${
                    consoles[item.id] ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {consoles[item.id] ? t('consoleEnabled') : t('consoleDisabled')}
                </span>
              </label>
            ))}
          </div>
                    </div>
                  )}
                  {section === 'llm' && (
                    <div>
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
        {form.llm_provider === 'openai' &&
          field('OpenAI API key', 'openai_api_key', 'password', settings?.openai_api_key || '')}
        {form.llm_provider === 'anthropic' &&
          field('Anthropic API key', 'anthropic_api_key', 'password', settings?.anthropic_api_key || '')}

        {field(t('model'), 'llm_model')}

        {(() => {
          const setTemp = (n: number) =>
            setForm({
              ...form,
              llm_temperature: Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.1)),
            })
          const modes: Array<'auto' | 'on' | 'off'> = ['auto', 'on', 'off']
          const modeLabel = (m: 'auto' | 'on' | 'off') =>
            m === 'auto' ? t('llmVisionAuto') : m === 'on' ? t('llmVisionOn') : t('llmVisionOff')
          let status = t('llmVisionNotProbed')
          if (form.llm_vision_mode === 'auto') {
            if (settings?.llm_vision_probe_ok === true) status = t('llmVisionAvailable')
            else if (settings?.llm_vision_probe_ok === false) status = t('llmVisionUnsupported')
          } else if (form.llm_vision_mode === 'on') {
            status = t('llmVisionOn')
          } else {
            status = t('llmVisionOff')
          }
          return (
            <div className="mb-4 space-y-3">
              <div>
                <span className="text-xs text-slate-400 block mb-1.5">{t('llmVision')}</span>
                <div className="flex gap-1.5" role="radiogroup" aria-label={t('llmVision')}>
                  {modes.map((m) => {
                    const active = form.llm_vision_mode === m
                    return (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setForm({ ...form, llm_vision_mode: m })}
                        className={`flex-1 px-2 py-1.5 rounded-md border text-xs transition-colors ${
                          active
                            ? 'border-bu-500 bg-bu-500/10 text-slate-100'
                            : 'border-line bg-ink-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        {modeLabel(m)}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{t('llmVisionHelp')}</p>
                <p className="text-[11px] text-slate-400 mt-1">{status}</p>
                {form.llm_provider === 'local' && form.llm_vision_mode === 'on' && (
                  <p className="text-[11px] text-amber-400/90 mt-1.5">
                    {t('llmVisionLocalWarning')}
                  </p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs text-slate-400">{t('llmTemperature')}</span>
                  <span className="text-[11px] font-mono text-slate-400">
                    {form.llm_temperature.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={form.llm_temperature}
                    onChange={(e) => setTemp(parseFloat(e.target.value))}
                    className="flex-1 accent-bu-500"
                  />
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={form.llm_temperature}
                    onChange={(e) => setTemp(parseFloat(e.target.value))}
                    className="w-20 bg-ink-800 border border-line rounded-md px-2 py-1.5 text-sm outline-none focus:border-bu-500 font-mono"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{t('llmTemperatureHelp')}</p>
              </div>
            </div>
          )
        })()}

        <div className="flex flex-wrap gap-2 items-center mb-6">
          <button
            type="button"
            className="px-3 py-1.5 rounded-md border border-line text-xs text-slate-300 hover:border-bu-500/50 disabled:opacity-40"
            disabled={llmTesting}
            onClick={() => void testLlmConnection()}
          >
            {llmTesting ? t('testingConnection') : t('testConnection')}
          </button>
          {llmTestMsg && (
            <span className={`text-[11px] break-all ${statusClass(llmTestMsg)}`}>{llmTestMsg}</span>
          )}
        </div>
                    </div>
                  )}
                  {section === 'keycloak' && (
                    <div>
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
              placeholder={settings?.application_url || 'https://app.company.com (optional)'}
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
            <p className={`text-[11px] mt-2 break-all ${statusClass(keycloakTestMsg)}`}>
              {keycloakTestMsg}
            </p>
          )}
          <p className="text-[10px] text-slate-500 mt-2">{t('keycloakTestHint')}</p>
                    </div>
                  )}
                  {section === 'atlassian' && (
                    <div>
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
            {testMsg && (
              <span className={`text-[11px] break-all ${statusClass(testMsg)}`}>{testMsg}</span>
            )}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{t('chatLogHint')}</p>
                    </div>
                  )}
                </div>
              </section>
              <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
                Local models need tool/function calling and context ≥ 16k. Or edit{' '}
                <code className="text-slate-400">backend/.env</code> and restart the API.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-ink-900/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-3 flex flex-wrap items-center gap-3 md:ps-[13.5rem]">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="bg-bu-500 hover:bg-bu-600 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-md text-sm"
          >
            {saving ? t('saving') : t('saveSettings')}
          </button>
          {msg && <span className={`text-xs ${statusClass(msg)}`}>{msg}</span>}
        </div>
      </div>
    </main>
  )
}
