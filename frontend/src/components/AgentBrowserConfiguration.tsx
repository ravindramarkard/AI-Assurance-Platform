import { useEffect, useState } from 'react'
import { api, type AppSettings, type BrowserEngine } from '../api'
import { usePreferences } from '../preferences'

export type AgentBrowserConfigurationProps = {
  settings: AppSettings | null
  onSaved: (s: AppSettings) => void
}

type ScreenshotArchive = 'always' | 'on_failure' | 'never'

type ParallelExecutionMode = 'off' | 'auto' | 'always'

type FormState = {
  headless: boolean
  screenshot_archive: ScreenshotArchive
  screenshot_archive_user_set: boolean
  browser_engine: BrowserEngine
  browser_executable: string
  application_url: string
  application_username: string
  application_password: string
  max_concurrent_agents: number
  parallel_execution_mode: ParallelExecutionMode
  max_subagents_per_task: number
}

function defaultArchive(headless: boolean): ScreenshotArchive {
  return headless ? 'on_failure' : 'always'
}

function normalizeArchive(v: unknown, headless: boolean): ScreenshotArchive {
  if (v === 'always' || v === 'on_failure' || v === 'never') return v
  return defaultArchive(headless)
}

function normalizeParallelMode(v: unknown): ParallelExecutionMode {
  if (v === 'off' || v === 'auto' || v === 'always') return v
  return 'auto'
}

export default function AgentBrowserConfiguration({
  settings,
  onSaved,
}: AgentBrowserConfigurationProps) {
  const { t } = usePreferences()
  const [form, setForm] = useState<FormState>({
    headless: true,
    screenshot_archive: 'on_failure',
    screenshot_archive_user_set: false,
    browser_engine: 'chromium',
    browser_executable: '',
    application_url: '',
    application_username: '',
    application_password: '',
    max_concurrent_agents: 2,
    parallel_execution_mode: 'auto',
    max_subagents_per_task: 4,
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!settings) return
    const engine = (settings.browser_engine || 'chromium') as BrowserEngine
    const headless = settings.headless
    setForm({
      headless,
      screenshot_archive: normalizeArchive(settings.screenshot_archive, headless),
      screenshot_archive_user_set: Boolean(settings.screenshot_archive_user_set),
      browser_engine: ['chromium', 'chrome', 'custom'].includes(engine) ? engine : 'chromium',
      browser_executable: settings.browser_executable || '',
      application_url: settings.application_url || '',
      application_username: settings.application_username || '',
      application_password: '',
      max_concurrent_agents: Math.max(1, Math.min(8, Number(settings.max_concurrent_agents) || 2)),
      parallel_execution_mode: normalizeParallelMode(settings.parallel_execution_mode),
      max_subagents_per_task: Math.max(1, Math.min(8, Number(settings.max_subagents_per_task) || 4)),
    })
  }, [settings])

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const body: Record<string, unknown> = {
        application_url: form.application_url.trim(),
        application_username: form.application_username.trim(),
        max_concurrent_agents: Math.max(1, Math.min(8, Number(form.max_concurrent_agents) || 2)),
        parallel_execution_mode: form.parallel_execution_mode,
        max_subagents_per_task: Math.max(1, Math.min(8, Number(form.max_subagents_per_task) || 4)),
        browser_engine: form.browser_engine,
        browser_executable: form.browser_executable.trim(),
        headless: form.headless,
        screenshot_archive: form.screenshot_archive,
        screenshot_archive_user_set: form.screenshot_archive_user_set,
      }
      if (form.application_password && !form.application_password.includes('••')) {
        body.application_password = form.application_password
      }
      const s = await api.updateSettings(body as Parameters<typeof api.updateSettings>[0])
      onSaved(s)
      setMsg(t('saved'))
      const headless = s.headless
      setForm({
        headless,
        screenshot_archive: normalizeArchive(s.screenshot_archive, headless),
        screenshot_archive_user_set: Boolean(s.screenshot_archive_user_set),
        browser_engine: (s.browser_engine as BrowserEngine) || form.browser_engine,
        browser_executable: s.browser_executable || '',
        application_url: s.application_url || '',
        application_username: s.application_username || '',
        application_password: '',
        max_concurrent_agents: Math.max(1, Math.min(8, Number(s.max_concurrent_agents) || 2)),
        parallel_execution_mode: normalizeParallelMode(s.parallel_execution_mode),
        max_subagents_per_task: Math.max(1, Math.min(8, Number(s.max_subagents_per_task) || 4)),
      })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

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

  return (
    <div className="flex-1 overflow-y-auto scroll p-6 min-w-0 bg-ink-950">
      <header className="mb-5 max-w-2xl">
        <h1 className="text-[22px] font-semibold text-slate-100 tracking-tight">
          {t('agentBrowserConfiguration')}
        </h1>
        <p className="text-[13px] text-slate-500 mt-0.5">{t('agentBrowserConfigurationBlurb')}</p>
      </header>

      <div className="max-w-lg">
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
          <label className="block mb-2 mt-3">
            <span className="text-xs text-slate-400 block mb-1">{t('applicationUsername')}</span>
            <input
              type="text"
              autoComplete="username"
              value={form.application_username}
              onChange={(e) => setForm({ ...form, application_username: e.target.value })}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500"
            />
          </label>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('applicationPassword')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={form.application_password}
              placeholder={settings?.has_application_password ? '••••••••' : ''}
              onChange={(e) => setForm({ ...form, application_password: e.target.value })}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500"
            />
          </label>
          <p className="text-[11px] text-slate-500 mb-1">{t('applicationLoginHelp')}</p>
        </div>

        <div className="mb-6 border-t border-line pt-5">
          <h2 className="text-sm font-medium text-slate-200 mb-3">{t('concurrency')}</h2>
          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('parallelExecution')}</span>
            <select
              value={form.parallel_execution_mode}
              onChange={(e) =>
                setForm({
                  ...form,
                  parallel_execution_mode: normalizeParallelMode(e.target.value),
                })
              }
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 text-slate-200"
            >
              <option value="off">{t('parallelExecutionOff')}</option>
              <option value="auto">{t('parallelExecutionAuto')}</option>
              <option value="always">{t('parallelExecutionAlways')}</option>
            </select>
          </label>
          <p className="text-[11px] text-slate-500 mb-3">{t('parallelExecutionHelp')}</p>

          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('maxSubagents')}</span>
            <input
              type="number"
              min={1}
              max={8}
              value={form.max_subagents_per_task}
              onChange={(e) =>
                setForm({
                  ...form,
                  max_subagents_per_task: Math.max(1, Math.min(8, Number(e.target.value) || 1)),
                })
              }
              className="w-28 bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500"
            />
          </label>
          <p className="text-[11px] text-slate-500 mb-3">{t('maxSubagentsHelp')}</p>

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
          <p className="text-[11px] text-slate-500">{t('maxAgentsHelp')}</p>
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
              onChange={(e) => {
                const headless = e.target.checked
                setForm((prev) => ({
                  ...prev,
                  headless,
                  screenshot_archive: prev.screenshot_archive_user_set
                    ? prev.screenshot_archive
                    : defaultArchive(headless),
                }))
              }}
            />
            {t('headless')}
          </label>
          <p className="mt-1.5 text-[11px] text-slate-500 mb-4">
            Chromium uses headless-shell when available. Local Chrome / custom use{' '}
            <code className="text-slate-400">--headless=new</code>.
          </p>

          <label className="block mb-2">
            <span className="text-xs text-slate-400 block mb-1">{t('screenshotArchive')}</span>
            <select
              value={form.screenshot_archive}
              onChange={(e) =>
                setForm({
                  ...form,
                  screenshot_archive: e.target.value as ScreenshotArchive,
                  screenshot_archive_user_set: true,
                })
              }
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 text-slate-200"
            >
              <option value="always">{t('screenshotArchiveAlways')}</option>
              <option value="on_failure">{t('screenshotArchiveOnFailure')}</option>
              <option value="never">{t('screenshotArchiveNever')}</option>
            </select>
          </label>
          <p className="text-[11px] text-slate-500">{t('screenshotArchiveHelp')}</p>
        </div>

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="bg-bu-500 hover:bg-bu-600 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-md text-sm"
        >
          {saving ? t('saving') : t('saveSettings')}
        </button>
        {msg && <span className="ml-3 text-xs text-slate-400">{msg}</span>}
      </div>
    </div>
  )
}
