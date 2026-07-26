import { useCallback, useEffect, useRef, useState } from 'react'
import type { Locale } from './preferences'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null
  onerror: ((this: SpeechRecognitionLike, ev: { error?: string }) => void) | null
  onresult:
    | ((
        this: SpeechRecognitionLike,
        ev: {
          resultIndex: number
          results: ArrayLike<{
            isFinal: boolean
            0: { transcript: string }
          }>
        },
      ) => void)
    | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function speechLangForLocale(locale: Locale): string {
  switch (locale) {
    case 'ar':
      return 'ar-SA'
    case 'hi':
      return 'hi-IN'
    default:
      return 'en-US'
  }
}

export function isSpeechInputSupported(): boolean {
  return typeof window !== 'undefined' && !!getSpeechRecognitionCtor()
}

function joinTranscript(base: string, next: string): string {
  const a = base.trimEnd()
  const b = next.trim()
  if (!b) return a
  if (!a) return b
  const needsSpace = !/[\s([{/]$/.test(a) && !/^[.,!?;:)\]}]/.test(b)
  return needsSpace ? `${a} ${b}` : `${a}${b}`
}

type Options = {
  locale: Locale
  value: string
  onChange: (next: string) => void
  onError?: (message: string) => void
  disabled?: boolean
}

export function useSpeechInput({ locale, value, onChange, onError, disabled }: Options) {
  const [supported] = useState(() => isSpeechInputSupported())
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const wantListenRef = useRef(false)
  const baseRef = useRef(value)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const stop = useCallback(() => {
    wantListenRef.current = false
    const rec = recognitionRef.current
    recognitionRef.current = null
    try {
      rec?.stop()
    } catch {
      /* already stopped */
    }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    if (disabled || !supported) return
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      onErrorRef.current?.('unsupported')
      return
    }

    stop()
    wantListenRef.current = true
    baseRef.current = valueRef.current

    const rec = new Ctor()
    recognitionRef.current = rec
    rec.lang = speechLangForLocale(locale)
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => {
      if (wantListenRef.current) setListening(true)
    }

    rec.onerror = (ev) => {
      const code = ev.error || 'error'
      if (code === 'aborted' || code === 'no-speech') return
      wantListenRef.current = false
      setListening(false)
      onErrorRef.current?.(code)
    }

    rec.onresult = (ev) => {
      let interim = ''
      let finalized = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i]
        const text = piece[0]?.transcript || ''
        if (piece.isFinal) finalized += text
        else interim += text
      }
      if (finalized) {
        baseRef.current = joinTranscript(baseRef.current, finalized)
        onChangeRef.current(baseRef.current)
      } else if (interim) {
        onChangeRef.current(joinTranscript(baseRef.current, interim))
      }
    }

    rec.onend = () => {
      if (wantListenRef.current && recognitionRef.current === rec) {
        // Chrome ends sessions periodically; keep listening until the user stops.
        try {
          rec.start()
          return
        } catch {
          wantListenRef.current = false
        }
      }
      if (recognitionRef.current === rec) recognitionRef.current = null
      setListening(false)
    }

    try {
      rec.start()
      setListening(true)
    } catch {
      wantListenRef.current = false
      recognitionRef.current = null
      setListening(false)
      onErrorRef.current?.('start-failed')
    }
  }, [disabled, locale, stop, supported])

  const toggle = useCallback(() => {
    if (listening || wantListenRef.current) stop()
    else start()
  }, [listening, start, stop])

  useEffect(() => () => stop(), [stop])

  useEffect(() => {
    if (disabled && (listening || wantListenRef.current)) stop()
  }, [disabled, listening, stop])

  return { supported, listening, start, stop, toggle }
}
