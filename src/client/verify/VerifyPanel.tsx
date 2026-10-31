/**
 * Verification panel (T056).
 *
 * Lives in the preview page's bottom drawer layer as a third tab, so the run
 * and its evidence stay next to the page they describe. The panel is manual:
 * one click runs `preview.verify.run` and renders the four checks the Host
 * evaluated (T055). Evidence rows carry the id of the console/network buffer
 * entry, and clicking one asks the page to open that drawer focused on the row
 * — the panel never duplicates the drawers' data or formatting.
 *
 * The Host result is a bounded wire shape; every message and evidence string
 * came from the page, so this component renders it as text nodes only.
 */
import * as React from 'react'
import { PREVIEW_VERIFY_RUN_METHOD } from '../../contracts/transport'
import type {
  VerifyCheck,
  VerifyCheckStatus,
  VerifyEvidence,
  VerifyResult,
} from '../../contracts/verify'
import { createTranslator, type Locale } from '../i18n'
import { callUnary } from '../transport/client'

/** Test seam; defaults to the unary transport. */
export interface VerifySource {
  run(): Promise<VerifyResult>
}

export interface VerifyPanelProps {
  readonly locale?: Locale
  /** Shown when this drawer is the selected bottom tab. */
  readonly visible?: boolean
  /** The preview session is live; the run button waits for it otherwise. */
  readonly ready: boolean
  readonly source?: VerifySource
  onClose?(): void
  /** Opens the matching drawer at one evidence row. */
  onOpenEvidence?(evidence: VerifyEvidence): void
}

const DEFAULT_SOURCE: VerifySource = {
  run: () => callUnary<VerifyResult>(PREVIEW_VERIFY_RUN_METHOD),
}

function rootStyle(visible: boolean): React.CSSProperties {
  return {
    display: visible ? 'grid' : 'none',
    gridTemplateRows: 'auto minmax(0, 1fr)',
    gap: 4,
    height: '100%',
    minHeight: 0,
    padding: '4px 8px 8px',
    boxSizing: 'border-box',
    font: '12px/1.5 system-ui, sans-serif',
  }
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
}

const titleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  font: '600 12px/1.4 system-ui, sans-serif',
}

const buttonStyle: React.CSSProperties = {
  font: 'inherit',
  padding: '4px 10px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const bodyStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  alignContent: 'start',
  gap: 4,
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.75,
}

const metaStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.75,
  fontVariantNumeric: 'tabular-nums',
}

const alertStyle: React.CSSProperties = {
  margin: 0,
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid var(--dsw-danger-color, #d14343)',
  color: 'var(--dsw-danger-color, #d14343)',
}

const listStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'grid',
  gap: 2,
}

const checkStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '14px minmax(0, 1fr)',
  columnGap: 6,
  alignItems: 'start',
  padding: '2px 0',
}

function statusColor(status: VerifyCheckStatus): string {
  if (status === 'pass') return 'var(--dsw-success-color, #2f8f4e)'
  if (status === 'fail') return 'var(--dsw-danger-color, #d14343)'
  return 'var(--dsw-warning-color, #c4811a)'
}

function statusSymbol(status: VerifyCheckStatus): string {
  if (status === 'pass') return '✓'
  if (status === 'fail') return '✗'
  return '–'
}

const statusStyle = (status: VerifyCheckStatus): React.CSSProperties => ({
  color: statusColor(status),
  fontWeight: 700,
})

const checkLabelStyle: React.CSSProperties = {
  margin: 0,
  font: '600 12px/1.4 system-ui, sans-serif',
  wordBreak: 'break-word',
}

const checkMessageStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.7,
  wordBreak: 'break-word',
}

const evidenceListStyle: React.CSSProperties = {
  margin: '4px 0 0',
  padding: 0,
  listStyle: 'none',
  display: 'grid',
  gap: 2,
}

const evidenceButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  minWidth: 0,
  textAlign: 'left',
  font: '11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace',
  padding: '2px 6px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
  borderRadius: 3,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Local wall-clock time; the raw ISO value if the browser cannot parse it. */
function formatRanAt(value: string, locale: Locale): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    return date.toLocaleTimeString(locale)
  } catch {
    return value
  }
}

function evidenceLabel(evidence: VerifyEvidence): string {
  if (evidence.kind === 'console') return `${evidence.level} · ${evidence.text}`
  const status = evidence.status === null ? evidence.outcome : String(evidence.status)
  return `${evidence.method} ${evidence.url} → ${status}`
}

function CheckRow({
  check,
  t,
  onOpenEvidence,
}: {
  readonly check: VerifyCheck
  readonly t: ReturnType<typeof createTranslator>
  readonly onOpenEvidence?: (evidence: VerifyEvidence) => void
}): React.ReactElement {
  const evidence = check.evidence ?? []
  return (
    <li
      data-vibe-verify-check={check.id}
      data-status={check.status}
      aria-label={`${t(`verify.check.${check.id}`)} · ${t(`verify.status.${check.status}`)}`}
      style={checkStyle}
    >
      <span aria-hidden="true" style={statusStyle(check.status)}>
        {statusSymbol(check.status)}
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={checkLabelStyle}>{t(`verify.check.${check.id}`)}</p>
        <p style={checkMessageStyle}>{check.message}</p>
        {evidence.length === 0 ? null : (
          <ul style={evidenceListStyle}>
            {evidence.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  data-vibe-verify-evidence={row.kind}
                  data-evidence-id={row.id}
                  aria-label={t(`verify.evidence.${row.kind}`, { text: evidenceLabel(row) })}
                  title={evidenceLabel(row)}
                  style={evidenceButtonStyle}
                  onClick={() => onOpenEvidence?.(row)}
                >
                  {evidenceLabel(row)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

export function VerifyPanel({
  locale,
  visible = true,
  ready,
  source = DEFAULT_SOURCE,
  onClose,
  onOpenEvidence,
}: VerifyPanelProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [result, setResult] = React.useState<VerifyResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [running, setRunning] = React.useState(false)
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      const value = await source.run()
      if (mounted.current) setResult(value)
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught))
    } finally {
      if (mounted.current) setRunning(false)
    }
  }

  const failed =
    result === null ? 0 : result.checks.filter((check) => check.status !== 'pass').length
  const summary =
    result === null
      ? null
      : failed === 0
        ? t('verify.summary.pass')
        : t('verify.summary.fail', { failed, total: result.checks.length })

  return (
    <section
      id="vibe-verify-drawer"
      data-vibe-verify="1"
      aria-label={t('verify.title')}
      style={rootStyle(visible)}
    >
      <div style={headerStyle}>
        <strong style={titleStyle}>{t('verify.title')}</strong>
        <button
          type="button"
          style={buttonStyle}
          disabled={running || !ready}
          onClick={() => void run()}
        >
          {running ? t('verify.running') : t('verify.run')}
        </button>
        {onClose ? (
          <button
            type="button"
            aria-label={t('preview.drawer.close')}
            style={buttonStyle}
            onClick={onClose}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div style={bodyStyle}>
        {error === null ? null : (
          <p role="alert" style={alertStyle}>
            {t('verify.error', { message: error })}
          </p>
        )}

        {result === null ? (
          <p style={noteStyle}>{ready ? t('verify.empty') : t('verify.notReady')}</p>
        ) : (
          <>
            <p style={metaStyle} role="status">
              {`${summary ?? ''} · ${formatRanAt(result.ranAt, locale ?? 'en')}`}
            </p>
            <ul style={listStyle} aria-label={t('verify.results')}>
              {result.checks.map((check) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  t={t}
                  onOpenEvidence={onOpenEvidence}
                />
              ))}
            </ul>
            {result.truncated ? (
              <p style={noteStyle}>{t('verify.truncated')}</p>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
