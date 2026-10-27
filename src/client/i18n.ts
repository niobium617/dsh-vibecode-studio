/**
 * Minimal i18n skeleton for the Studio client (T010).
 *
 * Two catalogs live next to this file as JSON so esbuild can inline them into
 * the client bundle. Lookup falls back locale -> en -> the raw key; missing
 * translations are therefore visible but never crash the panel.
 */
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

export const LOCALES = ['en', 'zh-CN'] as const
export type Locale = (typeof LOCALES)[number]

export type MessageKey = keyof typeof en

const CATALOGS: Record<Locale, Record<string, string>> = {
  en,
  'zh-CN': zhCN,
}

export const DEFAULT_LOCALE: Locale = 'en'

export interface TranslateOptions {
  readonly locale?: Locale
  readonly params?: Readonly<Record<string, string | number>>
}

/** Map a BCP 47 language tag onto a bundled catalog. Unknown tags use en. */
export function detectLocale(language?: string | null): Locale {
  if (!language) return DEFAULT_LOCALE
  const normalized = language.trim().toLowerCase()
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  return DEFAULT_LOCALE
}

function interpolate(text: string, params?: TranslateOptions['params']): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/** Translate a key; falls back to en, then to the key itself. */
export function translate(key: string, options: TranslateOptions = {}): string {
  const locale = options.locale ?? DEFAULT_LOCALE
  const text = CATALOGS[locale][key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key
  return interpolate(text, options.params)
}

/** Bind a locale once; components use this to avoid repeating it per call. */
export function createTranslator(
  locale: Locale,
): (key: string, params?: TranslateOptions['params']) => string {
  return (key, params) => translate(key, { locale, params })
}

/** Locale from the browser, if any. Falls back to en outside a DOM. */
export function browserLocale(): Locale {
  return detectLocale(typeof navigator === 'undefined' ? undefined : navigator.language)
}
