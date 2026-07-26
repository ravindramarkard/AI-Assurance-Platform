import { usePreferences } from '../preferences'
import { useSpeechInput } from '../useSpeechInput'

type Props = {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  onError?: (message: string) => void
  className?: string
}

function IconMic({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18.5 11.5a6.5 6.5 0 0 1-13 0M12 18v2.5" strokeLinecap="round" />
    </svg>
  )
}

function IconMicOff({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-1.1-2.5M8.6 8.6A3.5 3.5 0 0 0 8.5 11.5V12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18.5 11.5a6.5 6.5 0 0 1-2.2 4.9M5.5 11.5a6.5 6.5 0 0 0 8.2 5.9M12 18v2.5M4 4l16 16" strokeLinecap="round" />
    </svg>
  )
}

export default function VoiceInputButton({ value, onChange, disabled, onError, className = '' }: Props) {
  const { t, locale } = usePreferences()
  const { supported, listening, toggle } = useSpeechInput({
    locale,
    value,
    onChange,
    disabled,
    onError: (code) => {
      if (code === 'not-allowed') onError?.(t('voicePermissionDenied'))
      else if (code === 'unsupported' || code === 'start-failed') onError?.(t('voiceUnsupported'))
      else onError?.(t('voiceError'))
    },
  })

  const title = !supported
    ? t('voiceUnsupported')
    : listening
      ? t('voiceStop')
      : t('voiceStart')

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || !supported}
      title={title}
      aria-label={title}
      aria-pressed={listening}
      className={`relative p-2 rounded-lg transition-colors disabled:opacity-40 ${
        listening
          ? 'text-red-400 bg-red-500/15 hover:bg-red-500/25'
          : 'text-slate-500 hover:text-slate-300 hover:bg-ink-800'
      } ${className}`}
    >
      {listening ? (
        <>
          <span className="absolute inset-1 rounded-md bg-red-500/20 animate-ping pointer-events-none" />
          <IconMic className="w-4 h-4 relative" />
        </>
      ) : supported ? (
        <IconMic />
      ) : (
        <IconMicOff />
      )}
    </button>
  )
}
