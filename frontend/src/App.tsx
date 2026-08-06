import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type AppSettings, type Event, type Message, type Session } from './api'
import { looksLikeGeneralChat } from './chatGate'
import type { ReportPreviewPayload } from './messageExport'
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
import AgentBrowserPage, { type AgentBrowserTab } from './components/AgentBrowserPage'
import ChatPanel from './components/ChatPanel'
import RightPanel from './components/RightPanel'
import PanelResizeHandle from './components/PanelResizeHandle'
import SettingsPanel from './components/SettingsPanel'
import AgentPage from './components/AgentPage'
import AgentSessionsPage from './components/AgentSessionsPage'
import A2AConsolePage from './components/A2AConsolePage'
import RedTeamConsolePage from './components/RedTeamConsolePage'
import ApiTestConsolePage from './components/ApiTestConsolePage'

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

type View = 'agentbrowser' | 'a2a' | 'redteam' | 'apitest' | 'settings'
type AgentsPane = 'create' | 'list'
type RightTab = 'browser' | 'files' | 'logs' | 'report'

export default function App() {
  const { t, theme, setTheme, locale, setLocale, resolvedTheme, consoles } = usePreferences()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<View>('agentbrowser')
  const [agentBrowserTab, setAgentBrowserTab] = useState<AgentBrowserTab>('agents')
  const [agentsPane, setAgentsPane] = useState<AgentsPane>('create')
  const [wsConnected, setWsConnected] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [apiOk, setApiOk] = useState(false)
  /** null = probing, true = reachable, false = not configured/connected */
  const [llmReady, setLlmReady] = useState<boolean | null>(null)
  const [openFilePath, setOpenFilePath] = useState<string | null>(null)
  const [rightTab, setRightTab] = useState<RightTab>('browser')
  const [reportPreview, setReportPreview] = useState<ReportPreviewPayload | null>(null)
  const prevRightTabRef = useRef<Exclude<RightTab, 'report'>>('browser')
  const [scheduledCount, setScheduledCount] = useState(0)
  const [liveShotB64, setLiveShotB64] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('aip_sidebar_collapsed') === '1'
    } catch {
      return false
    }
  })
  const [sidebarPeek, setSidebarPeek] = useState(false)

  const toggleSidebar = useCallback(() => {
    setSidebarPeek(false)
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

  const hideSidebar = useCallback(() => {
    setSidebarPeek(false)
    setSidebarCollapsed(true)
    try {
      localStorage.setItem('aip_sidebar_collapsed', '1')
    } catch {
      /* ignore */
    }
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

  const showRightPanel = useCallback(() => {
    setRightPanelHidden(false)
    try {
      localStorage.setItem('aip_right_panel_hidden', '0')
    } catch {
      /* ignore */
    }
  }, [])

  const openReportPreview = useCallback(
    (payload: ReportPreviewPayload) => {
      setRightTab((current) => {
        if (current !== 'report') {
          prevRightTabRef.current = current
        }
        return 'report'
      })
      setReportPreview(payload)
      showRightPanel()
    },
    [showRightPanel],
  )

  const closeReportPreview = useCallback(() => {
    setReportPreview(null)
    setRightTab(prevRightTabRef.current)
  }, [])

  const onRightTabChange = useCallback(
    (t: RightTab) => {
      setRightTab((current) => {
        if (t === 'report') {
          if (!reportPreview) return current
          if (current !== 'report') {
            prevRightTabRef.current = current
          }
          return 'report'
        }
        prevRightTabRef.current = t
        return t
      })
    },
    [reportPreview],
  )

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

  const probeLlm = useCallback(async (cfg: AppSettings | null) => {
    const model = (cfg?.llm_model || '').trim()
    if (!model) {
      setLlmReady(false)
      return
    }
    setLlmReady(null)
    try {
      const r = await api.testLlm()
      setLlmReady(!!r.ok)
    } catch {
      setLlmReady(false)
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
        void probeLlm(s)
      })
      .catch(() => {
        setLlmReady(false)
      })
    const timer = window.setInterval(() => {
      refreshSessions()
      refreshScheduledCount()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refreshSessions, refreshScheduledCount, setTheme, setLocale, probeLlm])

  useEffect(() => {
    if (view === 'agentbrowser' && !consoles.agentbrowser) setView('settings')
    else if (view === 'a2a' && !consoles.a2a) {
      setView(consoles.agentbrowser ? 'agentbrowser' : 'settings')
    } else if (view === 'redteam' && !consoles.redteam) {
      setView(consoles.agentbrowser ? 'agentbrowser' : 'settings')
    } else if (view === 'apitest' && !consoles.apitest) {
      setView(consoles.agentbrowser ? 'agentbrowser' : 'settings')
    }
  }, [view, consoles])

  const goHome = useCallback(() => {
    setActiveId(null)
    setSession(null)
    setMessages([])
    setEvents([])
    setOpenFilePath(null)
    setReportPreview(null)
    setRightTab('browser')
    prevRightTabRef.current = 'browser'
    setView('agentbrowser')
    setAgentBrowserTab('agents')
    setAgentsPane('create')
  }, [])

  const loadSession = useCallback(async (id: string) => {
    setActiveId(id)
    setView('agentbrowser')
    setAgentBrowserTab('agents')
    setOpenFilePath(null)
    setReportPreview(null)
    setRightTab('browser')
    prevRightTabRef.current = 'browser'
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
          ev.type === 'error' ||
          ev.type === 'human_input_required'
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

  const onCreate = async (
    task: string,
    model?: string,
    files?: File[],
    runtimeUrl?: string,
    forceParallel?: boolean,
  ) => {
    if (llmReady !== true) {
      throw new Error(t('modelNotConnected'))
    }
    const s = await api.createSession(task, model, files, runtimeUrl, forceParallel)
    await refreshSessions()
    await loadSession(s.id)
    if (files && files.length > 0) {
      setRightTab('files')
      prevRightTabRef.current = 'files'
      setOpenFilePath(`uploads/${files[0].name}`)
    } else if (looksLikeGeneralChat(task)) {
      setRightTab('logs')
      prevRightTabRef.current = 'logs'
    }
  }

  const onSend = async (content: string) => {
    if (!activeId) return
    if (llmReady !== true) {
      window.alert(t('modelNotConnected'))
      return
    }
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

  const inAgentBrowser = view === 'agentbrowser'
  const showWorkspace = inAgentBrowser && agentBrowserTab === 'agents' && !!activeId
  const showSessionsList =
    inAgentBrowser && agentBrowserTab === 'agents' && !activeId && agentsPane === 'list'
  const showCreate =
    inAgentBrowser && agentBrowserTab === 'agents' && !activeId && agentsPane === 'create'
  const shouldRenderRightPanel = showBrowserPanel || reportPreview !== null

  const agentsWorkspace = showSessionsList ? (
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
        llmReady={llmReady}
        onSend={onSend}
        onPreviewReport={openReportPreview}
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
          prevRightTabRef.current = 'files'
        }}
        onScheduled={() => {
          void refreshScheduledCount()
        }}
        onOpenScheduled={() => {
          setView('agentbrowser')
          setAgentBrowserTab('scheduled')
        }}
      />
      {shouldRenderRightPanel && !rightPanelHidden ? (
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
            onTabChange={onRightTabChange}
            focusFile={openFilePath}
            onHide={toggleRightPanel}
            reportPreview={reportPreview}
            onCloseReport={closeReportPreview}
            width={rightPanelWidth}
          />
        </>
      ) : shouldRenderRightPanel && rightPanelHidden ? (
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
  ) : showCreate ? (
    <AgentPage
      settings={settings}
      llmReady={llmReady}
      onCreate={onCreate}
      onOpenSettings={() => setView('settings')}
    />
  ) : null

  return (
    <div className="bg-ink-950 text-slate-200 h-screen overflow-hidden flex flex-col">
      <header className="h-12 bg-ink-900 border-b border-line flex items-center px-4 justify-between text-[13px] flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-lg accent-fill font-bold text-xs flex items-center justify-center flex-shrink-0">
            AI
          </div>
          <span className="font-semibold text-[14px] text-slate-100 truncate">
            {t('brand')}
          </span>
          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? t('showSidebar') : t('hideSidebar')}
            className="w-8 h-8 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800 flex items-center justify-center flex-shrink-0"
            aria-label={sidebarCollapsed ? t('showSidebar') : t('hideSidebar')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>
          {activeId && showWorkspace ? (
            <>
              <span className="text-slate-600">/</span>
              <span className="text-slate-400">session</span>
              <span className="mono text-xs text-slate-300">{activeId.slice(0, 8)}…</span>
            </>
          ) : null}
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
          view={view}
          onView={(v: SidebarView) => {
            if (v === 'agentbrowser') {
              setView('agentbrowser')
            } else {
              setView(v)
            }
            hideSidebar()
          }}
          collapsed={sidebarCollapsed}
          peek={sidebarPeek}
          onPeekChange={setSidebarPeek}
          width={sidebarWidth}
        />
        {!sidebarCollapsed && !sidebarPeek && (
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
          <SettingsPanel
            settings={settings}
            onSaved={(s) => {
              setSettings(s)
              void probeLlm(s)
            }}
          />
        ) : view === 'a2a' ? (
          <A2AConsolePage
            sessions={sessions}
            onOpenSession={(id) => {
              void loadSession(id)
            }}
          />
        ) : view === 'redteam' ? (
          <RedTeamConsolePage
            sessions={sessions}
            onOpenSession={(id) => {
              void loadSession(id)
            }}
          />
        ) : view === 'apitest' ? (
          <ApiTestConsolePage sessions={sessions} />
        ) : (
          <AgentBrowserPage
            tab={agentBrowserTab}
            onTabChange={(tab) => {
              setAgentBrowserTab(tab)
              if (tab === 'agents' && !activeId) setAgentsPane('list')
            }}
            scheduledCount={scheduledCount}
            sessions={sessions}
            onNew={goHome}
            llmReady={llmReady}
            agentsWorkspace={agentsWorkspace}
            settings={settings}
            onSettingsSaved={(s) => {
              setSettings(s)
              void probeLlm(s)
            }}
            onOpenSession={(id) => {
              void loadSession(id)
            }}
          />
        )}
      </div>
    </div>
  )
}
