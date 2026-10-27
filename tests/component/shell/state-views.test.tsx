// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  ShellErrorBoundary,
} from '../../../src/client/shell/StateViews'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('state views', () => {
  it('announces loading with a status role', () => {
    render(<LoadingState label="Loading…" />)

    expect(screen.getByRole('status').textContent).toBe('Loading…')
  })

  it('renders an empty state with an optional action', () => {
    render(
      <EmptyState
        title="Nothing here yet"
        body="Come back later."
        action={<button type="button">Open</button>}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Nothing here yet' })).toBeTruthy()
    expect(screen.getByText('Come back later.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
  })

  it('renders an error state with a retry callback', () => {
    let retries = 0
    render(
      <ErrorState
        title="Something went wrong"
        detail="boom"
        retryLabel="Retry"
        onRetry={() => {
          retries += 1
        }}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('Something went wrong')
    expect(screen.getByText('boom')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retries).toBe(1)
  })
})

describe('ShellErrorBoundary', () => {
  it('contains a render error and recovers after retry', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true

    function Boom(): React.ReactElement {
      if (shouldThrow) throw new Error('kaboom')
      return <p>recovered</p>
    }

    render(
      <ShellErrorBoundary locale="en">
        <Boom />
      </ShellErrorBoundary>,
    )

    expect(screen.getByRole('alert').textContent).toContain('Something went wrong')
    expect(screen.getByText('kaboom')).toBeTruthy()

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(screen.getByText('recovered')).toBeTruthy()
    expect(consoleError).toHaveBeenCalled()
  })
})
