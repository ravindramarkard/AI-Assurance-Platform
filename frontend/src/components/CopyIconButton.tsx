import { useState } from 'react'
import { copyText } from '../messageExport'

type Props = {
  text: string
  title?: string
  className?: string
}

export default function CopyIconButton({ text, title = 'Copy', className = '' }: Props) {
  const [copied, setCopied] = useState(false)
  const value = (text || '').trim()
  if (!value) return null

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-ink-800/60 disabled:opacity-40 ${className}`}
      title={copied ? 'Copied' : title}
      aria-label={copied ? 'Copied' : title}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        void (async () => {
          const ok = await copyText(text)
          if (ok) {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }
        })()
      }}
    >
      <span aria-hidden className="text-[12px] leading-none">
        {copied ? '✓' : '⧉'}
      </span>
    </button>
  )
}
