/**
 * Shared loading / empty / error views for the Studio shell. Later pages
 * reuse these instead of inventing their own states.
 */
import * as React from 'react'
import { createTranslator, DEFAULT_LOCALE, type Locale } from '../i18n'

const frame: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  alignContent: 'center',
  justifyItems: 'start',
  padding: 16,
  minHeight: 120,
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  font: '600 13px/1.4 system-ui, sans-serif',
}

const bodyStyle: React.CSSProperties = {
  margin: 0,
  font: '12px/1.5 system-ui, sans-serif',
  opacity: 0.75,
}

export function LoadingState({ label }: { readonly label: string }): React.ReactElement {
  return (
    <div role="status" aria-live="polite" style={frame} data-vibe-state="loading">
      <span style={titleStyle}>{label}</span>
    </div>
  )
}

export interface EmptyStateProps {
  readonly title: string
  readonly body?: string
  readonly action?: React.ReactNode
}

export function EmptyState({ title, body, action }: EmptyStateProps): React.ReactElement {
  return (
    <div style={frame} data-vibe-state="empty">
      <h3 style={titleStyle}>{title}</h3>
      {body ? <p style={bodyStyle}>{body}</p> : null}
      {action}
    </div>
  )
}

export interface ErrorStateProps {
  readonly title: string
  readonly body?: string
  readonly detail?: string
  readonly retryLabel?: string
  readonly onRetry?: () => void
}

export function ErrorState({
  title,
  body,
  detail,
  retryLabel,
  onRetry,
}: ErrorStateProps): React.ReactElement {
  return (
    <div role="alert" style={frame} data-vibe-state="error">
      <h3 style={titleStyle}>{title}</h3>
      {body ? <p style={bodyStyle}>{body}</p> : null}
      {detail ? (
        <code style={{ ...bodyStyle, fontFamily: 'ui-monospace, monospace' }}>{detail}</code>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          {retryLabel ?? 'Retry'}
        </button>
      ) : null}
    </div>
  )
}

export interface ShellErrorBoundaryProps {
  readonly children: React.ReactNode
  readonly locale?: Locale
  readonly fallback?: (error: Error, reset: () => void) => React.ReactNode
}

interface ShellErrorBoundaryState {
  readonly error: Error | null
}

/** Contains a page crash to the Studio panel instead of the whole sidebar. */
export class ShellErrorBoundary extends React.Component<
  ShellErrorBoundaryProps,
  ShellErrorBoundaryState
> {
  state: ShellErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ShellErrorBoundaryState {
    return { error }
  }

  private readonly reset = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)

    const t = createTranslator(this.props.locale ?? DEFAULT_LOCALE)
    return (
      <ErrorState
        title={t('state.error.title')}
        body={t('state.error.body')}
        detail={error.message}
        retryLabel={t('state.error.retry')}
        onRetry={this.reset}
      />
    )
  }
}
