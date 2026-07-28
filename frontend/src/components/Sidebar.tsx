import { type ReactNode, useEffect, useRef } from 'react'
import { usePreferences } from '../preferences'

export type SidebarView =
  | 'agentbrowser'
  | 'a2a'
  | 'redteam'
  | 'apitest'
  | 'settings'

type Props = {
  view: SidebarView
  onView: (v: SidebarView) => void
  collapsed: boolean
  /** Temporary expand while hovering the collapsed edge */
  peek: boolean
  onPeekChange: (peek: boolean) => void
  /** Expanded sidebar width in px (ignored when collapsed). */
  width?: number
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

function IconA2A({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l8 5v8l-8 5-8-5V8l8-5Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconRedTeam({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 9.5C8 19.2 5 15.5 5 11V6l7-3Z" />
      <path d="M9.5 12.5 12 15l3.5-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconApiTest({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 10h3M8 14h8M15 10h1" strokeLinecap="round" />
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

export default function Sidebar({
  view,
  onView,
  collapsed,
  peek,
  onPeekChange,
  width = 240,
}: Props) {
  const { t, consoles } = usePreferences()
  const leaveTimer = useRef<number | null>(null)

  const showPanel = !collapsed || peek

  useEffect(() => {
    return () => {
      if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current)
    }
  }, [])

  const clearLeaveTimer = () => {
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }

  const selectView = (v: SidebarView) => {
    onView(v)
  }

  const onRailEnter = () => {
    clearLeaveTimer()
    if (collapsed) onPeekChange(true)
  }

  const onPanelLeave = () => {
    if (!collapsed) return
    clearLeaveTimer()
    leaveTimer.current = window.setTimeout(() => onPeekChange(false), 160)
  }

  const nav: {
    id: SidebarView
    label: string
    title: string
    icon: ReactNode
    onClick: () => void
    active: boolean
  }[] = [
    ...(consoles.agentbrowser
      ? [
          {
            id: 'agentbrowser' as const,
            label: t('navAgentBrowser'),
            title: t('agentBrowserConsole'),
            icon: <IconAgents />,
            onClick: () => selectView('agentbrowser'),
            active: view === 'agentbrowser',
          },
        ]
      : []),
    ...(consoles.a2a
      ? [
          {
            id: 'a2a' as const,
            label: t('navA2A'),
            title: t('a2aConsole'),
            icon: <IconA2A />,
            onClick: () => selectView('a2a'),
            active: view === 'a2a',
          },
        ]
      : []),
    ...(consoles.redteam
      ? [
          {
            id: 'redteam' as const,
            label: t('navRedTeam'),
            title: t('rtConsole'),
            icon: <IconRedTeam />,
            onClick: () => selectView('redteam'),
            active: view === 'redteam',
          },
        ]
      : []),
    ...(consoles.apitest
      ? [
          {
            id: 'apitest' as const,
            label: t('navApiTest'),
            title: t('apiConsole'),
            icon: <IconApiTest />,
            onClick: () => selectView('apitest'),
            active: view === 'apitest',
          },
        ]
      : []),
  ]

  /* Collapsed: thin hover edge — page stays 2-panel (secondary + main) */
  if (!showPanel) {
    return (
      <aside
        className="w-2 flex-shrink-0 self-stretch bg-ink-900/80 border-r border-line hover:bg-bu-500/30 cursor-pointer transition-colors"
        title={t('showSidebar')}
        onMouseEnter={onRailEnter}
        onFocus={onRailEnter}
        aria-label={t('showSidebar')}
      />
    )
  }

  /* Expanded in layout flow: 1st + 2nd + 3rd panels share the page */
  return (
    <aside
      className="bg-ink-900 border-r border-line flex flex-col text-base flex-shrink-0 min-w-0 self-stretch"
      style={{ width }}
      onMouseEnter={() => {
        clearLeaveTimer()
        if (collapsed) onPeekChange(true)
      }}
      onMouseLeave={onPanelLeave}
    >
      <nav className="px-2 pt-3 space-y-0.5 flex-shrink-0 text-[14px]">
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
          </button>
        ))}
        <button
          type="button"
          onClick={() => selectView('settings')}
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

      <div className="flex-1" />

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
