/**
 * T038: store failures reach the panel as stable StudioError codes, and no
 * absolute path from the host filesystem leaks into the message.
 */
import { describe, expect, it } from 'vitest'
import { ApiStoreError, toApiStoreStudioError } from '../../../src/host'

describe('toApiStoreStudioError', () => {
  it('keeps invalid and missing entries distinct', () => {
    expect(toApiStoreStudioError(new ApiStoreError('invalid_id', 'vibe-studio: "a b" is not a usable collection id'))).toEqual({
      code: 'invalid_input',
      message: 'vibe-studio: invalid API store id',
      details: { reason: 'invalid_id' },
    })
    expect(toApiStoreStudioError(new ApiStoreError('not_found', 'vibe-studio: missing'))).toMatchObject({
      code: 'not_found',
      details: { reason: 'not_found' },
    })
  })

  it('never forwards the host path', () => {
    const error = new ApiStoreError('io', 'vibe-studio: cannot read collection x: C:\\Users\\me\\project')
    const mapped = toApiStoreStudioError(error)
    expect(mapped.code).toBe('internal')
    expect(JSON.stringify(mapped)).not.toContain('C:\\Users')
  })

  it('maps outside-project storage to permission_denied and unknown errors to internal', () => {
    expect(
      toApiStoreStudioError(new ApiStoreError('path_outside_project', 'vibe-studio: outside')).code,
    ).toBe('permission_denied')
    expect(toApiStoreStudioError(new Error('boom'))).toEqual({
      code: 'internal',
      message: 'vibe-studio: API storage failed',
      details: { reason: 'unknown' },
    })
  })
})
