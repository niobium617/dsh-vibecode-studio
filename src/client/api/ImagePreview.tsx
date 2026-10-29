/**
 * Image response preview (T040).
 *
 * The Host hands binary bodies over as base64; the panel turns them into a
 * `data:` URI and lets the browser decode, so no markup is injected and SVG
 * cannot run script inside an `<img>`. Only a fixed allowlist of image types
 * is rendered.
 */
import * as React from 'react'
import type { HttpExecutionResult } from '../../contracts/api'
import { createTranslator, type Locale } from '../i18n'

const IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'image/x-icon',
])

function baseType(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase()
}

export function isImageContentType(contentType: string | null | undefined): boolean {
  return IMAGE_CONTENT_TYPES.has(baseType(contentType))
}

/** `data:` URI for an image body, or null when it is not a renderable image. */
export function imageDataUri(
  result: Pick<HttpExecutionResult, 'body'>,
): string | null {
  const { base64, contentType } = result.body
  if (!base64 || !isImageContentType(contentType)) return null
  return `data:${baseType(contentType)};base64,${base64}`
}

export interface ImagePreviewProps {
  readonly result: Pick<HttpExecutionResult, 'body'>
  readonly locale?: Locale
}

const wrapStyle: React.CSSProperties = {
  display: 'grid',
  placeItems: 'start',
  padding: 8,
  borderRadius: 6,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.25))',
  background: 'rgba(127, 127, 127, 0.06)',
  maxHeight: 280,
  overflow: 'auto',
}

const imageStyle: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: 260,
  objectFit: 'contain',
}

const noteStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.7,
}

export function ImagePreview({ result, locale }: ImagePreviewProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const uri = imageDataUri(result)
  if (!uri) {
    return (
      <div style={noteStyle} data-vibe-response-image-unsupported="1">
        {t('api.response.image.unsupported')}
      </div>
    )
  }
  return (
    <div style={wrapStyle} data-vibe-response-image="1">
      <img
        src={uri}
        alt={t('api.response.image.alt')}
        data-vibe-response-image-src="1"
        style={imageStyle}
      />
    </div>
  )
}
