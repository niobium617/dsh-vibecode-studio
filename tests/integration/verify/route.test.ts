/**
 * T056 route: the panel reaches the T055 verification service through one
 * unary method on the shared authenticated transport. These cases exercise the
 * real registry and the real service; only the live preview is faked.
 */
import { describe, expect, it } from 'vitest'
import { utf8Bytes } from '../../../src/contracts/budget'
import { PREVIEW_VERIFY_RUN_METHOD } from '../../../src/contracts/transport'
import type { VerifyResult } from '../../../src/contracts/verify'
import { UnaryRegistry } from '../../../src/host/transport/unary'
import { registerVerifyMethods } from '../../../src/host/verify/route'
import { createVerifyService, type VerifyPreviewSource } from '../../../src/host/verify/service'
import {
  consoleSnapshot,
  domSnapshot,
  networkSnapshot,
  readySession,
} from './helpers'

const context = {
  request: new Request('http://127.0.0.1/api/vibe/request'),
  signal: new AbortController().signal,
}

function source(overrides: Partial<VerifyPreviewSource> = {}): VerifyPreviewSource {
  return {
    status: () => readySession(),
    domSnapshot: async () => domSnapshot(),
    consoleList: () => consoleSnapshot([{ level: 'info', text: 'mounted' }]),
    networkList: () => networkSnapshot([{ id: 'ok', status: 200 }]),
    ...overrides,
  }
}

function serviceFor(preview: VerifyPreviewSource) {
  return createVerifyService({ preview, now: () => 1_700_000_000_012 })
}

describe('preview.verify.run (T056)', () => {
  it('registers the method and answers with the fitted result', async () => {
    const registry = new UnaryRegistry()
    const unregister = registerVerifyMethods(registry, serviceFor(source()))
    expect(registry.has(PREVIEW_VERIFY_RUN_METHOD)).toBe(true)

    const response = await registry.dispatch(PREVIEW_VERIFY_RUN_METHOD, undefined, context)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ ok: true })
    const value = (response.body as { value: VerifyResult }).value
    expect(value.ok).toBe(true)
    expect(value.checks.map((check) => check.id)).toEqual([
      'target',
      'page',
      'console',
      'network',
    ])
    expect(utf8Bytes(JSON.stringify(value))).toBeLessThanOrEqual(4 * 1024)

    unregister()
    expect(registry.has(PREVIEW_VERIFY_RUN_METHOD)).toBe(false)
  })

  it('carries the buffer ids the panel needs for evidence jumps', async () => {
    const registry = new UnaryRegistry()
    const unregister = registerVerifyMethods(
      registry,
      serviceFor(
        source({
          consoleList: () => consoleSnapshot([{ level: 'error', text: 'boom' }]),
          networkList: () =>
            networkSnapshot([
              { id: 'ok', status: 200 },
              { id: 'boom', status: 500 },
            ]),
        }),
      ),
    )

    const response = await registry.dispatch(PREVIEW_VERIFY_RUN_METHOD, undefined, context)
    const value = (response.body as { value: VerifyResult }).value
    const consoleCheck = value.checks.find((check) => check.id === 'console')
    const networkCheck = value.checks.find((check) => check.id === 'network')

    expect(value.ok).toBe(false)
    expect(consoleCheck).toMatchObject({
      status: 'fail',
      evidence: [{ kind: 'console', id: 'console-1', level: 'error', text: 'boom' }],
    })
    expect(networkCheck).toMatchObject({
      status: 'fail',
      evidence: [{ kind: 'network', id: 'network-2', status: 500 }],
    })

    unregister()
  })

  it('reports an idle preview instead of failing the call', async () => {
    const registry = new UnaryRegistry()
    const unregister = registerVerifyMethods(
      registry,
      serviceFor(source({ status: () => readySession({ status: 'idle', url: null }) })),
    )

    const response = await registry.dispatch(PREVIEW_VERIFY_RUN_METHOD, undefined, context)
    const value = (response.body as { value: VerifyResult }).value
    expect(response.status).toBe(200)
    expect(value.ok).toBe(false)
    expect(value.checks[0]).toMatchObject({ id: 'target', status: 'fail' })

    unregister()
  })
})
