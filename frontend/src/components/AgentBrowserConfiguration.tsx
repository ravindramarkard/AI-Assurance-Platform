import { useEffect, useState } from 'react'
import { api, type AppSettings, type BrowserEngine } from '../api'
import { usePreferences } from '../preferences'

export type AgentBrowserConfigurationProps = {
  settings: AppSettings | null
  onSaved: (s: AppSettings) => void
}

type FormState = {
  headless: boolean
  browser_engine: BrowserEngine
  browser_executable: string
  application_url: string
  max_concurrent_agents: number
}

export default function AgentBrowserConfiguration({
  settings,
  onSaved,
}: AgentBrowserConfigurationProps) {
  const { t } = usePreferences()
  const [form, setForm] = useState<FormState>({
    headless: true,
    browser_engine: 'chromium',
    browser_executable: '',
    application_url: '',
    max_concurrent_agents: 2,
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!settings) return
    const engine = (settings.browser_engine || 'chromium') as BrowserEngine
    setForm({
      headless: settings.headless,
      browser_engine: ['chromium', 'chrome', 'custom'].includes(engine) ? engine : 'chromium',
      browser_executable: settings.browser_executable || '',
      application_url: settings.application_url || '',
      max_concurrent_agents: Math.max(1, Math.min(8, Number(settings.max_concurrent_agents) || 2)),
    })
  }, [settings])

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const s = await api.updateSettings({
        application_url: form.application_url.trim(),
        max_concurrent_agents: Math.max(1, Math.min(8, Number(form.max_concurrent_agents) || 2)),
        browser_engine: form.browser_engine,
        browser_executable: form.browser_executable.trim(),
        headless: form.headless,
      })
      onSaved(s)
      setMsg(t('saved'))
      setForm({
        headless: s.headless,
        browser_engine: (s.browser_engine as BrowserEngine) || form.browser_engine,
        browser_executable: s.browser_executable || '',
        application_url: s.application_url || '',
        max_concurrent_agents: Math.max(1, Math.min(8, Number(s.max_concurrent_agents) || 2)),
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
            With 1, a new agent stays <span className="text-slate-400">queued</span> until the current
            one finishes. Raise to 2+ to run multiple agents in parallel.
          </p>
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
