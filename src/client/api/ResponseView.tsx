/**
 * Response viewer, basic tier (T039).
 *
 * Shows status, elapsed time, size and content type, then the body and the
 * headers. A 10 MB body must not freeze the panel, so the body is rendered one
 * page at a time (`RESPONSE_PAGE_BYTES`) and JSON is only pretty-printed while
 * it stays under `RESPONSE_PRETTY_MAX_CHARS`; anything larger shows raw text.
 * The tree/HTML/image previews are T040.
 */
import * as React from 'react'
import type { HttpExecutionResult } from '../../contracts/api'
import { createTranslator, type Locale } from '../i18n'
import { ResponseHeaders } from './ResponseHeaders'

/** Characters of body text rendered at once; keeps a 10 MB response cheap. */
export const RESPONSE_PAGE_BYTES = 64 * 1024
/** Above this, JSON is shown raw instead of parsed and re-serialized. */
export const RESPONSE_PRETTY_MAX_CHARS = 256 * 1024

export function formatResponseBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type BodyContent =
  | {
      readonly kind: 'text'
      readonly raw: string
      readonly pretty: string | null
      readonly jsonTooLarge: boolean
    }
  | { readonly kind: 'binary' }
  | { readonly kind: 'empty' }

function headerValue(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const direct = headers[name]
  if (direct !== undefined) return direct
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

function looksJson(contentType: string | undefined, text: string): boolean {
  if (contentType && /json/i.test(contentType)) return true
  const head = text.trimStart()
  return head.startsWith('{') || head.startsWith('[')
}

export function buildBodyContent(result: HttpExecutionResult): BodyContent {
  const text = result.body.text
  // The Host sends `null` for known binary types and `''` for an empty body.
  if (text === null) return { kind: 'binary' }
  if (text === '') return result.body.bytes > 0 ? { kind: 'binary' } : { kind: 'empty' }
  const contentType = result.body.contentType ?? headerValue(result.headers, 'content-type')
  const jsonTooLarge =
    text.length > RESPONSE_PRETTY_MAX_CHARS && looksJson(contentType, text)
  let pretty: string | null = null
  if (!jsonTooLarge && looksJson(contentType, text)) {
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      pretty = null
    }
  }
  return { kind: 'text', raw: text, pretty, jsonTooLarge }
}

function statusTone(status: number): { readonly color: string; readonly background: string } {
  if (status >= 200 && status < 300) {
    return { color: 'var(--dsw-color-success, #1b7f3b)', background: 'rgba(27, 127, 59, 0.1)' }
  }
  if (status >= 300 && status < 400) {
    return { color: 'var(--dsw-color-info, #2a6fdb)', background: 'rgba(42, 111, 219, 0.1)' }
  }
  if (status >= 500) {
    return { color: 'var(--dsw-color-danger, #c62828)', background: 'rgba(198, 40, 40, 0.1)' }
  }
  if (status >= 400) {
    return { color: 'var(--dsw-color-warning, #b26a00)', background: 'rgba(178, 106, 0, 0.12)' }
  }
  return { color: 'inherit', background: 'rgba(127, 127, 127, 0.12)' }
}

const rootStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '10px 0 0',
  minWidth: 0,
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
}

const badgeStyle: React.CSSProperties = {
  borderRadius: 6,
  font: '600 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace',
  padding: '3px 8px',
}

const metaStyle: React.CSSProperties = {
  font: '11px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace',
  opacity: 0.8,
  wordBreak: 'break-all',
}

const tabButtonStyle: React.CSSProperties = {
  appearance: 'none',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
  font: '600 11px/1.4 system-ui, sans-serif',
  padding: '3px 8px',
}

const activeTabStyle: React.CSSProperties = {
  ...tabButtonStyle,
  borderColor: 'var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  background: 'rgba(127, 127, 127, 0.12)',
}

const bodyStyle: React.CSSProperties = {
  margin: 0,
  maxHeight: 280,
  overflow: 'auto',
  padding: 8,
  borderRadius: 6,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.25))',
  background: 'rgba(127, 127, 127, 0.06)',
  font: '11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
}

const noteStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.7,
}

const navButtonStyle: React.CSSProperties = {
  ...tabButtonStyle,
  borderColor: 'var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
}

export interface ResponseViewProps {
  readonly result: HttpExecutionResult
  readonly locale?: Locale
  /** Characters per page; overridable so tests stay small. */
  readonly pageBytes?: number
}

type Tab = 'body' | 'headers'
type Mode = 'pretty' | 'raw'

export function ResponseView({
  result,
  locale,
  pageBytes = RESPONSE_PAGE_BYTES,
}: ResponseViewProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const content = React.useMemo(() => buildBodyContent(result), [result])
  const [tab, setTab] = React.useState<Tab>('body')
  const [mode, setMode] = React.useState<Mode>(content.kind === 'text' && content.pretty ? 'pretty' : 'raw')
  const [page, setPage] = React.useState(0)

  React.useEffect(() => {
    setMode(content.kind === 'text' && content.pretty ? 'pretty' : 'raw')
    setPage(0)
  }, [content])

  const text = content.kind === 'text' ? (mode === 'pretty' && content.pretty ? content.pretty : content.raw) : ''
  const totalPages = Math.max(1, Math.ceil(text.length / pageBytes))
  const current = Math.min(page, totalPages - 1)
  const slice = text.slice(current * pageBytes, (current + 1) * pageBytes)
  const tone = statusTone(result.status)
  const contentType = result.body.contentType ?? headerValue(result.headers, 'content-type')

  return (
    <section style={rootStyle} data-vibe-response="1" aria-label="response">
      <div style={barStyle}>
        <span
          style={{ ...badgeStyle, color: tone.color, background: tone.background }}
          data-vibe-response-status="1"
        >
          {`HTTP ${result.status} ${result.statusText}`.trim()}
        </span>
        <span style={metaStyle} data-vibe-response-meta="1">
          {t('api.response.meta', {
            elapsed: result.elapsedMs,
            bytes: formatResponseBytes(result.body.bytes),
          })}
        </span>
        {contentType ? <span style={metaStyle}>{contentType}</span> : null}
        {result.redirects.length > 0 ? (
          <span style={metaStyle} data-vibe-response-redirects="1">
            {t('api.response.redirects', { count: result.redirects.length })}
          </span>
        ) : null}
        {result.body.truncated ? (
          <span
            style={{ ...badgeStyle, color: 'var(--dsw-color-warning, #b26a00)' }}
            data-vibe-response-truncated="1"
          >
            {t('api.response.truncated')}
          </span>
        ) : null}
      </div>

      <div style={barStyle} role="tablist">
        <button
          type="button"
          style={tab === 'body' ? activeTabStyle : tabButtonStyle}
          role="tab"
          aria-selected={tab === 'body'}
          data-vibe-response-tab="body"
          onClick={() => setTab('body')}
        >
          {t('api.response.tab.body')}
        </button>
        <button
          type="button"
          style={tab === 'headers' ? activeTabStyle : tabButtonStyle}
          role="tab"
          aria-selected={tab === 'headers'}
          data-vibe-response-tab="headers"
          onClick={() => setTab('headers')}
        >
          {`${t('api.response.tab.headers')} (${Object.keys(result.headers).length})`}
        </button>
        {tab === 'body' && content.kind === 'text' && content.pretty ? (
          <>
            <button
              type="button"
              style={mode === 'pretty' ? activeTabStyle : tabButtonStyle}
              data-vibe-response-mode="pretty"
              onClick={() => setMode('pretty')}
            >
              {t('api.response.mode.pretty')}
            </button>
            <button
              type="button"
              style={mode === 'raw' ? activeTabStyle : tabButtonStyle}
              data-vibe-response-mode="raw"
              onClick={() => setMode('raw')}
            >
              {t('api.response.mode.raw')}
            </button>
          </>
        ) : null}
      </div>

      {tab === 'headers' ? (
        <ResponseHeaders headers={result.headers} {...(locale === undefined ? {} : { locale })} />
      ) : content.kind === 'binary' ? (
        <div style={noteStyle} data-vibe-response-binary="1">
          {t('api.response.binary', { bytes: formatResponseBytes(result.body.bytes) })}
        </div>
      ) : content.kind === 'empty' ? (
        <div style={noteStyle} data-vibe-response-empty-body="1">
          {t('api.response.emptyBody')}
        </div>
      ) : (
        <>
          {content.jsonTooLarge ? (
            <div style={noteStyle} data-vibe-response-json-too-large="1">
              {t('api.response.jsonTooLarge')}
            </div>
          ) : null}
          <pre style={bodyStyle} data-vibe-response-body="1">
            {slice}
          </pre>
          {totalPages > 1 ? (
            <div style={barStyle}>
              <button
                type="button"
                style={navButtonStyle}
                data-vibe-response-page-prev="1"
                disabled={current === 0}
                onClick={() => setPage(Math.max(0, current - 1))}
              >
                {t('api.response.page.prev')}
              </button>
              <span style={metaStyle} data-vibe-response-page="1">
                {t('api.response.page', { page: current + 1, total: totalPages })}
              </span>
              <button
                type="button"
                style={navButtonStyle}
                data-vibe-response-page-next="1"
                disabled={current >= totalPages - 1}
                onClick={() => setPage(Math.min(totalPages - 1, current + 1))}
              >
                {t('api.response.page.next')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
