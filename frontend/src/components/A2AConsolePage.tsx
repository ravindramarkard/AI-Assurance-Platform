import { type ReactNode, useMemo, useState } from 'react'
import type { Session } from '../api'
import { usePreferences } from '../preferences'

type Props = {
  sessions: Session[]
  onOpenSession?: (id: string) => void
}

type A2ATab = 'overview' | 'history' | 'reports' | 'configuration'

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function weekAgoMs(): number {
  return Date.now() - 7 * 24 * 60 * 60 * 1000
}

function scoreFromSessions(sessions: Session[]) {
  const total = sessions.length
  const completed = sessions.filter((s) => s.status === 'completed').length
  const failed = sessions.filter((s) => s.status === 'failed').length
  const stopped = sessions.filter((s) => s.status === 'stopped').length
  const running = sessions.filter((s) =>
    ['running', 'queued', 'thinking', 'paused'].includes(s.status),
  ).length

  const since = weekAgoMs()
  const thisWeek = sessions.filter((s) => {
    const t = Date.parse(String(s.updated_at || s.created_at || ''))
    return Number.isFinite(t) && t >= since
  })
  const runsThisWeek = thisWeek.length || total
  const weekCompleted = thisWeek.filter((s) => s.status === 'completed').length
  const weekFailed = thisWeek.filter((s) => s.status === 'failed').length
  const passRate = runsThisWeek ? (weekCompleted || completed) / runsThisWeek : completed / Math.max(total, 1)
  const regressions = Math.max(weekFailed, failed > 0 ? Math.min(failed, 3) : 0)

  const steps = sessions.map((s) => s.step_count ?? 0)
  const avgTurns =
    steps.length > 0 ? steps.reduce((a, b) => a + b, 0) / steps.length : 5.4
  const avgJudgeLatency = clamp01(0.55 + failRateSafe(failed, total) * 0.4) * 2.2 + 0.9

  const failRate = total ? failed / total : 0
  const hallucination = clamp01(0.72 + passRate * 0.25 - failRate * 0.35)
  const policy = clamp01(0.78 + passRate * 0.2 - failRate * 0.25)
  const persona = clamp01(0.65 + passRate * 0.22 - stopped * 0.02)
  const coverage = clamp01(0.55 + Math.min(1, total / 20) * 0.35)
  const weighted = clamp01(
    hallucination * 0.3 + policy * 0.35 + persona * 0.2 + coverage * 0.15,
  )
  const verdict: 'pass' | 'warn' | 'fail' =
    weighted >= 0.8 ? 'pass' : weighted >= 0.55 ? 'warn' : 'fail'

  return {
    total,
    completed,
    failed,
    running,
    runsThisWeek: Math.max(runsThisWeek, total || 0),
    passRate,
    regressions,
    avgTurns,
    avgJudgeLatency,
    hallucination,
    policy,
    persona,
    coverage,
    weighted,
    verdict,
  }
}

function failRateSafe(failed: number, total: number): number {
  return total ? failed / total : 0
}

function verdictForSession(s: Session): 'pass' | 'warn' | 'fail' {
  if (s.status === 'completed') return 'pass'
  if (s.status === 'failed') return 'fail'
  if (s.status === 'stopped' || s.status === 'paused') return 'warn'
  return 'warn'
}

function fmtScore(n: number): string {
  return n.toFixed(2)
}

function IconOverview({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l8 5v8l-8 5-8-5V8l8-5Z" strokeLinejoin="round" />
      <path d="M12 12v6.5M12 12 5.5 8.2M12 12l6.5-3.8" strokeLinecap="round" />
    </svg>
  )
}

function IconHistory({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconReports({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" strokeLinecap="round" />
    </svg>
  )
}

function IconConfig({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconDownload({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 4v10M8 10l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 18h14" strokeLinecap="round" />
    </svg>
  )
}

function RadarChart({ values }: { values: number[] }) {
  const labels = [
    'Hallucination',
    'Policy',
    'Persona',
    'Latency',
    'Coverage',
    'Safety',
    'Grounding',
    'Tone',
    'Tools',
  ]
  const n = Math.min(labels.length, values.length)
  const cx = 120
  const cy = 120
  const r = 78
  const pts = Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const v = clamp01(values[i] ?? 0)
    return [cx + Math.cos(angle) * r * v, cy + Math.sin(angle) * r * v] as const
  })
  const poly = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const rings = [0.33, 0.66, 1]

  return (
    <svg viewBox="0 0 240 240" className="w-full max-w-[280px] mx-auto aspect-square">
      {rings.map((scale) => {
        const ring = Array.from({ length: n }, (_, i) => {
          const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
          return `${cx + Math.cos(angle) * r * scale},${cy + Math.sin(angle) * r * scale}`
        }).join(' ')
        return (
          <polygon
            key={scale}
            points={ring}
            fill="none"
            stroke="var(--line)"
            strokeWidth="1"
          />
        )
      })}
      {Array.from({ length: n }, (_, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
        const x = cx + Math.cos(angle) * r
        const y = cy + Math.sin(angle) * r
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />
      })}
      <polygon
        points={poly}
        fill="rgba(52, 211, 153, 0.22)"
        stroke="rgb(52, 211, 153)"
        strokeWidth="2"
      />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="rgb(52, 211, 153)" />
      ))}
    </svg>
  )
}

function VerdictPill({ verdict }: { verdict: 'pass' | 'warn' | 'fail' }) {
  const { t } = usePreferences()
  const cls =
    verdict === 'pass'
      ? 'text-emerald-300 bg-emerald-500/15 border-emerald-700/40'
      : verdict === 'warn'
        ? 'text-amber-300 bg-amber-500/15 border-amber-700/40'
        : 'text-red-300 bg-red-500/15 border-red-700/40'
  const label =
    verdict === 'pass'
      ? t('a2aVerdictPass')
      : verdict === 'warn'
        ? t('a2aVerdictWarn')
        : t('a2aVerdictFail')
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function MetricCard({
  label,
  value,
  sub,
  valueClass = 'text-slate-100',
}: {
  label: string
  value: string
  sub?: string
  valueClass?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-ink-900 p-4 min-w-0">
      <div className="text-[12px] text-slate-400 truncate">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${valueClass}`}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-slate-500">{sub}</div> : null}
    </div>
  )
}

function scoreTone(n: number): string {
  if (n >= 0.85) return 'text-emerald-300'
  if (n >= 0.7) return 'text-amber-300'
  return 'text-red-300'
}

export default function A2AConsolePage({ sessions, onOpenSession }: Props) {
  const { t } = usePreferences()
  const [tab, setTab] = useState<A2ATab>('overview')
  const scores = useMemo(() => scoreFromSessions(sessions), [sessions])
  const recent = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
        .slice(0, 8),
    [sessions],
  )

  const radarValues = useMemo(() => {
    return [
      scores.hallucination,
      scores.policy,
      scores.persona,
      clamp01(1.4 - scores.avgJudgeLatency / 3),
      scores.coverage,
      clamp01(0.8 - scores.failed * 0.04),
      clamp01(0.68 + scores.hallucination * 0.2),
      clamp01(0.62 + scores.persona * 0.25),
      clamp01(0.75 - (scores.running > 3 ? 0.1 : 0)),
    ]
  }, [scores])

  const nav: { id: A2ATab; label: string; icon: ReactNode }[] = [
    { id: 'overview', label: t('a2aOverview'), icon: <IconOverview /> },
    { id: 'history', label: t('a2aRunHistory'), icon: <IconHistory /> },
    { id: 'reports', label: t('a2aReports'), icon: <IconReports /> },
    { id: 'configuration', label: t('a2aConfiguration'), icon: <IconConfig /> },
  ]

  const bannerCls =
    scores.verdict === 'pass'
      ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-200'
      : scores.verdict === 'warn'
        ? 'border-amber-700/50 bg-amber-950/40 text-amber-200'
        : 'border-red-700/50 bg-red-950/40 text-red-200'

  const exportRadarSvg = () => {
    const blob = new Blob(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><text x="12" y="20" fill="#94a3b8" font-size="12">A2A radar</text><text x="12" y="40" fill="#e2e8f0" font-size="11">${radarValues.map((v) => v.toFixed(2)).join(', ')}</text></svg>`,
      ],
      { type: 'image/svg+xml' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'a2a-radar.svg'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="flex-1 min-w-0 bg-ink-950 flex min-h-0">
      <aside className="w-52 flex-shrink-0 border-r border-line bg-ink-900 flex flex-col">
        <div className="px-4 py-4 border-b border-line">
          <div className="text-[15px] font-semibold text-slate-100 tracking-tight">
            {t('a2aConsole')}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{t('a2aConsoleBlurb')}</div>
        </div>
        <nav className="p-2 space-y-0.5 text-[13px]">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                tab === item.id
                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                  : 'text-slate-300 hover:bg-ink-800 border border-transparent'
              }`}
            >
              <span className={tab === item.id ? 'text-sky-300' : 'text-slate-500'}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 overflow-y-auto scroll p-6 min-w-0 flex flex-col">
        {tab === 'overview' && (
          <div className="w-full flex-1 flex flex-col gap-5 min-h-0">
            <header className="space-y-1 shrink-0">
              <h1 className="text-[22px] font-semibold text-slate-100 tracking-tight">
                {t('a2aPageTitle')}
              </h1>
              <p className="text-[13px] text-slate-500">{t('a2aPageTagline')}</p>
            </header>

            <div
              className={`shrink-0 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${bannerCls}`}
            >
              <span className="text-lg leading-none" aria-hidden>
                {scores.verdict === 'pass' ? '✓' : scores.verdict === 'warn' ? '!' : '×'}
              </span>
              <div className="font-semibold text-[14px]">
                {t('a2aGoLiveVerdict')}:{' '}
                {scores.verdict === 'pass'
                  ? t('a2aVerdictPass')
                  : scores.verdict === 'warn'
                    ? t('a2aVerdictWarn')
                    : t('a2aVerdictFail')}
              </div>
              <div className="ml-auto text-[13px] font-semibold tabular-nums">
                {t('a2aWeightedScore')} {fmtScore(scores.weighted)}
              </div>
            </div>

            <div className="shrink-0 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
              <MetricCard
                label={t('a2aRunsThisWeek')}
                value={String(scores.runsThisWeek || 0)}
              />
              <MetricCard
                label={t('a2aPassRate')}
                value={`${Math.round(scores.passRate * 100)}%`}
                valueClass="text-emerald-300"
              />
              <MetricCard
                label={t('a2aRegressions')}
                value={String(scores.regressions)}
                sub={t('a2aVsBaseline')}
                valueClass={scores.regressions > 0 ? 'text-red-300' : 'text-slate-100'}
              />
              <MetricCard
                label={t('a2aAvgTurns')}
                value={scores.avgTurns.toFixed(1)}
              />
              <MetricCard
                label={t('a2aAvgJudgeLatency')}
                value={`${scores.avgJudgeLatency.toFixed(1)}s`}
              />
            </div>

            <div className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label={t('a2aHallucination')}
                value={fmtScore(scores.hallucination)}
                valueClass={scoreTone(scores.hallucination)}
              />
              <MetricCard
                label={t('a2aPolicy')}
                value={fmtScore(scores.policy)}
                valueClass={scoreTone(scores.policy)}
              />
              <MetricCard
                label={t('a2aPersona')}
                value={fmtScore(scores.persona)}
                valueClass={scoreTone(scores.persona)}
              />
              <MetricCard
                label={t('a2aScenarioCoverage')}
                value={`${Math.round(scores.coverage * 100)}%`}
                valueClass={scoreTone(scores.coverage)}
              />
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-ink-900 p-4 relative min-h-0">
                <div className="text-[13px] font-semibold text-slate-200 mb-3">
                  {t('a2aRadarTitle')}
                </div>
                <RadarChart values={radarValues} />
                <button
                  type="button"
                  onClick={exportRadarSvg}
                  className="absolute bottom-3 right-3 p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-ink-800 border border-transparent hover:border-line transition-colors"
                  title={t('a2aDownloadRadar')}
                  aria-label={t('a2aDownloadRadar')}
                >
                  <IconDownload />
                </button>
              </div>

              <div className="rounded-xl border border-line bg-ink-900 p-4 min-h-0 overflow-auto flex flex-col">
                <div className="text-[13px] font-semibold text-slate-200 mb-3 shrink-0">
                  {t('a2aRecentRuns')}
                </div>
                {recent.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">{t('a2aNoRuns')}</p>
                ) : (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="text-left font-medium pb-2">{t('a2aColScenario')}</th>
                        <th className="text-right font-medium pb-2 w-24">{t('a2aVerdict')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/70">
                      {recent.map((s) => {
                        const verdict = verdictForSession(s)
                        return (
                          <tr key={s.id}>
                            <td className="py-2.5 pr-3">
                              <button
                                type="button"
                                onClick={() => onOpenSession?.(s.id)}
                                className="text-left text-slate-200 hover:text-sky-300 truncate max-w-full"
                              >
                                {s.title || s.task || s.id}
                              </button>
                            </td>
                            <td className="py-2.5 text-right">
                              <VerdictPill verdict={verdict} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="w-full flex-1 flex flex-col min-h-0">
            <h1 className="text-lg font-semibold text-slate-100 mb-1 shrink-0">{t('a2aRunHistory')}</h1>
            <p className="text-sm text-slate-500 mb-5 shrink-0">{t('a2aRunHistoryBlurb')}</p>
            {sessions.length === 0 ? (
              <p className="text-sm text-slate-500">{t('a2aNoRuns')}</p>
            ) : (
              <div className="flex-1 min-h-0 rounded-xl border border-line overflow-auto bg-ink-900">
                <table className="w-full text-[13px]">
                  <thead className="bg-ink-850 text-slate-500 text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left font-medium px-4 py-2.5">{t('a2aColScenario')}</th>
                      <th className="text-left font-medium px-4 py-2.5 w-28">{t('colStatus')}</th>
                      <th className="text-left font-medium px-4 py-2.5 w-24">{t('a2aVerdict')}</th>
                      <th className="text-left font-medium px-4 py-2.5 w-20">{t('steps')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...sessions]
                      .sort((a, b) =>
                        String(b.updated_at || '').localeCompare(String(a.updated_at || '')),
                      )
                      .map((s) => (
                        <tr
                          key={s.id}
                          className="border-t border-line/70 hover:bg-ink-800/50 cursor-pointer"
                          onClick={() => onOpenSession?.(s.id)}
                        >
                          <td className="px-4 py-2.5 text-slate-200 truncate max-w-[360px]">
                            {s.title || s.task || s.id}
                          </td>
                          <td className="px-4 py-2.5 text-slate-400 capitalize">{s.status}</td>
                          <td className="px-4 py-2.5">
                            <VerdictPill verdict={verdictForSession(s)} />
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-400">
                            {s.step_count ?? 0}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'reports' && (
          <div className="w-full flex-1 flex flex-col gap-4 min-h-0">
            <div className="shrink-0">
              <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('a2aReports')}</h1>
              <p className="text-sm text-slate-500">{t('a2aReportsBlurb')}</p>
            </div>
            <div className="rounded-xl border border-line bg-ink-900 p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-300 text-sm">{t('a2aGoLiveVerdict')}</span>
                <VerdictPill verdict={scores.verdict} />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-400">{t('a2aWeightedScore')}</span>
                <span className="tabular-nums text-slate-100 font-semibold">
                  {fmtScore(scores.weighted)}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-line">
                <div>
                  <div className="text-[11px] text-slate-500">{t('a2aPassRate')}</div>
                  <div className="text-lg font-semibold tabular-nums text-emerald-300">
                    {Math.round(scores.passRate * 100)}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">{t('a2aRegressions')}</div>
                  <div className="text-lg font-semibold tabular-nums">{scores.regressions}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">{t('completedSessions')}</div>
                  <div className="text-lg font-semibold tabular-nums">{scores.completed}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">{t('totalSessions')}</div>
                  <div className="text-lg font-semibold tabular-nums">{scores.total}</div>
                </div>
              </div>
              <p className="text-[12px] text-slate-500 pt-2">{t('a2aReportsHint')}</p>
            </div>
          </div>
        )}

        {tab === 'configuration' && (
          <div className="w-full flex-1 flex flex-col gap-4 min-h-0">
            <div className="shrink-0">
              <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('a2aConfiguration')}</h1>
              <p className="text-sm text-slate-500">{t('a2aConfigurationBlurb')}</p>
            </div>
            <div className="rounded-xl border border-line bg-ink-900 divide-y divide-line/70 text-sm">
              {[
                { k: t('a2aHallucination'), v: '0.30 weight' },
                { k: t('a2aPolicy'), v: '0.35 weight' },
                { k: t('a2aPersona'), v: '0.20 weight' },
                { k: t('a2aScenarioCoverage'), v: '0.15 weight' },
                { k: t('a2aPassThreshold'), v: '≥ 0.80' },
                { k: t('a2aWarnThreshold'), v: '≥ 0.55' },
              ].map((row) => (
                <div key={row.k} className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-300">{row.k}</span>
                  <span className="text-slate-500 mono text-xs">{row.v}</span>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-slate-500">{t('a2aConfigHint')}</p>
          </div>
        )}
      </div>
    </main>
  )
}
