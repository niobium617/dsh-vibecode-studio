/**
 * Response headers (T039).
 *
 * The host already redacts sensitive response headers before the outcome
 * crosses the unary wire, so this view only formats. Values keep the server's
 * order; long values wrap instead of scrolling sideways.
 */
import * as React from 'react'
import { createTranslator, type Locale } from '../i18n'

const rootStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
}

const titleStyle: React.CSSProperties = {
  font: '600 11px/1.4 system-ui, sans-serif',
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(90px, 38%) 1fr',
  gap: 8,
  font: '11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace',
  borderBottom: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.15))',
  padding: '2px 0',
}

const nameStyle: React.CSSProperties = {
  opacity: 0.7,
  wordBreak: 'break-all',
}

const valueStyle: React.CSSProperties = {
  wordBreak: 'break-word',
}

const noteStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.7,
}

export interface ResponseHeadersProps {
  readonly headers: Readonly<Record<string, string>>
  readonly locale?: Locale
}

export function ResponseHeaders({ headers, locale }: ResponseHeadersProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const rows = Object.entries(headers)

  return (
    <div style={rootStyle} data-vibe-response-headers="1">
      <div style={titleStyle}>
        {t('api.response.headers.title')} ({rows.length})
      </div>
      {rows.length === 0 ? (
        <div style={noteStyle} data-vibe-response-headers-empty="1">
          {t('api.response.headers.empty')}
        </div>
      ) : (
        <div role="list">
          {rows.map(([name, value]) => (
            <div role="listitem" key={name} style={rowStyle} data-vibe-response-header="1">
              <span style={nameStyle}>{name}</span>
              <span style={valueStyle} data-vibe-response-header-value="1">
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={noteStyle}>{t('api.response.headers.redacted')}</div>
    </div>
  )
}
