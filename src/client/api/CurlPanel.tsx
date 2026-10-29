/**
 * cURL import / export panel (FR-API-07).
 *
 * Both directions are a pure text transform in the client: a pasted command
 * becomes an editable draft, and the current draft becomes a command. Nothing
 * here talks to the Host or the network, so a pasted command can never send
 * itself, and `{{variables}}` stay literal in both directions — exporting must
 * not turn a placeholder into a value it never resolved.
 *
 * The panel stays collapsed by default: the form is the primary path, cURL is
 * for people arriving from a browser's "Copy as cURL".
 */
import * as React from 'react'
import type { HttpRequestSpec } from '../../contracts/api'
import { createTranslator, type Locale } from '../i18n'
import { parseCurl, toCurl, type CurlExport, type CurlIssue } from './curl'
import { buildRequestSpec, type RequestDraft } from './request-model'

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
  minHeight: 56,
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
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.75,
}

const issueStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  color: 'var(--dsw-color-danger, #c62828)',
}

const lossStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 16,
  font: '11px/1.4 system-ui, sans-serif',
  color: 'var(--dsw-color-warning, #b26a00)',
}

type CopyState = 'idle' | 'copied' | 'failed'

export interface CurlPanelProps {
  readonly draft: RequestDraft
  /** Receives the parsed spec; the builder loads it and never sends it. */
  readonly onImport: (spec: HttpRequestSpec) => void
  readonly disabled?: boolean
  readonly locale?: Locale
}

export function CurlPanel({
  draft,
  onImport,
  disabled = false,
  locale,
}: CurlPanelProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState('')
  const [issue, setIssue] = React.useState<CurlIssue | null>(null)
  const [copy, setCopy] = React.useState<CopyState>('idle')

  // An incomplete draft has no command; the panel says so instead of exporting
  // text that would not round-trip.
  const exported = React.useMemo<CurlExport | null>(() => {
    const built = buildRequestSpec(draft)
    return built.ok ? toCurl(built.spec) : null
  }, [draft])

  const handleImport = React.useCallback((): void => {
    const result = parseCurl(text)
    if (!result.ok) {
      setIssue(result.issue)
      return
    }
    setIssue(null)
    setText('')
    setCopy('idle')
    onImport(result.spec)
  }, [onImport, text])

  const handleCopy = React.useCallback((): void => {
    if (exported === null) return
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (clipboard === undefined) {
      setCopy('failed')
      return
    }
    void clipboard
      .writeText(exported.command)
      .then(() => setCopy('copied'))
      .catch(() => setCopy('failed'))
  }, [exported])

  return (
    <div style={panelStyle} data-vibe-curl="1">
      <button
        type="button"
        style={toggleStyle}
        aria-expanded={open}
        data-vibe-curl-toggle="1"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? `▾ ${t('api.curl.toggle')}` : `▸ ${t('api.curl.toggle')}`}
      </button>
      {open ? (
        <div style={bodyStyle} data-vibe-curl-panel="1">
          <span style={headingStyle}>{t('api.curl.title')}</span>

          <label style={labelStyle}>
            <span>{t('api.curl.import.label')}</span>
            <textarea
              style={textareaStyle}
              rows={4}
              value={text}
              placeholder={t('api.curl.import.placeholder')}
              disabled={disabled}
              spellCheck={false}
              data-vibe-curl-input="1"
              onChange={(event) => {
                setText(event.target.value)
                setIssue(null)
              }}
            />
          </label>
          <div style={actionsStyle}>
            <button
              type="button"
              style={buttonStyle}
              data-vibe-curl-import="1"
              disabled={disabled || text.trim() === ''}
              onClick={handleImport}
            >
              {t('api.curl.import.button')}
            </button>
            <span style={hintStyle}>{t('api.curl.import.hint')}</span>
          </div>
          {issue === null ? null : (
            <span role="alert" style={issueStyle} data-vibe-curl-issue="1">
              {t(
                `api.curl.import.issue.${issue.code}`,
                issue.detail === undefined ? undefined : { detail: issue.detail },
              )}
            </span>
          )}

          <label style={labelStyle}>
            <span>{t('api.curl.export.label')}</span>
            <textarea
              style={textareaStyle}
              rows={3}
              readOnly
              value={exported?.command ?? ''}
              placeholder={t('api.curl.export.incomplete')}
              spellCheck={false}
              data-vibe-curl-output="1"
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <div style={actionsStyle}>
            <button
              type="button"
              style={buttonStyle}
              data-vibe-curl-copy="1"
              disabled={exported === null}
              onClick={handleCopy}
            >
              {t('api.curl.export.copy')}
            </button>
            {copy === 'idle' ? null : (
              <span style={statusStyle} role="status" data-vibe-curl-copy-status="1">
                {copy === 'copied' ? t('api.curl.export.copied') : t('api.curl.export.copyFailed')}
              </span>
            )}
          </div>
          {exported !== null && exported.losses.length > 0 ? (
            <ul style={lossStyle} data-vibe-curl-losses="1">
              {exported.losses.map((loss) => (
                <li key={loss}>{t(`api.curl.export.loss.${loss}`)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
