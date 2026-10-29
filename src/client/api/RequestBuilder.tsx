/**
 * Request builder container (T038).
 *
 * Holds the draft, turns it into a wire spec on send, and shows what happened:
 * validation issues before the wire, the stable error code afterwards. The
 * response viewer is T039 — this component only summarises status, time and
 * size so a send is visibly complete. Transport is injectable so the component
 * tests never touch the network.
 */
import * as React from 'react'
import {
  API_HTTP_SEND_METHOD,
  HTTP_TIMEOUT_DEFAULT_MS,
  type HttpExecutionResult,
  type HttpRequestSpec,
  type UnresolvedVariable,
} from '../../contracts/api'
import type { StudioError } from '../../contracts/errors'
import { createTranslator, type Locale } from '../i18n'
import { callUnary, toStudioError } from '../transport'
import { RequestForm } from './RequestForm'
import {
  buildRequestSpec,
  createRequestDraft,
  type RequestDraft,
  type RequestIssue,
} from './request-model'

export interface ApiSendOutcome {
  readonly result: HttpExecutionResult
  readonly unresolved: readonly UnresolvedVariable[]
}

export interface ApiSendOptions {
  readonly signal?: AbortSignal
}

export type ApiSend = (spec: HttpRequestSpec, options?: ApiSendOptions) => Promise<ApiSendOutcome>

/** Default sender: one unary call, with a transport window wider than the request. */
export function createTransportSend(): ApiSend {
  return (spec, options = {}) =>
    callUnary<ApiSendOutcome>(
      API_HTTP_SEND_METHOD,
      { request: spec },
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs: (spec.timeoutMs ?? HTTP_TIMEOUT_DEFAULT_MS) + 5_000,
      },
    )
}

const rootStyle: React.CSSProperties = {
  display: 'grid',
  gap: 0,
  minHeight: 0,
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  padding: '4px 0 0',
}

const buttonStyle: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--dsw-accent-color, #4f8cff)',
  borderRadius: 6,
  background: 'var(--dsw-accent-color, #4f8cff)',
  color: '#fff',
  cursor: 'pointer',
  font: '600 12px/1.4 system-ui, sans-serif',
  padding: '6px 12px',
}

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'transparent',
  color: 'inherit',
  borderColor: 'var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
}

const statusStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.75,
}

const boxStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 10,
  borderRadius: 6,
}

const issueBoxStyle: React.CSSProperties = {
  ...boxStyle,
  background: 'var(--dsw-color-danger-bg, rgba(198, 40, 40, 0.08))',
  color: 'var(--dsw-color-danger, #c62828)',
}

const warnBoxStyle: React.CSSProperties = {
  ...boxStyle,
  background: 'var(--dsw-color-warning-bg, rgba(178, 106, 0, 0.08))',
  color: 'var(--dsw-color-warning, #b26a00)',
}

const resultBoxStyle: React.CSSProperties = {
  ...boxStyle,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
  font: '12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace',
}

const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  font: '11px/1.4 system-ui, sans-serif',
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'sent'; readonly outcome: ApiSendOutcome }
  | { readonly kind: 'failed'; readonly error: StudioError }
  | { readonly kind: 'cancelled' }

export interface RequestBuilderProps {
  readonly initialDraft?: RequestDraft
  readonly send?: ApiSend
  readonly locale?: Locale
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function issueKey(issue: RequestIssue): string {
  return `${issue.code}\u0000${issue.field}`
}

function describeFailure(
  error: StudioError,
  t: ReturnType<typeof createTranslator>,
): { readonly title: string; readonly detail: string | null } {
  const detail = error.message === '' ? null : error.message
  if (error.code === 'timeout') return { title: t('api.request.error.timeout'), detail }
  if (error.code === 'permission_denied') return { title: t('api.request.error.blocked'), detail }
  if (error.code === 'network_error') {
    return { title: t('api.request.error.network'), detail }
  }
  if (error.code === 'invalid_input') {
    if (typeof error.details?.limitBytes === 'number') {
      return { title: t('api.request.error.tooLarge'), detail: null }
    }
    return { title: t('api.request.error.invalid'), detail }
  }
  return { title: t('api.request.error.internal'), detail }
}

export function RequestBuilder({
  initialDraft,
  send,
  locale,
}: RequestBuilderProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [draft, setDraft] = React.useState<RequestDraft>(() => initialDraft ?? createRequestDraft())
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })
  const [issues, setIssues] = React.useState<readonly RequestIssue[]>([])
  const controllerRef = React.useRef<AbortController | null>(null)
  const defaultSend = React.useMemo(() => createTransportSend(), [])
  const sendImpl = send ?? defaultSend

  React.useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  const sending = phase.kind === 'sending'
  const failure = phase.kind === 'failed' ? describeFailure(phase.error, t) : null

  const handleSend = React.useCallback((): void => {
    if (sending) return
    const built = buildRequestSpec(draft)
    if (!built.ok) {
      setIssues(built.issues)
      setPhase({ kind: 'idle' })
      return
    }
    setIssues([])
    const controller = new AbortController()
    controllerRef.current = controller
    setPhase({ kind: 'sending' })
    void sendImpl(built.spec, { signal: controller.signal })
      .then((outcome) => {
        if (controller.signal.aborted) return
        setPhase({ kind: 'sent', outcome })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          setPhase({ kind: 'cancelled' })
          return
        }
        setPhase({ kind: 'failed', error: toStudioError(error) })
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null
      })
  }, [draft, sendImpl, sending])

  const handleCancel = React.useCallback((): void => {
    controllerRef.current?.abort()
  }, [])

  const footer = (
    <div style={footerStyle}>
      <button
        type="button"
        style={buttonStyle}
        data-vibe-send="1"
        disabled={sending}
        onClick={handleSend}
      >
        {t('api.request.send')}
      </button>
      {sending ? (
        <button type="button" style={secondaryButtonStyle} data-vibe-cancel="1" onClick={handleCancel}>
          {t('api.request.cancel')}
        </button>
      ) : null}
      <span style={statusStyle} role="status" data-vibe-request-status="1">
        {phase.kind === 'sending'
          ? t('api.request.sending')
          : phase.kind === 'cancelled'
            ? t('api.request.cancelled')
            : ''}
      </span>
    </div>
  )

  return (
    <div style={rootStyle} data-vibe-request-builder="1">
      <RequestForm
        draft={draft}
        onChange={setDraft}
        disabled={sending}
        locale={locale}
        onSubmit={handleSend}
        footer={footer}
      />

      {issues.length > 0 ? (
        <div style={issueBoxStyle} role="alert" data-vibe-request-issues="1">
          <strong style={{ font: '600 11px/1.4 system-ui, sans-serif' }}>
            {t('api.request.issues.title')}
          </strong>
          <ul style={listStyle}>
            {issues.map((issue) => (
              <li key={issueKey(issue)}>
                {t(`api.request.issue.${issue.code}`, { field: issue.field })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {failure ? (
        <div style={issueBoxStyle} role="alert" data-vibe-request-error="1">
          <strong style={{ font: '600 11px/1.4 system-ui, sans-serif' }}>{failure.title}</strong>
          {failure.detail ? (
            <span style={{ font: '11px/1.4 system-ui, sans-serif' }}>{failure.detail}</span>
          ) : null}
        </div>
      ) : null}

      {phase.kind === 'sent' ? (
        <>
          <div style={resultBoxStyle} role="status" data-vibe-request-result="1">
            {t('api.request.result.summary', {
              status: phase.outcome.result.status,
              statusText: phase.outcome.result.statusText,
              elapsed: phase.outcome.result.elapsedMs,
              bytes: formatBytes(phase.outcome.result.body.bytes),
            })}
            {phase.outcome.result.body.truncated ? ` ${t('api.request.result.truncated')}` : ''}
          </div>
          {phase.outcome.unresolved.length > 0 ? (
            <div style={warnBoxStyle} data-vibe-request-unresolved="1">
              <strong style={{ font: '600 11px/1.4 system-ui, sans-serif' }}>
                {t('api.env.unresolved.title')}
              </strong>
              <ul style={listStyle}>
                {phase.outcome.unresolved.map((item) => (
                  <li key={`${item.name}\u0000${item.where}`}>
                    {t('api.env.unresolved.row', { name: item.name, where: item.where })}{' '}
                    {t(`api.env.reason.${item.reason}`)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
