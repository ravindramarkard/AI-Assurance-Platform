import { useMemo, useState, type MouseEvent } from 'react'
import type { Session } from '../api'
import { usePreferences } from '../preferences'
import { isSessionLive, sessionStatusClass, sessionStatusLabel } from '../sessionStatus'

type Props = {
  sessions: Session[]
  onOpenSession: (id: string) => void
  onCreateSession: () => void
  onRefresh: () => void
  onDelete?: (id: string) => void
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const days = Math.floor(hr / 24)
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`
  try {
    return new Date(t).toLocaleDateString()
  } catch {
    return '—'
  }
}

function formatDuration(startIso: string, endIso: string, status: string): string {
  const a = Date.parse(startIso)
  const b = Date.parse(endIso)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—'
  const end = isSessionLive(status) ? Date.now() : b
  let sec = Math.max(0, Math.round((end - a) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  sec %= 60
  if (m < 60) return sec ? `${m}m ${sec}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

function shortId(id: string): string {
  if (id.length <= 12) return id
  return `${id.slice(0, 4)}…${id.slice(-4)}`
}

function parseFilter(raw: string): { text: string; status?: string; sessionId?: string } {
  let text = raw.trim()
  let status: string | undefined
  let sessionId: string | undefined
  const statusM = text.match(/\bstatus:\s*(\w+)/i)
  if (statusM) {
    status = statusM[1].toLowerCase()
    if (status === 'succeeded') status = 'completed'
    text = text.replace(statusM[0], '').trim()
  }
  const idM = text.match(/\bsession_id:\s*([^\s]+)/i)
  if (idM) {
    sessionId = idM[1].toLowerCase()
    text = text.replace(idM[0], '').trim()
  }
  return { text: text.toLowerCase(), status, sessionId }
}

function IconRefresh({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.6-6.3" strokeLinecap="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconCopy({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" strokeLinecap="round" />
    </svg>
  )
}

function IconExternal({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 5h5v5M19 5l-9 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4" strokeLinecap="round" />
    </svg>
  )
}

export default function AgentSessionsPage({
  sessions,
  onOpenSession,
  onCreateSession,
  onRefresh,
  onDelete,
}: Props) {
  const { t } = usePreferences()
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const f = parseFilter(query)
    return sessions.filter((s) => {
      if (f.status && (s.status || '').toLowerCase() !== f.status) return false
      if (f.sessionId && !s.id.toLowerCase().includes(f.sessionId)) return false
      if (!f.text) return true
      const hay = `${s.title || ''} ${s.task || ''} ${s.id} ${s.status || ''} ${s.model || ''}`.toLowerCase()
      return hay.includes(f.text)
    })
  }, [sessions, query])

  const copyId = async (id: string, e: MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(id)
      setCopied(id)
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <main className="flex-1 min-w-0 bg-ink-900 overflow-y-auto scroll flex flex-col">
      <div className="w-full flex-1 flex flex-col px-6 py-6 min-h-0">
        <div className="flex items-start justify-between gap-4 mb-6 flex-shrink-0">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold text-slate-100 tracking-tight">
              {t('agentSessions')}
            </h1>
            <p className="mt-1.5 text-[13px] text-slate-400 leading-relaxed">
              {t('agentSessionsBlurb')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 pt-1">
            <span className="text-[12px] text-slate-500 tabular-nums">
              {sessions.length} {t('sessionsCount')}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line bg-ink-800 hover:border-slate-600 text-[12px] text-slate-300 font-medium"
            >
              <IconRefresh />
              {t('refresh')}
            </button>
            <button
              type="button"
              onClick={onCreateSession}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bu-500 hover:bg-bu-600 text-white text-[12px] font-semibold"
            >
              + {t('createSession')}
            </button>
          </div>
        </div>

        <div className="mb-4 flex-shrink-0">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sessionsSearchPlaceholder')}
            className="w-full bg-ink-950 border border-line rounded-lg px-3.5 py-2.5 text-[13px] text-slate-200 outline-none focus:border-bu-500 placeholder:text-slate-600"
          />
        </div>

        <div className="border border-line rounded-xl overflow-hidden bg-ink-950/40 flex-1 min-h-0 flex flex-col">
          <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">{t('colGoal')}</th>
                <th className="px-3 py-3 font-medium w-[140px]">{t('colSessionId')}</th>
                <th className="px-3 py-3 font-medium w-[100px]">{t('colProfileId')}</th>
                <th className="px-3 py-3 font-medium w-[120px]">{t('colStartedAt')}</th>
                <th className="px-3 py-3 font-medium w-[90px]">{t('colDuration')}</th>
                <th className="px-3 py-3 font-medium w-[120px]">{t('colLastTask')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-slate-500 text-sm">
                    {sessions.length === 0 ? t('noSessionsYet') : t('noSearchResults')}
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => onOpenSession(s.id)}
                    className="border-b border-line/80 last:border-0 hover:bg-ink-800/60 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3.5 align-middle">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-slate-100 font-medium min-w-0 flex-1">
                          {s.title || s.task || t('untitled')}
                        </span>
                        {s.model && (
                          <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-line text-slate-500">
                            {s.model.length > 18 ? `${s.model.slice(0, 16)}…` : s.model}
                          </span>
                        )}
                        {s.role === 'orchestrator' && (
                          <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-bu-500/30 bg-bu-500/10 text-bu-400">
                            {s.child_stats?.total ?? 0} {t('subagents')}
                          </span>
                        )}
                        <span className="opacity-0 group-hover:opacity-100 text-slate-500 flex-shrink-0">
                          <IconExternal />
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 align-middle">
                      <button
                        type="button"
                        title={s.id}
                        onClick={(e) => void copyId(s.id, e)}
                        className="inline-flex items-center gap-1.5 font-mono text-[12px] text-slate-400 hover:text-bu-400"
                      >
                        {shortId(s.id)}
                        <IconCopy className="w-3 h-3 opacity-60" />
                        {copied === s.id && (
                          <span className="text-[10px] text-emerald-400">{t('copied')}</span>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-3.5 align-middle text-slate-600">—</td>
                    <td className="px-3 py-3.5 align-middle text-slate-400 whitespace-nowrap">
                      {relativeTime(s.created_at)}
                    </td>
                    <td className="px-3 py-3.5 align-middle text-slate-400 tabular-nums whitespace-nowrap">
                      {formatDuration(s.created_at, s.updated_at, s.status)}
                    </td>
                    <td className="px-3 py-3.5 align-middle">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${sessionStatusClass(s.status)}`}
                        >
                          {sessionStatusLabel(s.status, t)}
                        </span>
                        {onDelete && (
                          <button
                            type="button"
                            title={t('delete')}
                            onClick={(e) => {
                              e.stopPropagation()
                              onDelete(s.id)
                            }}
                            className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-xs px-1"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t border-line text-[12px] text-slate-500 flex items-center gap-2 flex-shrink-0">
              <span className="text-amber-400/80">✦</span>
              {t('noAdditionalRows')}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
