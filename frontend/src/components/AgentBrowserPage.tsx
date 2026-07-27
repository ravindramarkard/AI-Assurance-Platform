import { type ReactNode } from 'react'
import type { AppSettings, Session } from '../api'
import { usePreferences } from '../preferences'
import BrowsersView from './BrowsersView'
import AnalyticsView from './AnalyticsView'
import ScheduledJobsPage from './ScheduledJobsPage'
import AgentBrowserConfiguration from './AgentBrowserConfiguration'

export type AgentBrowserTab = 'agents' | 'browsers' | 'scheduled' | 'analytics' | 'configuration'

export type AgentBrowserPageProps = {
  tab: AgentBrowserTab
  onTabChange: (tab: AgentBrowserTab) => void
  scheduledCount: number
  sessions: Session[]
  onNew: () => void
  agentsWorkspace: ReactNode
  settings: AppSettings | null
  onSettingsSaved: (s: AppSettings) => void
  onOpenSession: (id: string) => void
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

export default function AgentBrowserPage({
  tab,
  onTabChange,
  scheduledCount,
  sessions,
  onNew,
  agentsWorkspace,
  settings,
  onSettingsSaved,
  onOpenSession,
}: AgentBrowserPageProps) {
  const { t } = usePreferences()

  const nav: { id: AgentBrowserTab; label: string; icon: ReactNode; badge?: string | null }[] = [
    { id: 'agents', label: t('agentSessions'), icon: <IconAgents /> },
    { id: 'browsers', label: t('navBrowsers'), icon: <IconBrowsers /> },
    {
      id: 'scheduled',
      label: t('navScheduled'),
      icon: <IconScheduled />,
      badge: scheduledCount > 0 ? String(scheduledCount) : null,
    },
    { id: 'analytics', label: t('navAnalytics'), icon: <IconAnalytics /> },
    { id: 'configuration', label: t('navConfiguration'), icon: <IconConfig /> },
  ]

  return (
    <main className="flex-1 min-w-0 bg-ink-950 flex min-h-0">
      <aside className="w-52 flex-shrink-0 border-r border-line bg-ink-900 flex flex-col">
        <div className="px-4 py-4 border-b border-line">
          <div className="text-[15px] font-semibold text-slate-100 tracking-tight">
            {t('agentBrowserConsole')}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{t('agentBrowserBlurb')}</div>
          <button
            type="button"
            onClick={onNew}
            className="mt-3 w-full accent-fill accent-shadow text-[13px] font-semibold py-2 rounded-lg flex items-center justify-center gap-2"
          >
            <span className="text-base leading-none">+</span>
            <span>{t('newAgent')}</span>
          </button>
        </div>
        <nav className="p-2 space-y-0.5 text-[13px]">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                tab === item.id
                  ? 'bg-bu-500/15 text-bu-300 border border-bu-500/30'
                  : 'text-slate-300 hover:bg-ink-800 border border-transparent'
              }`}
            >
              <span className={tab === item.id ? 'text-bu-300' : 'text-slate-500'}>{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge != null && (
                <span className="text-[11px] text-slate-500 tabular-nums">{item.badge}</span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {tab === 'agents' && (
          <div className="flex flex-1 min-h-0 min-w-0">{agentsWorkspace}</div>
        )}
        {tab === 'browsers' && <BrowsersView />}
        {tab === 'scheduled' && (
          <ScheduledJobsPage
            settings={settings}
            sessions={sessions}
            onOpenSession={onOpenSession}
          />
        )}
        {tab === 'analytics' && <AnalyticsView sessions={sessions} />}
        {tab === 'configuration' && (
          <AgentBrowserConfiguration settings={settings} onSaved={onSettingsSaved} />
        )}
      </div>
    </main>
  )
}
