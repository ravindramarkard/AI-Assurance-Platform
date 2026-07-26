import { useEffect, useMemo, useState } from 'react'
import type { CreateScheduledJobBody, SchedulePreset, Session } from '../api'
import { usePreferences } from '../preferences'

export type ScheduleJobDefaults = {
  task?: string
  name?: string
  model?: string
  startUrl?: string
  systemPrompt?: string
  maxSteps?: number
  schedule?: SchedulePreset
  sessionId?: string
}

type SourceMode = 'existing' | 'new'

type Props = {
  defaultModel?: string
  defaults?: ScheduleJobDefaults
  /** Past agent sessions the user can reuse as the scheduled task. */
  sessions?: Session[]
  title?: string
  subtitle?: string
  onClose: () => void
  onCreate: (body: CreateScheduledJobBody) => Promise<void>
}

function firstUrlInText(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s)'"`<>]+/i)
  return m?.[0]
}

function applySession(
  s: Session,
  setters: {
    setTask: (v: string) => void
    setName: (v: string) => void
    setModel: (v: string) => void
    setStartUrl: (v: string) => void
  },
) {
  setters.setTask(s.task || '')
  setters.setName((s.title || '').slice(0, 60))
  setters.setModel(s.model || '')
  const url =
    s.current_url && !s.current_url.startsWith('about:')
      ? s.current_url
      : firstUrlInText(s.task || '') || ''
  setters.setStartUrl(url)
}

export default function ScheduleJobModal({
  defaultModel = '',
  defaults,
  sessions = [],
  title,
  subtitle,
  onClose,
  onCreate,
}: Props) {
  const { t } = usePreferences()
  const resolvedTitle = title || t('scheduleModalTitle')
  const resolvedSubtitle = subtitle || t('scheduleModalDefaultSubtitle')
  const usableSessions = useMemo(
    () => sessions.filter((s) => (s.task || '').trim().length > 0),
    [sessions],
  )
  const hasSessions = usableSessions.length > 0

  const initialMode: SourceMode =
    defaults?.task || defaults?.sessionId
      ? 'existing'
      : hasSessions
        ? 'existing'
        : 'new'

  const [source, setSource] = useState<SourceMode>(hasSessions ? initialMode : 'new')
  const [selectedSessionId, setSelectedSessionId] = useState(
    defaults?.sessionId || usableSessions[0]?.id || '',
  )
  const [task, setTask] = useState(defaults?.task || '')
  const [name, setName] = useState(defaults?.name || '')
  const [schedule, setSchedule] = useState<SchedulePreset>(defaults?.schedule || 'every_hour')
  const [advanced, setAdvanced] = useState(Boolean(defaults?.startUrl || defaults?.systemPrompt))
  const [model, setModel] = useState(defaults?.model || defaultModel)
  const [maxSteps, setMaxSteps] = useState(defaults?.maxSteps || 100)
  const [startUrl, setStartUrl] = useState(defaults?.startUrl || '')
  const [systemPrompt, setSystemPrompt] = useState(defaults?.systemPrompt || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Prefill from selected/first session when using "Existing agent" and no defaults were passed.
  useEffect(() => {
    if (!hasSessions || source !== 'existing') return
    if (defaults?.task) return
    const s =
      usableSessions.find((x) => x.id === selectedSessionId) || usableSessions[0]
    if (!s) return
    setSelectedSessionId(s.id)
    applySession(s, { setTask, setName, setModel, setStartUrl })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, name, schedule, model, maxSteps, startUrl, systemPrompt])

  const onPickSession = (id: string) => {
    setSelectedSessionId(id)
    const s = usableSessions.find((x) => x.id === id)
    if (!s) return
    applySession(s, { setTask, setName, setModel, setStartUrl })
    if (s.model || s.current_url) setAdvanced(true)
  }

  const switchSource = (mode: SourceMode) => {
    setSource(mode)
    setErr(null)
    if (mode === 'new') {
      setTask('')
      setName('')
      setModel(defaultModel)
      setStartUrl('')
      setSelectedSessionId('')
    } else if (usableSessions.length) {
      const s =
        usableSessions.find((x) => x.id === selectedSessionId) || usableSessions[0]
      setSelectedSessionId(s.id)
      applySession(s, { setTask, setName, setModel, setStartUrl })
    }
  }

  const submit = async () => {
    if (source === 'existing' && hasSessions && !selectedSessionId) {
      setErr(t('selectSessionRequired'))
      return
    }
    if (!task.trim()) {
      setErr(t('taskRequired'))
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await onCreate({
        task: task.trim(),
        name: name.trim() || undefined,
        schedule,
        model: model.trim() || undefined,
        max_steps: maxSteps,
        start_url: startUrl.trim() || undefined,
        system_prompt: systemPrompt.trim() || undefined,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('createFailed'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-ink-900 border border-line rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto scroll"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{resolvedTitle}</h2>
            <p className="text-xs text-slate-400 mt-1">{resolvedSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {hasSessions && (
            <div>
              <div className="text-xs text-slate-400 mb-1.5">{t('taskSource')}</div>
              <div className="flex rounded-lg border border-line overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => switchSource('existing')}
                  className={`flex-1 px-3 py-2 ${
                    source === 'existing'
                      ? 'bg-bu-500/20 text-bu-400 font-semibold'
                      : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('existingAgent')}
                </button>
                <button
                  type="button"
                  onClick={() => switchSource('new')}
                  className={`flex-1 px-3 py-2 border-l border-line ${
                    source === 'new'
                      ? 'bg-bu-500/20 text-bu-400 font-semibold'
                      : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('newTask')}
                </button>
              </div>
            </div>
          )}

          {source === 'existing' && hasSessions && (
            <label className="block">
              <span className="text-xs text-slate-400">
                {t('selectAgentSession')} <span className="text-bu-500">*</span>
              </span>
              <select
                value={selectedSessionId}
                onChange={(e) => onPickSession(e.target.value)}
                className="mt-1.5 w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-bu-500"
              >
                {usableSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.title || s.task || t('untitled')).slice(0, 72)}
                    {s.status ? ` · ${s.status}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">{t('selectAgentHint')}</p>
            </label>
          )}

          <label className="block">
            <span className="text-xs text-slate-400">
              {t('taskLabel')} <span className="text-bu-500">*</span>
            </span>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder={source === 'existing' ? t('taskFromAgent') : t('taskDescribe')}
              rows={4}
              className="mt-1.5 w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-bu-500 resize-y"
              autoFocus={source === 'new' || !hasSessions}
            />
          </label>

          <label className="block">
            <span className="text-xs text-slate-400">{t('nameOptional')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="mt-1.5 w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-bu-500"
            />
          </label>

          <div className="rounded-md border border-line bg-ink-850 px-3 py-2.5">
            <div className="text-xs text-slate-400">{t('filesLabel')}</div>
            <div className="mt-1 text-sm text-slate-200 mono">schedular/</div>
            <p className="mt-1 text-[11px] text-slate-500">{t('filesHint')}</p>
          </div>

          <label className="block">
            <span className="text-xs text-slate-400">{t('scheduleLabel')}</span>
            <select
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as SchedulePreset)}
              className="mt-1.5 w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-bu-500"
            >
              <option value="every_hour">{t('everyHour')}</option>
              <option value="every_day">{t('everyDay')}</option>
              <option value="every_week">{t('everyWeek')}</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            {advanced ? '▾' : '▸'} {t('advancedOptions')}
          </button>

          {advanced && (
            <div className="space-y-3 border border-line rounded-md p-3 bg-ink-850">
              <label className="block">
                <span className="text-xs text-slate-400">{t('model')}</span>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={defaultModel || t('fromSettings')}
                  className="mt-1.5 w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-bu-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">{t('maxSteps')}</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(Number(e.target.value) || 100)}
                  className="mt-1.5 w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-bu-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">{t('startUrl')}</span>
                <input
                  value={startUrl}
                  onChange={(e) => setStartUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1.5 w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-bu-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">{t('systemPromptExt')}</span>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={t('systemPromptPlaceholder')}
                  rows={3}
                  className="mt-1.5 w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-bu-500 resize-y"
                />
              </label>
            </div>
          )}

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-300 hover:text-white border border-line rounded-md"
            >
              {t('cancel')} <span className="text-slate-600 text-xs ml-1">Esc</span>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="px-4 py-2 text-sm font-semibold text-white bg-bu-500 hover:bg-bu-600 rounded-md disabled:opacity-50"
            >
              {saving ? t('creating') : t('createScheduledJob')}
              <span className="text-white/70 text-xs ml-2">⌘ Enter</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
