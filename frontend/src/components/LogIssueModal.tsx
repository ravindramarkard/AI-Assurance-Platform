import { useEffect, useState } from 'react'
import { api, type IntegrationStatus, type Session } from '../api'
import { usePreferences } from '../preferences'

type Props = {
  session: Session
  onClose: () => void
  onDone?: () => void
}

export default function LogIssueModal({ session, onClose, onDone }: Props) {
  const { t } = usePreferences()
  const [tab, setTab] = useState<'jira' | 'confluence'>('jira')
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [summary, setSummary] = useState(session.title || session.task.slice(0, 80))
  const [description, setDescription] = useState(
    [
      session.task,
      session.current_url ? `URL: ${session.current_url}` : '',
      session.error ? `Error: ${session.error}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  )
  const [issueType, setIssueType] = useState('Bug')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resultUrl, setResultUrl] = useState('')

  useEffect(() => {
    void api.integrationStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  const submit = async () => {
    setBusy(true)
    setError('')
    setResultUrl('')
    try {
      if (tab === 'jira') {
        const r = await api.createJiraIssue({
          summary: summary.trim(),
          description: description.trim(),
          issue_type: issueType,
          session_id: session.id,
        })
        setResultUrl(r.url)
      } else {
        const r = await api.createConfluencePage({
          title: summary.trim(),
          body_html: '',
          session_id: session.id,
        })
        setResultUrl(r.url)
      }
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const jiraOk = !!status?.jira.configured
  const confOk = !!status?.confluence.configured
  const ready = tab === 'jira' ? jiraOk : confOk

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-line bg-ink-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{t('logIssue')}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{t('logIssueBlurb')}</p>
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-200 px-2" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {(['jira', 'confluence'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                tab === k
                  ? 'border-bu-500 bg-bu-500/10 text-bu-400'
                  : 'border-line text-slate-400 hover:border-slate-600'
              }`}
            >
              {k === 'jira' ? 'Jira' : 'Confluence'}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-3">
          {!ready && (
            <p className="text-xs text-amber-300/90 border border-amber-800/40 bg-amber-950/30 rounded-md px-3 py-2">
              {t('atlassianNotConfigured')}
            </p>
          )}

          <label className="block">
            <span className="text-xs text-slate-400 block mb-1">
              {tab === 'jira' ? t('issueSummary') : t('pageTitle')}
            </span>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500"
            />
          </label>

          {tab === 'jira' && (
            <>
              <label className="block">
                <span className="text-xs text-slate-400 block mb-1">{t('issueType')}</span>
                <select
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value)}
                  className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500"
                >
                  <option value="Bug">Bug</option>
                  <option value="Task">Task</option>
                  <option value="Story">Story</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-400 block mb-1">{t('issueDescription')}</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className="w-full bg-ink-800 border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-bu-500 resize-y"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">{t('issueChatHint')}</span>
              </label>
            </>
          )}

          {tab === 'confluence' && (
            <p className="text-[11px] text-slate-500">{t('confluenceChatHint')}</p>
          )}

          {error && (
            <p className="text-xs text-red-400 border border-red-900/50 rounded-md px-3 py-2 whitespace-pre-wrap">
              {error}
            </p>
          )}
          {resultUrl && (
            <p className="text-xs text-emerald-300 border border-emerald-800/40 bg-emerald-950/30 rounded-md px-3 py-2">
              {t('created')}{' '}
              <a href={resultUrl} target="_blank" rel="noreferrer" className="underline text-bu-400">
                {resultUrl}
              </a>
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-line text-sm text-slate-300 hover:border-slate-600"
          >
            {resultUrl ? t('close') : t('cancel')}
          </button>
          {!resultUrl && (
            <button
              type="button"
              disabled={busy || !ready || !summary.trim()}
              onClick={() => void submit()}
              className="px-3 py-1.5 rounded-md bg-bu-500 hover:bg-bu-600 disabled:opacity-40 text-white text-sm font-semibold"
            >
              {busy ? t('creating') : tab === 'jira' ? t('createJiraIssue') : t('createConfluencePage')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
