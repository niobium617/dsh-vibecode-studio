/**
 * Capture replay button (T043).
 *
 * Lives in one expanded network row. It only ever asks the Host for a draft
 * and hands that draft to the request builder — there is no send path here.
 * Non-idempotent methods open a confirmation first, and the Host refuses the
 * same methods without `confirm`, so a UI regression cannot auto-replay.
 */
import * as React from 'react'
import {
  API_REPLAY_PREPARE_METHOD,
  requiresReplayConfirmation,
  type ApiReplayResult,
} from '../../contracts/api'
import type { StudioError } from '../../contracts/errors'
import type { NetworkEntry } from '../../contracts/telemetry'
import { createTranslator, type Locale } from '../i18n'
import { callUnary, toStudioError } from '../transport'
import { setActiveTab } from '../shell/store'

export interface PendingReplay {
  readonly entryId: string
  readonly method: string
  readonly url: string
  readonly result: ApiReplayResult
}

let pendingReplay: PendingReplay | null = null

/** Stores the draft the builder consumes after the tab switch. */
export function setPendingReplay(value: PendingReplay): void {
  pendingReplay = value
}

/** Returns the pending draft once; a second call sees nothing to load. */
export function takePendingReplay(): PendingReplay | null {
  const value = pendingReplay
  pendingReplay = null
  return value
}

/** Test helper between cases. */
export function resetReplayStore(): void {
  pendingReplay = null
}

/**
 * Only the fields replay reads. Response data would waste the 64 KiB unary
 * envelope and has no bearing on the draft.
 */
export function replayEntryOf(entry: NetworkEntry): NetworkEntry {
  return {
    id: entry.id,
    method: entry.method,
    url: entry.url,
    status: null,
    outcome: 'pending',
    resourceType: null,
    startedAt: entry.startedAt,
    durationMs: null,
    ...(entry.requestHeaders === undefined ? {} : { requestHeaders: entry.requestHeaders }),
    ...(entry.requestBody === undefined ? {} : { requestBody: entry.requestBody }),
    ...(entry.requestBodyTruncated === true ? { requestBodyTruncated: true } : {}),
    ...(entry.requestBodyUnavailable === true ? { requestBodyUnavailable: true } : {}),
  }
}

export type ReplayPrepare = (entry: NetworkEntry, confirm: boolean) => Promise<ApiReplayResult>

export function createReplayPrepare(): ReplayPrepare {
  return (entry, confirm) =>
    callUnary<ApiReplayResult>(API_REPLAY_PREPARE_METHOD, {
      entry: replayEntryOf(entry),
      ...(confirm ? { confirm: true } : {}),
    })
}

const rootStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
}

const buttonStyle: React.CSSProperties = {
  justifySelf: 'start',
  font: 'inherit',
  padding: '3px 10px',
  border: '1px solid var(--dsw-accent-color, #4f8cff)',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const hintStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.7,
}

const errorStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--dsw-color-danger, #c62828)',
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(0, 0, 0, 0.45)',
}

const dialogStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  width: 'min(320px, 100%)',
  boxSizing: 'border-box',
  padding: 12,
  borderRadius: 8,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  background: 'var(--dsw-surface-color, Canvas)',
  color: 'var(--dsw-text-primary, CanvasText)',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.35)',
  font: '12px/1.5 system-ui, sans-serif',
}

const dialogTitleStyle: React.CSSProperties = {
  margin: 0,
  font: '600 13px/1.4 system-ui, sans-serif',
}

const dialogBodyStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.8,
  wordBreak: 'break-word',
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  justifyContent: 'flex-end',
}

const actionStyle: React.CSSProperties = {
  font: 'inherit',
  padding: '3px 10px',
  borderRadius: 4,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

function describeError(
  error: StudioError,
  t: ReturnType<typeof createTranslator>,
): { readonly title: string; readonly detail: string | null } {
  const message = error.message.replace(/^vibe-studio:\s*/, '')
  if (error.code === 'permission_denied') {
    return { title: t('api.replay.error.blocked'), detail: null }
  }
  if (error.code === 'invalid_input') {
    if (typeof error.details?.limitBytes === 'number') {
      return { title: t('api.replay.error.tooLarge'), detail: null }
    }
    return { title: t('api.replay.error.invalid'), detail: message === '' ? null : message }
  }
  return { title: t('api.replay.error.failed'), detail: null }
}

export interface ReplayButtonProps {
  readonly entry: NetworkEntry
  readonly locale?: Locale
  /** Test seam; defaults to the unary transport. */
  readonly prepare?: ReplayPrepare
  /** Test seam; defaults to switching to the workbench page. */
  readonly openWorkbench?: () => void
}

export function ReplayButton({
  entry,
  locale,
  prepare,
  openWorkbench,
}: ReplayButtonProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const prepareImpl = React.useMemo(() => prepare ?? createReplayPrepare(), [prepare])
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<StudioError | null>(null)
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const method = entry.method.toUpperCase()
  const failure = error === null ? null : describeError(error, t)

  const run = React.useCallback(
    async (confirm: boolean): Promise<void> => {
      if (busy) return
      setBusy(true)
      setError(null)
      try {
        const result = await prepareImpl(entry, confirm)
        if (!mounted.current) return
        setPendingReplay({ entryId: entry.id, method, url: entry.url, result })
        setConfirming(false)
        if (openWorkbench === undefined) setActiveTab('api')
        else openWorkbench()
      } catch (caught) {
        if (!mounted.current) return
        setConfirming(false)
        setError(toStudioError(caught))
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    [busy, entry, method, openWorkbench, prepareImpl],
  )

  const handleClick = (): void => {
    if (requiresReplayConfirmation(method)) {
      setConfirming(true)
      return
    }
    void run(false)
  }

  return (
    <div style={rootStyle} data-vibe-replay="1">
      <button
        type="button"
        style={buttonStyle}
        data-vibe-replay-button="1"
        disabled={busy}
        onClick={handleClick}
      >
        {busy ? t('api.replay.preparing') : t('api.replay.button')}
      </button>
      <p style={hintStyle}>{t('api.replay.hint')}</p>
      {failure === null ? null : (
        <p role="alert" style={errorStyle} data-vibe-replay-error="1">
          {failure.title}
          {failure.detail === null ? null : ` ${failure.detail}`}
        </p>
      )}

      {confirming ? (
        <div
          data-vibe-replay-dialog="1"
          style={overlayStyle}
          onClick={(event) => {
            if (event.target !== event.currentTarget || busy) return
            setConfirming(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-replay-dialog-title"
            aria-describedby="vibe-replay-dialog-body"
            style={dialogStyle}
          >
            <h4 id="vibe-replay-dialog-title" style={dialogTitleStyle}>
              {t('api.replay.confirm.title', { method })}
            </h4>
            <p id="vibe-replay-dialog-body" style={dialogBodyStyle}>
              {t('api.replay.confirm.body', { method, url: entry.url })}
            </p>
            <div style={actionsStyle}>
              <button
                type="button"
                style={actionStyle}
                data-vibe-replay-cancel="1"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                {t('api.replay.confirm.cancel')}
              </button>
              <button
                type="button"
                style={{ ...actionStyle, borderColor: 'var(--dsw-danger-color, #d14343)' }}
                data-vibe-replay-confirm="1"
                disabled={busy}
                onClick={() => void run(true)}
              >
                {busy ? t('api.replay.preparing') : t('api.replay.confirm.action', { method })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
