/**
 * T043 bridge test: the host returns a spec, the workbench turns it into form
 * rows, and building those rows again must give the same spec back — including
 * captured query/header rows and body type.
 */
import { describe, expect, it } from 'vitest'
import { buildRequestSpec, draftFromRequestSpec } from '../../../src/client/api/request-model'
import type { HttpRequestSpec } from '../../../src/contracts/api'
import { prepareReplay } from '../../../src/host/api/replay'
import type { NetworkEntry } from '../../../src/contracts/telemetry'

function entry(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    id: 'network-1',
    method: 'GET',
    url: 'http://127.0.0.1:4320/api/items',
    status: 200,
    outcome: 'success',
    resourceType: 'XHR',
    startedAt: '2023-11-14T22:13:20.000Z',
    durationMs: 12,
    ...overrides,
  }
}

function rebuild(spec: HttpRequestSpec): HttpRequestSpec {
  const draft = draftFromRequestSpec(spec)
  const built = buildRequestSpec(draft)
  if (!built.ok) throw new Error(`draft did not rebuild: ${JSON.stringify(built.issues)}`)
  return built.spec
}

describe('draftFromRequestSpec round trip', () => {
  it('rebuilds a captured JSON POST unchanged', () => {
    const replay = prepareReplay(
      entry({
        method: 'POST',
        requestHeaders: { 'content-type': 'application/json', 'x-request-id': 'abc' },
        requestBody: '{"name":"book"}',
      }),
      { confirm: true },
    )

    expect(rebuild(replay.draft)).toEqual(replay.draft)
  })

  it('rebuilds a captured text body with its content type', () => {
    const replay = prepareReplay(
      entry({
        method: 'PUT',
        requestHeaders: { 'content-type': 'text/plain; charset=utf-8' },
        requestBody: 'plain text',
      }),
      { confirm: true },
    )

    expect(rebuild(replay.draft)).toEqual(replay.draft)
  })

  it('rebuilds a spec without headers or body without adding spare rows', () => {
    const spec: HttpRequestSpec = { method: 'GET', url: 'http://127.0.0.1:4320/api/items' }

    expect(rebuild(spec)).toEqual(spec)
  })

  it('keeps query values byte-for-byte, including placeholders', () => {
    const spec: HttpRequestSpec = {
      method: 'GET',
      url: 'http://127.0.0.1:4320/api/items',
      query: [
        { name: 'tag', value: 'a b' },
        { name: 'token', value: '{{token}}' },
      ],
    }

    expect(rebuild(spec)).toEqual(spec)
  })

  it('keeps a form body and its disabled rows', () => {
    const spec: HttpRequestSpec = {
      method: 'POST',
      url: 'http://127.0.0.1:4320/api/items',
      body: {
        kind: 'form',
        fields: [
          { name: 'name', value: 'book' },
          { name: 'draft', value: 'x', enabled: false },
        ],
      },
    }

    expect(rebuild(spec)).toEqual(spec)
  })

  it('keeps bearer auth', () => {
    const spec: HttpRequestSpec = {
      method: 'GET',
      url: 'http://127.0.0.1:4320/api/items',
      auth: { kind: 'bearer', token: '{{token}}' },
    }

    expect(rebuild(spec)).toEqual(spec)
  })
})
