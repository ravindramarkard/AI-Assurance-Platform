import { useMemo, useState } from 'react'
import type { Session } from '../api'
import { usePreferences } from '../preferences'

export type AgentsHistoryRailProps = {
  sessions: Session[]
  activeId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onClearHistory: () => void
  width?: number
}

function statusDot(status: string) {
  if (status === 'running' || status === 'thinking') return 'bg-green-400'
  if (status === 'queued') return 'bg-amber-400'
  if (status === 'failed') return 'bg-red-400'
  if (status === 'paused') return 'bg-yellow-400'
  return 'bg-slate-600'
}

function IconSearch({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

export default function AgentsHistoryRail({
  sessions,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onClearHistory,
  width = 240,
}: AgentsHistoryRailProps) {
  const { t } = usePreferences()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => {
      const hay = `${s.title || ''} ${s.task || ''} ${s.id} ${s.status || ''} ${s.model || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [sessions, query])

  return (
    <aside
      className="bg-ink-900 border-r border-line flex flex-col text-base flex-shrink-0 min-w-0 min-h-0"
      style={{ width }}
    >
      <div className="p-3 flex-shrink-0">
        <button
          type="button"
          onClick={onNew}
          className="w-full accent-fill accent-shadow text-[14px] font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2"
        >
          <span className="text-base leading-none">+</span>
          <span>{t('newAgent')}</span>
        </button>
      </div>

      <div className="px-3 mt-1 mb-1.5 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="type-label text-slate-500">{t('history')}</div>
        {sessions.length > 0 && (
          <button
            type="button"
            title={t('clearAll')}
            onClick={() => {
              if (window.confirm(`Delete all ${sessions.length} sessions? This cannot be undone.`)) {
                onClearHistory()
              }
            }}
            className="text-[11px] text-slate-500 hover:text-red-400"
          >
            {t('clearAll')}
          </button>
        )}
      </div>

      <div className="px-2 mb-2 flex-shrink-0">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
            <IconSearch />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchHistory')}
            className="w-full bg-ink-800 border border-line rounded-lg pl-8 pr-2.5 py-1.5 text-[13px] text-slate-200 placeholder-slate-500 outline-none focus:border-bu-500/50"
            aria-label={t('searchHistory')}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll px-2 space-y-0.5 text-[13px] pb-2">
        {sessions.length === 0 && (
          <div className="px-2.5 py-2 text-slate-500 text-[13px]">{t('noSessions')}</div>
        )}
        {sessions.length > 0 && filtered.length === 0 && (
          <div className="px-2.5 py-2 text-slate-500 text-[13px]">{t('noSearchResults')}</div>
        )}
        {filtered.map((s) => (
          <div
            key={s.id}
            className={`group relative flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-ink-800 ${
              activeId === s.id ? 'active-nav bg-bu-500/10' : ''
            }`}
            onClick={() => onSelect(s.id)}
            title={s.title}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(s.status)}`} />
            <span
              className={`flex-1 truncate min-w-0 text-[13px] ${
                activeId === s.id ? 'text-slate-100 font-medium' : 'text-slate-400 font-normal'
              }`}
            >
              {s.title}
            </span>
            <button
              type="button"
              title="Delete session"
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-500 hover:text-red-400 px-1 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm(`Delete "${s.title.slice(0, 60)}"?`)) {
                  onDelete(s.id)
                }
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
