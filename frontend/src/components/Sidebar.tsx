import { useMemo, useState, type ReactNode } from 'react'
import type { Session } from '../api'
import { usePreferences } from '../preferences'

export type SidebarView = 'sessions' | 'scheduled' | 'browsers' | 'analytics' | 'settings'

type Props = {
  sessions: Session[]
  activeId: string | null
  view: SidebarView
  onView: (v: SidebarView) => void
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onClearHistory: () => void
  scheduledCount?: number
  collapsed: boolean
  onToggleCollapse: () => void
  /** Expanded sidebar width in px (ignored when collapsed). */
  width?: number
}

function statusDot(status: string) {
  if (status === 'running' || status === 'thinking') return 'bg-green-400'
  if (status === 'queued') return 'bg-amber-400'
  if (status === 'failed') return 'bg-red-400'
  if (status === 'paused') return 'bg-yellow-400'
  return 'bg-slate-600'
}

function IconAgents({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 17h6M12 8V5" strokeLinecap="round" />
    </svg>
  )
}

function IconBrowsers({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" strokeLinecap="round" />
    </svg>
  )
}

function IconScheduled({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconAnalytics({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19V5M4 19h16" strokeLinecap="round" />
      <path d="M8 15v-4M12 15V8M16 15v-6" strokeLinecap="round" />
    </svg>
  )
}

function IconSettings({ className = 'w-4 h-4' }: { className?: string }) {
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

function IconPanel({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  )
}

function IconSearch({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

function IconHistory({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 12a9 9 0 1 0 3-6.7" strokeLinecap="round" />
      <path d="M3 4v4h4M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Sidebar({
  sessions,
  activeId,
  view,
  onView,
  onSelect,
  onNew,
  onDelete,
  onClearHistory,
  scheduledCount = 0,
  collapsed,
  onToggleCollapse,
  width = 240,
}: Props) {
  const { t } = usePreferences()
  const [query, setQuery] = useState('')
  const [historyFocus, setHistoryFocus] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => {
      const hay = `${s.title || ''} ${s.task || ''} ${s.id} ${s.status || ''} ${s.model || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [sessions, query])

  const nav: {
    id: SidebarView | 'history'
    label: string
    title: string
    badge?: string | null
    icon: ReactNode
    onClick: () => void
    active: boolean
  }[] = [
    {
      id: 'sessions',
      label: t('navAgents'),
      title: t('navAgents'),
      badge: String(sessions.length),
      icon: <IconAgents />,
      onClick: () => {
        setHistoryFocus(false)
        onView('sessions')
      },
      active: view === 'sessions' && !historyFocus,
    },
    {
      id: 'browsers',
      label: t('navBrowsers'),
      title: t('navBrowsers'),
      icon: <IconBrowsers />,
      onClick: () => {
        setHistoryFocus(false)
        onView('browsers')
      },
      active: view === 'browsers',
    },
    {
      id: 'scheduled',
      label: t('navScheduled'),
      title: t('navScheduled'),
      badge: scheduledCount > 0 ? String(scheduledCount) : null,
      icon: <IconScheduled />,
      onClick: () => {
        setHistoryFocus(false)
        onView('scheduled')
      },
      active: view === 'scheduled',
    },
    {
      id: 'analytics',
      label: t('navAnalytics'),
      title: t('navAnalytics'),
      icon: <IconAnalytics />,
      onClick: () => {
        setHistoryFocus(false)
        onView('analytics')
      },
      active: view === 'analytics',
    },
  ]

  /* ——— Collapsed icon rail (matches Browser Use) ——— */
  if (collapsed) {
    return (
      <aside className="w-[56px] bg-ink-900 border-r border-line flex flex-col items-center py-3 gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={onToggleCollapse}
          title={t('showSidebar')}
          className="w-9 h-9 rounded-xl accent-fill accent-shadow font-extrabold text-[11px] flex items-center justify-center mb-2"
        >
          AI
        </button>
        <button
          type="button"
          onClick={onNew}
          title={t('newAgent')}
          className="w-9 h-9 rounded-xl border border-line bg-ink-800 hover:border-bu-500/50 text-slate-200 text-lg font-semibold flex items-center justify-center"
        >
          +
        </button>
        <div className="w-7 border-t border-line my-2" />
        {nav.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.title}
            onClick={item.onClick}
            className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
              item.active
                ? 'bg-bu-500/15 text-bu-400'
                : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200'
            }`}
          >
            {item.icon}
            {item.badge && Number(item.badge) > 0 && item.id === 'scheduled' && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-bu-500" />
            )}
          </button>
        ))}
        <button
          type="button"
          title={t('history')}
          onClick={() => {
            setHistoryFocus(true)
            onView('sessions')
            onToggleCollapse()
          }}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-ink-800 hover:text-slate-200"
        >
          <IconHistory />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          title={t('settings')}
          onClick={() => onView('settings')}
          className={`w-9 h-9 rounded-xl flex items-center justify-center ${
            view === 'settings'
              ? 'bg-bu-500/15 text-bu-400'
              : 'text-slate-400 hover:bg-ink-800 hover:text-slate-200'
          }`}
        >
          <IconSettings />
        </button>
      </aside>
    )
  }

  /* ——— Expanded sidebar ——— */
  return (
    <aside
      className="bg-ink-900 border-r border-line flex flex-col text-base flex-shrink-0 min-w-0"
      style={{ width }}
    >
      {/* Brand + collapse (like Browser Use header) */}
      <div className="h-12 px-3 flex items-center gap-2 border-b border-line flex-shrink-0">
        <div className="w-7 h-7 rounded-lg accent-fill font-bold text-xs flex items-center justify-center flex-shrink-0">
          AI
        </div>
        <span className="font-semibold text-[14px] text-slate-100 truncate flex-1 min-w-0">
          {t('brandShort')}
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          title={t('hideSidebar')}
          className="w-8 h-8 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800 flex items-center justify-center flex-shrink-0"
          aria-label={t('hideSidebar')}
        >
          <IconPanel />
        </button>
      </div>

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

      <nav className="px-2 space-y-0.5 flex-shrink-0 text-[14px]">
        {nav.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            className={`relative w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors font-medium ${
              item.active ? 'active-nav bg-bu-500/10 text-bu-400' : 'text-slate-300 hover:bg-ink-800'
            }`}
          >
            <span className={item.active ? 'text-bu-400' : 'text-slate-400'}>{item.icon}</span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge != null && (
              <span className="text-[11px] text-slate-500 tabular-nums font-normal">{item.badge}</span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onView('settings')}
          className={`relative w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors font-medium ${
            view === 'settings' ? 'active-nav bg-bu-500/10 text-bu-400' : 'text-slate-300 hover:bg-ink-800'
          }`}
        >
          <span className={view === 'settings' ? 'text-bu-400' : 'text-slate-400'}>
            <IconSettings />
          </span>
          <span>{t('settings')}</span>
        </button>
      </nav>

      <div className="px-3 mt-4 mb-1.5 flex items-center justify-between gap-2 flex-shrink-0">
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
                if (window.confirm(`Delete “${s.title.slice(0, 60)}”?`)) {
                  onDelete(s.id)
                }
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-line flex items-center gap-2.5 flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-ink-750 border border-line flex items-center justify-center text-[11px] font-semibold text-slate-300">
          AI
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-slate-200 truncate font-medium">{t('localUser')}</div>
          <div className="text-[11px] text-slate-500 truncate">{t('local')}</div>
        </div>
        <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title={t('connected')} />
      </div>
    </aside>
  )
}
