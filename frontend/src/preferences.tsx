import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ar } from './i18n/locales/ar'
import { en, type MessageKey } from './i18n/locales/en'
import { hi } from './i18n/locales/hi'

/** User-selectable themes (system follows OS dark/light). */
export type ThemeMode =
  | 'system'
  | 'dark'
  | 'light'
  | 'midnight'
  | 'ocean'
  | 'nord'
  | 'ember'
  | 'rose'
  | 'solar'
  | 'matcha'

export type ResolvedTheme = Exclude<ThemeMode, 'system'>
export type Locale = 'en' | 'ar' | 'hi'

export type UiFont = 'inter' | 'system' | 'source' | 'plex' | 'serif' | 'mono'
export type UiFontSize = 'sm' | 'md' | 'lg' | 'xl'

export const THEME_OPTIONS: ThemeMode[] = [
  'system',
  'dark',
  'light',
  'midnight',
  'ocean',
  'nord',
  'ember',
  'rose',
  'solar',
  'matcha',
]

export const FONT_OPTIONS: UiFont[] = ['inter', 'system', 'source', 'plex', 'serif', 'mono']
export const FONT_SIZE_OPTIONS: UiFontSize[] = ['sm', 'md', 'lg', 'xl']

const LIGHT_THEMES = new Set<ResolvedTheme>(['light', 'solar', 'matcha'])

const THEME_KEY = 'aip_theme'
const LOCALE_KEY = 'aip_locale'
const FONT_KEY = 'aip_font'
const FONT_SIZE_KEY = 'aip_font_size'
const CONSOLE_A2A_KEY = 'aip_console_a2a'
const CONSOLE_REDTEAM_KEY = 'aip_console_redteam'
const CONSOLE_APITEST_KEY = 'aip_console_apitest'
const CONSOLE_AGENTBROWSER_KEY = 'aip_console_agentbrowser'

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, ar, hi }

export type ConsoleFeatures = {
  agentbrowser: boolean
  a2a: boolean
  redteam: boolean
  apitest: boolean
}

type PreferencesContextValue = {
  theme: ThemeMode
  resolvedTheme: ResolvedTheme
  colorScheme: 'dark' | 'light'
  setTheme: (t: ThemeMode) => void
  font: UiFont
  setFont: (f: UiFont) => void
  fontSize: UiFontSize
  setFontSize: (s: UiFontSize) => void
  locale: Locale
  setLocale: (l: Locale) => void
  consoles: ConsoleFeatures
  setConsoleEnabled: (id: keyof ConsoleFeatures, enabled: boolean) => void
  t: (key: MessageKey) => string
  dir: 'ltr' | 'rtl'
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function isThemeMode(v: string | null | undefined): v is ThemeMode {
  return !!v && (THEME_OPTIONS as string[]).includes(v)
}

export function isUiFont(v: string | null | undefined): v is UiFont {
  return !!v && (FONT_OPTIONS as string[]).includes(v)
}

export function isUiFontSize(v: string | null | undefined): v is UiFontSize {
  return !!v && (FONT_SIZE_OPTIONS as string[]).includes(v)
}

export function isLightTheme(theme: ResolvedTheme): boolean {
  return LIGHT_THEMES.has(theme)
}

function readStoredTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY)
  // Former "Black & white" (contrast) → Light
  if (v === 'contrast') return 'light'
  if (isThemeMode(v)) return v
  return 'dark'
}

function readStoredLocale(): Locale {
  const v = localStorage.getItem(LOCALE_KEY)
  if (v === 'en' || v === 'ar' || v === 'hi') return v
  return 'en'
}

function readStoredFont(): UiFont {
  const v = localStorage.getItem(FONT_KEY)
  if (isUiFont(v)) return v
  return 'inter'
}

function readStoredFontSize(): UiFontSize {
  const v = localStorage.getItem(FONT_SIZE_KEY)
  if (isUiFontSize(v)) return v
  return 'md'
}

function readStoredBool(key: string, fallback = true): boolean {
  const v = localStorage.getItem(key)
  if (v === '0' || v === 'false') return false
  if (v === '1' || v === 'true') return true
  return fallback
}

function readStoredConsoles(): ConsoleFeatures {
  return {
    agentbrowser: readStoredBool(CONSOLE_AGENTBROWSER_KEY, true),
    a2a: readStoredBool(CONSOLE_A2A_KEY, true),
    redteam: readStoredBool(CONSOLE_REDTEAM_KEY, true),
    apitest: readStoredBool(CONSOLE_APITEST_KEY, true),
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return mode
}

function applyDom(
  theme: ResolvedTheme,
  locale: Locale,
  font: UiFont,
  fontSize: UiFontSize,
) {
  const root = document.documentElement
  const scheme = isLightTheme(theme) ? 'light' : 'dark'
  // Set scheme + theme together so text remaps never fight surface colors
  root.setAttribute('data-scheme', scheme)
  root.setAttribute('data-theme', theme)
  root.setAttribute('data-font', font)
  root.setAttribute('data-font-size', fontSize)
  root.lang = locale
  root.dir = locale === 'ar' ? 'rtl' : 'ltr'
  root.style.colorScheme = scheme
  // Clear any stale inline colors from prior experiments
  root.style.removeProperty('color')
  root.style.removeProperty('background')
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() =>
    typeof window !== 'undefined' ? readStoredTheme() : 'dark',
  )
  const [locale, setLocaleState] = useState<Locale>(() =>
    typeof window !== 'undefined' ? readStoredLocale() : 'en',
  )
  const [font, setFontState] = useState<UiFont>(() =>
    typeof window !== 'undefined' ? readStoredFont() : 'inter',
  )
  const [fontSize, setFontSizeState] = useState<UiFontSize>(() =>
    typeof window !== 'undefined' ? readStoredFontSize() : 'md',
  )
  const [consoles, setConsoles] = useState<ConsoleFeatures>(() =>
    typeof window !== 'undefined'
      ? readStoredConsoles()
      : { agentbrowser: true, a2a: true, redteam: true, apitest: true },
  )
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    typeof window !== 'undefined' ? resolveTheme(readStoredTheme()) : 'dark',
  )

  useEffect(() => {
    const resolved = resolveTheme(theme)
    setResolvedTheme(resolved)
    applyDom(resolved, locale, font, fontSize)
    localStorage.setItem(THEME_KEY, theme)
    localStorage.setItem(LOCALE_KEY, locale)
    localStorage.setItem(FONT_KEY, font)
    localStorage.setItem(FONT_SIZE_KEY, fontSize)
  }, [theme, locale, font, fontSize])

  useEffect(() => {
    localStorage.setItem(CONSOLE_AGENTBROWSER_KEY, consoles.agentbrowser ? '1' : '0')
    localStorage.setItem(CONSOLE_A2A_KEY, consoles.a2a ? '1' : '0')
    localStorage.setItem(CONSOLE_REDTEAM_KEY, consoles.redteam ? '1' : '0')
    localStorage.setItem(CONSOLE_APITEST_KEY, consoles.apitest ? '1' : '0')
  }, [consoles])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => {
      const resolved = resolveTheme('system')
      setResolvedTheme(resolved)
      applyDom(resolved, locale, font, fontSize)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme, locale, font, fontSize])

  const setTheme = useCallback((t: ThemeMode) => setThemeState(t), [])
  const setLocale = useCallback((l: Locale) => setLocaleState(l), [])
  const setFont = useCallback((f: UiFont) => setFontState(f), [])
  const setFontSize = useCallback((s: UiFontSize) => setFontSizeState(s), [])
  const setConsoleEnabled = useCallback((id: keyof ConsoleFeatures, enabled: boolean) => {
    setConsoles((prev) => ({ ...prev, [id]: enabled }))
  }, [])

  const t = useCallback(
    (key: MessageKey) => catalogs[locale][key] ?? en[key] ?? key,
    [locale],
  )

  const colorScheme: 'dark' | 'light' = isLightTheme(resolvedTheme) ? 'light' : 'dark'

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      colorScheme,
      setTheme,
      font,
      setFont,
      fontSize,
      setFontSize,
      locale,
      setLocale,
      consoles,
      setConsoleEnabled,
      t,
      dir: (locale === 'ar' ? 'rtl' : 'ltr') as 'ltr' | 'rtl',
    }),
    [
      theme,
      resolvedTheme,
      colorScheme,
      setTheme,
      font,
      setFont,
      fontSize,
      setFontSize,
      locale,
      setLocale,
      consoles,
      setConsoleEnabled,
      t,
    ],
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences requires PreferencesProvider')
  return ctx
}

/** Preview colors for Settings swatches (not applied live). */
export const THEME_SWATCHES: Record<
  ThemeMode,
  { bg: string; accent: string; fg: string; labelKey: MessageKey }
> = {
  system: { bg: '#111111', accent: '#ff7a1a', fg: '#e2e8f0', labelKey: 'themeSystem' },
  dark: { bg: '#111111', accent: '#ff7a1a', fg: '#e2e8f0', labelKey: 'themeDark' },
  light: { bg: '#ffffff', accent: '#ff7a1a', fg: '#0f172a', labelKey: 'themeLight' },
  midnight: { bg: '#0c1220', accent: '#0ea5e9', fg: '#e8eef8', labelKey: 'themeMidnight' },
  ocean: { bg: '#0a1c19', accent: '#14b8a6', fg: '#e6f4f1', labelKey: 'themeOcean' },
  nord: { bg: '#2e3440', accent: '#81a1c1', fg: '#eceff4', labelKey: 'themeNord' },
  ember: { bg: '#1a1210', accent: '#f97316', fg: '#f5ebe4', labelKey: 'themeEmber' },
  rose: { bg: '#1a0f15', accent: '#f43f5e', fg: '#fce7f0', labelKey: 'themeRose' },
  solar: { bg: '#faf7f0', accent: '#b45309', fg: '#2a2218', labelKey: 'themeSolar' },
  matcha: { bg: '#f7fbf8', accent: '#16a34a', fg: '#15251b', labelKey: 'themeMatcha' },
}

export const FONT_LABEL_KEYS: Record<UiFont, MessageKey> = {
  inter: 'fontInter',
  system: 'fontSystem',
  source: 'fontSource',
  plex: 'fontPlex',
  serif: 'fontSerif',
  mono: 'fontMono',
}

export const FONT_SIZE_LABEL_KEYS: Record<UiFontSize, MessageKey> = {
  sm: 'fontSizeSm',
  md: 'fontSizeMd',
  lg: 'fontSizeLg',
  xl: 'fontSizeXl',
}
