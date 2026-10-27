/**
 * T025 client lifecycle: only a panel teardown with a live Host session calls
 * stop, and the flag is cleared even when the call fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW_STOP_METHOD } from '../../../src/contracts/transport'

const mocks = vi.hoisted(() => ({ callUnary: vi.fn() }))

vi.mock('../../../src/client/transport/client', () => ({
  callUnary: mocks.callUnary,
}))

import {
  PREVIEW_STOP_TIMEOUT_MS,
  isPreviewActive,
  markPreviewActive,
  stopPreviewSession,
} from '../../../src/client/preview/lifecycle'

afterEach(() => {
  markPreviewActive(false)
  mocks.callUnary.mockReset()
})

describe('preview lifecycle (T025)', () => {
  it('does nothing when no session was marked active', async () => {
    await stopPreviewSession()
    expect(mocks.callUnary).not.toHaveBeenCalled()
  })

  it('stops an active session once and clears the flag', async () => {
    markPreviewActive(true)
    expect(isPreviewActive()).toBe(true)

    await stopPreviewSession()
    expect(mocks.callUnary).toHaveBeenCalledWith(PREVIEW_STOP_METHOD, undefined, {
      timeoutMs: PREVIEW_STOP_TIMEOUT_MS,
    })
    expect(isPreviewActive()).toBe(false)

    await stopPreviewSession()
    expect(mocks.callUnary).toHaveBeenCalledTimes(1)
  })

  it('swallows a failed stop and still clears the flag', async () => {
    markPreviewActive(true)
    mocks.callUnary.mockRejectedValueOnce(new Error('host gone'))

    await expect(stopPreviewSession()).resolves.toBeUndefined()
    expect(isPreviewActive()).toBe(false)
  })
})
