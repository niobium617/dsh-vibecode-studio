/**
 * OpenAPI import entry (FR-API-08, T046 R3).
 *
 * Paste a document or pick a JSON file; the Host parses it, maps every
 * operation into a request and saves the result as a new collection. The panel
 * never writes `.vibe/api` itself and never sends a request — the imported
 * collection is inert until the user opens one and presses Send.
 *
 * A document travels inside one unary envelope, so the panel measures the
 * exact body before calling and explains an over-limit document instead of
 * letting the transport answer with a bare 413.
 */
import * as React from 'react'
import type { ApiOpenApiImportParams, ApiOpenApiImportResult } from '../../contracts/api'
import type { StudioError } from '../../contracts/errors'
import { createTranslator, type Locale } from '../i18n'
import { revealCollection } from './collection-store'
import {
  MAX_UNARY_BODY_BYTES,
  importEnvelopeBytes,
  importOpenApiDocument,
} from './openapi-import'

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '4px 12px 12px',
}

const bodyStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 10,
  borderRadius: 6,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
}

const toggleStyle: React.CSSProperties = {
  justifySelf: 'start',
  appearance: 'none',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: '600 11px/1.4 system-ui, sans-serif',
  opacity: 0.8,
  padding: 0,
}

const headingStyle: React.CSSProperties = {
  font: '600 11px/1.4 system-ui, sans-serif',
}

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  font: '11px/1.4 system-ui, sans-serif',
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
  minHeight: 64,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  background: 'var(--dsw-panel-bg, transparent)',
  color: 'inherit',
  font: '12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace',
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
}

const buttonStyle: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: '600 11px/1.4 system-ui, sans-serif',
  padding: '4px 10px',
}

const hintStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.75,
}

const statusStyle: React.CSSProperties = {
  display: 'grid',
  gap: 2,
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.9,
}

const issueStyle: React.CSSProperties = {
  display: 'grid',
  gap: 2,
  font: '11px/1.4 system-ui, sans-serif',
  color: 'var(--dsw-color-danger, #c62828)',
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly result: ApiOpenApiImportResult }
  | { readonly kind: 'failed'; readonly title: string; readonly detail: string | null }

export interface OpenApiImportPanelProps {
  /** Called after the collection is saved; the workbench refreshes its tree. */
  readonly onImported?: (result: ApiOpenApiImportResult) => void
  readonly locale?: Locale
}

/** Reasons the panel words itself; anything else shows the Host's message. */
const KNOWN_REASONS = new Set([
  'invalid_json',
  'invalid_document',
  'document_too_large',
  'too_many_operations',
  'ref_unresolved',
  'ref_cycle',
  'remote_ref_blocked',
  'remote_ref_redirect',
  'remote_ref_too_large',
  'remote_ref_failed',
  'collection_full',
  'collection_exists',
])

function describeFailure(
  error: unknown,
  t: ReturnType<typeof createTranslator>,
): { readonly title: string; readonly detail: string | null } {
  const candidate = error as Partial<StudioError> | null
  const message = typeof candidate?.message === 'string' ? candidate.message : ''
  const details = candidate?.details
  const reason = typeof details?.reason === 'string' ? details.reason : ''
  if (reason !== '' && KNOWN_REASONS.has(reason)) {
    return { title: t(`api.openapi.error.${reason}`), detail: null }
  }
  if (candidate?.code === 'permission_denied') {
    return { title: t('api.openapi.error.blocked'), detail: message === '' ? null : message }
  }
  return {
    title: t('api.openapi.error.unknown'),
    detail: message === '' ? null : message,
  }
}

export function OpenApiImportPanel({
  onImported,
  locale,
}: OpenApiImportPanelProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState('')
  const [fileName, setFileName] = React.useState('')
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })

  const handleImport = React.useCallback((): void => {
    if (text.trim() === '') {
      setPhase({ kind: 'failed', title: t('api.openapi.empty'), detail: null })
      return
    }
    const params: ApiOpenApiImportParams = { text }
    if (importEnvelopeBytes(params) > MAX_UNARY_BODY_BYTES) {
      setPhase({ kind: 'failed', title: t('api.openapi.tooLarge'), detail: null })
      return
    }
    setPhase({ kind: 'busy' })
    importOpenApiDocument(params).then(
      (result) => {
        setPhase({ kind: 'done', result })
        setText('')
        setFileName('')
        void revealCollection(result.collection.id)
        onImported?.(result)
      },
      (error: unknown) => setPhase({ kind: 'failed', ...describeFailure(error, t) }),
    )
  }, [onImported, t, text])

  const handleFile = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0]
      // Clearing the input lets the same file be picked again after an edit.
      event.target.value = ''
      if (file === undefined) return
      setFileName(file.name)
      if (file.size >= MAX_UNARY_BODY_BYTES) {
        setPhase({ kind: 'failed', title: t('api.openapi.tooLarge'), detail: null })
        return
      }
      if (typeof file.text !== 'function') {
        setPhase({ kind: 'failed', title: t('api.openapi.fileFailed'), detail: null })
        return
      }
      file.text().then(
        (value) => {
          setText(value)
          setPhase({ kind: 'idle' })
        },
        () => setPhase({ kind: 'failed', title: t('api.openapi.fileFailed'), detail: null }),
      )
    },
    [t],
  )

  return (
    <div style={panelStyle} data-vibe-openapi="1">
      <button
        type="button"
        style={toggleStyle}
        aria-expanded={open}
        data-vibe-openapi-toggle="1"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? `▾ ${t('api.openapi.toggle')}` : `▸ ${t('api.openapi.toggle')}`}
      </button>
      {open ? (
        <div style={bodyStyle} data-vibe-openapi-panel="1">
          <span style={headingStyle}>{t('api.openapi.title')}</span>
          <span style={hintStyle}>{t('api.openapi.hint')}</span>

          <label style={labelStyle}>
            <span>{t('api.openapi.input.label')}</span>
            <textarea
              style={textareaStyle}
              rows={5}
              value={text}
              placeholder={t('api.openapi.input.placeholder')}
              spellCheck={false}
              data-vibe-openapi-input="1"
              onChange={(event) => {
                setText(event.target.value)
                setFileName('')
                setPhase({ kind: 'idle' })
              }}
            />
          </label>

          <label style={labelStyle}>
            <span>{t('api.openapi.file.label')}</span>
            <input
              type="file"
              accept=".json,application/json"
              data-vibe-openapi-file="1"
              onChange={handleFile}
            />
          </label>

          <div style={actionsStyle}>
            <button
              type="button"
              style={buttonStyle}
              data-vibe-openapi-import="1"
              disabled={phase.kind === 'busy' || text.trim() === ''}
              onClick={handleImport}
            >
              {phase.kind === 'busy' ? t('api.openapi.importing') : t('api.openapi.import')}
            </button>
            {fileName === '' ? null : (
              <span style={hintStyle} data-vibe-openapi-name="1">
                {t('api.openapi.file.loaded', { name: fileName })}
              </span>
            )}
          </div>

          {phase.kind === 'done' ? (
            <div role="status" style={statusStyle} data-vibe-openapi-status="1">
              <span>
                {t('api.openapi.done', {
                  name: phase.result.collection.name,
                  endpoints: phase.result.endpointCount,
                  groups: phase.result.groupCount,
                })}
              </span>
              {phase.result.skipped === 0 ? null : (
                <span>{t('api.openapi.done.skipped', { count: phase.result.skipped })}</span>
              )}
              {phase.result.warnings.length === 0 ? null : (
                <span>
                  {t('api.openapi.done.warnings', { count: phase.result.warnings.length })}
                </span>
              )}
              <span>{t('api.openapi.done.nothingSent')}</span>
            </div>
          ) : phase.kind === 'failed' ? (
            <div role="alert" style={issueStyle} data-vibe-openapi-status="1">
              <span>{phase.title}</span>
              {phase.detail === null ? null : <span>{phase.detail}</span>}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
