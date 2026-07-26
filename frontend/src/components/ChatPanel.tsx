import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type CreateScheduledJobBody, type Event, type Message, type Session } from '../api'
import { suggestFollowUps } from '../followUpPrompts'
import { usePreferences } from '../preferences'
import ScheduleJobModal from './ScheduleJobModal'
import LogIssueModal from './LogIssueModal'
import MessageActions from './MessageActions'
import VoiceInputButton from './VoiceInputButton'

type Props = {
  session: Session | null
  sessions?: Session[]
  messages: Message[]
  events: Event[]
  onSend: (content: string) => Promise<void>
  onControl: (action: 'pause' | 'resume' | 'stop') => void
  /** Delete current session and leave the workspace */
  onClearSession?: () => void
  onOpenFile?: (path: string) => void
  onScheduled?: () => void
  onOpenScheduled?: () => void
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms / 1000))}s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}

type ToolKind = 'browser' | 'files' | 'other'

type ToolCall = {
  kind: ToolKind
  title: string
  code: string
  outputLines: string[]
  filePath?: string
}

type TimelineItem =
  | { kind: 'message'; message: Message }
  | {
      kind: 'agent_block'
      steps: Event[]
      files: Event[]
      thoughtMs: number
      plan: string[]
      thoughtBody: string
      note?: string
    }
  | { kind: 'error'; event: Event }

function kv(action: string): Record<string, string> {
  const out: Record<string, string> = {}
  // match key=value or key='value' / key="value"
  const re = /(\w+)=('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|[^,]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(action))) {
    let v = m[2].trim()
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

function actionName(action: string): string {
  const i = action.indexOf(':')
  return (i >= 0 ? action.slice(0, i) : action).trim().toLowerCase()
}

function humanTitle(action: string): string {
  const name = actionName(action)
  const p = kv(action)
  switch (name) {
    case 'navigate':
    case 'go_to_url':
    case 'goto':
      return p.url ? `Navigate to ${shortUrl(p.url)}` : 'Navigate'
    case 'go_back':
      return p.description || 'Go back'
    case 'click':
      return p.index ? `Click element #${p.index}` : 'Click'
    case 'input':
    case 'type':
    case 'fill':
      return p.text != null
        ? `Type “${truncate(p.text, 28)}”`
        : 'Type into field'
    case 'wait':
      return p.seconds ? `Wait ${p.seconds}s` : 'Wait'
    case 'scroll':
      return 'Scroll page'
    case 'extract':
    case 'extract_content':
      return 'Extract page content'
    case 'screenshot':
      return 'Take screenshot'
    case 'write_file':
    case 'append_file':
      return p.file_name || p.filename || p.path || 'Write file'
    case 'read_file':
      return `Read ${p.file_name || p.path || 'file'}`
    case 'done':
      return 'Complete task'
    case 'search':
      return p.query ? `Search “${truncate(p.query, 32)}”` : 'Search'
    case 'select_dropdown':
      return 'Select dropdown option'
    case 'send_keys':
      return p.keys ? `Press ${p.keys}` : 'Send keys'
    case 'error':
      return 'Error'
    default:
      return name.replace(/_/g, ' ')
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 36 ? `${u.pathname.slice(0, 34)}…` : u.pathname
    return `${u.host}${path}`
  } catch {
    return truncate(url, 48)
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function actionToCode(action: string): string {
  const name = actionName(action)
  const p = kv(action)
  switch (name) {
    case 'navigate':
    case 'go_to_url':
    case 'goto':
      return [
        `const page = await session.getPage()`,
        `await page.goto(${JSON.stringify(p.url || '')})`,
        `await page.waitForLoadState('networkidle')`,
        `const title = await page.title()`,
        `console.log('Title:', title)`,
      ].join('\n')
    case 'go_back':
      return [
        `const page = await session.getPage()`,
        `await page.goBack()`,
        `await page.waitForLoadState('domcontentloaded')`,
      ].join('\n')
    case 'click':
      return [
        `const page = await session.getPage()`,
        p.index
          ? `await page.locator('[data-index="${p.index}"]').click()`
          : `await page.click(${JSON.stringify(p.selector || 'button')})`,
      ].join('\n')
    case 'input':
    case 'type':
    case 'fill':
      return [
        `const page = await session.getPage()`,
        p.index
          ? `await page.locator('[data-index="${p.index}"]').fill(${JSON.stringify(p.text ?? '')})`
          : `await page.fill(${JSON.stringify(p.selector || 'input')}, ${JSON.stringify(p.text ?? '')})`,
      ].join('\n')
    case 'wait':
      return `await page.waitForTimeout(${Number(p.seconds || 1) * 1000})`
    case 'write_file':
    case 'append_file': {
      const fname = p.file_name || p.filename || p.path || 'output.txt'
      const preview = truncate((p.content || '').replace(/\\n/g, '\n'), 120)
      return [
        `await fs.writeFile(`,
        `  ${JSON.stringify(fname)},`,
        `  ${JSON.stringify(preview)}${preview.length >= 120 ? ' + "…"' : ''}`,
        `)`,
      ].join('\n')
    }
    case 'done':
      return [
        `return {`,
        `  success: ${p.success ?? 'true'},`,
        `  text: ${JSON.stringify(truncate(p.text || 'Task complete', 80))}`,
        `}`,
      ].join('\n')
    case 'send_keys':
      return `await page.keyboard.press(${JSON.stringify(p.keys || 'Enter')})`
    case 'scroll':
      return `await page.mouse.wheel(0, ${p.amount || 600})`
    case 'error':
      return `throw new Error(${JSON.stringify(truncate(action.replace(/^error:\s*/i, ''), 160))})`
    default:
      return `// ${action}`
  }
}

function actionToOutput(action: string, step: Event): string[] {
  const name = actionName(action)
  const p = kv(action)
  const lines: string[] = []
  if (step.payload.title) lines.push(`Title: ${String(step.payload.title)}`)
  if (step.payload.url) lines.push(`URL: ${String(step.payload.url)}`)
  if (step.payload.screenshot) lines.push('(1 screenshot attached)')
  if (name === 'done' && p.text) lines.push(truncate(p.text.replace(/\\n/g, ' '), 180))
  if (name === 'write_file' || name === 'append_file') {
    lines.push(`Wrote ${p.file_name || p.filename || p.path || 'file'}`)
  }
  if (name === 'error') lines.push(truncate(action.replace(/^error:\s*/i, ''), 200))
  if (name === 'input' || name === 'type' || name === 'fill') {
    lines.push(`Typed into field${p.index ? ` #${p.index}` : ''}`)
  }
  if (name === 'click') lines.push(`Clicked${p.index ? ` element #${p.index}` : ''}`)
  if (name === 'wait') lines.push(`Waited ${p.seconds || 1}s`)
  if (!lines.length) lines.push('OK')
  return lines
}

function toToolCall(action: string, step: Event): ToolCall {
  const name = actionName(action)
  const p = kv(action)
  const isFile = name.includes('file') || name === 'write_file' || name === 'append_file'
  return {
    kind: isFile ? 'files' : name === 'done' ? 'other' : 'browser',
    title: humanTitle(action),
    code: actionToCode(action),
    outputLines: actionToOutput(action, step),
    filePath: p.file_name || p.filename || p.path,
  }
}

function extractPlan(steps: Event[]): { plan: string[]; thoughtBody: string } {
  const plan: string[] = []
  let thoughtBody = ''

  for (const e of steps) {
    const fields = (e.payload.thought_fields || {}) as Record<string, string>
    const thinking = fields.thinking || String(e.payload.thought || '')
    if (!thoughtBody && thinking) thoughtBody = thinking

    // plan_update may arrive as JSON array string in thought fields
    const rawPlan = (fields as Record<string, unknown>).plan_update
    if (Array.isArray(rawPlan)) {
      for (const item of rawPlan) {
        const s = String(item).trim()
        if (s && !plan.includes(s)) plan.push(s)
      }
    } else if (typeof rawPlan === 'string') {
      try {
        const parsed = JSON.parse(rawPlan)
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const s = String(item).trim()
            if (s && !plan.includes(s)) plan.push(s)
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Numbered lines inside thinking: "1. Do X"
    for (const line of thinking.split('\n')) {
      const m = line.trim().match(/^\d+[\.)]\s+(.+)/)
      if (m) {
        const s = m[1].trim()
        if (s && !plan.includes(s) && s.length < 160) plan.push(s)
      }
    }
  }

  // Fallback plan from next_goal / memory of early steps
  if (plan.length === 0 && steps.length) {
    const first = (steps[0].payload.thought_fields || {}) as Record<string, string>
    if (first.next_goal) plan.push(first.next_goal)
    const goals = steps
      .map((s) => ((s.payload.thought_fields || {}) as Record<string, string>).next_goal)
      .filter(Boolean) as string[]
    for (const g of goals.slice(0, 6)) {
      if (!plan.includes(g)) plan.push(g)
    }
  }

  return { plan: plan.slice(0, 10), thoughtBody }
}

function labelForKind(kind: ToolKind): string {
  if (kind === 'files') return 'Artifacts'
  if (kind === 'browser') return 'Snaps'
  return 'Agent'
}

function firstUrlInText(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s)'"`<>]+/i)
  return m?.[0]
}

export default function ChatPanel({
  session,
  sessions = [],
  messages,
  events,
  onSend,
  onControl,
  onClearSession,
  onOpenFile,
  onScheduled,
  onOpenScheduled,
}: Props) {
  const { t } = usePreferences()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [voiceErr, setVoiceErr] = useState('')
  const [expandedThought, setExpandedThought] = useState<Record<string, boolean>>({})
  const [expandedCode, setExpandedCode] = useState<Record<string, boolean>>({})
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [logIssueOpen, setLogIssueOpen] = useState(false)
  const [scheduleToast, setScheduleToast] = useState<string | null>(null)
  const [dismissedFollowUps, setDismissedFollowUps] = useState(false)
  const [stickToBottom, setStickToBottom] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const NEAR_BOTTOM_PX = 96

  const isNearBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = true
    setStickToBottom(true)
    el.scrollTo({ top: el.scrollHeight, behavior })
  }

  const onTimelineScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const near = isNearBottom(el)
    stickToBottomRef.current = near
    setStickToBottom(near)
  }

  const clearSession = () => {
    if (!session) return
    if (!window.confirm(t('clearSessionConfirm'))) return
    if (
      session.status === 'running' ||
      session.status === 'queued' ||
      session.status === 'paused' ||
      session.status === 'thinking'
    ) {
      onControl('stop')
    }
    onClearSession?.()
  }

  // New suggestions when the session finishes a turn
  useEffect(() => {
    setDismissedFollowUps(false)
  }, [session?.id, session?.status, messages.length])

  // New session → resume auto-follow
  useEffect(() => {
    stickToBottomRef.current = true
    setStickToBottom(true)
  }, [session?.id])

  const thinking =
    session?.status === 'running' ||
    session?.status === 'queued' ||
    session?.status === 'paused'

  const followUps = useMemo(() => {
    if (!session || thinking || dismissedFollowUps) return []
    if (session.status === 'running' || session.status === 'queued') return []
    return suggestFollowUps({ session, messages, events })
  }, [session, messages, events, thinking, dismissedFollowUps])

  useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = scrollRef.current
    if (!el) return
    // Instant while the agent is streaming steps; smooth otherwise
    const behavior: ScrollBehavior =
      session?.status === 'running' || session?.status === 'thinking' ? 'auto' : 'smooth'
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [messages.length, events.length, followUps.length, session?.status, stickToBottom])

  const timeline = useMemo(() => {
    const items: TimelineItem[] = []
    const steps = events.filter((e) => e.type === 'step')
    const fileEvents = events.filter((e) => e.type === 'file_written')
    const errors = events.filter((e) => e.type === 'error')

    const ts = (iso?: string | null) => (iso ? Date.parse(iso) : NaN)

    const buildAgentBlock = (turnSteps: Event[], turnFiles: Event[]) => {
      if (!turnSteps.length && !turnFiles.length) return
      const t0 = turnSteps[0]?.created_at ? ts(turnSteps[0].created_at) : Date.now()
      const t1 = turnSteps[turnSteps.length - 1]?.created_at
        ? ts(turnSteps[turnSteps.length - 1].created_at!)
        : t0
      const { plan, thoughtBody } = extractPlan(turnSteps)
      let note: string | undefined
      for (let i = turnSteps.length - 1; i >= 0; i--) {
        const fields = (turnSteps[i].payload.thought_fields || {}) as Record<string, string>
        note =
          fields.memory ||
          fields.thinking ||
          (turnSteps[i].payload.thought as string) ||
          undefined
        if (note) break
      }
      items.push({
        kind: 'agent_block',
        steps: turnSteps,
        files: turnFiles,
        thoughtMs: Math.max(1000, (t1 || 0) - (t0 || 0) || turnSteps.length * 4000),
        plan,
        thoughtBody,
        note,
      })
    }

    // Chronological turns: user → tools/thought → assistant (so new answers appear below)
    let cursor = 0
    while (cursor < messages.length) {
      const m = messages[cursor]
      if (m.role !== 'user') {
        // Orphan assistant (e.g. system) — show as-is
        items.push({ kind: 'message', message: m })
        cursor++
        continue
      }

      items.push({ kind: 'message', message: m })
      const userT = ts(m.created_at)
      const nextUserIdx = messages.findIndex((x, i) => i > cursor && x.role === 'user')
      const nextUserT =
        nextUserIdx >= 0 ? ts(messages[nextUserIdx].created_at) : Number.POSITIVE_INFINITY

      const seenStep = new Set<string>()
      const turnSteps = steps.filter((s) => {
        const id = s.id || ''
        if (id && seenStep.has(id)) return false
        const t = ts(s.created_at)
        const inTurn =
          !Number.isFinite(t) || !Number.isFinite(userT)
            ? nextUserIdx < 0
            : t >= userT - 500 && t < nextUserT
        if (inTurn && id) seenStep.add(id)
        return inTurn
      })
      const seenFile = new Set<string>()
      const turnFiles = fileEvents.filter((s) => {
        const id = s.id || ''
        if (id && seenFile.has(id)) return false
        const t = ts(s.created_at)
        const inTurn =
          !Number.isFinite(t) || !Number.isFinite(userT)
            ? nextUserIdx < 0
            : t >= userT - 500 && t < nextUserT
        if (inTurn && id) seenFile.add(id)
        return inTurn
      })
      buildAgentBlock(turnSteps, turnFiles)

      cursor++
      while (cursor < messages.length && messages[cursor].role !== 'user') {
        items.push({ kind: 'message', message: messages[cursor] })
        cursor++
      }
    }

    // Steps with no matching user timestamp (legacy) — append once
    if (!messages.some((m) => m.role === 'user') && (steps.length || fileEvents.length)) {
      buildAgentBlock(steps, fileEvents)
    } else if (
      !thinking &&
      (session?.step_count || 0) > 0 &&
      steps.length === 0 &&
      !items.some((it) => it.kind === 'agent_block')
    ) {
      items.push({
        kind: 'agent_block',
        steps: [],
        files: fileEvents,
        thoughtMs: 1000,
        plan: [],
        thoughtBody: '',
        note:
          `Agent reported ${session?.step_count} steps but no thinking was recorded. ` +
          `Usually the local LLM returned empty/invalid JSON.`,
      })
    }

    for (const e of errors) {
      items.push({ kind: 'error', event: e })
    }
    return items
  }, [messages, events, thinking, session?.step_count])

  /** Prompt that produced each assistant message (nearest prior user turn). */
  const promptByAssistantId = useMemo(() => {
    const map = new Map<string, string>()
    let lastUser = session?.task || ''
    for (const m of messages) {
      if (m.role === 'user') lastUser = m.content
      else if (m.role === 'assistant') map.set(m.id, lastUser)
    }
    return map
  }, [messages, session?.task])

  const send = async (raw?: string) => {
    const content = (raw ?? text).trim()
    if (!content || !session || sending) return
    setSending(true)
    setText('')
    setDismissedFollowUps(true)
    scrollToBottom('smooth')
    try {
      await onSend(content)
    } finally {
      setSending(false)
    }
  }

  if (!session) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center bg-ink-900 text-slate-500 text-sm">
        <div className="text-4xl mb-3 opacity-40">B</div>
        <p>Select a session or create a new agent</p>
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-ink-900">
      <div className="h-12 border-b border-line flex items-center px-4 gap-3 flex-shrink-0">
        <div className="type-title text-slate-100 truncate">{session.title}</div>
        {session.model && (
          <span className="px-2 py-0.5 rounded-full bg-bu-500/10 text-bu-500 text-[11px] font-semibold border border-bu-500/30 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-bu-500" />
            {session.model}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-[12px] text-slate-400">
          <button
            type="button"
            onClick={() => setLogIssueOpen(true)}
            className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-bu-500/60 hover:text-bu-400 text-slate-300 font-medium text-[12px]"
            title={t('logIssue')}
          >
            {t('logIssue')}
          </button>
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-bu-500/60 hover:text-bu-400 text-slate-300 font-medium text-[12px]"
            title="Schedule this agent task to run on a recurring schedule"
          >
            ⏱ {t('scheduleJob')}
          </button>
          <span className="px-2 py-0.5 rounded bg-ink-800 border border-line text-[11px]">
            {session.step_count} {t('steps')}
          </span>
          <span className="px-2 py-0.5 rounded bg-ink-800 border border-line capitalize text-[11px]">
            {session.status}
          </span>
          {(session.status === 'running' || session.status === 'thinking') && (
            <>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-amber-500/50 text-amber-300 font-medium text-[12px]"
                onClick={() => onControl('pause')}
                title={t('pause')}
              >
                ⏸ {t('pause')}
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md border border-red-900/50 bg-red-950/40 hover:border-red-500/50 text-red-300 font-medium text-[12px]"
                onClick={() => onControl('stop')}
                title={t('stop')}
              >
                ■ {t('stop')}
              </button>
            </>
          )}
          {session.status === 'queued' && (
            <button
              type="button"
              className="px-2.5 py-1 rounded-md border border-red-900/50 bg-red-950/40 text-red-300 font-medium text-[12px]"
              onClick={() => onControl('stop')}
              title={t('cancelQueue')}
            >
              ■ {t('cancelQueue')}
            </button>
          )}
          {session.status === 'paused' && (
            <>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-bu-500/50 text-bu-400 font-medium text-[12px]"
                onClick={() => onControl('resume')}
                title={t('resume')}
              >
                ▶ {t('resume')}
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md border border-red-900/50 bg-red-950/40 text-red-300 font-medium text-[12px]"
                onClick={() => onControl('stop')}
                title={t('stop')}
              >
                ■ {t('stop')}
              </button>
            </>
          )}
          <button
            type="button"
            className="px-2.5 py-1 rounded-md border border-line bg-ink-800 hover:border-slate-500 text-slate-300 font-medium text-[12px]"
            onClick={clearSession}
            title={t('clearSession')}
          >
            {t('clear')}
          </button>
        </div>
      </div>

      {scheduleToast && (
        <div className="mx-4 mt-3 text-xs border border-emerald-800/50 bg-emerald-950/40 text-emerald-300 rounded-md px-3 py-2 flex items-center justify-between gap-3">
          <span>{scheduleToast}</span>
          <button
            type="button"
            className="text-bu-400 hover:underline whitespace-nowrap"
            onClick={() => {
              setScheduleToast(null)
              onOpenScheduled?.()
            }}
          >
            View jobs →
          </button>
        </div>
      )}

      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={scrollRef}
          onScroll={onTimelineScroll}
          className="flex-1 overflow-y-auto scroll p-6 space-y-5"
        >
        {timeline.map((item, idx) => {
          if (item.kind === 'message') {
            const m = item.message
            const msgKey = `msg-${m.id}-${idx}`
            return m.role === 'user' ? (
              <div key={msgKey} className="flex justify-end">
                <div className="max-w-2xl accent-fill rounded-2xl rounded-tr-sm px-4 py-3 text-[14px] leading-[1.5] whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            ) : (
              <div
                key={msgKey}
                className="max-w-3xl text-[14px] leading-[1.5] text-slate-300 whitespace-pre-wrap bg-ink-800 border border-line rounded-lg px-4 py-3"
              >
                {m.content}
                <MessageActions
                  content={m.content}
                  title={session?.title || session?.task || 'AgentBrowser report'}
                  prompt={promptByAssistantId.get(m.id) || session?.task || ''}
                  sessionId={session?.id}
                  events={events}
                  onOpenFile={onOpenFile}
                />
              </div>
            )
          }

          if (item.kind === 'error') {
            return (
              <div
                key={`err-${item.event.id || 'x'}-${idx}`}
                className="max-w-3xl bg-ink-800 border border-red-700/40 rounded-lg p-3 text-xs text-red-300"
              >
                {String(item.event.payload.error || 'Error')}
              </div>
            )
          }

          const blockKey = `block-${idx}-${item.steps[0]?.id || 'empty'}`
          const thoughtOpen = expandedThought[blockKey] !== false

          // Flatten tool calls in step order for Browser: cards
          const tools: { key: string; step: Event; tool: ToolCall; stepNo: number }[] = []
          item.steps.forEach((e, i) => {
            const stepNo = (e.payload.step as number | undefined) || i + 1
            const actions = (e.payload.actions as string[] | undefined) || []
            if (actions.length === 0) {
              tools.push({
                key: `${blockKey}-${e.id || i}-${i}-think`,
                step: e,
                stepNo,
                tool: {
                  kind: 'other',
                  title: `Step ${stepNo} — thinking`,
                  code: '// no tool call this step',
                  outputLines: e.payload.url
                    ? [`URL: ${String(e.payload.url)}`]
                    : ['(no actions)'],
                },
              })
              return
            }
            actions.forEach((a, j) => {
              tools.push({
                key: `${blockKey}-${e.id || i}-${i}-${j}`,
                step: e,
                stepNo,
                tool: toToolCall(a, e),
              })
            })
          })

          return (
            <div key={blockKey} className="max-w-3xl space-y-4 text-[14px]">
              {/* Thought for Xs — plan style */}
              <div className="rounded-xl border border-line/80 bg-ink-850/40 overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-slate-400 hover:text-slate-200 hover:bg-ink-800/50"
                  onClick={() =>
                    setExpandedThought((p) => ({ ...p, [blockKey]: !thoughtOpen }))
                  }
                >
                  <span className="text-slate-500">▹</span>
                  <span className="font-medium text-[13px] text-slate-300">
                    Thought for {formatDuration(item.thoughtMs)}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span>
                    {item.steps.length} steps · {tools.length} tool calls
                  </span>
                  <span className="ml-auto text-slate-600">{thoughtOpen ? '▾' : '▸'}</span>
                </button>

                {thoughtOpen && (
                  <div className="px-4 pb-3 pt-1 border-t border-line/50 space-y-3">
                    {item.plan.length > 0 ? (
                      <ol className="list-decimal pl-5 space-y-1.5 text-[14px] text-slate-300 leading-[1.5]">
                        {item.plan.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ol>
                    ) : item.thoughtBody ? (
                      <pre className="text-[14px] text-slate-300 whitespace-pre-wrap leading-[1.5] font-sans">
                        {item.thoughtBody.length > 1200
                          ? `${item.thoughtBody.slice(0, 1200)}…`
                          : item.thoughtBody}
                      </pre>
                    ) : item.note ? (
                      <pre className="text-xs text-slate-400 whitespace-pre-wrap">{item.note}</pre>
                    ) : (
                      <p className="text-xs text-slate-500 italic">No plan captured for this run.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Browser / Files tool cards */}
              {tools.map(({ key, tool, step }, ti) => {
                const codeOpen = expandedCode[key] !== false
                const shot = step.payload.screenshot
                  ? api.screenshotUrl(session.id, String(step.payload.screenshot))
                  : null
                return (
                  <div key={key} className="space-y-2">
                    <div className="flex items-center gap-2 text-[14px]">
                      <span className="text-bu-400 font-semibold">{labelForKind(tool.kind)}:</span>
                      <span className="text-slate-200 font-medium">{tool.title}</span>
                    </div>

                    <div className="rounded-lg border border-line overflow-hidden bg-ink-950">
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500 hover:text-slate-300 border-b border-line/60"
                        onClick={() =>
                          setExpandedCode((p) => ({ ...p, [key]: !codeOpen }))
                        }
                      >
                        <span className="mono text-slate-400">js</span>
                        <span className="ml-auto">{codeOpen ? '▾' : '▸'}</span>
                      </button>
                      {codeOpen && (
                        <pre className="px-3 py-3 text-[12px] leading-[1.55] text-slate-200 mono overflow-x-auto scroll whitespace-pre">
                          {tool.code}
                        </pre>
                      )}
                    </div>

                    <div className="rounded-lg border border-line/70 bg-ink-850/60 overflow-hidden">
                      <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-line/50">
                        Output
                      </div>
                      <div className="px-3 py-2.5 space-y-1">
                        {tool.outputLines.map((line, li) => (
                          <div key={li} className="text-[12px] text-slate-300 mono whitespace-pre-wrap">
                            {line}
                          </div>
                        ))}
                        {shot && (
                          <a
                            href={shot}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block mt-2 border border-line rounded overflow-hidden hover:border-bu-500"
                          >
                            <img
                              src={shot}
                              alt="Step screenshot"
                              className="max-h-36 max-w-full object-contain bg-black"
                            />
                          </a>
                        )}
                        {tool.filePath && (
                          <button
                            type="button"
                            onClick={() => onOpenFile?.(tool.filePath!)}
                            className="mt-1 mono text-xs text-blue-300 hover:underline"
                          >
                            Open {tool.filePath.split('/').pop()}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Subtle next-step cue like the screenshot */}
                    {ti < tools.length - 1 && (
                      <div className="pt-1 text-[13px]">
                        <span className="text-bu-400 font-semibold">
                          {labelForKind(tools[ti + 1].tool.kind)}:
                        </span>{' '}
                        <span className="text-slate-400">{tools[ti + 1].tool.title}</span>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Wrote chips from file_written events */}
              <div className="space-y-1">
                {item.files.map((fe, fi) => {
                  const name = String(fe.payload.name || fe.payload.path || 'file')
                  const path = String(fe.payload.path || name)
                  return (
                    <div key={`${blockKey}-file-${fe.id || path}-${fi}`} className="flex items-center gap-2 py-1 text-sm">
                      <span className="text-slate-400">Wrote</span>
                      <button
                        type="button"
                        onClick={() => onOpenFile?.(path)}
                        className="mono text-xs bg-ink-800 border border-line px-2 py-1 rounded inline-flex items-center gap-1.5 hover:border-bu-500"
                      >
                        <span className="text-blue-400">📄</span>
                        <span className="text-blue-300">{name}</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {thinking && (
          <div className="flex items-center gap-2 text-slate-500 text-sm pt-2">
            <span className="spin inline-block w-3 h-3 border-2 border-bu-500 border-t-transparent rounded-full" />
            <span>
              {session.status === 'queued'
                ? (() => {
                    const running = (sessions || []).filter(
                      (s) => s.status === 'running' || s.status === 'thinking' || s.status === 'paused',
                    ).length
                    return running > 0
                      ? `${t('queued')} (${running})`
                      : t('queued')
                  })()
                : session.status === 'paused'
                  ? t('paused')
                  : t('thinking')}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
        </div>
        {!stickToBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-line bg-ink-850/95 text-slate-200 text-[12px] font-semibold shadow-xl hover:border-bu-500/50 hover:text-bu-400 backdrop-blur-sm"
            title={t('scrollToLatest')}
            aria-label={t('scrollToLatest')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('scrollToLatest')}
          </button>
        )}
      </div>

      <div className="border-t border-line p-4 flex-shrink-0 bg-ink-900 space-y-2">
        {(session.status === 'running' ||
          session.status === 'thinking' ||
          session.status === 'paused' ||
          session.status === 'queued') && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink-850 px-3 py-2"
            role="toolbar"
            aria-label={t('agentControls')}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1">
              {t('agentControls')}
            </span>
            {(session.status === 'running' || session.status === 'thinking') && (
              <button
                type="button"
                onClick={() => onControl('pause')}
                className="px-3 py-1.5 rounded-lg border border-amber-800/50 bg-amber-950/30 text-amber-300 text-[12px] font-semibold hover:border-amber-500/50"
              >
                ⏸ {t('pause')}
              </button>
            )}
            {session.status === 'paused' && (
              <button
                type="button"
                onClick={() => onControl('resume')}
                className="px-3 py-1.5 rounded-lg border border-bu-500/40 bg-bu-500/10 text-bu-400 text-[12px] font-semibold hover:border-bu-500/60"
              >
                ▶ {t('resume')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onControl('stop')}
              className="px-3 py-1.5 rounded-lg border border-red-900/50 bg-red-950/40 text-red-300 text-[12px] font-semibold hover:border-red-500/50"
            >
              ■ {t('stop')}
            </button>
            <button
              type="button"
              onClick={clearSession}
              className="px-3 py-1.5 rounded-lg border border-line bg-ink-900 text-slate-300 text-[12px] font-semibold hover:border-slate-500"
            >
              {t('clearSession')}
            </button>
          </div>
        )}

        {followUps.length > 0 && (
          <div className="rounded-xl border border-line bg-ink-850/80 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t('suggestedFollowUps')}
              </div>
              <button
                type="button"
                onClick={() => setDismissedFollowUps(true)}
                className="text-[11px] text-slate-500 hover:text-slate-300"
                title={t('close')}
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {followUps.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  onClick={() => void send(prompt)}
                  className="text-left text-[12px] leading-snug px-2.5 py-1.5 rounded-lg border border-line bg-ink-900 hover:border-bu-500/50 hover:bg-bu-500/10 text-slate-300 transition-colors max-w-full"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-600 mt-1.5">{t('followUpHint')}</p>
          </div>
        )}
        {(session.status === 'completed' || session.status === 'failed' || session.status === 'stopped') && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setScheduleOpen(true)}
              className="flex-1 min-w-[140px] text-left text-xs px-3 py-2 rounded-lg border border-line bg-ink-850 hover:border-bu-500/50 text-slate-300 flex items-center gap-2"
            >
              <span>⏱</span>
              <span>{t('scheduleJob')}</span>
            </button>
            <button
              type="button"
              onClick={clearSession}
              className="text-xs px-3 py-2 rounded-lg border border-line bg-ink-850 hover:border-slate-500 text-slate-300 font-medium"
            >
              {t('clearSession')}
            </button>
          </div>
        )}
        <div className="bg-ink-800 border border-line rounded-2xl p-3 flex items-end gap-2">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={t('replyPlaceholder')}
            className="flex-1 bg-transparent text-[14px] leading-[1.5] text-slate-200 placeholder-slate-500 resize-none outline-none"
          />
          {text.trim() && (
            <button
              type="button"
              onClick={() => setText('')}
              className="px-2 py-2 text-[11px] text-slate-500 hover:text-slate-300"
              title={t('clearInput')}
            >
              {t('clear')}
            </button>
          )}
          <VoiceInputButton
            value={text}
            onChange={(next) => {
              setVoiceErr('')
              setText(next)
            }}
            disabled={sending || thinking}
            onError={setVoiceErr}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !text.trim() || thinking}
            className="accent-fill disabled:opacity-40 p-2 rounded-lg"
            title={thinking ? t('thinking') : undefined}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
        {voiceErr && <p className="text-[11px] text-red-400 mt-1.5">{voiceErr}</p>}
        <div className="text-[10px] text-slate-500 mt-2">⏎ send · ⇧⏎ newline · {t('voiceHint')}</div>
      </div>

      {scheduleOpen && (
        <ScheduleJobModal
          defaultModel={session.model || ''}
          sessions={sessions.length ? sessions : [session]}
          title={t('scheduleModalTitle')}
          subtitle={t('scheduleModalSubtitleChat')}
          defaults={{
            sessionId: session.id,
            task: session.task || '',
            name: session.title?.slice(0, 60) || undefined,
            model: session.model || undefined,
            startUrl:
              session.current_url && !session.current_url.startsWith('about:')
                ? session.current_url
                : firstUrlInText(session.task || ''),
          }}
          onClose={() => setScheduleOpen(false)}
          onCreate={async (body: CreateScheduledJobBody) => {
            await api.createScheduledJob(body)
            setScheduleOpen(false)
            setScheduleToast(t('scheduleCreatedToast'))
            onScheduled?.()
            window.setTimeout(() => setScheduleToast(null), 8000)
          }}
        />
      )}

      {logIssueOpen && session && (
        <LogIssueModal
          session={session}
          onClose={() => setLogIssueOpen(false)}
          onDone={() => {
            setScheduleToast(t('issueLoggedToast'))
            window.setTimeout(() => setScheduleToast(null), 8000)
          }}
        />
      )}
    </main>
  )
}
