import { useEffect, useState } from 'react'
import { api } from '../api'
import { usePreferences } from '../preferences'

export default function BrowsersView() {
  const { t } = usePreferences()
  const [data, setData] = useState<Awaited<ReturnType<typeof api.browsers>> | null>(null)
  useEffect(() => {
    api.browsers().then(setData).catch(() => {})
    const timer = window.setInterval(() => api.browsers().then(setData).catch(() => {}), 3000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <main className="flex-1 p-8 bg-ink-900 overflow-y-auto scroll">
      <h1 className="text-lg font-semibold mb-4">{t('remoteBrowsers')}</h1>
      <p className="text-sm text-slate-400 mb-6">{t('browsersBlurb')}</p>
      {data?.browsers.map((b) => (
        <div key={b.id} className="border border-line rounded-lg p-4 bg-ink-800 max-w-md">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${b.status === 'busy' ? 'bg-bu-500 pulse-dot' : 'bg-green-400'}`}
            />
            <span className="font-semibold">{b.name}</span>
            <span className="ml-auto text-xs text-slate-500 uppercase">{b.status}</span>
          </div>
          <div className="mt-3 text-xs text-slate-400 flex gap-4">
            <span>
              {t('activeCount')}: {b.active_sessions}
            </span>
            <span>
              {t('queuedCount')}: {data.queued}
            </span>
          </div>
        </div>
      ))}
    </main>
  )
}
