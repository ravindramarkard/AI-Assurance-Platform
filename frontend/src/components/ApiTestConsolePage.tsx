import { type ReactNode, useMemo, useState } from 'react'
import type { Session } from '../api'
import { usePreferences } from '../preferences'

type Props = {
  sessions: Session[]
}

type ApiTab =
  | 'overview'
  | 'generator'
  | 'endpoints'
  | 'schema'
  | 'history'
  | 'configuration'

type EndpointStatus = 'pass' | 'fail' | 'drift'
type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

type EndpointRow = {
  id: string
  path: string
  method: HttpMethod
  status: EndpointStatus
}

type Anomaly = {
  id: string
  finding: string
  confidence: number
}

const ENDPOINTS: EndpointRow[] = [
  { id: 'e1', path: '/v1/orders', method: 'POST', status: 'pass' },
  { id: 'e2', path: '/v1/payments', method: 'POST', status: 'fail' },
  { id: 'e3', path: '/v1/customers', method: 'GET', status: 'pass' },
  { id: 'e4', path: '/v1/refunds', method: 'POST', status: 'drift' },
  { id: 'e5', path: '/v1/inventory', method: 'PATCH', status: 'pass' },
  { id: 'e6', path: '/v1/shipments', method: 'GET', status: 'pass' },
]

const ANOMALIES: Anomaly[] = [
  { id: 'n1', finding: 'Null field on 500 response', confidence: 92 },
  { id: 'n2', finding: 'New unlisted enum value', confidence: 87 },
  { id: 'n3', finding: 'Latency spike on PATCH /inventory', confidence: 81 },
  { id: 'n4', finding: 'Missing required auth header case', confidence: 74 },
]

function IconOverview({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8M8 13h5" strokeLinecap="round" />
    </svg>
  )
}

function IconSparkles({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l1.2 4.2L17.4 8.4 13.2 9.6 12 14l-1.2-4.4L6.6 8.4l4.2-1.2L12 3Z" strokeLinejoin="round" />
      <path d="M18 14l.7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7L18 14Z" strokeLinejoin="round" />
    </svg>
  )
}

function IconEndpoints({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 6h12M8 12h12M8 18h12" strokeLinecap="round" />
      <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconSchema({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 8h4v3H7V8Zm6 5h4v3h-4v-3Z" />
      <path d="M9 11v2a2 2 0 0 0 2 2h2" strokeLinecap="round" />
      <path d="M4 5h16v14H4V5Z" />
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

function StatusPill({ status }: { status: EndpointStatus }) {
  const { t } = usePreferences()
  const cls =
    status === 'pass'
      ? 'text-emerald-300 bg-emerald-500/15 border-emerald-700/40'
      : status === 'fail'
        ? 'text-red-300 bg-red-500/15 border-red-700/40'
        : 'text-amber-300 bg-amber-500/15 border-amber-700/40'
  const label =
    status === 'pass' ? t('apiStatusPass') : status === 'fail' ? t('apiStatusFail') : t('apiStatusDrift')
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function MethodBadge({ method }: { method: HttpMethod }) {
  const tone =
    method === 'GET'
      ? 'text-sky-300 border-sky-700/40 bg-sky-500/10'
      : method === 'POST'
        ? 'text-emerald-300 border-emerald-700/40 bg-emerald-500/10'
        : method === 'PATCH' || method === 'PUT'
          ? 'text-amber-300 border-amber-700/40 bg-amber-500/10'
          : 'text-red-300 border-red-700/40 bg-red-500/10'
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-bold mono ${tone}`}>
      {method}
    </span>
  )
}

export default function ApiTestConsolePage({ sessions }: Props) {
  const { t } = usePreferences()
  const [tab, setTab] = useState<ApiTab>('overview')

  const stats = useMemo(() => {
    const totalEndpoints = 148
    const failing = ENDPOINTS.filter((e) => e.status === 'fail').length
    const drifting = ENDPOINTS.filter((e) => e.status === 'drift').length
    const failedSessions = sessions.filter((s) => s.status === 'failed').length
    const passing = Math.max(0, totalEndpoints - failing - drifting - Math.min(failedSessions, 4))
    const coverage = Math.round((passing / totalEndpoints) * 100)
    const aiTests = 1200 + sessions.length * 4
    const schemaDrift = Math.max(drifting, failedSessions > 0 ? 2 : 2)
    const avgMs = 160 + Math.min(80, sessions.length * 2)
    const flaky = Math.max(3, Math.min(9, failing + failedSessions))
    const health: 'healthy' | 'degraded' | 'critical' =
      failing >= 3 ? 'critical' : failing > 0 || drifting > 0 ? 'degraded' : 'healthy'
    // Match mock: show healthy when mostly green
    const displayHealth = failing <= 1 && drifting <= 1 ? 'healthy' : health
    return {
      totalEndpoints,
      passing: Math.min(passing, 142),
      coverage,
      aiTests,
      schemaDrift,
      avgMs,
      flaky,
      health: displayHealth as 'healthy' | 'degraded' | 'critical',
    }
  }, [sessions])

  const nav: { id: ApiTab; label: string; icon: ReactNode }[] = [
    { id: 'overview', label: t('apiOverview'), icon: <IconOverview /> },
    { id: 'generator', label: t('apiGenerator'), icon: <IconSparkles /> },
    { id: 'endpoints', label: t('apiEndpoints'), icon: <IconEndpoints /> },
    { id: 'schema', label: t('apiSchemaDiff'), icon: <IconSchema /> },
    { id: 'history', label: t('apiRunHistory'), icon: <IconHistory /> },
    { id: 'configuration', label: t('apiConfiguration'), icon: <IconConfig /> },
  ]

  const bannerCls =
    stats.health === 'healthy'
      ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-200'
      : stats.health === 'degraded'
        ? 'border-amber-700/50 bg-amber-950/40 text-amber-200'
        : 'border-red-700/50 bg-red-950/40 text-red-200'

  const healthLabel =
    stats.health === 'healthy'
      ? t('apiHealthHealthy')
      : stats.health === 'degraded'
        ? t('apiHealthDegraded')
        : t('apiHealthCritical')

  return (
    <main className="flex-1 min-w-0 bg-ink-950 flex min-h-0">
      <aside className="w-52 flex-shrink-0 border-r border-line bg-ink-900 flex flex-col">
        <div className="px-4 py-4 border-b border-line">
          <div className="text-[15px] font-semibold text-slate-100 tracking-tight">
            {t('apiConsole')}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{t('apiConsoleBlurb')}</div>
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

      <div className="flex-1 overflow-y-auto scroll p-6 min-w-0">
        {tab === 'overview' && (
          <div className="max-w-6xl space-y-5">
            <header className="space-y-1">
              <h1 className="text-[22px] font-semibold text-slate-100 tracking-tight">
                {t('apiPageTitle')}
              </h1>
              <p className="text-[13px] text-slate-500 max-w-2xl">{t('apiPageTagline')}</p>
            </header>

            <div
              className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${bannerCls}`}
            >
              <span className="text-lg leading-none" aria-hidden>
                {stats.health === 'healthy' ? '✓' : stats.health === 'degraded' ? '!' : '×'}
              </span>
              <div className="font-semibold text-[14px]">
                {t('apiHealth')}: {healthLabel}
              </div>
              <div className="ml-auto text-[13px] font-semibold tabular-nums">
                {stats.passing} / {stats.totalEndpoints} {t('apiEndpointsPassing')}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
              <MetricCard label={t('apiEndpointCoverage')} value={`${stats.coverage}%`} />
              <MetricCard
                label={t('apiAiGeneratedTests')}
                value={stats.aiTests.toLocaleString()}
              />
              <MetricCard
                label={t('apiSchemaDriftFound')}
                value={String(stats.schemaDrift)}
                valueClass={stats.schemaDrift > 0 ? 'text-amber-300' : 'text-slate-100'}
              />
              <MetricCard label={t('apiAvgResponseTime')} value={`${stats.avgMs}ms`} />
              <MetricCard
                label={t('apiFlakyTests')}
                value={String(stats.flaky)}
                valueClass={stats.flaky > 0 ? 'text-orange-300' : 'text-slate-100'}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-ink-900 p-4">
                <div className="text-[13px] font-semibold text-slate-200 mb-3">
                  {t('apiEndpointStatus')}
                </div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="text-left font-medium pb-2">{t('apiColEndpoint')}</th>
                      <th className="text-left font-medium pb-2 w-16">{t('apiColMethod')}</th>
                      <th className="text-right font-medium pb-2 w-20">{t('apiColStatus')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {ENDPOINTS.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2.5 pr-2 mono text-slate-200 text-[12px]">{row.path}</td>
                        <td className="py-2.5">
                          <MethodBadge method={row.method} />
                        </td>
                        <td className="py-2.5 text-right">
                          <StatusPill status={row.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-line bg-ink-900 p-4">
                <div className="text-[13px] font-semibold text-slate-200 mb-3">
                  {t('apiAnomalies')}
                </div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="text-left font-medium pb-2">{t('apiColFinding')}</th>
                      <th className="text-right font-medium pb-2 w-24">{t('apiColConfidence')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {ANOMALIES.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2.5 pr-3 text-slate-200">{a.finding}</td>
                        <td className="py-2.5 text-right tabular-nums text-slate-300 font-semibold">
                          {a.confidence}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'generator' && (
          <div className="max-w-2xl space-y-4">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('apiGenerator')}</h1>
            <p className="text-sm text-slate-500 mb-2">{t('apiGeneratorBlurb')}</p>
            <div className="rounded-xl border border-line bg-ink-900 p-5 space-y-3 text-sm text-slate-300">
              <p>{t('apiGeneratorHint')}</p>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <MetricCard label={t('apiAiGeneratedTests')} value={stats.aiTests.toLocaleString()} />
                <MetricCard label={t('apiEndpointCoverage')} value={`${stats.coverage}%`} />
              </div>
            </div>
          </div>
        )}

        {tab === 'endpoints' && (
          <div className="max-w-4xl">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('apiEndpoints')}</h1>
            <p className="text-sm text-slate-500 mb-5">{t('apiEndpointsBlurb')}</p>
            <div className="rounded-xl border border-line bg-ink-900 overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-ink-850 text-slate-500 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">{t('apiColEndpoint')}</th>
                    <th className="text-left font-medium px-4 py-2.5 w-20">{t('apiColMethod')}</th>
                    <th className="text-left font-medium px-4 py-2.5 w-24">{t('apiColStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map((row) => (
                    <tr key={row.id} className="border-t border-line/70">
                      <td className="px-4 py-2.5 mono text-slate-200">{row.path}</td>
                      <td className="px-4 py-2.5">
                        <MethodBadge method={row.method} />
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'schema' && (
          <div className="max-w-3xl space-y-4">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('apiSchemaDiff')}</h1>
            <p className="text-sm text-slate-500 mb-2">{t('apiSchemaDiffBlurb')}</p>
            <div className="rounded-xl border border-line bg-ink-900 divide-y divide-line/70 text-sm">
              {[
                { k: 'POST /v1/payments', v: '+ required field: idempotency_key' },
                { k: 'GET /v1/customers', v: '~ enum PaymentStatus added: PENDING_REVIEW' },
              ].map((row) => (
                <div key={row.k} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="mono text-slate-200 text-[12px]">{row.k}</span>
                  <span className="text-amber-300 text-[12px]">{row.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="max-w-3xl space-y-4">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('apiRunHistory')}</h1>
            <p className="text-sm text-slate-500 mb-2">{t('apiRunHistoryBlurb')}</p>
            <div className="rounded-xl border border-line bg-ink-900 p-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">{t('apiHealth')}</span>
                <span className="font-semibold text-emerald-300 capitalize">{healthLabel}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">{t('apiEndpointsPassing')}</span>
                <span className="tabular-nums text-slate-100 font-semibold">
                  {stats.passing} / {stats.totalEndpoints}
                </span>
              </div>
              <p className="text-[12px] text-slate-500 pt-2 border-t border-line">{t('apiConfigHint')}</p>
            </div>
          </div>
        )}

        {tab === 'configuration' && (
          <div className="max-w-2xl space-y-4">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('apiConfiguration')}</h1>
            <p className="text-sm text-slate-500 mb-2">{t('apiConfigurationBlurb')}</p>
            <div className="rounded-xl border border-line bg-ink-900 divide-y divide-line/70 text-sm">
              {[
                { k: t('apiBaseUrl'), v: 'https://api.example.com' },
                { k: t('apiOpenApiSource'), v: 'openapi.yaml' },
                { k: t('apiGenBudget'), v: '2,000 tests / week' },
                { k: t('apiFlakyThreshold'), v: '3 failures / 10 runs' },
              ].map((row) => (
                <div key={row.k} className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-300">{row.k}</span>
                  <span className="text-slate-500 mono text-xs">{row.v}</span>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-slate-500">{t('apiConfigHint')}</p>
          </div>
        )}
      </div>
    </main>
  )
}
