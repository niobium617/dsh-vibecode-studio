import { describe, expect, it } from 'vitest'
import en from '../../../src/client/locales/en.json'
import zhCN from '../../../src/client/locales/zh-CN.json'
import { browserLocale, DEFAULT_LOCALE, detectLocale, translate } from '../../../src/client/i18n'

describe('i18n skeleton', () => {
  it('keeps both catalogs on the same key set', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort())
  })

  it('translates known keys and falls back to en', () => {
    expect(translate('tab.preview', { locale: 'en' })).toBe('Preview')
    expect(translate('tab.preview', { locale: 'zh-CN' })).toBe('预览')
  })

  it('returns the key itself for unknown keys and interpolates params', () => {
    expect(translate('missing.key')).toBe('missing.key')
    expect(translate('missing.{name}', { params: { name: 'value' } })).toBe('missing.value')
  })

  it('detects zh variants and defaults to en', () => {
    expect(detectLocale('zh')).toBe('zh-CN')
    expect(detectLocale('zh-CN')).toBe('zh-CN')
    expect(detectLocale('zh-TW')).toBe('zh-CN')
    expect(detectLocale('en-US')).toBe('en')
    expect(detectLocale('fr')).toBe('en')
    expect(detectLocale(undefined)).toBe(DEFAULT_LOCALE)
    expect(detectLocale(null)).toBe(DEFAULT_LOCALE)
  })

  it('reads the locale from the browser when available', () => {
    expect(browserLocale()).toBe(detectLocale(navigator.language))
  })
})
