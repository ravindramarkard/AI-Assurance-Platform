import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type AppSettings, type Event, type Message, type Session } from './api'
import { looksLikeGeneralChat } from './chatGate'
import {
  THEME_OPTIONS,
  THEME_SWATCHES,
  isThemeMode,
  usePreferences,
  type Locale,
  type ThemeMode,
} from './preferences'
import { connectSessionWs } from './ws'
import Sidebar, { type SidebarView } from './components/Sidebar'
import ChatPanel from './components/ChatPanel'
import RightPanel from './components/RightPanel'
import PanelResizeHandle from './components/PanelResizeHandle'
import SettingsPanel from './components/SettingsPanel'
import AgentPage from './components/AgentPage'
import AgentSessionsPage from './components/AgentSessionsPage'
import ScheduledJobsPage from './components/ScheduledJobsPage'

const RIGHT_PANEL_MIN = 320
const RIGHT_PANEL_DEFAULT = 560
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 240

function clampRightPanelWidth(w: number): number {
  const max = Math.max(RIGHT_PANEL_MIN, Math.floor(window.innerWidth * 0.72))
  return Math.min(max, Math.max(RIGHT_PANEL_MIN, Math.round(w)))
}

function clampSidebarWidth(w: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))
}

type View = 'agent' | 'sessions' | 'scheduled' | 'browsers' | 'analytics' | 'settings'

export default function App() {
  const { t, theme, setTheme, locale, setLocale, resolvedTheme } = usePreferences()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<View>('agent')
  const [wsConnected, setWsConnected] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [apiOk, setApiOk] = useState(false)
  const [openFilePath, setOpenFilePath] = useState<string | null>(null)
  const [rightTab, setRightTab] = useState<'browser' | 'files' | 'logs'>('browser')
  const [scheduledCount, setScheduledCount] = useState(0)
  const [liveShotB64, setLiveShotB64] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('aip_sidebar_collapsed') === '1'
    } catch {
      return false
    }
  })

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem('aip_sidebar_collapsed', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const raw = Number(localStorage.getItem('aip_sidebar_width'))
      if (Number.isFinite(raw) && raw >= SIDEBAR_MIN) return clampSidebarWidth(raw)
    } catch {
      /* ignore */
    }
    return SIDEBAR_DEFAULT
  })

  const persistSidebarWidth = useCallback((w: number) => {
    try {
      localStorage.setItem('aip_sidebar_width', String(w))
    } catch {
      /* ignore */
    }
  }, [])

  const onSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((w) => clampSidebarWidth(w + delta))
  }, [])

  const [rightPanelHidden, setRightPanelHidden] = useState(() => {
    try {
      return localStorage.getItem('aip_right_panel_hidden') === '1'
    } catch {
      return false
    }
  })

  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    try {
      const raw = Number(localStorage.getItem('aip_right_panel_width'))
      if (Number.isFinite(raw) && raw >= RIGHT_PANEL_MIN) return raw
    } catch {
      /* ignore */
    }
    return RIGHT_PANEL_DEFAULT
  })

  const persistRightPanelWidth = useCallback((w: number) => {
    try {
      localStorage.setItem('aip_right_panel_width', String(w))
    } catch {
      /* ignore */
    }
  }, [])

  const onRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth((w) => clampRightPanelWidth(w + delta))
  }, [])

  const toggleRightPanel = useCallback(() => {
    setRightPanelHidden((v) => {
      const next = !v
      try {
        localStorage.setItem('aip_right_panel_hidden', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const list = await api.listSessions()
      setSessions(list)
      setApiOk(true)
    } catch {
      setApiOk(false)
    }
  }, [])

  const refreshScheduledCount = useCallback(async () => {
    try {
      const jobs = await api.listScheduledJobs()
      setScheduledCount(jobs.length)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    refreshSessions()
    refreshScheduledCount()
    api
      .getSettings()
      .then((s) => {
        setSettings(s)
        if (isThemeMode(s.ui_theme)) {
          setTheme(s.ui_theme)
        }
        if (s.ui_locale === 'en' || s.ui_locale === 'ar' || s.ui_locale === 'hi') {
          setLocale(s.ui_locale)
        }
      })
      .catch(() => {})
    const timer = window.setInterval(() => {
      refreshSessions()
      refreshScheduledCount()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refreshSessions, refreshScheduledCount, setTheme, setLocale])

  const goHome = useCallback(() => {
    setActiveId(null)
    setSession(null)
    setMessages([])
    setEvents([])
    setOpenFilePath(null)
    setRightTab('browser')
    setView('agent')
  }, [])

  const loadSession = useCallback(async (id: string) => {
    setActiveId(id)
    setView('sessions')
    setOpenFilePath(null)
    setRightTab('browser')
    const [s, msgs, evs] = await Promise.all([
      api.getSession(id),
      api.getMessages(id),
      api.getEvents(id),
    ])
    setSession(s)
    setMessages(msgs)
    setEvents(evs)
  }, [])

  useEffect(() => {
    if (!activeId) return
    const sessionId = activeId
    const disconnect = connectSessionWs(
      sessionId,
      (ev) => {
        if (ev.type === 'ready') return
        // Keep React state lean — don't retain multi‑MB base64 frames in the event list.
        if (
          (ev.type === 'preview' || ev.type === 'step') &&
          typeof ev.payload?.screenshot_b64 === 'string' &&
          ev.payload.screenshot_b64
        ) {
          setLiveShotB64(String(ev.payload.screenshot_b64))
        }
        const slim =
          ev.payload && 'screenshot_b64' in ev.payload
            ? {
                ...ev,
                payload: Object.fromEntries(
                  Object.entries(ev.payload).filter(([k]) => k !== 'screenshot_b64'),
                ),
              }
            : ev
        // WS replays the full event backlog on every connect; API load already has them.
        setEvents((prev) => {
          const id = (slim as Event).id
          if (id && prev.some((e) => e.id === id)) return prev
          return [...prev, slim as Event]
        })
        if (ev.type === 'message' && ev.payload) {
          const role = String(ev.payload.role || 'assistant')
          const content = String(ev.payload.content || '')
          setMessages((prev) => {
            // Skip backlog / optimistic duplicates (same role+content already in state).
            if (prev.some((m) => m.role === role && m.content === content)) return prev
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                session_id: sessionId,
                role,
                content,
                created_at: new Date().toISOString(),
              },
            ]
          })
        }
        if (
          ev.type === 'status' ||
          ev.type === 'step' ||
          ev.type === 'preview' ||
          ev.type === 'done' ||
          ev.type === 'error'
        ) {
          api.getSession(sessionId).then(setSession).catch(() => {})
          refreshSessions()
        }
      },
      setWsConnected,
    )
    return disconnect
  }, [activeId, refreshSessions])

  useEffect(() => {
    setLiveShotB64(null)
  }, [activeId])

  const latestScreenshot = useMemo(() => {
    if (liveShotB64) {
      return { kind: 'b64' as const, value: liveShotB64 }
    }
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.type === 'preview' || e.type === 'step') {
        if (e.payload.screenshot && activeId) {
          const path = String(e.payload.screenshot)
          const bust = e.created_at || String(i)
          return {
            kind: 'url' as const,
            value: `${api.screenshotUrl(activeId, path)}?t=${encodeURIComponent(bust)}`,
          }
        }
        if (e.payload.screenshot_b64) {
          return { kind: 'b64' as const, value: String(e.payload.screenshot_b64) }
        }
      }
    }
    return null
  }, [events, activeId, liveShotB64])

  const currentUrl = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if ((e.type === 'preview' || e.type === 'step') && e.payload.url) {
        return String(e.payload.url)
      }
    }
    return session?.current_url || ''
  }, [events, session])

  const hadBrowserActivity = useMemo(() => {
    return events.some((e) => {
      if (e.type !== 'preview' && e.type !== 'step') return false
      const p = e.payload || {}
      return Boolean(p.url || p.screenshot || p.screenshot_b64)
    })
  }, [events])

  const showBrowserPanel = useMemo(() => {
    if (hadBrowserActivity) return true
    if (events.some((e) => e.type === 'done' && e.payload?.chat_only)) return false
    const task = session?.task || ''
    if (looksLikeGeneralChat(task)) return false
    // Follow-up-only chat: last user message is general and no browser yet
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        if (looksLikeGeneralChat(messages[i].content) && !hadBrowserActivity) return false
        break
      }
    }
    return true
  }, [hadBrowserActivity, events, session, messages])

  const onCreate = async (task: string, model?: string, files?: File[], runtimeUrl?: string) => {
    const s = await api.createSession(task, model, files, runtimeUrl)
    await refreshSessions()
    await loadSession(s.id)
    if (files && files.length > 0) {
      setRightTab('files')
      setOpenFilePath(`uploads/${files[0].name}`)
    } else if (looksLikeGeneralChat(task)) {
      setRightTab('logs')
    }
  }

  const onSend = async (content: string) => {
    if (!activeId) return
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        session_id: activeId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      },
    ])
    await api.postMessage(activeId, content)
  }

  const onDeleteSession = async (id: string) => {
    try {
      await api.deleteSession(id)
      if (activeId === id) goHome()
      await refreshSessions()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const onClearHistory = async () => {
    try {
      await api.clearHistory()
      goHome()
      await refreshSessions()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Clear failed')
    }
  }

  const showWorkspace = view === 'sessions' && !!activeId
  const showSessionsList = view === 'sessions' && !activeId

  return (
    <div className="bg-ink-950 text-slate-200 h-screen overflow-hidden flex flex-col">
      <header className="h-12 bg-ink-900 border-b border-line flex items-center px-4 justify-between text-[13px] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goHome}
            className="flex items-center gap-2 hover:opacity-90"
            title="New agent"
          >
            <div className="w-7 h-7 rounded-lg accent-fill font-bold text-xs flex items-center justify-center">
              AI
            </div>
            <span className="font-semibold text-[13px]">{t('brand')}</span>
          </button>
          <span className="text-slate-600">/</span>
          <span className="text-slate-400">{t('local')}</span>
          {activeId && showWorkspace && (
            <>
              <span className="text-slate-600">/</span>
              <span className="text-slate-400">session</span>
              <span className="text-slate-600">/</span>
              <span className="mono text-xs text-slate-300">{activeId.slice(0, 8)}…</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-slate-400">
          <select
            aria-label={t('theme')}
            value={theme}
            onChange={(e) => {
              const next = e.target.value as ThemeMode
              setTheme(next)
              // Persist so refresh / settings sync keep the choice
              void api
                .updateSettings({ ui_theme: next })
                .then((s) => setSettings(s))
                .catch(() => {})
            }}
            className="bg-ink-800 border border-line rounded-md px-2 py-1 text-[12px] text-slate-300 outline-none focus:border-bu-500 max-w-[140px]"
            title={`${t('theme')}: ${resolvedTheme}`}
          >
            {THEME_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(THEME_SWATCHES[opt].labelKey)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('language')}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="bg-ink-800 border border-line rounded-md px-2 py-1 text-[12px] text-slate-300 outline-none focus:border-bu-500"
          >
            <option value="en">EN</option>
            <option value="ar">AR</option>
            <option value="hi">HI</option>
          </select>
          <span className="text-slate-600">|</span>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${apiOk ? 'bg-green-400 pulse-dot' : 'bg-red-400'}`}
            />
            <span>
              {apiOk
                ? wsConnected || !activeId
                  ? t('connected')
                  : t('reconnecting')
                : t('apiOffline')}
            </span>
          </div>
          <span className="text-slate-600">|</span>
          <span>{settings?.llm_provider || '—'}</span>
          <span className="text-slate-600">|</span>
          <span className="truncate max-w-[140px]">{settings?.llm_model || 'model'}</span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <Sidebar
          sessions={sessions}
          activeId={showWorkspace ? activeId : null}
          view={
            (view === 'agent' || view === 'sessions'
              ? 'sessions'
              : view) as SidebarView
          }
          onView={(v) => {
            if (v === 'sessions') {
              setActiveId(null)
              setSession(null)
              setMessages([])
              setEvents([])
              setOpenFilePath(null)
              setView('sessions')
              return
            }
            setView(v)
          }}
          onSelect={loadSession}
          onNew={goHome}
          onDelete={onDeleteSession}
          onClearHistory={onClearHistory}
          scheduledCount={scheduledCount}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          width={sidebarWidth}
        />
        {!sidebarCollapsed && (
          <PanelResizeHandle
            edge="end"
            label="Resize sidebar"
            onResize={onSidebarResize}
            onResizeEnd={() => {
              setSidebarWidth((w) => {
                persistSidebarWidth(w)
                return w
              })
            }}
          />
        )}

        {view === 'settings' ? (
          <SettingsPanel settings={settings} onSaved={(s) => setSettings(s)} />
        ) : view === 'scheduled' ? (
          <ScheduledJobsPage
            settings={settings}
            sessions={sessions}
            onOpenSession={(id) => {
              void loadSession(id)
            }}
          />
        ) : view === 'browsers' ? (
          <BrowsersView />
        ) : view === 'analytics' ? (
          <AnalyticsView sessions={sessions} />
        ) : showSessionsList ? (
          <AgentSessionsPage
            sessions={sessions}
            onOpenSession={(id) => {
              void loadSession(id)
            }}
            onCreateSession={goHome}
            onRefresh={() => {
              void refreshSessions()
            }}
            onDelete={onDeleteSession}
          />
        ) : showWorkspace ? (
          <>
            <ChatPanel
              session={session}
              sessions={sessions}
              messages={messages}
              events={events}
              onSend={onSend}
              onControl={(action) => {
                if (!activeId) return
                void api.control(activeId, action).catch((e) => {
                  window.alert(e instanceof Error ? e.message : 'Control failed')
                })
              }}
              onClearSession={() => {
                if (!activeId) return
                void onDeleteSession(activeId)
              }}
              onOpenFile={(path) => {
                setOpenFilePath(path)
                setRightTab('files')
              }}
              onScheduled={() => {
                void refreshScheduledCount()
              }}
              onOpenScheduled={() => setView('scheduled')}
            />
            {showBrowserPanel && !rightPanelHidden ? (
              <>
                <PanelResizeHandle
                  edge="start"
                  label="Resize snaps panel"
                  onResize={onRightPanelResize}
                  onResizeEnd={() => {
                    setRightPanelWidth((w) => {
                      persistRightPanelWidth(w)
                      return w
                    })
                  }}
                />
                <RightPanel
                  sessionId={activeId}
                  screenshot={latestScreenshot}
                  url={currentUrl}
                  events={events}
                  status={session?.status}
                  tab={rightTab}
                  onTabChange={setRightTab}
                  focusFile={openFilePath}
                  onHide={toggleRightPanel}
                  width={rightPanelWidth}
                />
              </>
            ) : showBrowserPanel && rightPanelHidden ? (
              <div className="w-11 border-l border-line bg-ink-900 flex flex-col items-center py-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={toggleRightPanel}
                  title={t('showSnapsPanel')}
                  className="w-8 h-8 rounded-md border border-line bg-ink-800 hover:border-bu-500/50 text-slate-300 flex items-center justify-center"
                  aria-label={t('showSnapsPanel')}
                >
                  ⊡
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <AgentPage
            settings={settings}
            onCreate={onCreate}
            onOpenSettings={() => setView('settings')}
          />
        )}
      </div>
    </div>
  )
}

function BrowsersView() {
  const { t } = usePreferences()
  const [data, setData] = useState<Awaited<ReturnType<typeof api.browsers>> | null>(null)
  useEffect(() => {
    api.browsers().then(setData).catch(() => {})
    const timer = window.setInterval(() => api.browsers().then(setData).catch(() => {}), 3000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <main className="flex-1 p-8 bg-ink-900 overflow-y-auto scroll">
      <h1 className="text-lg font-semibold mb-4">{t('remoteBrowsers')}</h1>
      <p className="text-sm text-slate-400 mb-6">{t('browsersBlurb')}</p>
      {data?.browsers.map((b) => (
        <div key={b.id} className="border border-line rounded-lg p-4 bg-ink-800 max-w-md">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${b.status === 'busy' ? 'bg-bu-500 pulse-dot' : 'bg-green-400'}`}
            />
            <span className="font-semibold">{b.name}</span>
            <span className="ml-auto text-xs text-slate-500 uppercase">{b.status}</span>
          </div>
          <div className="mt-3 text-xs text-slate-400 flex gap-4">
            <span>
              {t('activeCount')}: {b.active_sessions}
            </span>
            <span>
              {t('queuedCount')}: {data.queued}
            </span>
          </div>
        </div>
      ))}
    </main>
  )
}

function AnalyticsView({ sessions }: { sessions: Session[] }) {
  const { t } = usePreferences()
  const completed = sessions.filter((s) => s.status === 'completed').length
  const failed = sessions.filter((s) => s.status === 'failed').length
  const running = sessions.filter((s) =>
    ['running', 'queued', 'thinking', 'paused'].includes(s.status),
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
