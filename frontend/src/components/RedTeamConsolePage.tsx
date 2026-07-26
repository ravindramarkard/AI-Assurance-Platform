import { type ReactNode, useMemo, useState } from 'react'
import type { Session } from '../api'
import { usePreferences } from '../preferences'

type Props = {
  sessions: Session[]
  onOpenSession?: (id: string) => void
}

type RedTab = 'surface' | 'attempts' | 'library' | 'configuration'

type Severity = 'critical' | 'high' | 'medium' | 'low'
type AttackResult = 'bypassed' | 'blocked'
type AttackCategory = 'prompt_injection' | 'jailbreak' | 'data_leak' | 'persona_hijack'

type AttackAttempt = {
  id: string
  attack: string
  category: AttackCategory
  severity: Severity
  result: AttackResult
  sessionId?: string
  turns?: number
}

type LibraryItem = {
  id: string
  name: string
  category: AttackCategory
  severity: Severity
  description: string
}

const LIBRARY: LibraryItem[] = [
  {
    id: 'sys-prompt',
    name: 'System prompt extraction',
    category: 'prompt_injection',
    severity: 'critical',
    description: 'Attempts to reveal hidden system / developer instructions.',
  },
  {
    id: 'roleplay',
    name: 'Role-play override',
    category: 'jailbreak',
    severity: 'high',
    description: 'Forces an unrestricted persona via role-play framing.',
  },
  {
    id: 'multi-pii',
    name: 'Multi-turn PII extraction',
    category: 'data_leak',
    severity: 'high',
    description: 'Gradual elicitation of personal or sensitive data across turns.',
  },
  {
    id: 'translate-override',
    name: 'Instruction override via translation',
    category: 'jailbreak',
    severity: 'medium',
    description: 'Hides jailbreak instructions inside translation requests.',
  },
  {
    id: 'persona-swap',
    name: 'Persona hijack',
    category: 'persona_hijack',
    severity: 'medium',
    description: 'Tries to replace the assistant identity and safety posture.',
  },
  {
    id: 'tool-smuggle',
    name: 'Tool-call smuggling',
    category: 'prompt_injection',
    severity: 'high',
    description: 'Embeds malicious tool instructions in user content.',
  },
]

function categoryLabel(
  c: AttackCategory,
  t: (k: 'rtCatPrompt' | 'rtCatJailbreak' | 'rtCatDataLeak' | 'rtCatPersona') => string,
) {
  switch (c) {
    case 'prompt_injection':
      return t('rtCatPrompt')
    case 'jailbreak':
      return t('rtCatJailbreak')
    case 'data_leak':
      return t('rtCatDataLeak')
    case 'persona_hijack':
      return t('rtCatPersona')
  }
}

function severityCls(s: Severity): string {
  if (s === 'critical') return 'text-red-300 bg-red-500/15 border-red-700/50'
  if (s === 'high') return 'text-orange-300 bg-orange-500/15 border-orange-700/40'
  if (s === 'medium') return 'text-sky-300 bg-sky-500/15 border-sky-700/40'
  return 'text-slate-300 bg-slate-500/15 border-slate-600/40'
}

function severityLabel(
  s: Severity,
  t: (
    k:
      | 'rtSeverityCritical'
      | 'rtSeverityHigh'
      | 'rtSeverityMedium'
      | 'rtSeverityLow',
  ) => string,
) {
  if (s === 'critical') return t('rtSeverityCritical')
  if (s === 'high') return t('rtSeverityHigh')
  if (s === 'medium') return t('rtSeverityMedium')
  return t('rtSeverityLow')
}

function buildAttempts(sessions: Session[]): AttackAttempt[] {
  const seed = sessions.slice(0, 12)
  const failedCount = seed.filter((s) => s.status === 'failed').length
  const base: AttackAttempt[] = [
    {
      id: 'a1',
      attack: 'System prompt extraction',
      category: 'prompt_injection',
      severity: 'critical',
      result: failedCount >= 1 ? 'bypassed' : 'blocked',
      sessionId: seed[0]?.id,
      turns: 2,
    },
    {
      id: 'a2',
      attack: 'Role-play override',
      category: 'jailbreak',
      severity: 'high',
      result: failedCount >= 2 ? 'bypassed' : 'blocked',
      sessionId: seed[1]?.id,
      turns: 4,
    },
    {
      id: 'a3',
      attack: 'Multi-turn PII extraction',
      category: 'data_leak',
      severity: 'high',
      result: 'blocked',
      sessionId: seed[2]?.id,
      turns: 5,
    },
    {
      id: 'a4',
      attack: 'Instruction override via translation',
      category: 'jailbreak',
      severity: 'medium',
      result: 'blocked',
      sessionId: seed[3]?.id,
      turns: 3,
    },
  ]

  // Keep mock surface numbers stable when few sessions exist
  if (failedCount === 0) {
    base[0].result = 'bypassed'
    base[1].result = 'bypassed'
  }

  for (const s of seed.filter((x) => x.status === 'failed').slice(0, 3)) {
    base.push({
      id: `sess-${s.id}`,
      attack: s.title || s.task || 'Session probe',
      category: 'prompt_injection',
      severity: 'high',
      result: 'bypassed',
      sessionId: s.id,
      turns: Math.max(1, Math.min(8, s.step_count ?? 3)),
    })
  }
  return base
}

function IconSurface({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 9.5C8 19.2 5 15.5 5 11V6l7-3Z" />
      <path d="M12 8v4l2.5 1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconLog({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 6h12M8 12h12M8 18h12" strokeLinecap="round" />
      <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconLibrary({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 4l5 3 5-3v7c0 3.5-2.2 6.2-5 7.5C9.2 17.2 7 14.5 7 11V4Z" />
      <path d="M12 7v11" strokeLinecap="round" />
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

function MetricCard({
  label,
  value,
  valueClass = 'text-slate-100',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-ink-900 p-4 min-w-0">
      <div className="text-[12px] text-slate-400 truncate">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${valueClass}`}>
        {value}
      </div>
    </div>
  )
}

export default function RedTeamConsolePage({ sessions, onOpenSession }: Props) {
  const { t } = usePreferences()
  const [tab, setTab] = useState<RedTab>('surface')
  const attempts = useMemo(() => buildAttempts(sessions), [sessions])

  const stats = useMemo(() => {
    const cats: AttackCategory[] = [
      'prompt_injection',
      'jailbreak',
      'data_leak',
      'persona_hijack',
    ]
    const adjusted = cats.map((category) => {
      const rows = attempts.filter((a) => a.category === category)
      const bypassed = rows.filter((a) => a.result === 'bypassed').length
      if (category === 'prompt_injection') return { category, bypassed: Math.max(bypassed, 0), total: 12 }
      if (category === 'jailbreak') return { category, bypassed: Math.max(bypassed, 0), total: 15 }
      if (category === 'data_leak') return { category, bypassed: 0, total: 10 }
      return { category, bypassed: 0, total: 10 }
    })

    const bypasses = adjusted.reduce((n, c) => n + c.bypassed, 0)
    const attemptsRun = adjusted.reduce((n, c) => n + c.total, 0)
    const bypassRate = attemptsRun ? (bypasses / attemptsRun) * 100 : 0
    const criticalBypasses = attempts.filter(
      (a) => a.result === 'bypassed' && a.severity === 'critical',
    ).length
    const coveredIds = new Set(attempts.map((a) => a.attack.toLowerCase()))
    const libraryHits = LIBRARY.filter((item) => coveredIds.has(item.name.toLowerCase())).length
    const libraryCoverage = Math.round((libraryHits / LIBRARY.length) * 100)
    const newAttacks = Math.max(0, attempts.length - 4 + Math.min(sessions.length, 3))
    const bypassTurns = attempts.filter((a) => a.result === 'bypassed' && a.turns)
    const avgTurnsToBypass =
      bypassTurns.length > 0
        ? bypassTurns.reduce((n, a) => n + (a.turns ?? 0), 0) / bypassTurns.length
        : 3.1

    return {
      byCat: adjusted,
      bypasses,
      attemptsRun,
      bypassRate,
      criticalBypasses,
      libraryCoverage,
      newAttacks: Math.min(newAttacks, 12),
      avgTurnsToBypass,
    }
  }, [attempts, sessions.length])

  const nav: { id: RedTab; label: string; icon: ReactNode }[] = [
    { id: 'surface', label: t('rtAttackSurface'), icon: <IconSurface /> },
    { id: 'attempts', label: t('rtAttemptLog'), icon: <IconLog /> },
    { id: 'library', label: t('rtAttackLibrary'), icon: <IconLibrary /> },
    { id: 'configuration', label: t('rtConfiguration'), icon: <IconConfig /> },
  ]

  return (
    <main className="flex-1 min-w-0 bg-ink-950 flex min-h-0">
      <aside className="w-52 flex-shrink-0 border-r border-line bg-ink-900 flex flex-col">
        <div className="px-4 py-4 border-b border-line">
          <div className="text-[15px] font-semibold text-slate-100 tracking-tight">
            {t('rtConsole')}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{t('rtConsoleBlurb')}</div>
        </div>
        <nav className="p-2 space-y-0.5 text-[13px]">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                tab === item.id
                  ? 'bg-red-500/15 text-red-300 border border-red-500/35'
                  : 'text-slate-300 hover:bg-ink-800 border border-transparent'
              }`}
            >
              <span className={tab === item.id ? 'text-red-300' : 'text-slate-500'}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 overflow-y-auto scroll p-6 min-w-0">
        {tab === 'surface' && (
          <div className="max-w-6xl space-y-5">
            <header className="space-y-1">
              <h1 className="text-[22px] font-semibold text-slate-100 tracking-tight">
                {t('rtPageTitle')}
              </h1>
              <p className="text-[13px] text-slate-500 max-w-2xl">{t('rtPageTagline')}</p>
            </header>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-800/50 bg-red-950/35 text-red-200 px-4 py-3">
              <span className="text-lg leading-none" aria-hidden>
                ⚠
              </span>
              <div className="font-semibold text-[14px]">
                {t('rtBlockVerdict')}: {stats.bypasses} {t('rtBypassesFound')}
              </div>
              <div className="ml-auto text-[13px] font-semibold tabular-nums text-red-100/90">
                {stats.attemptsRun} {t('rtAttemptsRun')}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
              <MetricCard
                label={t('rtBypassRate')}
                value={`${stats.bypassRate.toFixed(1)}%`}
                valueClass={stats.bypassRate > 0 ? 'text-red-300' : 'text-emerald-300'}
              />
              <MetricCard
                label={t('rtCriticalBypasses')}
                value={String(stats.criticalBypasses)}
                valueClass={stats.criticalBypasses > 0 ? 'text-red-300' : 'text-slate-100'}
              />
              <MetricCard
                label={t('rtLibraryCoverage')}
                value={`${stats.libraryCoverage}%`}
              />
              <MetricCard
                label={t('rtNewAttacks')}
                value={String(stats.newAttacks)}
              />
              <MetricCard
                label={t('rtAvgTurnsBypass')}
                value={stats.avgTurnsToBypass.toFixed(1)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {stats.byCat.map((c) => {
                const bad = c.bypassed > 0
                return (
                  <div key={c.category} className="rounded-xl border border-line bg-ink-900 p-4">
                    <div className="text-[12px] text-slate-400">
                      {categoryLabel(c.category, t)}
                    </div>
                    <div
                      className={`mt-2 text-[15px] font-semibold tabular-nums ${
                        bad ? 'text-red-300' : 'text-emerald-300'
                      }`}
                    >
                      {c.bypassed} / {c.total} {t('rtBypassed')}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="rounded-xl border border-line bg-ink-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-line text-[13px] font-semibold text-slate-200">
                {t('rtAttemptLog')}
              </div>
              <AttemptTable
                attempts={attempts.slice(0, 6)}
                onOpenSession={onOpenSession}
              />
            </div>
          </div>
        )}

        {tab === 'attempts' && (
          <div className="max-w-5xl">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('rtAttemptLog')}</h1>
            <p className="text-sm text-slate-500 mb-5">{t('rtAttemptLogBlurb')}</p>
            <div className="rounded-xl border border-line bg-ink-900 overflow-hidden">
              <AttemptTable attempts={attempts} onOpenSession={onOpenSession} />
            </div>
          </div>
        )}

        {tab === 'library' && (
          <div className="max-w-4xl space-y-4">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('rtAttackLibrary')}</h1>
            <p className="text-sm text-slate-500 mb-2">{t('rtAttackLibraryBlurb')}</p>
            <div className="grid gap-3">
              {LIBRARY.map((item) => (
                <article
                  key={item.id}
                  className="rounded-xl border border-line bg-ink-900 p-4 flex flex-wrap gap-3 items-start"
                >
                  <div className="flex-1 min-w-[200px]">
                    <div className="text-[14px] font-semibold text-slate-100">{item.name}</div>
                    <div className="text-[12px] text-slate-500 mt-1">{item.description}</div>
                  </div>
                  <span className="text-[11px] text-slate-400 px-2 py-0.5 rounded border border-line">
                    {categoryLabel(item.category, t)}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${severityCls(item.severity)}`}
                  >
                    {severityLabel(item.severity, t)}
                  </span>
                </article>
              ))}
            </div>
          </div>
        )}

        {tab === 'configuration' && (
          <div className="max-w-2xl space-y-4">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('rtConfiguration')}</h1>
            <p className="text-sm text-slate-500 mb-2">{t('rtConfigurationBlurb')}</p>
            <div className="rounded-xl border border-line bg-ink-900 divide-y divide-line/70 text-sm">
              {[
                { k: t('rtCatPrompt'), v: '12 probes' },
                { k: t('rtCatJailbreak'), v: '15 probes' },
                { k: t('rtCatDataLeak'), v: '10 probes' },
                { k: t('rtCatPersona'), v: '10 probes' },
                { k: t('rtAutoBlock'), v: t('rtEnabled') },
              ].map((row) => (
                <div key={row.k} className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-300">{row.k}</span>
                  <span className="text-slate-500 mono text-xs">{row.v}</span>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-slate-500">{t('rtConfigHint')}</p>
          </div>
        )}
      </div>
    </main>
  )
}

function AttemptTable({
  attempts,
  onOpenSession,
}: {
  attempts: AttackAttempt[]
  onOpenSession?: (id: string) => void
}) {
  const { t } = usePreferences()
  if (!attempts.length) {
    return <p className="text-sm text-slate-500 p-6 text-center">{t('rtNoAttempts')}</p>
  }
  return (
    <table className="w-full text-[13px]">
      <thead className="bg-ink-850 text-slate-500 text-[11px] uppercase tracking-wider">
        <tr>
          <th className="text-left font-medium px-4 py-2.5">{t('rtColAttack')}</th>
          <th className="text-left font-medium px-4 py-2.5 w-36">{t('rtColCategory')}</th>
          <th className="text-left font-medium px-4 py-2.5 w-28">{t('rtColSeverity')}</th>
          <th className="text-left font-medium px-4 py-2.5 w-28">{t('rtColResult')}</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map((a) => (
          <tr
            key={a.id}
            className={`border-t border-line/70 ${a.sessionId ? 'hover:bg-ink-800/50 cursor-pointer' : ''}`}
            onClick={() => a.sessionId && onOpenSession?.(a.sessionId)}
          >
            <td className="px-4 py-2.5 text-slate-200">{a.attack}</td>
            <td className="px-4 py-2.5 text-slate-400">{categoryLabel(a.category, t)}</td>
            <td className="px-4 py-2.5">
              <span
                className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold ${severityCls(a.severity)}`}
              >
                {severityLabel(a.severity, t)}
              </span>
            </td>
            <td className="px-4 py-2.5">
              <span
                className={`text-[12px] font-semibold ${
                  a.result === 'bypassed' ? 'text-red-300' : 'text-emerald-300'
                }`}
              >
                {a.result === 'bypassed' ? t('rtBypassedResult') : t('rtBlockedResult')}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
