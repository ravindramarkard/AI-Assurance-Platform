import { useMemo, useState } from 'react'
import { api, type Event } from '../api'

type Filter = 'all' | 'status' | 'step' | 'preview' | 'files' | 'message' | 'error' | 'other'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'status', label: 'Status' },
  { id: 'step', label: 'Steps' },
  { id: 'preview', label: 'Snaps' },
  { id: 'files', label: 'Files' },
  { id: 'message', label: 'Messages' },
  { id: 'error', label: 'Errors' },
]

function bucket(type: string): Filter {
  if (type === 'status' || type === 'done') return 'status'
  if (type === 'step') return 'step'
  if (type === 'preview') return 'preview'
  if (type === 'file_written' || type === 'files' || type === 'recording_gif') return 'files'
  if (type === 'message') return 'message'
  if (type === 'error') return 'error'
  return 'other'
}

function badgeClass(type: string): string {
  switch (bucket(type)) {
    case 'status':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/30'
    case 'step':
      return 'bg-bu-500/15 text-bu-400 border-bu-500/35'
    case 'preview':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    case 'files':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    case 'message':
      return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
    case 'error':
      return 'bg-red-500/15 text-red-300 border-red-500/35'
    default:
      return 'bg-ink-800 text-slate-400 border-line'
  }
}

function formatTime(iso?: string): string {
  if (!iso) return '—'
  const d = Date.parse(iso)
  if (!Number.isFinite(d)) return iso.slice(11, 19) || iso
  return new Date(d).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function str(v: unknown, max = 280): string {
  if (v == null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function summarize(e: Event): { title: string; detail?: string; shot?: string } {
  const p = e.payload || {}
  switch (e.type) {
    case 'status': {
      const st = String(p.status || 'status')
      const msg = str(p.message)
      return { title: st.charAt(0).toUpperCase() + st.slice(1), detail: msg || undefined }
    }
    case 'done': {
      const steps = p.steps != null ? `${p.steps} steps` : 'Finished'
      const extra = p.chat_only ? ' · chat only' : p.from_prior ? ' · from prior' : ''
      return { title: 'Done', detail: `${steps}${extra}` }
    }
    case 'step': {
      const n = p.step != null ? `Step ${p.step}` : 'Step'
      const thought = str(p.thought || (p.thought_fields as { thinking?: string } | undefined)?.thinking, 220)
      const url = p.url ? str(p.url, 80) : ''
      const actions = Array.isArray(p.actions) ? p.actions.length : 0
      const detail = [thought, url && `URL: ${url}`, actions ? `${actions} action(s)` : '']
        .filter(Boolean)
        .join(' · ')
      return {
        title: n,
        detail: detail || str(p.title, 120) || undefined,
        shot: typeof p.screenshot === 'string' ? p.screenshot : undefined,
      }
    }
    case 'preview': {
      const shot = typeof p.screenshot === 'string' ? p.screenshot : undefined
      const name = shot?.split('/').pop() || 'snapshot'
      return {
        title: 'Snapshot',
        detail: [name, p.url ? str(p.url, 90) : ''].filter(Boolean).join(' · '),
        shot,
      }
    }
    case 'file_written':
      return {
        title: p.recording_gif ? 'Recording GIF' : 'File written',
        detail: str(p.name || p.path, 120) || undefined,
      }
    case 'recording_gif':
      return {
        title: 'Recording GIF',
        detail: `${p.frames ?? '?'} frames · ${str(p.path, 80)}`,
      }
    case 'files': {
      const list = Array.isArray(p.files) ? p.files : []
      return { title: 'Workspace files', detail: `${list.length} file(s)` }
    }
    case 'message': {
      const role = String(p.role || 'assistant')
      return {
        title: role === 'user' ? 'User message' : 'Assistant message',
        detail: str(p.content, 240) || undefined,
      }
    }
    case 'error':
      return { title: 'Error', detail: str(p.error, 320) || 'Unknown error' }
    case 'ready':
      return { title: 'Connected', detail: 'Event stream ready' }
    default:
      return { title: e.type, detail: str(p, 200) || undefined }
  }
}

type Props = {
  events: Event[]
  sessionId: string | null
}

export default function EventLogsPanel({ events, sessionId }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showRawDefault, setShowRawDefault] = useState(false)

  const filtered = useMemo(() => {
    const list = filter === 'all' ? events : events.filter((e) => bucket(e.type) === filter)
    // Newest first so the latest activity is at the top
    return [...list].sort((a, b) => {
      const ta = Date.parse(a.created_at || '') || 0
      const tb = Date.parse(b.created_at || '') || 0
      if (tb !== ta) return tb - ta
      return String(b.id ?? '').localeCompare(String(a.id ?? ''))
    })
  }, [events, filter])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: events.length }
    for (const e of events) {
      const b = bucket(e.type)
      c[b] = (c[b] || 0) + 1
    }
    return c
  }, [events])

  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm p-8 text-center">
        No events yet. They appear here as the agent runs.
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-shrink-0 border-b border-line bg-ink-900/80 px-2 py-2 space-y-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const n = counts[f.id] || 0
            if (f.id !== 'all' && n === 0) return null
            const active = filter === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors ${
                  active
                    ? 'bg-bu-500/15 text-bu-400 border-bu-500/40'
                    : 'bg-ink-850 text-slate-400 border-line hover:text-slate-200'
                }`}
              >
                {f.label}
                <span className="ml-1 tabular-nums opacity-70">{n}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[10px] text-slate-500">
            {filtered.length} shown · proper view
          </span>
          <button
            type="button"
            onClick={() => setShowRawDefault((v) => !v)}
            className="text-[10px] text-slate-500 hover:text-slate-300"
          >
            {showRawDefault ? 'Hide raw JSON' : 'Show raw JSON'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll p-2 space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-slate-500 text-xs p-4 text-center">No events in this filter</div>
        )}
        {filtered.map((e, i) => {
          const key = `${e.id || 'ev'}-${i}`
          const { title, detail, shot } = summarize(e)
          const open = showRawDefault || !!expanded[key]
          const shotUrl =
            sessionId && shot
              ? api.screenshotUrl(sessionId, shot)
              : null
          return (
            <article
              key={key}
              className="rounded-lg border border-line/70 bg-ink-900/60 overflow-hidden"
            >
              <button
                type="button"
                className="w-full text-left px-2.5 py-2 flex gap-2 items-start hover:bg-ink-800/50"
                onClick={() => setExpanded((p) => ({ ...p, [key]: !open }))}
              >
                <span
                  className={`mt-0.5 flex-shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide ${badgeClass(e.type)}`}
                >
                  {e.type}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-slate-200 truncate">{title}</span>
                    <span className="text-[10px] text-slate-500 tabular-nums flex-shrink-0 ml-auto">
                      {formatTime(e.created_at)}
                    </span>
                  </div>
                  {detail && (
                    <p className="text-[12px] text-slate-400 mt-0.5 leading-snug line-clamp-3">
                      {detail}
                    </p>
                  )}
                </div>
                {shotUrl && (
                  <img
                    src={shotUrl}
                    alt=""
                    className="w-14 h-10 object-cover rounded border border-line flex-shrink-0 bg-black"
                    loading="lazy"
                  />
                )}
              </button>
              {open && (
                <pre className="px-2.5 pb-2 text-[10px] mono text-slate-500 whitespace-pre-wrap border-t border-line/50 pt-2 max-h-40 overflow-auto scroll">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
