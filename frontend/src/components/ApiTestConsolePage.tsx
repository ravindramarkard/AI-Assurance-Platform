import { type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  api,
  type ApiAnomaly,
  type ApiDrift,
  type ApiEndpoint,
  type ApiFlow,
  type ApiOverview,
  type ApiProject,
  type ApiProjectSchedule,
  type ApiRun,
  type ApiRunStep,
  type ApiSecurityScheme,
  type ApiService,
  type SchedulePreset,
  type Session,
} from '../api'
import { usePreferences } from '../preferences'
import { connectApiRunWs } from '../ws'

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

const PROJECT_KEY = 'api_test_project_id'

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

function InfoIcon({ hint }: { hint: string }) {
  return (
    <span
      className="relative group inline-flex shrink-0 text-slate-500 hover:text-slate-300 cursor-help"
      tabIndex={0}
      aria-label={hint}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" strokeLinecap="round" />
        <circle cx="12" cy="8" r="0.75" fill="currentColor" stroke="none" />
      </svg>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-52 -translate-x-1/2 rounded-md border border-line bg-ink-950 px-2.5 py-2 text-[11px] leading-snug text-slate-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {hint}
      </span>
    </span>
  )
}

function MetricCard({
  label,
  value,
  hint,
  valueClass = 'text-slate-100',
  active = false,
  onClick,
}: {
  label: string
  value: string
  hint?: string
  valueClass?: string
  active?: boolean
  onClick?: () => void
}) {
  const cls = `rounded-xl border p-4 min-w-0 text-left transition-colors ${
    active
      ? 'border-sky-500/50 bg-sky-950/40 ring-1 ring-sky-500/30'
      : 'border-line bg-ink-900'
  } ${onClick ? 'cursor-pointer hover:border-sky-600/40 hover:bg-ink-850' : ''}`
  const body = (
    <>
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="text-[12px] text-slate-400 truncate min-w-0">{label}</div>
        {hint ? <InfoIcon hint={hint} /> : null}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${valueClass}`}>
        {value}
      </div>
    </>
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} aria-pressed={active}>
        {body}
      </button>
    )
  }
  return <div className={cls}>{body}</div>
}

type GeneratorKpiFilter =
  | 'all'
  | 'journey'
  | 'positive'
  | 'negative'
  | 'edge'
  | 'security'
  | 'performance'
  | 'contract'

function flowKind(flow: { kind?: string }): string {
  const k = String(flow.kind || 'e2e').toLowerCase()
  return k === 'happy' ? 'e2e' : k
}

function pathRoot(path: unknown): string {
  const p = String(path || '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\{[^}]+\}/g, '')
  const parts = p.split('/').filter(Boolean)
  return (parts[0] || '').toLowerCase()
}

function isJourneyFlow(flow: {
  resource?: string
  name?: string
  kind?: string
  steps?: Array<Record<string, unknown> | unknown>
}): boolean {
  if (String(flow.resource || '').toLowerCase() === 'journey') return true
  if (/happy path|login to logout/i.test(String(flow.name || ''))) return true
  const steps = flow.steps || []
  if (flowKind(flow) !== 'e2e') return false
  if (steps.length >= 6) return true
  // Cross-resource E2E (e.g. user + pet + store) counts as a journey
  if (steps.length >= 4) {
    const roots = new Set(
      steps.map((s) => pathRoot((s as Record<string, unknown>)?.path)).filter(Boolean),
    )
    if (roots.size >= 2) return true
  }
  return false
}

function countFlowSteps(
  flows: Array<{ kind?: string; steps?: unknown[] }>,
  kinds: string | string[],
): number {
  const want = new Set((Array.isArray(kinds) ? kinds : [kinds]).map((k) => k.toLowerCase()))
  return flows.reduce((n, f) => {
    if (!want.has(flowKind(f))) return n
    return n + (f.steps?.length || 0)
  }, 0)
}

function flowsForKpiFilter<T extends { kind?: string; resource?: string; name?: string; steps?: unknown[] }>(
  flows: T[],
  filter: GeneratorKpiFilter,
): T[] {
  switch (filter) {
    case 'journey':
      return flows.filter(isJourneyFlow)
    case 'positive':
      return flows.filter((f) => ['e2e', 'contract'].includes(flowKind(f)))
    case 'negative':
      return flows.filter((f) => flowKind(f) === 'negative')
    case 'edge':
      return flows.filter((f) => flowKind(f) === 'edge')
    case 'security':
      return flows.filter((f) => flowKind(f) === 'security')
    case 'performance':
      return flows.filter((f) => flowKind(f) === 'load')
    case 'contract':
      return flows.filter((f) => flowKind(f) === 'contract')
    case 'all':
    default:
      return flows
  }
}

function StatusPill({ status }: { status: EndpointStatus | string | null | undefined }) {
  const { t } = usePreferences()
  if (!status) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-md border border-line text-[11px] font-semibold text-slate-500">
        —
      </span>
    )
  }
  const s = status as EndpointStatus
  const cls =
    s === 'pass'
      ? 'text-emerald-300 bg-emerald-500/15 border-emerald-700/40'
      : s === 'fail'
        ? 'text-red-300 bg-red-500/15 border-red-700/40'
        : 'text-amber-300 bg-amber-500/15 border-amber-700/40'
  const label =
    s === 'pass' ? t('apiStatusPass') : s === 'fail' ? t('apiStatusFail') : t('apiStatusDrift')
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function MethodBadge({ method }: { method: string }) {
  const m = method.toUpperCase() as HttpMethod
  const tone =
    m === 'GET'
      ? 'text-sky-300 border-sky-700/40 bg-sky-500/10'
      : m === 'POST'
        ? 'text-emerald-300 border-emerald-700/40 bg-emerald-500/10'
        : m === 'PATCH' || m === 'PUT'
          ? 'text-amber-300 border-amber-700/40 bg-amber-500/10'
          : 'text-red-300 border-red-700/40 bg-red-500/10'
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-bold mono ${tone}`}>
      {m}
    </span>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] text-slate-400">{label}</span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-line bg-ink-950 px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-sky-600'

function prettyJson(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function CodeBlock({ label, value, emptyLabel }: { label: string; value: unknown; emptyLabel: string }) {
  const text = prettyJson(value)
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <pre className="rounded-lg border border-line bg-ink-950 p-2.5 text-[11px] mono text-slate-300 overflow-x-auto max-h-56 scroll whitespace-pre-wrap break-all">
        {text || emptyLabel}
      </pre>
    </div>
  )
}

function methodSwaggerTone(method: string) {
  const m = method.toUpperCase()
  if (m === 'GET')
    return {
      badge: 'bg-sky-600',
      border: 'border-sky-600/50',
      bg: 'bg-sky-950/35',
    }
  if (m === 'POST')
    return {
      badge: 'bg-emerald-600',
      border: 'border-emerald-600/50',
      bg: 'bg-emerald-950/30',
    }
  if (m === 'PUT' || m === 'PATCH')
    return {
      badge: 'bg-amber-600',
      border: 'border-amber-600/50',
      bg: 'bg-amber-950/30',
    }
  if (m === 'DELETE')
    return {
      badge: 'bg-red-600',
      border: 'border-red-600/50',
      bg: 'bg-red-950/30',
    }
  return {
    badge: 'bg-slate-600',
    border: 'border-line',
    bg: 'bg-ink-900',
  }
}

function groupKeyFromPath(path: string): string {
  const seg = (path || '').split('/').filter(Boolean)[0]
  if (seg && !seg.includes('{')) return seg
  return ''
}

function resolveEndpointTag(
  endpoints: ApiEndpoint[],
  opts: {
    operationId?: string | null
    method?: string
    path?: string
    fallback?: string
  },
): string {
  const { operationId, method, path, fallback } = opts
  if (operationId) {
    const byId = endpoints.find((e) => e.operation_id === operationId)
    if (byId?.tags?.[0]) return byId.tags[0]
  }
  if (method && path) {
    const byRoute = endpoints.find(
      (e) => e.method.toUpperCase() === method.toUpperCase() && e.path === path,
    )
    if (byRoute?.tags?.[0]) return byRoute.tags[0]
  }
  const fromPath = path ? groupKeyFromPath(path) : ''
  return fromPath || fallback || 'default'
}

function matchesEndpointSearch(query: string, parts: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const tokens = q.split(/\s+/).filter(Boolean)
  const hay = parts
    .filter((p) => p != null && String(p).length > 0)
    .map((p) => String(p).toLowerCase())
    .join(' ')
  return tokens.every((tok) => hay.includes(tok))
}

function EndpointSearchBar({
  value,
  onChange,
  resultCount,
  placeholder,
  clearLabel,
}: {
  value: string
  onChange: (v: string) => void
  resultCount?: number
  placeholder: string
  clearLabel: string
}) {
  return (
    <div className="w-full flex flex-wrap items-center gap-2 mb-4">
      <div className="relative flex-1 min-w-[16rem]">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[13px]">
          ⌕
        </span>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputCls} pl-9`}
          autoComplete="off"
        />
      </div>
      {value.trim() ? (
        <>
          {typeof resultCount === 'number' ? (
            <span className="text-[12px] text-slate-500 tabular-nums">{resultCount}</span>
          ) : null}
          <button
            type="button"
            onClick={() => onChange('')}
            className="rounded-lg border border-line px-2.5 py-2 text-[12px] text-slate-300 hover:bg-ink-800"
          >
            {clearLabel}
          </button>
        </>
      ) : null}
    </div>
  )
}

function groupByTag<T>(items: T[], tagOf: (item: T) => string): { tag: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const tag = tagOf(item) || 'default'
    const list = map.get(tag)
    if (list) list.push(item)
    else map.set(tag, [item])
  }
  const preferred = ['journey', 'pet', 'store', 'user']
  return [...map.entries()]
    .sort(([a], [b]) => {
      const ia = preferred.indexOf(a.toLowerCase())
      const ib = preferred.indexOf(b.toLowerCase())
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      return a.localeCompare(b)
    })
    .map(([tag, grouped]) => ({ tag, items: grouped }))
}

function TagGroup({
  name,
  description,
  count,
  defaultOpen = true,
  children,
}: {
  name: string
  description?: string
  count?: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-line overflow-hidden bg-ink-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-ink-850"
      >
        <span className="text-[16px] font-bold text-slate-100">{name}</span>
        {description ? (
          <span className="text-[12px] text-slate-500 truncate min-w-0">{description}</span>
        ) : null}
        {typeof count === 'number' ? (
          <span className="ml-auto text-[11px] tabular-nums text-slate-500">{count}</span>
        ) : (
          <span className="ml-auto" />
        )}
        <span className="text-slate-500 text-[12px]">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="space-y-2 px-3 pb-3 pt-1 bg-ink-950/40">{children}</div>}
    </div>
  )
}

function ServiceBadge({ serviceKey }: { serviceKey?: string | null }) {
  if (!serviceKey) return null
  return (
    <span className="inline-flex items-center rounded border border-sky-700/50 bg-sky-950/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
      {serviceKey}
    </span>
  )
}

function SwaggerOpRow({
  method,
  path,
  summary,
  trailing,
  defaultOpen = false,
  children,
}: {
  method: string
  path: string
  summary?: string
  trailing?: ReactNode
  defaultOpen?: boolean
  children?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const tone = methodSwaggerTone(method)
  const expandable = Boolean(children)
  return (
    <div className={`rounded-lg border ${tone.border} ${tone.bg}`}>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => expandable && setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default"
      >
        <span
          className={`inline-flex min-w-[4.25rem] justify-center px-2 py-0.5 rounded text-[11px] font-bold text-white ${tone.badge}`}
        >
          {method.toUpperCase()}
        </span>
        <span className="mono text-[13px] font-semibold text-slate-100 shrink-0">{path}</span>
        {summary ? (
          <span className="text-[12px] text-slate-500 truncate min-w-0">{summary}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {trailing}
          {expandable ? (
            <span className="text-slate-500 text-[12px]">{open ? '▴' : '▾'}</span>
          ) : null}
        </span>
      </button>
      {expandable && open ? (
        <div className="px-3 pb-3 pt-1 border-t border-black/20">{children}</div>
      ) : null}
    </div>
  )
}

const SPECTRUM_LABELS: Record<string, string> = {
  contract: 'Contract / Schema',
  e2e: 'End-to-End',
  happy: 'End-to-End',
  edge: 'Boundary & Edge',
  negative: 'Negative & Errors',
  security: 'Security & Auth',
  load: 'Performance & Load',
}

function jsonDraft(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function parseJsonDraft(text: string, emptyAs: unknown): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, value: emptyAs }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    return { ok: false }
  }
}

function EditableJsonField({
  label,
  value,
  onChange,
  editing,
  emptyLabel,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  editing: boolean
  emptyLabel: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      {editing ? (
        <textarea
          className="w-full min-h-[7rem] rounded-lg border border-sky-700/50 bg-ink-950 p-2.5 text-[11px] mono text-slate-100 outline-none focus:border-sky-500 resize-y"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <pre className="rounded-lg border border-line bg-ink-950 p-2.5 text-[11px] mono text-slate-300 overflow-x-auto max-h-56 scroll whitespace-pre-wrap break-all">
          {value || emptyLabel}
        </pre>
      )}
    </div>
  )
}

function FlowStepDetailBlocks({
  step,
  flowName,
  projectId,
  onSaved,
}: {
  step: Record<string, unknown>
  flowName?: string
  projectId?: string
  onSaved?: (msg: string) => void
}) {
  const { t } = usePreferences()
  const method = String(step.method || 'GET')
  const path = String(step.path || '/')
  const pathTemplate =
    typeof step.path_template === 'string' ? String(step.path_template) : path
  const expected = Array.isArray(step.expected_status) ? step.expected_status : []
  const captures = step.captures
  const seedVar = step.seed_var
  const rationale = typeof step.rationale === 'string' ? step.rationale : ''

  const [editing, setEditing] = useState(false)
  const [headersText, setHeadersText] = useState(() => jsonDraft(step.headers ?? {}))
  const [queryText, setQueryText] = useState(() => jsonDraft(step.query ?? {}))
  const [bodyText, setBodyText] = useState(() => jsonDraft(step.body ?? null))
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [localError, setLocalError] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [runResult, setRunResult] = useState<{
    ok: boolean
    status: string
    auth_applied: boolean
    auth_schemes_ready: string[]
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
  } | null>(null)

  const parseRequestFields = () => {
    const h = parseJsonDraft(editing ? headersText : jsonDraft(step.headers ?? {}), {})
    const q = parseJsonDraft(editing ? queryText : jsonDraft(step.query ?? {}), {})
    const b = parseJsonDraft(editing ? bodyText : jsonDraft(step.body ?? null), null)
    if (!h.ok || !q.ok || !b.ok) return { error: t('apiInvalidJson') as string }
    if (h.value !== null && (typeof h.value !== 'object' || Array.isArray(h.value))) {
      return { error: `${t('apiHeaders')}: object required` }
    }
    if (q.value !== null && (typeof q.value !== 'object' || Array.isArray(q.value))) {
      return { error: `${t('apiQuery')}: object required` }
    }
    return {
      headers: (h.value || {}) as Record<string, unknown>,
      query: (q.value || {}) as Record<string, unknown>,
      body: b.value,
    }
  }

  const startEdit = () => {
    setHeadersText(jsonDraft(step.headers ?? {}))
    setQueryText(jsonDraft(step.query ?? {}))
    setBodyText(jsonDraft(step.body ?? null))
    setLocalError('')
    setSavedNote('')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setLocalError('')
  }

  const saveEdit = async () => {
    if (!projectId) {
      setLocalError(t('apiNeedProject'))
      return
    }
    const parsed = parseRequestFields()
    if ('error' in parsed && parsed.error) {
      setLocalError(parsed.error)
      return
    }
    setSaving(true)
    setLocalError('')
    try {
      const res = await api.saveApiRequestEdit(projectId, {
        method,
        path,
        path_template: pathTemplate,
        operation_id: step.operation_id ? String(step.operation_id) : undefined,
        flow_name: flowName,
        headers: parsed.headers,
        query: parsed.query,
        body: parsed.body,
        update_mock: true,
      })
      const msg = `${t('apiRequestSaved')} (${res.updated_steps} step${res.updated_steps === 1 ? '' : 's'}${
        res.updated_flows.length ? `: ${res.updated_flows.join(', ')}` : ''
      })`
      setSavedNote(msg)
      setEditing(false)
      onSaved?.(msg)
    } catch (e) {
      setLocalError(String((e as Error).message || e))
    } finally {
      setSaving(false)
    }
  }

  const runStep = async () => {
    if (!projectId) {
      setLocalError(t('apiNeedProject'))
      return
    }
    const parsed = parseRequestFields()
    if ('error' in parsed && parsed.error) {
      setLocalError(parsed.error)
      return
    }
    setRunning(true)
    setLocalError('')
    setSavedNote('')
    setRunResult(null)
    try {
      const res = await api.runApiStep(projectId, {
        method,
        path,
        path_template: pathTemplate,
        operation_id: step.operation_id ? String(step.operation_id) : undefined,
        flow_name: flowName,
        headers: parsed.headers,
        query: parsed.query,
        body: parsed.body,
        captures: Array.isArray(step.captures)
          ? (step.captures as Array<Record<string, unknown>>)
          : undefined,
        seed_var:
          step.seed_var && typeof step.seed_var === 'object'
            ? (step.seed_var as Record<string, unknown>)
            : undefined,
        expected_status: expected.map((x) => Number(x)).filter((n) => !Number.isNaN(n)),
        kind: typeof step.kind === 'string' ? step.kind : 'e2e',
        use_auth: true,
        skip_auth: false,
      })
      setRunResult(res)
      if (res.warning) setLocalError(res.warning)
    } catch (e) {
      setLocalError(String((e as Error).message || e))
    } finally {
      setRunning(false)
    }
  }

  const liveResp = runResult?.result?.response || null
  const liveStatus = liveResp?.status_code
  const liveAssertions = (runResult?.result?.assertions || []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 items-center">
        <span>
          {t('apiUrl')}: <span className="mono text-slate-200">{path}</span>
        </span>
        {pathTemplate !== path ? (
          <span>
            template: <span className="mono text-slate-300">{pathTemplate}</span>
          </span>
        ) : null}
        {expected.length > 0 ? (
          <span>
            {t('apiExpectedStatus')}:{' '}
            <span className="tabular-nums text-slate-200">{expected.join(', ')}</span>
          </span>
        ) : null}
        {step.skip_auth ? (
          <span className="text-amber-300 border border-amber-700/40 px-1.5 py-0.5 rounded">
            skip_auth
          </span>
        ) : null}
        {step.security_probe ? (
          <span className="text-rose-300 border border-rose-700/40 px-1.5 py-0.5 rounded">
            {String(step.security_probe)}
          </span>
        ) : null}
        {projectId ? (
          <span className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              disabled={running || saving}
              onClick={() => runStep()}
              className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-2.5 py-1 text-[11px] font-semibold text-white"
              title={t('apiRunStepAuthHint')}
            >
              {running ? t('apiRunningStep') : t('apiRunStep')}
            </button>
            {!editing ? (
              <button
                type="button"
                onClick={startEdit}
                className="rounded-md border border-sky-700/50 bg-sky-950/40 px-2.5 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-900/50"
              >
                {t('apiEditRequest')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={saving || running}
                  onClick={() => saveEdit()}
                  className="rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  {saving ? t('apiSaving') : t('apiSaveRequest')}
                </button>
                <button
                  type="button"
                  disabled={saving || running}
                  onClick={cancelEdit}
                  className="rounded-md border border-line px-2.5 py-1 text-[11px] text-slate-300 hover:bg-ink-800"
                >
                  {t('apiCancelEdit')}
                </button>
              </>
            )}
          </span>
        ) : null}
      </div>
      <div className="text-[11px] text-slate-500">{t('apiRunStepAuthHint')}</div>
      {rationale ? (
        <div className="text-[12px] text-slate-400 leading-relaxed">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-2">
            {t('apiRationale')}
          </span>
          {rationale}
        </div>
      ) : null}
      {localError ? <div className="text-[12px] text-red-300">{localError}</div> : null}
      {savedNote ? <div className="text-[12px] text-emerald-300">{savedNote}</div> : null}
      {runResult ? (
        <div
          className={`rounded-lg border px-3 py-2 text-[12px] space-y-1 ${
            runResult.ok
              ? 'border-emerald-700/40 bg-emerald-950/30 text-emerald-100'
              : 'border-rose-700/40 bg-rose-950/30 text-rose-100'
          }`}
        >
          <div className="font-semibold flex flex-wrap gap-2 items-center">
            <span>
              {runResult.ok ? t('apiStepRunPass') : t('apiStepRunFail')}
              {liveStatus != null ? ` · HTTP ${String(liveStatus)}` : ''}
              {runResult.result.latency_ms != null
                ? ` · ${runResult.result.latency_ms}ms`
                : ''}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                runResult.auth_applied
                  ? 'border-emerald-600/50 text-emerald-200'
                  : 'border-amber-600/50 text-amber-200'
              }`}
            >
              {runResult.auth_applied ? t('apiAuthApplied') : t('apiAuthNotApplied')}
            </span>
            {runResult.auth_schemes_ready?.length ? (
              <span className="text-[11px] opacity-80 mono">
                {runResult.auth_schemes_ready.join(', ')}
              </span>
            ) : null}
          </div>
          {runResult.result.error ? (
            <div className="text-[11px] opacity-90">{String(runResult.result.error)}</div>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-slate-200">{t('apiRequest')}</div>
          <EditableJsonField
            label={t('apiHeaders')}
            value={editing ? headersText : jsonDraft(step.headers ?? {})}
            onChange={setHeadersText}
            editing={editing}
            emptyLabel={t('apiNoPayload')}
          />
          <EditableJsonField
            label={t('apiQuery')}
            value={editing ? queryText : jsonDraft(step.query ?? {})}
            onChange={setQueryText}
            editing={editing}
            emptyLabel={t('apiNoPayload')}
          />
          <EditableJsonField
            label={t('apiBody')}
            value={editing ? bodyText : jsonDraft(step.body ?? null)}
            onChange={setBodyText}
            editing={editing}
            emptyLabel={t('apiNoPayload')}
          />
        </div>
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-slate-200">
            {runResult ? t('apiResponse') : t('apiStepMeta')}
          </div>
          {runResult ? (
            <>
              <CodeBlock
                label={t('apiBody')}
                value={liveResp?.body ?? liveResp}
                emptyLabel={t('apiNoPayload')}
              />
              <CodeBlock
                label={t('apiCaptures')}
                value={runResult.result.captures}
                emptyLabel={t('apiNoPayload')}
              />
              {liveAssertions.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    {t('apiAssertions')}
                  </div>
                  {liveAssertions.map((a, i) => (
                    <div
                      key={i}
                      className={`text-[11px] flex gap-2 ${
                        a.pass ? 'text-emerald-300/90' : 'text-red-300'
                      }`}
                    >
                      <span className="font-semibold shrink-0">
                        {a.pass ? '✓' : '×'} {String(a.name || 'assert')}
                      </span>
                      <span className="text-slate-400 truncate">{String(a.detail || '')}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <CodeBlock label={t('apiCaptures')} value={captures} emptyLabel={t('apiNoPayload')} />
              <CodeBlock label={t('apiSeedVar')} value={seedVar} emptyLabel={t('apiNoPayload')} />
              <CodeBlock
                label={t('apiExpectedStatus')}
                value={expected}
                emptyLabel={t('apiNoPayload')}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StepDetailBlocks({
  step,
  projectId,
  onSaved,
}: {
  step: ApiRunStep
  projectId?: string
  onSaved?: (msg: string) => void
}) {
  const { t } = usePreferences()
  const detail = (step.detail || {}) as Record<string, unknown>
  const req = (detail.request || {}) as Record<string, unknown>
  const resp = (detail.response || null) as Record<string, unknown> | null
  const assertions = (detail.assertions || []) as Array<Record<string, unknown>>
  const captures = detail.captures as Record<string, unknown> | undefined
  const statusCode = resp?.status_code

  const [editing, setEditing] = useState(false)
  const [headersText, setHeadersText] = useState(() => jsonDraft(req.headers ?? {}))
  const [queryText, setQueryText] = useState(() => jsonDraft(req.query ?? {}))
  const [bodyText, setBodyText] = useState(() => jsonDraft(req.body ?? null))
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  const [savedNote, setSavedNote] = useState('')

  const startEdit = () => {
    setHeadersText(jsonDraft(req.headers ?? {}))
    setQueryText(jsonDraft(req.query ?? {}))
    setBodyText(jsonDraft(req.body ?? null))
    setLocalError('')
    setSavedNote('')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setLocalError('')
  }

  const saveEdit = async () => {
    if (!projectId) {
      setLocalError(t('apiNeedProject'))
      return
    }
    const h = parseJsonDraft(headersText, {})
    const q = parseJsonDraft(queryText, {})
    const b = parseJsonDraft(bodyText, null)
    if (!h.ok || !q.ok || !b.ok) {
      setLocalError(t('apiInvalidJson'))
      return
    }
    if (h.value !== null && (typeof h.value !== 'object' || Array.isArray(h.value))) {
      setLocalError(`${t('apiHeaders')}: object required`)
      return
    }
    if (q.value !== null && (typeof q.value !== 'object' || Array.isArray(q.value))) {
      setLocalError(`${t('apiQuery')}: object required`)
      return
    }
    setSaving(true)
    setLocalError('')
    try {
      const pathTemplate =
        typeof (detail as { path_template?: string }).path_template === 'string'
          ? String((detail as { path_template?: string }).path_template)
          : step.path
      const res = await api.saveApiRequestEdit(projectId, {
        method: step.method,
        path: step.path,
        path_template: pathTemplate,
        operation_id: step.operation_id || undefined,
        flow_name: step.flow_name || undefined,
        headers: (h.value || {}) as Record<string, unknown>,
        query: (q.value || {}) as Record<string, unknown>,
        body: b.value,
        update_mock: true,
      })
      const msg = `${t('apiRequestSaved')} (${res.updated_steps} step${res.updated_steps === 1 ? '' : 's'}${
        res.updated_flows.length ? `: ${res.updated_flows.join(', ')}` : ''
      })`
      setSavedNote(msg)
      setEditing(false)
      onSaved?.(msg)
    } catch (e) {
      setLocalError(String((e as Error).message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 items-center">
        <span>
          {t('apiUrl')}:{' '}
          <span className="mono text-slate-200">{String(req.url || step.path || '—')}</span>
        </span>
        {statusCode != null && (
          <span>
            {t('apiStatusCode')}:{' '}
            <span className="tabular-nums text-slate-200">{String(statusCode)}</span>
          </span>
        )}
        {detail.error != null && String(detail.error) ? (
          <span className="text-red-300">{String(detail.error)}</span>
        ) : null}
        {projectId ? (
          <span className="ml-auto flex flex-wrap gap-2">
            {!editing ? (
              <button
                type="button"
                onClick={startEdit}
                className="rounded-md border border-sky-700/50 bg-sky-950/40 px-2.5 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-900/50"
              >
                {t('apiEditRequest')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveEdit()}
                  className="rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  {saving ? t('apiSaving') : t('apiSaveRequest')}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={cancelEdit}
                  className="rounded-md border border-line px-2.5 py-1 text-[11px] text-slate-300 hover:bg-ink-800"
                >
                  {t('apiCancelEdit')}
                </button>
              </>
            )}
          </span>
        ) : null}
      </div>
      {localError ? <div className="text-[12px] text-red-300">{localError}</div> : null}
      {savedNote ? <div className="text-[12px] text-emerald-300">{savedNote}</div> : null}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-slate-200">{t('apiRequest')}</div>
          <EditableJsonField
            label={t('apiHeaders')}
            value={editing ? headersText : jsonDraft(req.headers ?? {})}
            onChange={setHeadersText}
            editing={editing}
            emptyLabel={t('apiNoPayload')}
          />
          <EditableJsonField
            label={t('apiQuery')}
            value={editing ? queryText : jsonDraft(req.query ?? {})}
            onChange={setQueryText}
            editing={editing}
            emptyLabel={t('apiNoPayload')}
          />
          <EditableJsonField
            label={t('apiBody')}
            value={editing ? bodyText : jsonDraft(req.body ?? null)}
            onChange={setBodyText}
            editing={editing}
            emptyLabel={t('apiNoPayload')}
          />
        </div>
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-slate-200">{t('apiResponse')}</div>
          <CodeBlock
            label={t('apiBody')}
            value={resp?.body ?? resp}
            emptyLabel={t('apiNoPayload')}
          />
          <CodeBlock label={t('apiCaptures')} value={captures} emptyLabel={t('apiNoPayload')} />
        </div>
      </div>
      {assertions.length > 0 && (
        <div>
          <div className="text-[12px] font-semibold text-slate-200 mb-1.5">{t('apiAssertions')}</div>
          <div className="space-y-1">
            {assertions.map((a, i) => (
              <div
                key={i}
                className={`text-[11px] flex gap-2 ${a.pass ? 'text-emerald-300/90' : 'text-red-300'}`}
              >
                <span className="font-semibold shrink-0">
                  {a.pass ? '✓' : '×'} {String(a.name || 'assert')}
                </span>
                <span className="text-slate-400 truncate">{String(a.detail || '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AllureReportView({
  run,
  steps,
  endpoints,
  projectId,
  endpointQuery = '',
  insights: insightsProp,
  loadingInsights,
  onClose,
}: {
  run: ApiRun
  steps: ApiRunStep[]
  endpoints: ApiEndpoint[]
  projectId?: string
  endpointQuery?: string
  insights?: NonNullable<ApiRun['summary']['insights']> | null
  loadingInsights?: boolean
  onClose: () => void
}) {
  const { t } = usePreferences()
  const insights = insightsProp || run.summary?.insights
  const spectrum = run.summary?.spectrum || {}
  const themes = insights?.themes || []
  const visibleSteps = useMemo(
    () =>
      steps.filter((s) =>
        matchesEndpointSearch(endpointQuery, [
          s.method,
          s.path,
          s.operation_id,
          s.flow_name,
          resolveEndpointTag(endpoints, {
            operationId: s.operation_id,
            method: s.method,
            path: s.path,
          }),
        ]),
      ),
    [steps, endpointQuery, endpoints],
  )
  const failed = run.summary?.failed ?? 0
  const total = run.summary?.total ?? 0
  const passed = run.summary?.passed ?? 0
  const passRate =
    insights?.pass_rate ??
    (total ? Math.round((passed / Math.max(total, 1)) * 1000) / 10 : 0)
  const verdict =
    insights?.verdict ||
    (failed === 0 && total > 0 ? 'healthy' : passRate >= 70 ? 'degraded' : 'critical')
  const bannerCls =
    verdict === 'healthy'
      ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-100'
      : verdict === 'degraded'
        ? 'border-amber-700/50 bg-amber-950/40 text-amber-100'
        : 'border-rose-700/50 bg-rose-950/40 text-rose-100'
  const headline =
    insights?.headline ||
    (failed === 0
      ? 'All executed steps passed.'
      : `High failure rate (${passRate}% pass). ${failed} of ${total} steps failed.`)
  const summaryText =
    insights?.summary ||
    `${headline} Avg latency ${run.summary?.avg_latency_ms ?? 0}ms.`
  const rootCause =
    insights?.primary_root_cause ||
    themes[0]?.root_cause ||
    (failed > 0
      ? 'Failures detected, but RCA is still loading. Open a failed step below for HTTP status and assertion detail.'
      : 'No failures detected.')
  const solution =
    insights?.primary_solution ||
    themes[0]?.solution ||
    (failed > 0
      ? 'Inspect failed steps (status/assertions), fix payload/auth/binding, then re-run the suite.'
      : 'Keep monitoring; re-run after OpenAPI changes.')

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-line hover:bg-ink-800 px-3 py-2 text-[13px] text-slate-200"
        >
          ← {t('apiCloseReport')}
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-100">{t('apiAllureReport')}</h1>
          <p className="text-[12px] text-slate-500 mono truncate">
            {run.id} · {new Date(run.created_at).toLocaleString()}
          </p>
        </div>
      </div>

      <div className={`rounded-xl border px-4 py-3 space-y-1.5 ${bannerCls}`}>
        <div className="text-[10px] uppercase tracking-wider opacity-70">{t('apiRunSummary')}</div>
        <div className="text-[15px] font-semibold">{headline}</div>
        <div className="text-[13px] opacity-90 leading-relaxed">{summaryText}</div>
        {loadingInsights ? (
          <div className="text-[11px] opacity-70">Analyzing root cause…</div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <MetricCard label={t('apiStatusPass')} value={String(passed)} valueClass="text-emerald-300" />
        <MetricCard label={t('apiStatusFail')} value={String(failed)} valueClass="text-red-300" />
        <MetricCard label="Pass rate" value={`${passRate}%`} />
        <MetricCard label="Avg latency" value={`${run.summary?.avg_latency_ms ?? 0}ms`} />
        <MetricCard label={t('apiSelfHealed')} value={String(run.summary?.self_healed_steps ?? 0)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-rose-800/40 bg-rose-950/20 p-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-rose-300/80">{t('apiRootCause')}</div>
          <div className="text-[13px] text-slate-100 leading-relaxed whitespace-pre-wrap">{rootCause}</div>
        </div>
        <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-emerald-300/80">
            {t('apiSolution')} hints
          </div>
          <div className="text-[13px] text-emerald-100/95 leading-relaxed whitespace-pre-wrap">
            {solution}
          </div>
        </div>
      </div>

      {Object.keys(spectrum).length > 0 && (
        <div className="space-y-2">
          <h2 className="text-[13px] font-semibold text-slate-200">{t('apiSpectrumCoverage')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {Object.entries(spectrum).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-ink-900 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  {SPECTRUM_LABELS[k] || k}
                </div>
                <div className="text-lg font-semibold tabular-nums text-slate-100 mt-0.5">{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {themes.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-[13px] font-semibold text-slate-200">{t('apiFailureThemes')}</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {themes.map((theme, i) => (
              <div key={i} className="rounded-xl border border-line bg-ink-900 p-4 space-y-2 text-[12px]">
                <div className="font-semibold text-slate-100">
                  {theme.title}{' '}
                  {theme.count != null && (
                    <span className="text-slate-500 font-normal">×{theme.count}</span>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    {t('apiRootCause')}
                  </div>
                  <div className="text-slate-300 mt-0.5 leading-relaxed">{theme.root_cause || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    {t('apiSolution')}
                  </div>
                  <div className="text-emerald-300/90 mt-0.5 leading-relaxed">
                    {theme.solution || '—'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-[13px] font-semibold text-slate-200">{t('apiRunSummary')}</h2>
        <p className="text-[11px] text-slate-500">{t('apiReportDetails')}</p>
        <div className="space-y-3">
          {groupByTag(visibleSteps, (s) =>
            resolveEndpointTag(endpoints, {
              operationId: s.operation_id,
              method: s.method,
              path: s.path,
              fallback: t('apiUntagged'),
            }),
          ).map(({ tag, items }) => (
            <TagGroup
              key={tag}
              name={tag}
              description={`${items.filter((x) => x.status === 'pass').length}/${items.length} pass`}
              count={items.length}
              defaultOpen
            >
              {items.map((s) => {
                const detail = (s.detail || {}) as Record<string, unknown>
                const resp = (detail.response || null) as Record<string, unknown> | null
                const statusCode = resp?.status_code
                return (
                  <SwaggerOpRow
                    key={s.id}
                    method={s.method}
                    path={s.path}
                    summary={s.flow_name}
                    trailing={
                      <span className="flex items-center gap-2">
                        {statusCode != null && (
                          <span className="tabular-nums text-slate-400 text-[11px]">
                            {String(statusCode)}
                          </span>
                        )}
                        <span className="tabular-nums text-slate-500 text-[11px]">
                          {s.latency_ms}ms
                        </span>
                        <StatusPill status={s.status === 'pass' ? 'pass' : 'fail'} />
                      </span>
                    }
                    defaultOpen={s.status !== 'pass'}
                  >
                    <StepDetailBlocks step={s} projectId={projectId} />
                  </SwaggerOpRow>
                )
              })}
            </TagGroup>
          ))}
          {!visibleSteps.length && (
            <div className="rounded-xl border border-line bg-ink-900 px-4 py-5 text-sm text-slate-500">
              {endpointQuery.trim() ? t('apiSearchNoMatch') : t('apiNoSteps')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ApiTestConsolePage({ sessions: _sessions }: Props) {
  const { t } = usePreferences()
  const [tab, setTab] = useState<ApiTab>('overview')
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem(PROJECT_KEY) || '')
  const [overview, setOverview] = useState<ApiOverview | null>(null)
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([])
  const [flows, setFlows] = useState<ApiFlow[]>([])
  const [drift, setDrift] = useState<ApiDrift | null>(null)
  const [history, setHistory] = useState<ApiRun[]>([])
  const [security, setSecurity] = useState<ApiSecurityScheme[]>([])
  const [anomalies, setAnomalies] = useState<ApiAnomaly[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [liveSteps, setLiveSteps] = useState<ApiRunStep[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [collapsedRuns, setCollapsedRuns] = useState<Record<string, boolean>>({})
  const [runStepsById, setRunStepsById] = useState<Record<string, ApiRunStep[]>>({})
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null)
  const [reportRunId, setReportRunId] = useState<string | null>(null)
  const [reportInsights, setReportInsights] = useState<
    NonNullable<ApiRun['summary']['insights']> | null
  >(null)
  const [loadingInsights, setLoadingInsights] = useState(false)

  // config form
  const [name, setName] = useState('API suite')
  const [baseUrl, setBaseUrl] = useState('')
  const [openapiUrl, setOpenapiUrl] = useState('')
  const [services, setServices] = useState<ApiService[]>([])
  const [genBudget, setGenBudget] = useState(40)
  const [flakyThreshold, setFlakyThreshold] = useState(0.3)
  const [allowPrivate, setAllowPrivate] = useState(false)
  const [mockMode, setMockMode] = useState(false)
  const [mockFixtureCount, setMockFixtureCount] = useState(0)
  const [sourceKind, setSourceKind] = useState('')
  const [latencyBudget, setLatencyBudget] = useState(5000)
  const [endpointQuery, setEndpointQuery] = useState('')
  const deferredEndpointQuery = useDeferredValue(endpointQuery)
  const [generateMeta, setGenerateMeta] = useState<{
    llm_used?: boolean
    ai_flows?: number
    ai_steps?: number
    ai_journeys?: number
  } | null>(null)
  const [kpiFilter, setKpiFilter] = useState<GeneratorKpiFilter>('all')
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleCadence, setScheduleCadence] = useState<SchedulePreset>('every_day')
  const [scheduleInfo, setScheduleInfo] = useState<ApiProjectSchedule | null>(null)
  const [scheduleNotice, setScheduleNotice] = useState('')

  // auth form
  const [authScheme, setAuthScheme] = useState('api_key')
  const [authType, setAuthType] = useState('apiKey')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [bearer, setBearer] = useState('')
  const [scope, setScope] = useState('')
  const [oauthCode, setOauthCode] = useState('')
  const [connResult, setConnResult] = useState<{
    ok: boolean
    message: string
    status_code: number | null
    latency_ms: number
    url: string
    method?: string
    scheme_name?: string | null
  } | null>(null)

  const project = projects.find((p) => p.id === projectId) || null

  const refreshProjects = useCallback(async () => {
    const list = await api.listApiProjects()
    setProjects(list)
    if (!projectId && list.length) {
      setProjectId(list[0].id)
      localStorage.setItem(PROJECT_KEY, list[0].id)
    }
    return list
  }, [projectId])

  const loadRunSteps = useCallback(async (runId: string) => {
    const steps = await api.getApiRunSteps(runId)
    setRunStepsById((prev) => ({ ...prev, [runId]: steps }))
    return steps
  }, [])

  const loadProjectData = useCallback(async (id: string) => {
    if (!id) return
    const [ov, eps, fl, dr, hist, sec, anom, sched, svcs] = await Promise.all([
      api.getApiOverview(id),
      api.listApiEndpoints(id),
      api.listApiFlows(id),
      api.getApiDrift(id),
      api.listApiHistory(id),
      api.listApiSecurity(id),
      api.listApiAnomalies(id),
      api.getApiSchedule(id).catch(() => null),
      api.listApiServices(id).catch(() => [] as ApiService[]),
    ])
    setOverview(ov)
    setEndpoints(eps)
    setFlows(fl)
    setDrift(dr)
    setHistory(hist)
    setSecurity(sec)
    setAnomalies(anom)
    setServices(svcs)
    setName(ov.project.name)
    setBaseUrl(ov.project.base_url || svcs[0]?.base_url || '')
    setOpenapiUrl(ov.project.openapi_url || svcs[0]?.openapi_url || '')
    setGenBudget(ov.project.config?.generation_budget ?? 40)
    setFlakyThreshold(ov.project.config?.flaky_threshold ?? 0.3)
    setAllowPrivate(Boolean(ov.project.config?.allow_private_urls))
    setMockMode(Boolean(ov.project.config?.mock_mode))
    setMockFixtureCount(Object.keys(ov.project.config?.mock_data || {}).length)
    setSourceKind(String(ov.project.config?.source || ''))
    setLatencyBudget(ov.project.config?.latency_budget_ms ?? 5000)
    if (sched) {
      setScheduleInfo(sched)
      setScheduleEnabled(Boolean(sched.enabled))
      const cadence = String(sched.schedule || 'every_day')
      setScheduleCadence(
        cadence === 'every_hour' || cadence === 'every_week' ? cadence : 'every_day',
      )
    } else {
      setScheduleInfo(null)
      setScheduleEnabled(false)
      setScheduleCadence('every_day')
    }
    setAuthScheme((prev) => prev || (sec[0]?.name ?? ''))
    // Prefetch steps for finished runs so history shows results expanded by default
    const finished = hist.filter((r) => r.status === 'completed' || r.status === 'failed')
    await Promise.all(
      finished.map(async (r) => {
        try {
          const steps = await api.getApiRunSteps(r.id)
          setRunStepsById((prev) => ({ ...prev, [r.id]: steps }))
        } catch {
          /* ignore per-run load errors */
        }
      }),
    )
  }, [])

  useEffect(() => {
    refreshProjects().catch((e) => setError(String(e.message || e)))
  }, [refreshProjects])

  useEffect(() => {
    if (!projectId) return
    localStorage.setItem(PROJECT_KEY, projectId)
    loadProjectData(projectId).catch((e) => setError(String(e.message || e)))
  }, [projectId, loadProjectData])

  useEffect(() => {
    if (!activeRunId) return
    const unsub = connectApiRunWs(activeRunId, (ev) => {
      if (ev.type === 'step') {
        setLiveSteps((prev) => [
          ...prev,
          {
            id: String(ev.id || prev.length),
            run_id: activeRunId,
            idx: prev.length,
            flow_name: String(ev.payload.flow || ''),
            method: String(ev.payload.method || ''),
            path: String(ev.payload.path || ''),
            operation_id: (ev.payload.operation_id as string) || null,
            status: String(ev.payload.status || 'fail'),
            latency_ms: Number(ev.payload.latency_ms || 0),
            detail: ev.payload,
          },
        ])
      }
      if (ev.type === 'done' || ev.type === 'error' || ev.type === 'analysis') {
        if (projectId) {
          loadProjectData(projectId).catch(() => undefined)
          api.listApiHistory(projectId).then(setHistory).catch(() => undefined)
        }
        setBusy('')
      }
    })
    return unsub
  }, [activeRunId, projectId, loadProjectData])

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setBusy('')
    }
  }

  const ensureProject = async () => {
    if (projectId) return projectId
    const primary = services[0]
    const p = await api.createApiProject({
      name: name || 'API suite',
      base_url: primary?.base_url || baseUrl,
      openapi_url: primary?.openapi_url || openapiUrl,
      config: {
        generation_budget: genBudget,
        flaky_threshold: flakyThreshold,
        allow_private_urls: allowPrivate,
        latency_budget_ms: latencyBudget,
      },
    })
    setProjectId(p.id)
    await refreshProjects()
    return p.id
  }

  const saveConfig = () =>
    withBusy(t('apiSaving'), async () => {
      const id = await ensureProject()
      const existing = (await api.getApiProject(id)).config || {}
      const primary = services[0]
      await api.updateApiProject(id, {
        name,
        base_url: primary?.base_url || baseUrl,
        openapi_url: primary?.openapi_url || openapiUrl,
        config: {
          ...existing,
          generation_budget: genBudget,
          flaky_threshold: flakyThreshold,
          allow_private_urls: allowPrivate,
          latency_budget_ms: latencyBudget,
          mock_mode: mockMode,
        },
      })
      for (const svc of services) {
        if (!svc.id || svc.id.startsWith('legacy:')) continue
        await api.updateApiService(id, svc.id, {
          key: svc.key,
          name: svc.name,
          base_url: svc.base_url,
          openapi_url: svc.openapi_url,
        })
      }
      await refreshProjects()
      await loadProjectData(id)
    })

  const updateServiceLocal = (serviceId: string, patch: Partial<ApiService>) => {
    setServices((prev) => prev.map((s) => (s.id === serviceId ? { ...s, ...patch } : s)))
  }

  const addService = () =>
    withBusy(t('apiSaving'), async () => {
      const id = await ensureProject()
      const keyBase = `service${services.length + 1}`
      await api.createApiService(id, {
        key: keyBase,
        name: keyBase,
        base_url: '',
        openapi_url: '',
      })
      await loadProjectData(id)
    })

  const removeService = (serviceId: string) =>
    withBusy(t('apiSaving'), async () => {
      const id = await ensureProject()
      await api.deleteApiService(id, serviceId)
      await loadProjectData(id)
    })

  const doServiceIngest = (svc: ApiService) =>
    withBusy(t('apiIngesting'), async () => {
      if (!svc.openapi_url.trim()) {
        throw new Error(t('apiNeedOpenApiUrl'))
      }
      const id = await ensureProject()
      await api.updateApiService(id, svc.id, {
        base_url: svc.base_url,
        openapi_url: svc.openapi_url,
      })
      const res = await api.ingestApiService(id, svc.id, svc.openapi_url.trim())
      await loadProjectData(id)
      const schemes = res.security_schemes || []
      setSecurity(schemes)
      if (schemes[0]?.name) {
        setAuthScheme(schemes[0].name)
        setAuthType(schemes[0].type || 'apiKey')
      }
    })

  const doServiceUpload = (svc: ApiService, file: File) =>
    withBusy(t('apiIngesting'), async () => {
      const id = await ensureProject()
      const res = await api.ingestApiServiceUpload(id, svc.id, file)
      await loadProjectData(id)
      if (res.source === 'postman' || res.mock_fixtures) {
        setSourceKind('postman')
        setMockFixtureCount(Number(res.mock_fixtures || 0))
      }
    })

  const saveSchedule = () =>
    withBusy(t('apiSaving'), async () => {
      const id = await ensureProject()
      const sched = await api.saveApiSchedule(id, {
        enabled: scheduleEnabled,
        schedule: scheduleCadence,
      })
      setScheduleInfo(sched)
      setScheduleEnabled(Boolean(sched.enabled))
      const cadence = String(sched.schedule || 'every_day')
      setScheduleCadence(
        cadence === 'every_hour' || cadence === 'every_week' ? cadence : 'every_day',
      )
      setScheduleNotice(t('apiNightlySaved'))
    })

  const runScheduleNow = () =>
    withBusy(t('apiRunning'), async () => {
      const id = await ensureProject()
      const res = await api.runApiScheduleNow(id)
      setScheduleInfo(res.schedule)
      setScheduleEnabled(Boolean(res.schedule.enabled))
      if (res.run_id) {
        setActiveRunId(res.run_id)
        setLiveSteps([])
        setTab('history')
      }
      setScheduleNotice(t('apiNightlyTriggered'))
      await loadProjectData(id)
    })

  const doIngest = () => {
    const primary = services[0]
    if (primary) return doServiceIngest(primary)
    return withBusy(t('apiIngesting'), async () => {
      if (!openapiUrl.trim()) {
        throw new Error(t('apiNeedOpenApiUrl'))
      }
      const id = await ensureProject()
      await api.updateApiProject(id, { base_url: baseUrl, openapi_url: openapiUrl })
      const res = await api.ingestApiProject(id, openapiUrl.trim())
      await loadProjectData(id)
      const schemes = res.security_schemes || []
      setSecurity(schemes)
      if (schemes[0]?.name) {
        setAuthScheme(schemes[0].name)
        setAuthType(schemes[0].type || 'apiKey')
      }
    })
  }

  const doUpload = (file: File) =>
    withBusy(t('apiIngesting'), async () => {
      const id = await ensureProject()
      const nameLower = file.name.toLowerCase()
      const res =
        nameLower.includes('postman') || nameLower.endsWith('.postman_collection.json')
          ? await api.ingestApiPostman(id, file)
          : await api.ingestApiUpload(id, file)
      await loadProjectData(id)
      if (res.source === 'postman' || (res as { mock_fixtures?: number }).mock_fixtures) {
        setSourceKind('postman')
        setMockFixtureCount(Number((res as { mock_fixtures?: number }).mock_fixtures || 0))
      }
    })

  const doPostmanUpload = (file: File) =>
    withBusy(t('apiIngesting'), async () => {
      const id = await ensureProject()
      const res = await api.ingestApiPostman(id, file)
      await loadProjectData(id)
      setSourceKind('postman')
      setMockFixtureCount(res.mock_fixtures || 0)
      setName((prev) => prev || res.project.name)
      if (res.project.base_url) setBaseUrl(res.project.base_url)
    })

  const doMockDataUpload = (file: File) =>
    withBusy(t('apiSaving'), async () => {
      const id = projectId || (await ensureProject())
      const text = await file.text()
      const parsed = JSON.parse(text) as Record<string, unknown>
      const mock =
        parsed && typeof parsed === 'object' && 'mock_data' in parsed
          ? (parsed.mock_data as Record<string, unknown>)
          : parsed
      const res = await api.saveApiMockData(id, mock)
      setMockFixtureCount(res.fixture_count)
      await loadProjectData(id)
    })

  const doGenerate = () =>
    withBusy(t('apiGenerating'), async () => {
      if (!projectId) throw new Error(t('apiNeedProject'))
      const res = await api.generateApiFlows(projectId)
      setFlows(res.flows)
      setGenerateMeta({
        llm_used: res.llm_used,
        ai_flows: res.ai_flows ?? res.count,
        ai_steps: res.ai_steps,
        ai_journeys: res.ai_journeys,
      })
      setKpiFilter('all')
      await loadProjectData(projectId)
    })

  const doRun = () =>
    withBusy(t('apiRunning'), async () => {
      if (!projectId) throw new Error(t('apiNeedProject'))
      setLiveSteps([])
      const run = await api.startApiRun(projectId)
      setActiveRunId(run.id)
      setTab('history')
    })

  const doDeleteRun = (run: ApiRun) => {
    if (!projectId) return
    if (!window.confirm(t('apiDeleteRunConfirm'))) return
    withBusy(t('apiDeletingRun'), async () => {
      await api.deleteApiRun(projectId, run.id)
      setHistory((prev) => prev.filter((r) => r.id !== run.id))
      setRunStepsById((prev) => {
        const next = { ...prev }
        delete next[run.id]
        return next
      })
      setCollapsedRuns((prev) => {
        const next = { ...prev }
        delete next[run.id]
        return next
      })
      if (reportRunId === run.id) setReportRunId(null)
      if (activeRunId === run.id) {
        setActiveRunId(null)
        setLiveSteps([])
      }
      await loadProjectData(projectId)
    })
  }

  const doClearHistory = () => {
    if (!projectId) return
    if (!history.length) return
    if (!window.confirm(t('apiClearHistoryConfirm'))) return
    withBusy(t('apiClearingHistory'), async () => {
      await api.clearApiHistory(projectId)
      setHistory([])
      setRunStepsById({})
      setCollapsedRuns({})
      setReportRunId(null)
      setActiveRunId(null)
      setLiveSteps([])
      await loadProjectData(projectId)
    })
  }

  const doExportPostman = () =>
    withBusy(t('apiExportingPostman'), async () => {
      if (!projectId) throw new Error(t('apiNeedProject'))
      if (!flows.length) throw new Error(t('apiExportPostmanNeedFlows'))
      const { blob, filename } = await api.exportApiPostmanCollection(projectId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    })

  const saveAuth = () =>
    withBusy(t('apiSaving'), async () => {
      const id = projectId || (await ensureProject())
      const scheme = (authScheme || 'api_key').trim()
      if (!scheme) throw new Error(t('apiNeedScheme'))
      const res = await api.saveApiAuth(id, {
        scheme_name: scheme,
        type: authType || 'apiKey',
        client_id: clientId || undefined,
        client_secret: clientSecret || undefined,
        username: username || undefined,
        password: password || undefined,
        api_key: apiKey || undefined,
        bearer_token: bearer || undefined,
        access_token: bearer || undefined,
        scope: scope || undefined,
        redirect_uri: `${window.location.origin}/api/api-test/projects/${id}/oauth/callback`,
      })
      setClientSecret('')
      setPassword('')
      setApiKey('')
      setBearer('')
      if (Array.isArray((res as { security?: ApiSecurityScheme[] }).security)) {
        setSecurity((res as { security: ApiSecurityScheme[] }).security)
      }
      await loadProjectData(id)
    })

  const testConnection = () =>
    withBusy(t('apiTestingConnection'), async () => {
      setConnResult(null)
      const id = projectId || (await ensureProject())
      const primary = services[0]
      const probeBase = (primary?.base_url || baseUrl).trim()
      if (!probeBase) throw new Error('Set a Base URL on a service first')
      await api.updateApiProject(id, {
        name: name.trim() || 'API suite',
        base_url: probeBase,
        openapi_url: (primary?.openapi_url || openapiUrl).trim(),
        config: {
          generation_budget: genBudget,
          flaky_threshold: flakyThreshold,
          allow_private_urls: allowPrivate,
          latency_budget_ms: latencyBudget,
          mock_mode: mockMode,
        },
      })
      if (primary && !primary.id.startsWith('legacy:')) {
        await api.updateApiService(id, primary.id, {
          base_url: primary.base_url,
          openapi_url: primary.openapi_url,
        })
      }
      // Persist any typed credentials before probing
      const scheme = (authScheme || '').trim()
      if (scheme && (apiKey || bearer || clientId || username || password || clientSecret)) {
        await api.saveApiAuth(id, {
          scheme_name: scheme,
          type: authType || 'apiKey',
          client_id: clientId || undefined,
          client_secret: clientSecret || undefined,
          username: username || undefined,
          password: password || undefined,
          api_key: apiKey || undefined,
          bearer_token: bearer || undefined,
          access_token: bearer || undefined,
          scope: scope || undefined,
        })
        setClientSecret('')
        setPassword('')
        setApiKey('')
        setBearer('')
      }
      const res = await api.testApiConnection(id, scheme || undefined)
      setConnResult({
        ok: res.ok,
        message: res.message,
        status_code: res.status_code,
        latency_ms: res.latency_ms,
        url: res.url,
        method: res.method,
        scheme_name: res.scheme_name,
      })
      await refreshProjects()
      await loadProjectData(id)
    })

  const exchangeToken = (grant?: string) =>
    withBusy(t('apiExchanging'), async () => {
      if (!projectId || !authScheme) throw new Error(t('apiNeedScheme'))
      await api.exchangeApiToken(projectId, {
        scheme_name: authScheme,
        grant,
        code: oauthCode || undefined,
        redirect_uri: `${window.location.origin}/`,
      })
      setOauthCode('')
      await loadProjectData(projectId)
    })

  const openAuthorize = () =>
    withBusy(t('apiAuthorizing'), async () => {
      if (!projectId || !authScheme) throw new Error(t('apiNeedScheme'))
      const redirect = `${window.location.origin}/`
      const { authorize_url } = await api.getApiAuthorizeUrl(projectId, {
        scheme_name: authScheme,
        redirect_uri: redirect,
        state: projectId,
      })
      window.open(authorize_url, '_blank', 'noopener,noreferrer')
    })

  const isRunExpanded = (run: ApiRun) => {
    const finished = run.status === 'completed' || run.status === 'failed'
    if (finished) return !collapsedRuns[run.id]
    return Boolean(collapsedRuns[run.id] === false)
  }

  const toggleRun = async (run: ApiRun) => {
    const open = isRunExpanded(run)
    if (open) {
      setCollapsedRuns((prev) => ({ ...prev, [run.id]: true }))
      setExpandedStepId(null)
      return
    }
    setCollapsedRuns((prev) => ({ ...prev, [run.id]: false }))
    setExpandedStepId(null)
    if (!runStepsById[run.id]) {
      await loadRunSteps(run.id)
    }
  }

  const openReport = async (run: ApiRun) => {
    setReportRunId(run.id)
    setReportInsights(run.summary?.insights || null)
    setLoadingInsights(true)
    try {
      const jobs: Promise<unknown>[] = []
      if (!runStepsById[run.id]) jobs.push(loadRunSteps(run.id))
      jobs.push(
        api.getApiRunInsights(run.id).then((res) => {
          const ins = res.insights
          setReportInsights(ins)
          setHistory((prev) =>
            prev.map((r) =>
              r.id === run.id
                ? { ...r, summary: { ...r.summary, insights: ins } }
                : r,
            ),
          )
        }),
      )
      await Promise.all(jobs)
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setLoadingInsights(false)
    }
  }

  const createNewProject = () =>
    withBusy(t('apiSaving'), async () => {
      const p = await api.createApiProject({
        name: 'API suite',
        base_url: '',
        openapi_url: '',
      })
      setProjectId(p.id)
      localStorage.setItem(PROJECT_KEY, p.id)
      await refreshProjects()
      await loadProjectData(p.id)
      setTab('configuration')
    })

  const deleteCurrentProject = () => {
    if (!projectId) {
      setError(t('apiSelectProjectFirst'))
      return
    }
    const label = project?.name || name || projectId
    if (!window.confirm(t('apiDeleteProjectConfirm').replace('{name}', label))) return
    withBusy(t('apiDeletingProject'), async () => {
      await api.deleteApiProject(projectId)
      localStorage.removeItem(PROJECT_KEY)
      setProjectId('')
      setOverview(null)
      setEndpoints([])
      setFlows([])
      setDrift(null)
      setHistory([])
      setSecurity([])
      setAnomalies([])
      setRunStepsById({})
      setReportRunId(null)
      setActiveRunId(null)
      setLiveSteps([])
      const list = await refreshProjects()
      if (list.length) {
        setProjectId(list[0].id)
        localStorage.setItem(PROJECT_KEY, list[0].id)
        await loadProjectData(list[0].id)
      }
    })
  }

  const nav: { id: ApiTab; label: string; icon: ReactNode }[] = [
    { id: 'overview', label: t('apiOverview'), icon: <IconOverview /> },
    { id: 'generator', label: t('apiGenerator'), icon: <IconSparkles /> },
    { id: 'endpoints', label: t('apiEndpoints'), icon: <IconEndpoints /> },
    { id: 'schema', label: t('apiSchemaDiff'), icon: <IconSchema /> },
    { id: 'history', label: t('apiRunHistory'), icon: <IconHistory /> },
    { id: 'configuration', label: t('apiConfiguration'), icon: <IconConfig /> },
  ]

  const health = overview?.health || 'healthy'
  const bannerCls =
    health === 'healthy'
      ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-200'
      : health === 'degraded'
        ? 'border-amber-700/50 bg-amber-950/40 text-amber-200'
        : 'border-red-700/50 bg-red-950/40 text-red-200'
  const healthLabel =
    health === 'healthy'
      ? t('apiHealthHealthy')
      : health === 'degraded'
        ? t('apiHealthDegraded')
        : t('apiHealthCritical')

  const selectedScheme = security.find((s) => s.name === authScheme)

  const filteredEndpoints = useMemo(
    () =>
      endpoints.filter((ep) =>
        matchesEndpointSearch(deferredEndpointQuery, [
          ep.method,
          ep.path,
          ep.operation_id,
          ep.summary,
          ...(ep.tags || []),
        ]),
      ),
    [endpoints, deferredEndpointQuery],
  )

  const filteredFlows = useMemo(
    () =>
      flows.filter((f) => {
        if (
          matchesEndpointSearch(deferredEndpointQuery, [f.name, f.kind, f.resource || ''])
        ) {
          return true
        }
        return (f.steps || []).some((s) =>
          matchesEndpointSearch(deferredEndpointQuery, [
            String(s.method || ''),
            String(s.path || ''),
            String(s.operation_id || ''),
            f.name,
            f.resource || '',
          ]),
        )
      }),
    [flows, deferredEndpointQuery],
  )

  const filteredDriftChanges = useMemo(
    () =>
      (drift?.changes || []).filter((row) =>
        matchesEndpointSearch(deferredEndpointQuery, [row.op, row.kind, row.detail]),
      ),
    [drift, deferredEndpointQuery],
  )

  const filteredAnomalies = useMemo(
    () =>
      (anomalies.length ? anomalies : overview?.anomalies || []).filter((a) =>
        matchesEndpointSearch(deferredEndpointQuery, [a.finding, a.endpoint]),
      ),
    [anomalies, overview, deferredEndpointQuery],
  )

  const stepMatchesQuery = useCallback(
    (s: ApiRunStep) =>
      matchesEndpointSearch(deferredEndpointQuery, [
        s.method,
        s.path,
        s.operation_id,
        s.flow_name,
        resolveEndpointTag(endpoints, {
          operationId: s.operation_id,
          method: s.method,
          path: s.path,
        }),
      ]),
    [deferredEndpointQuery, endpoints],
  )

  const searchResultCount = useMemo(() => {
    if (!endpointQuery.trim()) return undefined
    if (tab === 'generator') return filteredFlows.length
    if (tab === 'schema') return filteredDriftChanges.length
    if (tab === 'overview') return filteredEndpoints.length + filteredAnomalies.length
    if (tab === 'history' && reportRunId) {
      return (runStepsById[reportRunId] || []).filter(stepMatchesQuery).length
    }
    if (tab === 'history') {
      const fromRuns = Object.values(runStepsById).reduce(
        (n, steps) => n + steps.filter(stepMatchesQuery).length,
        0,
      )
      return fromRuns + liveSteps.filter(stepMatchesQuery).length
    }
    return filteredEndpoints.length
  }, [
    endpointQuery,
    tab,
    filteredFlows.length,
    filteredDriftChanges.length,
    filteredEndpoints.length,
    filteredAnomalies.length,
    reportRunId,
    runStepsById,
    liveSteps,
    stepMatchesQuery,
  ])

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
              onClick={() => {
                setTab(item.id)
                if (item.id !== 'history') setReportRunId(null)
              }}
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
        <div className="mt-auto p-3 border-t border-line space-y-2">
          <select
            className={inputCls}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{t('apiSelectProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => createNewProject()}
            className="w-full rounded-lg border border-line px-3 py-1.5 text-[12px] text-slate-300 hover:bg-ink-800"
          >
            {t('apiNewProject')}
          </button>
          <button
            type="button"
            disabled={!projectId || Boolean(busy)}
            onClick={() => deleteCurrentProject()}
            className="w-full rounded-lg border border-red-900/50 px-3 py-1.5 text-[12px] text-red-300 hover:bg-red-950/40 disabled:opacity-40"
          >
            {t('apiDeleteProject')}
          </button>
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto scroll p-6 min-w-0">
        {(error || busy) && (
          <div className="w-full mb-4 flex flex-wrap gap-2 items-center">
            {busy && (
              <span className="text-[12px] text-sky-300 border border-sky-700/40 bg-sky-500/10 px-2.5 py-1 rounded-md">
                {busy}…
              </span>
            )}
            {error && (
              <span className="text-[12px] text-red-300 border border-red-700/40 bg-red-500/10 px-2.5 py-1 rounded-md">
                {error}
              </span>
            )}
          </div>
        )}

        <EndpointSearchBar
          value={endpointQuery}
          onChange={setEndpointQuery}
          resultCount={searchResultCount}
          placeholder={t('apiSearchEndpoints')}
          clearLabel={t('apiSearchClear')}
        />

        {tab === 'overview' && (
          <div className="w-full space-y-5">
            <header className="space-y-1">
              <h1 className="text-[22px] font-semibold text-slate-100 tracking-tight">
                {t('apiPageTitle')}
              </h1>
              <p className="text-[13px] text-slate-500">{t('apiPageTagline')}</p>
            </header>

            {!projectId ? (
              <div className="rounded-xl border border-line bg-ink-900 p-5 text-sm text-slate-400">
                {t('apiEmptyState')}
              </div>
            ) : (
              <>
                <div
                  className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${bannerCls}`}
                >
                  <span className="text-lg leading-none" aria-hidden>
                    {health === 'healthy' ? '✓' : health === 'degraded' ? '!' : '×'}
                  </span>
                  <div className="font-semibold text-[14px]">
                    {t('apiHealth')}: {healthLabel}
                  </div>
                  <div className="ml-auto text-[13px] font-semibold tabular-nums">
                    {overview?.passing ?? 0} / {overview?.total_endpoints ?? 0}{' '}
                    {t('apiEndpointsPassing')}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                  <MetricCard label={t('apiEndpointCoverage')} value={`${overview?.coverage ?? 0}%`} />
                  <MetricCard
                    label={t('apiAiGeneratedTests')}
                    value={(overview?.ai_generated_tests ?? 0).toLocaleString()}
                  />
                  <MetricCard
                    label={t('apiSchemaDriftFound')}
                    value={String(overview?.schema_drift ?? 0)}
                    valueClass={(overview?.schema_drift ?? 0) > 0 ? 'text-amber-300' : 'text-slate-100'}
                  />
                  <MetricCard
                    label={t('apiAvgResponseTime')}
                    value={`${overview?.avg_response_ms ?? 0}ms`}
                  />
                  <MetricCard
                    label={t('apiFlakyTests')}
                    value={String(overview?.flaky_tests ?? 0)}
                    valueClass={(overview?.flaky_tests ?? 0) > 0 ? 'text-orange-300' : 'text-slate-100'}
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
                        {filteredEndpoints.slice(0, deferredEndpointQuery.trim() ? 50 : 8).map((row) => (
                          <tr key={row.id}>
                            <td className="py-2.5 pr-2 mono text-slate-200 text-[12px]">{row.path}</td>
                            <td className="py-2.5">
                              <MethodBadge method={row.method} />
                            </td>
                            <td className="py-2.5 text-right">
                              <StatusPill status={row.last_status} />
                            </td>
                          </tr>
                        ))}
                        {!filteredEndpoints.length && (
                          <tr>
                            <td colSpan={3} className="py-4 text-slate-500 text-sm">
                              {endpointQuery.trim() ? t('apiSearchNoMatch') : t('apiNoEndpoints')}
                            </td>
                          </tr>
                        )}
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
                        {filteredAnomalies.map((a) => (
                          <tr key={a.id}>
                            <td className="py-2.5 pr-3 text-slate-200">{a.finding}</td>
                            <td className="py-2.5 text-right tabular-nums text-slate-300 font-semibold">
                              {a.confidence}%
                            </td>
                          </tr>
                        ))}
                        {!filteredAnomalies.length && (
                          <tr>
                            <td colSpan={2} className="py-4 text-slate-500 text-sm">
                              {endpointQuery.trim() ? t('apiSearchNoMatch') : t('apiNoAnomalies')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'generator' && (
          <div className="w-full space-y-4">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('apiGenerator')}</h1>
            <p className="text-sm text-slate-500 mb-1">{t('apiGeneratorBlurb')}</p>
            <p className="text-[12px] text-slate-500 mb-2">{t('apiAiGenerateNote')}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!projectId || Boolean(busy)}
                onClick={() => doGenerate()}
                className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-3 py-2 text-[13px] font-semibold text-white"
              >
                {t('apiGenerateFlows')}
              </button>
              <button
                type="button"
                disabled={!projectId || Boolean(busy)}
                onClick={() => doRun()}
                className="rounded-lg border border-line hover:bg-ink-800 disabled:opacity-40 px-3 py-2 text-[13px] text-slate-200"
              >
                {t('apiRunSuite')}
              </button>
              <button
                type="button"
                disabled={!projectId || !flows.length || Boolean(busy)}
                onClick={() => doExportPostman()}
                className="rounded-lg border border-line hover:bg-ink-800 disabled:opacity-40 px-3 py-2 text-[13px] text-slate-200"
                title={t('apiExportPostmanHint')}
              >
                {t('apiExportPostman')}
              </button>
            </div>
            {generateMeta?.llm_used && (
              <div className="rounded-lg border border-sky-700/40 bg-sky-950/30 px-3 py-2 text-[12px] text-sky-100">
                {t('apiAiGenerateResult')} · {t('apiAiJourneys')}: {generateMeta.ai_journeys ?? 0} ·{' '}
                {t('apiAiFlows')}: {generateMeta.ai_flows ?? 0} · {t('apiAiSteps')}:{' '}
                {generateMeta.ai_steps ?? 0}
              </div>
            )}
            {(() => {
              const journeys = filteredFlows.filter(isJourneyFlow).length
              const positive = countFlowSteps(filteredFlows, ['e2e', 'contract'])
              const negative = countFlowSteps(filteredFlows, 'negative')
              const edge = countFlowSteps(filteredFlows, 'edge')
              const security = countFlowSteps(filteredFlows, 'security')
              const performance = countFlowSteps(filteredFlows, 'load')
              const contract = countFlowSteps(filteredFlows, 'contract')
              const totalSteps = filteredFlows.reduce((n, f) => n + f.steps.length, 0)
              const toggleKpi = (next: GeneratorKpiFilter) =>
                setKpiFilter((prev) => (prev === next ? 'all' : next))
              const kpiLabel =
                kpiFilter === 'journey'
                  ? t('apiKpiE2E')
                  : kpiFilter === 'positive'
                    ? t('apiKpiPositive')
                    : kpiFilter === 'negative'
                      ? t('apiKpiNegative')
                      : kpiFilter === 'edge'
                        ? t('apiKpiEdge')
                        : kpiFilter === 'security'
                          ? t('apiKpiSecurity')
                          : kpiFilter === 'performance'
                            ? t('apiKpiPerformance')
                            : kpiFilter === 'contract'
                              ? t('apiKpiContract')
                              : t('apiKpiTotalFlows')
              const visibleFlows = flowsForKpiFilter(filteredFlows, kpiFilter)
              const visibleSteps = visibleFlows.reduce((n, f) => n + f.steps.length, 0)
              return (
                <>
                  <p className="text-[11px] text-slate-500">{t('apiKpiClickHint')}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                    <MetricCard
                      label={t('apiKpiE2E')}
                      value={String(journeys)}
                      hint={t('apiKpiE2EHint')}
                      valueClass="text-sky-300"
                      active={kpiFilter === 'journey'}
                      onClick={() => toggleKpi('journey')}
                    />
                    <MetricCard
                      label={t('apiKpiPositive')}
                      value={String(positive)}
                      hint={t('apiKpiPositiveHint')}
                      valueClass="text-emerald-300"
                      active={kpiFilter === 'positive'}
                      onClick={() => toggleKpi('positive')}
                    />
                    <MetricCard
                      label={t('apiKpiNegative')}
                      value={String(negative)}
                      hint={t('apiKpiNegativeHint')}
                      valueClass="text-rose-300"
                      active={kpiFilter === 'negative'}
                      onClick={() => toggleKpi('negative')}
                    />
                    <MetricCard
                      label={t('apiKpiEdge')}
                      value={String(edge)}
                      hint={t('apiKpiEdgeHint')}
                      valueClass="text-amber-300"
                      active={kpiFilter === 'edge'}
                      onClick={() => toggleKpi('edge')}
                    />
                    <MetricCard
                      label={t('apiKpiSecurity')}
                      value={String(security)}
                      hint={t('apiKpiSecurityHint')}
                      valueClass="text-violet-300"
                      active={kpiFilter === 'security'}
                      onClick={() => toggleKpi('security')}
                    />
                    <MetricCard
                      label={t('apiKpiPerformance')}
                      value={String(performance)}
                      hint={t('apiKpiPerformanceHint')}
                      valueClass="text-orange-300"
                      active={kpiFilter === 'performance'}
                      onClick={() => toggleKpi('performance')}
                    />
                    <MetricCard
                      label={t('apiKpiContract')}
                      value={String(contract)}
                      hint={t('apiKpiContractHint')}
                      active={kpiFilter === 'contract'}
                      onClick={() => toggleKpi('contract')}
                    />
                    <MetricCard
                      label={t('apiKpiTotalFlows')}
                      value={String(filteredFlows.length)}
                      hint={t('apiKpiTotalFlowsHint')}
                      active={kpiFilter === 'all'}
                      onClick={() => setKpiFilter('all')}
                    />
                    <MetricCard
                      label={t('apiKpiTotalSteps')}
                      value={String(generateMeta?.ai_steps ?? totalSteps)}
                      hint={t('apiKpiTotalStepsHint')}
                      active={kpiFilter === 'all'}
                      onClick={() => setKpiFilter('all')}
                    />
                  </div>
                  {kpiFilter !== 'all' && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-700/40 bg-sky-950/25 px-3 py-2 text-[12px] text-sky-100">
                      <span>
                        {t('apiKpiFilterShowing')}: <strong>{kpiLabel}</strong> ·{' '}
                        {visibleFlows.length} {t('apiFlowCount').toLowerCase()} · {visibleSteps}{' '}
                        {t('apiSteps')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setKpiFilter('all')}
                        className="ml-auto rounded-md border border-sky-600/50 px-2.5 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-900/40"
                      >
                        {t('apiKpiFilterClear')}
                      </button>
                    </div>
                  )}
                  {filteredFlows.length > 0 && (
                    <p className="text-[11px] text-slate-500">{t('apiClickFlowStep')}</p>
                  )}
                  <div className="space-y-3">
                    {groupByTag(visibleFlows, (f) => {
                      if (isJourneyFlow(f)) return t('apiJourneyGroup')
                      if (f.resource) return f.resource
                      const first = f.steps[0] || {}
                      return resolveEndpointTag(endpoints, {
                        operationId: String(first.operation_id || ''),
                        method: String(first.method || ''),
                        path: String(first.path || ''),
                        fallback: t('apiUntagged'),
                      })
                    }).map(({ tag, items }) => (
                      <TagGroup
                        key={`${kpiFilter}-${tag}`}
                        name={tag}
                        description={`${items.length} ${t('apiFlowCount').toLowerCase()}`}
                        count={items.reduce((n, f) => n + f.steps.length, 0)}
                        defaultOpen
                      >
                        {items.map((f) => {
                          const steps = (f.steps || []).filter(
                            (s) =>
                              !deferredEndpointQuery.trim() ||
                              matchesEndpointSearch(deferredEndpointQuery, [
                                String(s.method || ''),
                                String(s.path || ''),
                                String(s.operation_id || ''),
                                f.name,
                                f.resource || '',
                              ]) ||
                              matchesEndpointSearch(deferredEndpointQuery, [
                                f.name,
                                f.kind,
                                f.resource || '',
                              ]),
                          )
                          return (
                            <div key={f.id} className="space-y-2">
                              <div className="flex items-center gap-2 px-1 pt-1">
                                <span className="text-[12px] font-semibold text-slate-200">{f.name}</span>
                                <span className="text-[10px] uppercase tracking-wider text-slate-500 border border-line px-1.5 py-0.5 rounded">
                                  {f.kind}
                                </span>
                                <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
                                  {steps.length} {t('apiSteps')}
                                </span>
                              </div>
                              {steps.map((s, i) => (
                                <SwaggerOpRow
                                  key={`${f.id}-${i}`}
                                  method={String(s.method || 'GET')}
                                  path={String(s.path || '/')}
                                  summary={String(s.operation_id || f.kind || '')}
                                  trailing={
                                    <ServiceBadge
                                      serviceKey={
                                        typeof s.service_key === 'string' ? s.service_key : null
                                      }
                                    />
                                  }
                                  defaultOpen={false}
                                >
                                  <FlowStepDetailBlocks
                                    step={s}
                                    flowName={f.name}
                                    projectId={projectId}
                                    onSaved={() => {
                                      if (projectId) {
                                        loadProjectData(projectId).catch(() => undefined)
                                      }
                                    }}
                                  />
                                </SwaggerOpRow>
                              ))}
                            </div>
                          )
                        })}
                      </TagGroup>
                    ))}
                    {!filteredFlows.length && (
                      <div className="rounded-xl border border-line bg-ink-900 px-4 py-5 text-sm text-slate-500">
                        {endpointQuery.trim() ? t('apiSearchNoMatch') : t('apiNoFlows')}
                      </div>
                    )}
                    {filteredFlows.length > 0 && !visibleFlows.length && (
                      <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 px-4 py-5 space-y-3 text-sm text-amber-50/90">
                        <div>
                          {kpiFilter === 'journey' ? t('apiKpiJourneyEmpty') : t('apiKpiFilterEmpty')}
                        </div>
                        {kpiFilter === 'journey' && (
                          <button
                            type="button"
                            disabled={!projectId || Boolean(busy)}
                            onClick={() => doGenerate()}
                            className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-3 py-2 text-[13px] font-semibold text-white"
                          >
                            {t('apiGenerateFlows')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {tab === 'endpoints' && (
          <div className="w-full space-y-4">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('apiEndpoints')}</h1>
            <p className="text-sm text-slate-500 mb-1">{t('apiEndpointsBlurb')}</p>
            <div className="space-y-3">
              {groupByTag(
                filteredEndpoints,
                (ep) => ep.tags?.[0] || groupKeyFromPath(ep.path) || t('apiUntagged'),
              ).map(({ tag, items }) => (
                <TagGroup
                  key={tag}
                  name={tag}
                  description={`${items.length} ${t('apiEndpoints').toLowerCase()}`}
                  count={items.length}
                  defaultOpen
                >
                  {items.map((row) => (
                    <SwaggerOpRow
                      key={row.id}
                      method={row.method}
                      path={row.path}
                      summary={row.summary || row.operation_id}
                      trailing={
                        <span className="flex items-center gap-2">
                          <ServiceBadge serviceKey={row.meta?.service_key} />
                          <StatusPill status={row.last_status} />
                        </span>
                      }
                      defaultOpen={false}
                    >
                      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 pt-2 mb-1">
                        <span>
                          operation_id:{' '}
                          <span className="mono text-slate-200">{row.operation_id || '—'}</span>
                        </span>
                        {(row.tags || []).length > 0 && (
                          <span>
                            tags:{' '}
                            <span className="text-slate-200">{row.tags.join(', ')}</span>
                          </span>
                        )}
                        <span className="ml-auto">
                          <StatusPill status={row.last_status} />
                        </span>
                      </div>
                      <FlowStepDetailBlocks
                        step={{
                          method: row.method,
                          path: row.path,
                          path_template: row.path,
                          operation_id: row.operation_id,
                          headers: {},
                          query: {},
                          body: null,
                          expected_status: [200, 201, 202, 204, 400, 401, 403, 404, 405, 422, 500],
                          kind: 'e2e',
                        }}
                        flowName={`Endpoint ${row.operation_id || row.path}`}
                        projectId={projectId}
                      />
                    </SwaggerOpRow>
                  ))}
                </TagGroup>
              ))}
              {!filteredEndpoints.length && (
                <div className="rounded-xl border border-line bg-ink-900 px-4 py-5 text-sm text-slate-500">
                  {endpointQuery.trim() ? t('apiSearchNoMatch') : t('apiNoEndpoints')}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'schema' && (
          <div className="w-full space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('apiSchemaDiff')}</h1>
                <p className="text-sm text-slate-500">{t('apiSchemaDiffBlurb')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!projectId || Boolean(busy)}
                  onClick={() => doIngest()}
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-3 py-2 text-[13px] font-semibold text-white"
                >
                  {t('apiDriftRecheck')}
                </button>
                <button
                  type="button"
                  disabled={!projectId || Boolean(busy) || !drift?.has_current}
                  onClick={() =>
                    withBusy(t('apiSaving'), async () => {
                      if (!projectId) throw new Error(t('apiNeedProject'))
                      const res = await api.resetApiBaseline(projectId)
                      setDrift(res.drift)
                    })
                  }
                  className="rounded-lg border border-line hover:bg-ink-800 disabled:opacity-40 px-3 py-2 text-[13px] text-slate-200"
                >
                  {t('apiDriftResetBaseline')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <MetricCard label="+ added" value={String(drift?.added ?? 0)} valueClass="text-emerald-300" />
              <MetricCard label="~ modified" value={String(drift?.modified ?? 0)} valueClass="text-amber-300" />
              <MetricCard label="- removed" value={String(drift?.removed ?? 0)} valueClass="text-red-300" />
              <MetricCard label={t('apiDriftBaselineOps')} value={String(drift?.baseline_ops ?? 0)} />
              <MetricCard label={t('apiDriftCurrentOps')} value={String(drift?.current_ops ?? 0)} />
            </div>

            {(drift?.in_sync || !(drift?.changes || []).length) && (
              <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 px-4 py-4 space-y-2">
                <div className="text-[14px] font-semibold text-emerald-200">
                  {drift?.in_sync ? t('apiDriftInSync') : drift?.message || t('apiNoDrift')}
                </div>
                <p className="text-[13px] text-slate-300 leading-relaxed">{t('apiDriftEmptyHint')}</p>
                {drift?.baseline_at && (
                  <div className="text-[12px] text-slate-500">
                    {t('apiDriftBaselineAt')}: {new Date(drift.baseline_at).toLocaleString()}
                    {drift.openapi_url ? (
                      <span className="mono"> · {drift.openapi_url}</span>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-line bg-ink-900 divide-y divide-line/70 text-sm">
              {filteredDriftChanges.map((row, i) => (
                <div key={`${row.op}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="mono text-slate-200 text-[12px]">{row.op}</span>
                  <span
                    className={`text-[12px] ${
                      row.kind === 'added'
                        ? 'text-emerald-300'
                        : row.kind === 'removed'
                          ? 'text-red-300'
                          : 'text-amber-300'
                    }`}
                  >
                    {row.detail}
                  </span>
                </div>
              ))}
              {filteredDriftChanges.length > 0 && (
                <div className="px-4 py-3 text-[12px] text-slate-500">{drift?.message}</div>
              )}
              {endpointQuery.trim() && !filteredDriftChanges.length && (drift?.changes || []).length > 0 && (
                <div className="px-4 py-5 text-slate-500">{t('apiSearchNoMatch')}</div>
              )}
            </div>
          </div>
        )}

        {tab === 'history' && reportRunId && (() => {
          const reportRun = history.find((r) => r.id === reportRunId)
          if (!reportRun) return null
          return (
            <AllureReportView
              run={reportRun}
              steps={runStepsById[reportRunId] || []}
              endpoints={endpoints}
              projectId={projectId}
              endpointQuery={deferredEndpointQuery}
              insights={reportInsights}
              loadingInsights={loadingInsights}
              onClose={() => {
                setReportRunId(null)
                setReportInsights(null)
                setLoadingInsights(false)
              }}
            />
          )
        })()}

        {tab === 'history' && !reportRunId && (
          <div className="w-full space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('apiRunHistory')}</h1>
                <p className="text-sm text-slate-500">{t('apiRunHistoryBlurb')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  disabled={!projectId || !history.length || Boolean(busy)}
                  onClick={() => doClearHistory()}
                  className="rounded-lg border border-red-900/50 text-red-300 hover:bg-red-950/40 disabled:opacity-40 px-3 py-2 text-[13px]"
                >
                  {t('apiClearHistory')}
                </button>
                <button
                  type="button"
                  disabled={!projectId || Boolean(busy)}
                  onClick={() => doRun()}
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-3 py-2 text-[13px] font-semibold text-white"
                >
                  {t('apiRunSuite')}
                </button>
              </div>
            </div>

            {liveSteps.length > 0 && (
              <div className="rounded-xl border border-sky-700/40 bg-sky-950/30 p-4 space-y-2">
                <div className="text-[13px] font-semibold text-sky-200">{t('apiLiveRun')}</div>
                {liveSteps
                  .filter(stepMatchesQuery)
                  .slice(-8)
                  .map((s) => {
                  const open = expandedStepId === `live-${s.id}`
                  const detail = (s.detail || {}) as Record<string, unknown>
                  const req = (detail.request || {}) as Record<string, unknown>
                  const resp = (detail.response || null) as Record<string, unknown> | null
                  return (
                    <div key={s.id}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 text-[12px] text-left"
                        onClick={() => setExpandedStepId(open ? null : `live-${s.id}`)}
                      >
                        <span className="text-slate-500 w-3">{open ? '▾' : '▸'}</span>
                        <MethodBadge method={s.method} />
                        <span className="mono text-slate-300 truncate">{s.path}</span>
                        <span className="ml-auto tabular-nums text-slate-500">{s.latency_ms}ms</span>
                        <StatusPill status={s.status === 'pass' ? 'pass' : 'fail'} />
                      </button>
                      {open && (
                        <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2">
                          <CodeBlock label={t('apiRequest')} value={req} emptyLabel={t('apiNoPayload')} />
                          <CodeBlock
                            label={t('apiResponse')}
                            value={resp}
                            emptyLabel={t('apiNoPayload')}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
                {deferredEndpointQuery.trim() && !liveSteps.some(stepMatchesQuery) && (
                  <div className="text-[12px] text-slate-500">{t('apiSearchNoMatch')}</div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-line bg-ink-900 divide-y divide-line/70">
              {!history.length && (
                <div className="px-4 py-8 text-center text-[13px] text-slate-500">
                  {t('apiHistoryEmpty')}
                </div>
              )}
              {history.map((run) => {
                const hasReport = Boolean(run.summary?.report_html)
                const expanded = isRunExpanded(run)
                const runSteps = runStepsById[run.id] || []
                return (
                <div key={run.id}>
                  <div className="flex flex-wrap items-center gap-2 px-4 py-3 hover:bg-ink-850">
                    <button
                      type="button"
                      onClick={() => toggleRun(run)}
                      className="flex flex-wrap items-center gap-3 text-left min-w-0 flex-1"
                    >
                      <span className="text-slate-500 w-3 text-[12px]">{expanded ? '▾' : '▸'}</span>
                      <span className="text-[13px] font-semibold text-slate-100 capitalize">{run.status}</span>
                      <span className="text-[12px] text-slate-500 tabular-nums">
                        {run.summary?.passed ?? 0}/{run.summary?.total ?? 0} pass ·{' '}
                        {run.summary?.avg_latency_ms ?? 0}ms
                      </span>
                      <span className="text-[11px] text-slate-600">
                        {new Date(run.created_at).toLocaleString()}
                      </span>
                    </button>
                    {(hasReport || run.status === 'completed' || run.status === 'failed') && (
                      <button
                        type="button"
                        className="rounded-md border border-amber-700/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20 flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          openReport(run)
                        }}
                      >
                        {t('apiOpenAllureReport')}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      className="rounded-md border border-red-900/40 text-red-300/90 hover:bg-red-950/40 disabled:opacity-40 px-2.5 py-1 text-[11px] font-semibold flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        doDeleteRun(run)
                      }}
                    >
                      {t('apiDeleteRun')}
                    </button>
                  </div>
                  {expanded && (
                    <div className="px-4 pb-3 space-y-1.5 border-t border-line/50 bg-ink-950/40">
                      {run.summary?.insights?.headline && (
                        <div className="space-y-2 py-2 mb-1 border-b border-line/40">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openReport(run)}
                              className="text-[12px] text-amber-300 hover:underline"
                            >
                              {t('apiOpenAllureReport')}
                            </button>
                            {(run.summary?.self_healed_steps ?? 0) > 0 && (
                              <span className="text-[11px] text-sky-300 border border-sky-700/40 px-1.5 py-0.5 rounded">
                                {t('apiSelfHealed')}: {run.summary?.self_healed_steps}
                              </span>
                            )}
                          </div>
                          <div className="rounded-lg border border-line bg-ink-900/80 p-3 space-y-1.5 text-[12px]">
                            <div className="text-[10px] uppercase tracking-wider text-slate-500">
                              {t('apiRunSummary')}
                            </div>
                            <div className="font-semibold text-slate-200">
                              {run.summary.insights.headline}
                            </div>
                            <div>
                              <span className="text-slate-500 uppercase text-[10px] tracking-wider">
                                {t('apiRootCause')}
                              </span>
                              <div className="text-slate-300 mt-0.5">
                                {run.summary.insights.primary_root_cause || ''}
                              </div>
                            </div>
                            <div>
                              <span className="text-slate-500 uppercase text-[10px] tracking-wider">
                                {t('apiSolution')}
                              </span>
                              <div className="text-emerald-300/90 mt-0.5">
                                {run.summary.insights.primary_solution || ''}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {runSteps.length > 0 && (
                        <div className="text-[11px] text-slate-500 py-1">{t('apiClickStep')}</div>
                      )}
                      <div className="space-y-3">
                        {groupByTag(
                          runSteps.filter(stepMatchesQuery),
                          (s) =>
                            resolveEndpointTag(endpoints, {
                              operationId: s.operation_id,
                              method: s.method,
                              path: s.path,
                              fallback: t('apiUntagged'),
                            }),
                        ).map(({ tag, items }) => (
                          <TagGroup
                            key={`${run.id}-${tag}`}
                            name={tag}
                            description={`${items.filter((x) => x.status === 'pass').length}/${items.length} pass`}
                            count={items.length}
                            defaultOpen
                          >
                            {items.map((s) => {
                              const detail = (s.detail || {}) as Record<string, unknown>
                              const resp = (detail.response || null) as Record<string, unknown> | null
                              const statusCode = resp?.status_code
                              return (
                                <SwaggerOpRow
                                  key={s.id}
                                  method={s.method}
                                  path={s.path}
                                  summary={s.flow_name}
                                  trailing={
                                    <span className="flex items-center gap-2">
                                      {statusCode != null && (
                                        <span className="tabular-nums text-slate-400 text-[11px]">
                                          {String(statusCode)}
                                        </span>
                                      )}
                                      <span className="tabular-nums text-slate-500 text-[11px]">
                                        {s.latency_ms}ms
                                      </span>
                                      <StatusPill status={s.status === 'pass' ? 'pass' : 'fail'} />
                                    </span>
                                  }
                                  defaultOpen={false}
                                >
                                  <StepDetailBlocks step={s} projectId={projectId} />
                                </SwaggerOpRow>
                              )
                            })}
                          </TagGroup>
                        ))}
                      </div>
                      {!runSteps.length && (
                        <div className="text-[12px] text-slate-500 py-2">{t('apiNoSteps')}</div>
                      )}
                      {runSteps.length > 0 &&
                        deferredEndpointQuery.trim() &&
                        !runSteps.some(stepMatchesQuery) && (
                          <div className="text-[12px] text-slate-500 py-2">{t('apiSearchNoMatch')}</div>
                        )}
                    </div>
                  )}
                </div>
              )})}
              {!history.length && (
                <div className="px-4 py-5 text-sm text-slate-500">{t('apiNoRuns')}</div>
              )}
            </div>
          </div>
        )}

        {tab === 'configuration' && (
          <div className="w-full space-y-5">
            <h1 className="text-lg font-semibold text-slate-100 mb-1">{t('apiConfiguration')}</h1>
            <p className="text-sm text-slate-500 mb-2">{t('apiServicesBlurb')}</p>

            {endpointQuery.trim() ? (
              <div className="rounded-xl border border-line bg-ink-900 p-4 space-y-3">
                <div className="text-[13px] font-semibold text-slate-200">
                  {t('apiSearchMatches')}
                  <span className="ml-2 text-[12px] font-normal text-slate-500 tabular-nums">
                    {filteredEndpoints.length}
                  </span>
                </div>
                {filteredEndpoints.length ? (
                  <div className="space-y-3 max-h-72 overflow-y-auto scroll">
                    {groupByTag(
                      filteredEndpoints,
                      (ep) => ep.tags?.[0] || groupKeyFromPath(ep.path) || t('apiUntagged'),
                    ).map(({ tag, items }) => (
                      <TagGroup
                        key={tag}
                        name={tag}
                        description={`${items.length}`}
                        count={items.length}
                        defaultOpen
                      >
                        {items.map((row) => (
                          <SwaggerOpRow
                            key={row.id}
                            method={row.method}
                            path={row.path}
                            summary={row.summary || row.operation_id}
                            trailing={<StatusPill status={row.last_status} />}
                            defaultOpen={false}
                          />
                        ))}
                      </TagGroup>
                    ))}
                  </div>
                ) : (
                  <div className="text-[12px] text-slate-500">{t('apiSearchNoMatch')}</div>
                )}
              </div>
            ) : null}

            <div className="rounded-xl border border-line bg-ink-900 p-4 space-y-3">
              <Field label={t('apiProjectName')}>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-semibold text-slate-200">{t('apiServices')}</div>
                    <p className="text-[12px] text-slate-500 mt-0.5">{t('apiServicesBlurb')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addService()}
                    className="rounded-lg border border-line hover:bg-ink-800 px-2.5 py-1.5 text-[12px] text-slate-200"
                  >
                    {t('apiAddService')}
                  </button>
                </div>
                {services.map((svc) => (
                  <div
                    key={svc.id}
                    className="rounded-lg border border-line bg-ink-950/50 p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <ServiceBadge serviceKey={svc.key} />
                      <input
                        className={`${inputCls} max-w-[10rem]`}
                        value={svc.key}
                        onChange={(e) => updateServiceLocal(svc.id, { key: e.target.value })}
                        placeholder="backend"
                      />
                      <input
                        className={`${inputCls} flex-1 min-w-[8rem]`}
                        value={svc.name}
                        onChange={(e) => updateServiceLocal(svc.id, { name: e.target.value })}
                        placeholder={t('apiServiceName')}
                      />
                      {services.length > 1 && !svc.id.startsWith('legacy:') ? (
                        <button
                          type="button"
                          onClick={() => removeService(svc.id)}
                          className="ml-auto text-[12px] text-rose-300 hover:text-rose-200"
                        >
                          {t('apiRemoveService')}
                        </button>
                      ) : null}
                    </div>
                    <Field label={t('apiBaseUrl')}>
                      <input
                        className={inputCls}
                        value={svc.base_url}
                        onChange={(e) => updateServiceLocal(svc.id, { base_url: e.target.value })}
                        placeholder="http://xyz:4444/v1"
                      />
                    </Field>
                    <Field label={t('apiOpenApiSource')}>
                      <input
                        className={inputCls}
                        value={svc.openapi_url}
                        onChange={(e) => updateServiceLocal(svc.id, { openapi_url: e.target.value })}
                        placeholder="https://api.example.com/openapi.json"
                      />
                    </Field>
                    <div className="text-[11px] text-slate-500 mono">
                      {`{{${svc.key}Url}} · {{${String(svc.key || '').toUpperCase()}_BASE_URL}}`}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => doServiceIngest(svc)}
                        className="rounded-lg border border-line hover:bg-ink-800 px-2.5 py-1.5 text-[12px] text-slate-200"
                      >
                        {t('apiIngestSchema')}
                      </button>
                      <label className="rounded-lg border border-line hover:bg-ink-800 px-2.5 py-1.5 text-[12px] text-slate-200 cursor-pointer">
                        {t('apiUploadSchema')}
                        <input
                          type="file"
                          accept=".json,.yaml,.yml,application/json,text/yaml"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) doServiceUpload(svc, f)
                            e.target.value = ''
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
                {!services.length ? (
                  <div className="text-[12px] text-slate-500">{t('apiNoServices')}</div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('apiGenBudget')}>
                  <input
                    type="number"
                    className={inputCls}
                    value={genBudget}
                    onChange={(e) => setGenBudget(Number(e.target.value) || 40)}
                  />
                </Field>
                <Field label={t('apiFlakyThreshold')}>
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    className={inputCls}
                    value={flakyThreshold}
                    onChange={(e) => setFlakyThreshold(Number(e.target.value) || 0.3)}
                  />
                </Field>
                <Field label={t('apiLatencyBudget')}>
                  <input
                    type="number"
                    className={inputCls}
                    value={latencyBudget}
                    onChange={(e) => setLatencyBudget(Number(e.target.value) || 5000)}
                  />
                </Field>
                <label className="flex items-center gap-2 pt-6 text-[13px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={allowPrivate}
                    onChange={(e) => setAllowPrivate(e.target.checked)}
                  />
                  {t('apiAllowPrivate')}
                </label>
                <label className="flex items-center gap-2 pt-6 text-[13px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={mockMode}
                    onChange={(e) => setMockMode(e.target.checked)}
                  />
                  {t('apiMockMode')}
                </label>
              </div>
              {(sourceKind || mockFixtureCount > 0) && (
                <div className="text-[12px] text-slate-500">
                  {sourceKind ? `${t('apiSource')}: ${sourceKind}` : null}
                  {mockFixtureCount > 0
                    ? ` · ${mockFixtureCount} ${t('apiMockFixtures')}`
                    : null}
                  {mockMode ? ` · ${t('apiMockModeOn')}` : null}
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => saveConfig()}
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-2 text-[13px] font-semibold text-white"
                >
                  {t('apiSaveConfig')}
                </button>
                <button
                  type="button"
                  onClick={() => doIngest()}
                  className="rounded-lg border border-line hover:bg-ink-800 px-3 py-2 text-[13px] text-slate-200"
                >
                  {t('apiIngestSchema')}
                </button>
                <label className="rounded-lg border border-line hover:bg-ink-800 px-3 py-2 text-[13px] text-slate-200 cursor-pointer">
                  {t('apiUploadSchema')}
                  <input
                    type="file"
                    accept=".json,.yaml,.yml,application/json,text/yaml"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) doUpload(f)
                    }}
                  />
                </label>
                <label className="rounded-lg border border-amber-700/50 bg-amber-950/30 hover:bg-amber-900/40 px-3 py-2 text-[13px] text-amber-100 cursor-pointer">
                  {t('apiImportPostman')}
                  <input
                    type="file"
                    accept=".json,application/json,.postman_collection.json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) doPostmanUpload(f)
                      e.target.value = ''
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={!projectId || !flows.length || Boolean(busy)}
                  onClick={() => doExportPostman()}
                  className="rounded-lg border border-line hover:bg-ink-800 disabled:opacity-40 px-3 py-2 text-[13px] text-slate-200"
                  title={t('apiExportPostmanHint')}
                >
                  {t('apiExportPostman')}
                </button>
                <label className="rounded-lg border border-line hover:bg-ink-800 px-3 py-2 text-[13px] text-slate-200 cursor-pointer">
                  {t('apiUploadMockData')}
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) doMockDataUpload(f)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">{t('apiPostmanHint')}</p>
            </div>

            <div className="rounded-xl border border-line bg-ink-900 p-4 space-y-3">
              <div className="text-[13px] font-semibold text-slate-200">{t('apiNightlyTitle')}</div>
              <p className="text-[12px] text-slate-500">{t('apiNightlyBlurb')}</p>
              <label className="flex items-center gap-2 text-[13px] text-slate-300">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                />
                {t('apiNightlyEnable')}
              </label>
              <Field label={t('apiNightlyCadence')}>
                <select
                  className={inputCls}
                  value={scheduleCadence}
                  onChange={(e) => setScheduleCadence(e.target.value as SchedulePreset)}
                >
                  <option value="every_day">{t('apiNightlyEveryDay')}</option>
                  <option value="every_hour">{t('apiNightlyEveryHour')}</option>
                  <option value="every_week">{t('apiNightlyEveryWeek')}</option>
                </select>
              </Field>
              {(scheduleInfo?.next_run_at || scheduleInfo?.last_run_at || scheduleInfo?.job_id) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px] text-slate-400">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      {t('apiNightlyNext')}
                    </div>
                    <div className="mt-0.5 text-slate-300">
                      {scheduleInfo?.enabled && scheduleInfo.next_run_at
                        ? new Date(scheduleInfo.next_run_at).toLocaleString()
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      {t('apiNightlyLast')}
                    </div>
                    <div className="mt-0.5 text-slate-300">
                      {scheduleInfo?.last_run_at
                        ? new Date(scheduleInfo.last_run_at).toLocaleString()
                        : '—'}
                      {scheduleInfo?.last_run_id ? (
                        <button
                          type="button"
                          className="ml-2 text-sky-400 hover:underline"
                          onClick={() => {
                            setActiveRunId(scheduleInfo.last_run_id || null)
                            setTab('history')
                          }}
                        >
                          {scheduleInfo.last_run_id.slice(0, 8)}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      {t('apiNightlyJob')}
                    </div>
                    <div className="mt-0.5 mono text-slate-300 truncate" title={scheduleInfo?.job_id || ''}>
                      {scheduleInfo?.job_id || '—'}
                    </div>
                  </div>
                </div>
              )}
              {scheduleInfo?.last_error ? (
                <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-[12px] text-red-300">
                  {scheduleInfo.last_error}
                </div>
              ) : null}
              {scheduleNotice ? (
                <div className="text-[12px] text-emerald-400">{scheduleNotice}</div>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => saveSchedule()}
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  {t('apiNightlySave')}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => runScheduleNow()}
                  className="rounded-lg border border-line hover:bg-ink-800 px-3 py-2 text-[13px] text-slate-200 disabled:opacity-40"
                >
                  {t('apiNightlyRunNow')}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">{t('apiNightlyReuseNote')}</p>
            </div>

            <div className="rounded-xl border border-line bg-ink-900 p-4 space-y-3">
              <div className="text-[13px] font-semibold text-slate-200">{t('apiAuthTitle')}</div>
              <p className="text-[12px] text-slate-500">{t('apiAuthHint')}</p>

              {security.length === 0 && (
                <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2.5 text-[12px] text-amber-100 space-y-2">
                  <div>{t('apiNoSecurity')}</div>
                  <div className="text-amber-200/80">{t('apiAuthManualHint')}</div>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => doIngest()}
                    className="rounded-md bg-amber-600/90 hover:bg-amber-500 px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                  >
                    {t('apiIngestSchema')}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('apiAuthScheme')}>
                  {security.length > 0 ? (
                    <select
                      className={inputCls}
                      value={authScheme}
                      onChange={(e) => {
                        const name = e.target.value
                        setAuthScheme(name)
                        const s = security.find((x) => x.name === name)
                        if (s?.type) setAuthType(s.type === 'http' ? (s.scheme || 'bearer') : s.type)
                      }}
                    >
                      {security.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name} ({s.type}
                          {s.configured ? ', configured' : ''})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={inputCls}
                      value={authScheme}
                      onChange={(e) => setAuthScheme(e.target.value)}
                      placeholder="api_key"
                    />
                  )}
                </Field>
                <Field label={t('apiAuthType')}>
                  <select
                    className={inputCls}
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value)}
                  >
                    <option value="apiKey">apiKey</option>
                    <option value="bearer">HTTP Bearer</option>
                    <option value="basic">HTTP Basic</option>
                    <option value="oauth2">OAuth2</option>
                  </select>
                </Field>
              </div>

              {selectedScheme && (
                <div className="text-[11px] text-slate-500 mono">
                  {selectedScheme.flows?.length
                    ? `flows: ${selectedScheme.flows.join(', ')}`
                    : selectedScheme.scheme || selectedScheme.type}
                  {selectedScheme.token_url ? ` · token: ${selectedScheme.token_url}` : ''}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {(authType === 'oauth2' || authType === 'basic') && (
                  <>
                    <Field label="client_id / username">
                      <input
                        className={inputCls}
                        value={authType === 'basic' ? username : clientId}
                        onChange={(e) =>
                          authType === 'basic' ? setUsername(e.target.value) : setClientId(e.target.value)
                        }
                      />
                    </Field>
                    <Field label="client_secret / password">
                      <input
                        type="password"
                        className={inputCls}
                        value={authType === 'basic' ? password : clientSecret}
                        onChange={(e) =>
                          authType === 'basic'
                            ? setPassword(e.target.value)
                            : setClientSecret(e.target.value)
                        }
                        placeholder={
                          selectedScheme?.has_client_secret || selectedScheme?.has_password ? '••••' : ''
                        }
                      />
                    </Field>
                  </>
                )}
                {authType === 'oauth2' && (
                  <>
                    <Field label="username (password grant)">
                      <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} />
                    </Field>
                    <Field label="password">
                      <input
                        type="password"
                        className={inputCls}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </Field>
                    <Field label="scope">
                      <input className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)} />
                    </Field>
                    <Field label={t('apiOAuthCode')}>
                      <input
                        className={inputCls}
                        value={oauthCode}
                        onChange={(e) => setOauthCode(e.target.value)}
                      />
                    </Field>
                  </>
                )}
                {(authType === 'apiKey' || authType === 'bearer') && (
                  <Field label={authType === 'apiKey' ? 'api_key' : 'bearer token'}>
                    <input
                      className={inputCls}
                      value={apiKey || bearer}
                      onChange={(e) => {
                        setApiKey(e.target.value)
                        setBearer(e.target.value)
                      }}
                      placeholder={
                        selectedScheme?.has_api_key || selectedScheme?.has_access_token ? '••••' : ''
                      }
                    />
                  </Field>
                )}
              </div>

              {connResult && (
                <div
                  className={`rounded-lg border px-3 py-2.5 text-[12px] space-y-1 ${
                    connResult.ok
                      ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-100'
                      : 'border-rose-700/50 bg-rose-950/30 text-rose-100'
                  }`}
                >
                  <div className="font-semibold">
                    {connResult.ok ? t('apiConnectionOk') : t('apiConnectionFail')} — {connResult.message}
                  </div>
                  <div className="mono text-[11px] opacity-80 break-all">
                    {connResult.method || 'GET'} {connResult.url}
                    {connResult.status_code != null ? ` · HTTP ${connResult.status_code}` : ''}
                    {` · ${connResult.latency_ms}ms`}
                    {connResult.scheme_name ? ` · ${connResult.scheme_name}` : ''}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => saveAuth()}
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-2 text-[13px] font-semibold text-white"
                >
                  {t('apiSaveAuth')}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => testConnection()}
                  className="rounded-lg border border-sky-600/60 bg-sky-950/40 hover:bg-sky-900/50 px-3 py-2 text-[13px] font-semibold text-sky-100 disabled:opacity-40"
                >
                  {t('apiTestConnection')}
                </button>
                {authType === 'oauth2' && (
                  <>
                    <button
                      type="button"
                      onClick={() => exchangeToken('clientCredentials')}
                      className="rounded-lg border border-line hover:bg-ink-800 px-3 py-2 text-[13px] text-slate-200"
                    >
                      {t('apiClientCredentials')}
                    </button>
                    <button
                      type="button"
                      onClick={() => exchangeToken('password')}
                      className="rounded-lg border border-line hover:bg-ink-800 px-3 py-2 text-[13px] text-slate-200"
                    >
                      {t('apiPasswordGrant')}
                    </button>
                    <button
                      type="button"
                      onClick={() => openAuthorize()}
                      className="rounded-lg border border-line hover:bg-ink-800 px-3 py-2 text-[13px] text-slate-200"
                    >
                      {t('apiAuthorize')}
                    </button>
                    <button
                      type="button"
                      onClick={() => exchangeToken('authorizationCode')}
                      className="rounded-lg border border-line hover:bg-ink-800 px-3 py-2 text-[13px] text-slate-200"
                    >
                      {t('apiExchangeCode')}
                    </button>
                  </>
                )}
              </div>
            </div>
            {project && (
              <p className="text-[12px] text-slate-500 mono">
                {project.name} · {project.base_url || 'no base URL'} · updated{' '}
                {new Date(project.updated_at).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
