/**
 * Request builder container (T038).
 *
 * Holds the draft, turns it into a wire spec on send, and shows what happened:
 * validation issues before the wire, the stable error code afterwards, then the
 * response itself (T039 `ResponseView`). Transport is injectable so the
 * component tests never touch the network.
 */
import * as React from 'react'
import {
  API_HTTP_SEND_METHOD,
  HTTP_TIMEOUT_DEFAULT_MS,
  type ApiAssertion,
  type ApiAssertionResult,
  type HttpExecutionResult,
  type HttpRequestSpec,
  type UnresolvedVariable,
} from '../../contracts/api'
import type { StudioError } from '../../contracts/errors'
import { createTranslator, type Locale } from '../i18n'
import { callUnary, toStudioError } from '../transport'
import {
  AssertionsEditor,
  buildAssertions,
  type AssertionDraft,
  type AssertionIssue,
} from './AssertionsEditor'
import { CurlPanel } from './CurlPanel'
import { useApiEnvironments } from './environment-store'
import { RequestForm } from './RequestForm'
import { ResponseView } from './ResponseView'
import { registerDraftTarget, type PendingDraft } from './draft-store'
import {
  buildRequestSpec,
  createRequestDraft,
  draftFromRequestSpec,
  type RequestDraft,
  type RequestIssue,
} from './request-model'
import type { ApiUiMode } from './ui-mode'

export interface ApiSendOutcome {
  readonly result: HttpExecutionResult
  readonly unresolved: readonly UnresolvedVariable[]
  /** Only present when the send carried assertions (T045). */
  readonly assertions?: readonly ApiAssertionResult[]
}

export interface ApiSendOptions {
  readonly signal?: AbortSignal
  /** Declarative checks evaluated host-side after the response (T045). */
  readonly assertions?: readonly ApiAssertion[]
  /** Saved environment to expand against (T046 R4); loaded host-side. */
  readonly environmentId?: string
}

export type ApiSend = (spec: HttpRequestSpec, options?: ApiSendOptions) => Promise<ApiSendOutcome>

/** Default sender: one unary call, with a transport window wider than the request. */
export function createTransportSend(): ApiSend {
  return (spec, options = {}) =>
    callUnary<ApiSendOutcome>(
      API_HTTP_SEND_METHOD,
      {
        request: spec,
        ...(options.assertions === undefined ? {} : { assertions: options.assertions }),
        ...(options.environmentId === undefined
          ? {}
          : { environmentId: options.environmentId }),
      },
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
  padding: '2px 0 0',
  font: '11px/1.4 system-ui, sans-serif',
}

const responseAreaStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  marginTop: 4,
  paddingTop: 10,
  borderTop: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.18))',
  minHeight: 120,
}

const responseTitleStyle: React.CSSProperties = {
  font: '600 11px/1.4 system-ui, sans-serif',
  opacity: 0.8,
  margin: 0,
}

const responseEmptyStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.55,
  padding: '12px 0',
}

const advancedStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 6,
  paddingTop: 8,
  borderTop: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.18))',
}

const buttonStyle: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--dsw-accent-color, #4f8cff)',
  borderRadius: 6,
  background: 'var(--dsw-accent-color, #4f8cff)',
  color: '#fff',
  cursor: 'pointer',
  font: '600 13px/1.4 system-ui, sans-serif',
  minHeight: 34,
  padding: '8px 16px',
  whiteSpace: 'nowrap',
}

/** Quiet text action: available, but never competing with Send. */
const quietButtonStyle: React.CSSProperties = {
  appearance: 'none',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.75,
  padding: '2px 2px',
  textDecoration: 'underline',
}

const statusStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.75,
}

const saveErrorStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  color: 'var(--dsw-color-danger, #c62828)',
}

const loadBoxStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 10,
  borderRadius: 6,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
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

const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  font: '11px/1.4 system-ui, sans-serif',
}

const noticeLineStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  wordBreak: 'break-word',
}

const dismissStyle: React.CSSProperties = {
  justifySelf: 'start',
  appearance: 'none',
  border: '1px solid currentColor',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: '11px/1.4 system-ui, sans-serif',
  padding: '1px 8px',
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'sent'; readonly outcome: ApiSendOutcome }
  | { readonly kind: 'failed'; readonly error: StudioError }
  | { readonly kind: 'cancelled' }

/** Persists the current request; rejects so the button can report failure. */
export type ApiSave = (spec: HttpRequestSpec) => Promise<void>

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly error: StudioError }

export interface RequestBuilderProps {
  readonly initialDraft?: RequestDraft
  readonly send?: ApiSend
  /** When provided, the footer grows a Save button (T044). */
  readonly save?: ApiSave
  /** Runs after a send settles, so the history list can refresh. */
  readonly onSent?: () => void
  readonly locale?: Locale
  /** U04: beginner hides cURL and result checks; professional shows them. */
  readonly mode?: ApiUiMode
  /** URL of the loopback sample request; fills an untouched, empty URL. */
  readonly sampleUrl?: string | null
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

function describeSaveFailure(
  error: StudioError,
  t: ReturnType<typeof createTranslator>,
): string {
  if (error.code === 'invalid_input') {
    if (error.details?.reason === 'collection_full') return t('api.collections.full')
    if (typeof error.details?.limitBytes === 'number') return t('api.request.error.tooLarge')
  }
  return t('api.request.saveFailed')
}

export function RequestBuilder({
  initialDraft,
  send,
  save,
  onSent,
  locale,
  mode = 'pro',
  sampleUrl = null,
}: RequestBuilderProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [draft, setDraft] = React.useState<RequestDraft>(() => initialDraft ?? createRequestDraft())
  // U04: the sample URL arrives a tick after mount; only fill a URL the user
  // has not touched and that came in empty (a replay/collection draft wins).
  const urlTouchedRef = React.useRef<boolean>((initialDraft?.url ?? '') !== '')
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })
  const [issues, setIssues] = React.useState<readonly RequestIssue[]>([])
  // T045: checks live beside the draft; results belong to one send, so editing
  // a row drops them rather than leaving a pass/fail badge on a changed rule.
  const [assertionDrafts, setAssertionDrafts] = React.useState<readonly AssertionDraft[]>([])
  const [assertionIssues, setAssertionIssues] = React.useState<readonly AssertionIssue[]>([])
  const [assertionResults, setAssertionResults] = React.useState<
    readonly ApiAssertionResult[] | null
  >(null)
  const [pending, setPending] = React.useState<PendingDraft | null>(null)
  const [saveState, setSaveState] = React.useState<SaveState>({ kind: 'idle' })
  const controllerRef = React.useRef<AbortController | null>(null)
  const defaultSend = React.useMemo(() => createTransportSend(), [])
  const sendImpl = send ?? defaultSend
  // FR-API-04: a saved environment is selected in the environment panel; the
  // send only names it, and the Host loads the document itself.
  const environmentId = useApiEnvironments().activeId

  React.useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  React.useEffect(() => {
    if (sampleUrl === null || sampleUrl === '') return
    setDraft((current) => {
      if (urlTouchedRef.current || current.url !== '') return current
      return { ...current, url: sampleUrl }
    })
  }, [sampleUrl])

  const handleDraftChange = React.useCallback(
    (next: RequestDraft): void => {
      if (next.url !== draft.url) urlTouchedRef.current = true
      setDraft(next)
    },
    [draft.url],
  )

  // T044: replay, the collection tree and the history list all hand a draft
  // over through one store. Registering also drains a draft that arrived while
  // the builder was unmounted (the T043 tab-switch case); a draft is loaded
  // into the form and never sent on its own.
  React.useEffect(
    () =>
      registerDraftTarget((next) => {
        urlTouchedRef.current = true
        setDraft(draftFromRequestSpec(next.spec))
        setIssues([])
        // Checks are kept (the same API is often re-tested) but their verdicts
        // came from the previous request, so they go.
        setAssertionResults(null)
        setAssertionIssues([])
        setPhase({ kind: 'idle' })
        setSaveState({ kind: 'idle' })
        setPending(next)
      }),
    [],
  )

  const sending = phase.kind === 'sending'
  const saving = saveState.kind === 'saving'
  const failure = phase.kind === 'failed' ? describeFailure(phase.error, t) : null
  const replayNotice = pending?.replay ?? null

  const handleSend = React.useCallback((): void => {
    if (sending) return
    const built = buildRequestSpec(draft)
    // A row that failed validation blocks the send: a typo must not turn a
    // check off silently.
    const checks = buildAssertions(assertionDrafts)
    if (!built.ok || checks.issues.length > 0) {
      setIssues(built.ok ? [] : built.issues)
      setAssertionIssues(checks.issues)
      setPhase({ kind: 'idle' })
      return
    }
    const assertions = checks.assertions ?? []
    setIssues([])
    setAssertionIssues([])
    setAssertionResults(null)
    const controller = new AbortController()
    controllerRef.current = controller
    setPhase({ kind: 'sending' })
    void sendImpl(built.spec, {
      signal: controller.signal,
      ...(assertions.length === 0 ? {} : { assertions }),
      ...(environmentId === null ? {} : { environmentId }),
    })
      .then((outcome) => {
        if (controller.signal.aborted) return
        setPhase({ kind: 'sent', outcome })
        setAssertionResults(outcome.assertions ?? null)
        onSent?.()
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          setPhase({ kind: 'cancelled' })
          return
        }
        setPhase({ kind: 'failed', error: toStudioError(error) })
        onSent?.()
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null
      })
  }, [assertionDrafts, draft, environmentId, onSent, sendImpl, sending])

  // FR-API-07: a parsed command becomes a draft exactly like a saved request
  // does — the form is filled, nothing is sent, and the notice says so.
  const handleCurlImport = React.useCallback((spec: HttpRequestSpec): void => {
    urlTouchedRef.current = true
    setDraft(draftFromRequestSpec(spec))
    setIssues([])
    setAssertionResults(null)
    setAssertionIssues([])
    setPhase({ kind: 'idle' })
    setSaveState({ kind: 'idle' })
    setPending({ spec, source: 'curl' })
  }, [])

  const handleAssertionsChange = React.useCallback((next: readonly AssertionDraft[]): void => {
    setAssertionDrafts(next)
    setAssertionIssues([])
    setAssertionResults(null)
  }, [])

  const handleSave = React.useCallback((): void => {
    if (save === undefined || saving) return
    const built = buildRequestSpec(draft)
    if (!built.ok) {
      setIssues(built.issues)
      setPhase({ kind: 'idle' })
      return
    }
    setIssues([])
    setSaveState({ kind: 'saving' })
    void save(built.spec)
      .then(() => setSaveState({ kind: 'saved' }))
      .catch((error: unknown) => setSaveState({ kind: 'error', error: toStudioError(error) }))
  }, [draft, save, saving])

  const handleCancel = React.useCallback((): void => {
    controllerRef.current?.abort()
  }, [])

  // U04: Send is the only loud control; the core row ends with it. Save and the
  // status lines sit on a quiet line right below so one screen holds one action.
  const coreAction = (
    <button
      type="button"
      style={buttonStyle}
      data-vibe-send="1"
      disabled={sending}
      onClick={handleSend}
    >
      {t('api.request.send')}
    </button>
  )

  const secondaryActions = (
    <div style={footerStyle} data-vibe-secondary-actions="1">
      {save === undefined ? null : (
        <button
          type="button"
          style={quietButtonStyle}
          data-vibe-save="1"
          disabled={sending || saving}
          onClick={handleSave}
        >
          {saving ? t('api.request.saving') : t('api.request.save')}
        </button>
      )}
      {sending ? (
        <button type="button" style={quietButtonStyle} data-vibe-cancel="1" onClick={handleCancel}>
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
      {saveState.kind === 'saved' ? (
        <span style={statusStyle} role="status" data-vibe-save-status="1">
          {t('api.request.saved')}
        </span>
      ) : null}
      {saveState.kind === 'error' ? (
        <span role="alert" style={saveErrorStyle} data-vibe-save-error="1">
          {describeSaveFailure(saveState.error, t)}
        </span>
      ) : null}
    </div>
  )

  return (
    <div style={rootStyle} data-vibe-request-builder="1">
      <RequestForm
        draft={draft}
        onChange={handleDraftChange}
        disabled={sending}
        locale={locale}
        onSubmit={handleSend}
        coreAction={coreAction}
        secondaryActions={secondaryActions}
      />

      {replayNotice !== null ? (
        <div style={warnBoxStyle} data-vibe-replay-notice="1">
          <strong style={{ font: '600 11px/1.4 system-ui, sans-serif' }}>
            {t('api.replay.notice.title')}
          </strong>
          <span style={noticeLineStyle}>{t('api.replay.notice.body')}</span>
          <span style={noticeLineStyle}>
            {t('api.replay.notice.source', {
              method: replayNotice.method,
              url: replayNotice.url,
            })}
          </span>
          {replayNotice.result.requiresConfirmation ? (
            <span style={noticeLineStyle}>
              {t('api.replay.notice.confirm', { method: replayNotice.method })}
            </span>
          ) : null}
          {replayNotice.result.warnings.length > 0 ? (
            <ul style={listStyle}>
              {replayNotice.result.warnings.map((warning) => (
                <li key={warning}>
                  {t(`api.replay.warning.${warning}`, { method: replayNotice.method })}
                </li>
              ))}
            </ul>
          ) : null}
          {replayNotice.result.omittedHeaders.length > 0 ? (
            <span style={noticeLineStyle}>
              {t('api.replay.notice.omitted', {
                headers: replayNotice.result.omittedHeaders.join(', '),
              })}
            </span>
          ) : null}
          <button
            type="button"
            style={dismissStyle}
            data-vibe-replay-dismiss="1"
            onClick={() => setPending(null)}
          >
            {t('api.replay.notice.dismiss')}
          </button>
        </div>
      ) : pending === null ? null : (
        <div style={loadBoxStyle} data-vibe-load-notice="1">
          <span style={noticeLineStyle}>
            {pending.source === 'history'
              ? t('api.request.loaded.history')
              : pending.source === 'curl'
                ? t('api.request.loaded.curl')
                : t('api.request.loaded.saved')}
          </span>
          <button
            type="button"
            style={dismissStyle}
            data-vibe-load-dismiss="1"
            onClick={() => setPending(null)}
          >
            {t('api.replay.notice.dismiss')}
          </button>
        </div>
      )}

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

      {/* U04: the response is the centre of the screen, so it is always here and
          an untouched screen says what will appear rather than showing a void. */}
      <section style={responseAreaStyle} data-vibe-response-area="1" aria-label={t('api.response.title')}>
        <h3 style={responseTitleStyle}>{t('api.response.title')}</h3>
        {phase.kind === 'sent' ? (
          <ResponseView
            result={phase.outcome.result}
            {...(locale === undefined ? {} : { locale })}
          />
        ) : (
          <p style={responseEmptyStyle} data-vibe-response-empty="1">
            {t('api.response.empty')}
          </p>
        )}
        {phase.kind === 'sent' && phase.outcome.unresolved.length > 0 ? (
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
      </section>

      {mode === 'pro' ? (
        <div style={advancedStyle} data-vibe-advanced="1">
          <CurlPanel
            draft={draft}
            onImport={handleCurlImport}
            disabled={sending}
            {...(locale === undefined ? {} : { locale })}
          />
          <AssertionsEditor
            drafts={assertionDrafts}
            onChange={handleAssertionsChange}
            {...(assertionResults === null ? {} : { results: assertionResults })}
            issues={assertionIssues}
            disabled={sending}
            {...(locale === undefined ? {} : { locale })}
          />
        </div>
      ) : null}
    </div>
  )
}
