import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type AppSettings,
  type CreateScheduledJobBody,
  type ScheduledJob,
  type Session,
} from '../api'
import { usePreferences } from '../preferences'
import ScheduleJobModal from './ScheduleJobModal'

type Props = {
  settings: AppSettings | null
  onOpenSession: (id: string) => void
  /** Optional: pass from App to avoid an extra fetch; otherwise loaded on open. */
  sessions?: Session[]
}

function formatWhen(iso: string | null | undefined, locale: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(locale === 'ar' ? 'ar' : locale === 'hi' ? 'hi-IN' : undefined)
  } catch {
    return iso
  }
}

export default function ScheduledJobsPage({ settings, onOpenSession, sessions: sessionsProp }: Props) {
  const { t, locale } = usePreferences()
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [sessions, setSessions] = useState<Session[]>(sessionsProp || [])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scheduleLabel = (key: string) => {
    if (key === 'every_hour') return t('everyHour')
    if (key === 'every_day') return t('everyDay')
    if (key === 'every_week') return t('everyWeek')
    return key
  }

  const refresh = useCallback(async () => {
    try {
      const [list, sess] = await Promise.all([
        api.listScheduledJobs(),
        sessionsProp ? Promise.resolve(sessionsProp) : api.listSessions(),
      ])
      setJobs(list)
      setSessions(sess)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadJobsFailed'))
    } finally {
      setLoading(false)
    }
  }, [sessionsProp, t])

  useEffect(() => {
    if (sessionsProp) setSessions(sessionsProp)
  }, [sessionsProp])

  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 5000)
    return () => window.clearInterval(id)
  }, [refresh])

  const onCreate = async (body: CreateScheduledJobBody) => {
    await api.createScheduledJob(body)
    setModalOpen(false)
    await refresh()
  }

  const onToggle = async (job: ScheduledJob) => {
    await api.updateScheduledJob(job.id, { enabled: !job.enabled })
    await refresh()
  }

  const onDelete = async (job: ScheduledJob) => {
    const label = job.name || job.task.slice(0, 40)
    if (!window.confirm(t('deleteJobConfirm').replace('{name}', label))) return
    await api.deleteScheduledJob(job.id)
    await refresh()
  }

  const onRunNow = async (job: ScheduledJob) => {
    const res = await api.runScheduledJob(job.id)
    await refresh()
    if (res.session_id) onOpenSession(res.session_id)
  }

  const isApiTestJob = (job: ScheduledJob) =>
    (job.job_type || 'agent') === 'api_test' || job.task.startsWith('[api_test]')

  return (
    <main className="flex-1 min-w-0 p-6 bg-ink-900 overflow-y-auto scroll flex flex-col">
      <div className="w-full flex-1 flex flex-col min-h-0">
        <div className="flex items-start justify-between gap-4 mb-2 flex-shrink-0">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-slate-100">{t('scheduledJobs')}</h1>
            <p className="text-sm text-slate-400 mt-1">
              {t('scheduledJobsBlurb')}{' '}
              <span className="text-slate-200 mono text-xs">schedular/</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="accent-fill text-sm font-semibold px-4 py-2 rounded-md flex-shrink-0"
          >
            {t('scheduleJobPlus')}
          </button>
        </div>

        {error && (
          <div className="mt-4 text-sm text-red-400 border border-red-900/50 bg-red-950/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="mt-6 border border-line rounded-lg overflow-hidden bg-ink-850 flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-line">
                <th className="px-4 py-3 font-semibold">{t('colJob')}</th>
                <th className="px-4 py-3 font-semibold">{t('colSchedule')}</th>
                <th className="px-4 py-3 font-semibold">{t('colNextRun')}</th>
                <th className="px-4 py-3 font-semibold">{t('colStatus')}</th>
                <th className="px-4 py-3 font-semibold text-right">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-slate-500 text-center">
                    {t('loading')}
                  </td>
                </tr>
              )}
              {!loading && jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center">
                    <p className="text-slate-400">{t('noScheduledJobs')}</p>
                    <p className="text-slate-500 text-xs mt-1">{t('noScheduledJobsHint')}</p>
                    <button
                      type="button"
                      onClick={() => setModalOpen(true)}
                      className="mt-4 text-bu-500 hover:text-bu-400 text-sm font-medium"
                    >
                      {t('createFirstJob')}
                    </button>
                  </td>
                </tr>
              )}
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-line hover:bg-ink-800/60">
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-slate-100">
                      {job.name || job.task.slice(0, 48) || t('untitled')}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                      {job.task}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                      <span className="px-1.5 py-0.5 rounded bg-ink-700 text-slate-400">
                        schedular
                      </span>
                      {isApiTestJob(job) ? (
                        <span className="px-1.5 py-0.5 rounded bg-sky-950/60 text-sky-300 border border-sky-800/50">
                          api_test
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-ink-700 text-slate-400">agent</span>
                      )}
                      {job.last_session_id && (
                        <button
                          type="button"
                          className="text-bu-500 hover:underline"
                          onClick={() => onOpenSession(job.last_session_id!)}
                        >
                          {t('lastRun')}
                        </button>
                      )}
                      {isApiTestJob(job) && job.last_run_id ? (
                        <span className="text-slate-500 mono" title={job.last_run_id}>
                          run {job.last_run_id.slice(0, 8)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300 align-top whitespace-nowrap">
                    {scheduleLabel(job.schedule)}
                  </td>
                  <td className="px-4 py-3 text-slate-400 align-top text-xs whitespace-nowrap">
                    {job.enabled ? formatWhen(job.next_run_at, locale) : t('statusPaused')}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs ${
                        job.enabled ? 'text-green-400' : 'text-slate-500'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          job.enabled ? 'bg-green-400' : 'bg-slate-600'
                        }`}
                      />
                      {job.enabled ? t('statusActive') : t('statusPaused')}
                    </span>
                    {job.last_error && (
                      <div
                        className="text-[10px] text-red-400 mt-1 max-w-[140px] truncate"
                        title={job.last_error}
                      >
                        {job.last_error}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onRunNow(job)}
                      className="text-xs text-slate-300 hover:text-white px-2 py-1"
                      title={t('runNow')}
                    >
                      {t('runNow')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggle(job)}
                      className="text-xs text-slate-300 hover:text-white px-2 py-1"
                    >
                      {job.enabled ? t('pause') : t('resume')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(job)}
                      className="text-xs text-slate-500 hover:text-red-400 px-2 py-1"
                    >
                      {t('delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <ScheduleJobModal
          defaultModel={settings?.llm_model || ''}
          defaultProvider={settings?.llm_provider || 'local'}
          sessions={sessions}
          subtitle={t('scheduleModalSubtitle')}
          onClose={() => setModalOpen(false)}
          onCreate={onCreate}
        />
      )}
    </main>
  )
}
