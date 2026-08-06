import type { MessageKey } from './i18n/locales/en'

type Translate = (k: MessageKey) => string

export function sessionStatusLabel(status: string, t: Translate): string {
  switch (status) {
    case 'completed':
      return t('statusSucceeded')
    case 'failed':
      return t('statusFailed')
    case 'partial':
      return t('statusPartial')
    case 'planning':
      return t('statusPlanning')
    case 'aggregating':
      return t('statusAggregating')
    case 'running':
      return t('statusRunning')
    case 'queued':
      return t('statusQueued')
    case 'paused':
      return t('statusPaused')
    case 'waiting_for_input':
      return t('waitingForInput')
    case 'stopped':
      return t('statusStopped')
    default:
      return status || '—'
  }
}

export function sessionStatusClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    case 'failed':
      return 'bg-red-500/15 text-red-400 border-red-500/30'
    case 'partial':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    case 'planning':
      return 'bg-slate-500/15 text-slate-300 border-slate-500/30'
    case 'aggregating':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    case 'running':
      return 'bg-bu-500/15 text-bu-400 border-bu-500/30'
    case 'queued':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    case 'paused':
      return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30'
    case 'waiting_for_input':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    default:
      return 'bg-slate-500/15 text-slate-400 border-slate-500/30'
  }
}

/** Statuses where the session may still change on its own. */
export function isSessionLive(status: string | undefined | null): boolean {
  switch (status) {
    case 'queued':
    case 'running':
    case 'thinking':
    case 'paused':
    case 'waiting_for_input':
    case 'planning':
    case 'aggregating':
      return true
    default:
      return false
  }
}
