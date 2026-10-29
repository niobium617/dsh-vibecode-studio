/**
 * Sandboxed HTML response preview (T040).
 *
 * API responses are untrusted: the document renders inside an iframe with
 * `sandbox=""` (no scripts, no forms, no popups, opaque origin) and a CSP
 * that blocks scripts and remote loads. Everything the preview needs is
 * inline in `srcDoc`; nothing is injected into the panel document itself.
 */
import * as React from 'react'
import { createTranslator, type Locale } from '../i18n'

/**
 * `default-src 'none'` blocks scripts and network requests; inline styles and
 * `data:` images keep ordinary HTML previews readable.
 */
export const HTML_PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"

export interface HtmlPreviewProps {
  readonly html: string
  readonly locale?: Locale
  readonly height?: number
}

const wrapStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
}

const noteStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.7,
}

const frameStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.25))',
  borderRadius: 6,
  background: '#fff',
}

export function HtmlPreview({ html, locale, height = 280 }: HtmlPreviewProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  // React's JSX typings lack `csp`, so set the attribute on the real element.
  const frameRef = React.useCallback((node: HTMLIFrameElement | null) => {
    if (node) node.setAttribute('csp', HTML_PREVIEW_CSP)
  }, [])
  return (
    <div style={wrapStyle} data-vibe-html-preview="1">
      <div style={noteStyle} data-vibe-html-note="1">
        {t('api.response.html.sandbox')}
      </div>
      <iframe
        ref={frameRef}
        title="Response HTML preview"
        data-vibe-html-frame="1"
        sandbox=""
        srcDoc={html}
        style={{ ...frameStyle, height }}
      />
    </div>
  )
}
