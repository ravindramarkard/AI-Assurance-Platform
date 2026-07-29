import { useState } from 'react'
import type { HitlPending } from '../api'
import { usePreferences } from '../preferences'

type Props = {
  pending: HitlPending
  busy?: boolean
  onSubmit: (value: string) => void | Promise<void>
  onStop: () => void
}

export default function HumanInputBanner({ pending, busy, onSubmit, onStop }: Props) {
  const { t } = usePreferences()
  const [value, setValue] = useState('')
  const canSubmit = value.trim().length > 0 && !busy

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <div className="text-sm font-medium text-amber-200">{t('humanInputTitle')}</div>
      <p className="mt-1 text-sm text-ink-200">{pending.prompt}</p>
      <p className="mt-1 text-xs text-ink-400">{t('humanInputHint')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="flex-1 min-w-[12rem] rounded border border-line bg-ink-950 px-3 py-2 text-sm text-ink-100"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('humanInputPlaceholder')}
          inputMode={pending.input_type === 'otp' ? 'numeric' : 'text'}
          autoFocus
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void onSubmit(value.trim())
          }}
        />
        <button
          type="button"
          disabled={!canSubmit}
          className="rounded bg-bu-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          onClick={() => void onSubmit(value.trim())}
        >
          {t('humanInputSubmit')}
        </button>
        <button
          type="button"
          className="rounded border border-line px-3 py-2 text-sm text-ink-200"
          onClick={onStop}
          disabled={busy}
        >
          {t('stop')}
        </button>
      </div>
    </div>
  )
}
