import { useEffect, useMemo, useRef, useState } from 'react'
import type { LlmModelsCatalog, LlmProvider } from '../api'

export type ModelPick = { provider: LlmProvider; model: string }

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  local: 'Local',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
}

const PROVIDER_ORDER: LlmProvider[] = ['local', 'openai', 'anthropic']

type Props = {
  catalog: LlmModelsCatalog | null | undefined
  value: ModelPick
  onChange: (next: ModelPick) => void
  onManageSettings?: () => void
  compact?: boolean
  className?: string
  disabled?: boolean
}

export default function ModelPicker({
  catalog,
  value,
  onChange,
  onManageSettings,
  compact = false,
  className = '',
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PROVIDER_ORDER.map((provider) => {
      const models = (catalog?.[provider] || []).filter((m) => {
        if (!q) return true
        return (
          m.toLowerCase().includes(q) ||
          PROVIDER_LABELS[provider].toLowerCase().includes(q) ||
          provider.includes(q)
        )
      })
      return { provider, models }
    }).filter((g) => g.models.length > 0)
  }, [catalog, query])

  const total = useMemo(
    () =>
      PROVIDER_ORDER.reduce((n, p) => n + ((catalog?.[p] || []).length), 0),
    [catalog],
  )

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      queueMicrotask(() => searchRef.current?.focus())
    }
  }, [open])

  const label = value.model
    ? `${PROVIDER_LABELS[value.provider] || value.provider} · ${value.model}`
    : 'Select model'

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-900/80 text-slate-200 hover:border-slate-600 disabled:opacity-40 ${
          compact ? 'px-2 py-1 text-[11px] max-w-[220px]' : 'px-2.5 py-1.5 text-xs max-w-[280px]'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <span className="text-slate-500 shrink-0" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-line bg-ink-900 shadow-xl overflow-hidden"
          role="listbox"
        >
          <div className="p-2 border-b border-line">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models"
              className="w-full bg-ink-800 border border-line rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500"
            />
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {total === 0 && (
              <div className="px-3 py-4 text-xs text-slate-400 text-center space-y-2">
                <p>Add models in Settings</p>
                {onManageSettings && (
                  <button
                    type="button"
                    className="text-bu-400 hover:underline"
                    onClick={() => {
                      setOpen(false)
                      onManageSettings()
                    }}
                  >
                    Open Settings
                  </button>
                )}
              </div>
            )}
            {total > 0 && groups.length === 0 && (
              <div className="px-3 py-3 text-xs text-slate-500 text-center">No matches</div>
            )}
            {groups.map(({ provider, models }) => (
              <div key={provider} className="py-1">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                  {PROVIDER_LABELS[provider]}
                </div>
                {models.map((model) => {
                  const selected =
                    value.provider === provider && value.model === model
                  return (
                    <button
                      key={`${provider}:${model}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-ink-800 ${
                        selected ? 'text-slate-100 bg-ink-800/80' : 'text-slate-300'
                      }`}
                      onClick={() => {
                        onChange({ provider, model })
                        setOpen(false)
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{model}</span>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {PROVIDER_LABELS[provider]}
                      </span>
                      {selected && (
                        <span className="text-bu-400 shrink-0" aria-hidden>
                          ✓
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {onManageSettings && (
            <div className="border-t border-line p-2">
              <button
                type="button"
                className="w-full text-left px-2 py-1.5 text-[11px] text-bu-400 hover:underline"
                onClick={() => {
                  setOpen(false)
                  onManageSettings()
                }}
              >
                Manage in Settings…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
