import type { Session } from '../api'
import { usePreferences } from '../preferences'

export default function AnalyticsView({ sessions }: { sessions: Session[] }) {
  const { t } = usePreferences()
  const completed = sessions.filter((s) => s.status === 'completed').length
  const failed = sessions.filter((s) => s.status === 'failed').length
  const running = sessions.filter((s) =>
    ['running', 'queued', 'thinking', 'paused', 'waiting_for_input'].includes(s.status),
  ).length
  const cards = [
    { label: t('totalSessions'), value: sessions.length },
    { label: t('completedSessions'), value: completed },
    { label: t('failedSessions'), value: failed },
    { label: t('runningSessions'), value: running },
  ]
  return (
    <main className="flex-1 p-8 bg-ink-900 overflow-y-auto scroll">
      <h1 className="text-lg font-semibold mb-1">{t('analyticsTitle')}</h1>
      <p className="text-sm text-slate-400 mb-6">{t('analyticsBlurb')}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 max-w-3xl">
        {cards.map((c) => (
          <div key={c.label} className="border border-line rounded-xl bg-ink-800 p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">{c.label}</div>
            <div className="mt-2 text-2xl font-semibold text-slate-100 tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>
    </main>
  )
}
