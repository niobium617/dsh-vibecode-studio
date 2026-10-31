/**
 * T059 redaction audit (SPEC §9 "never print secrets", FR-SEC-03/04).
 *
 * This suite exercises the shipped helpers end to end rather than unit-testing
 * them again: what leaves the host for the model or for disk must not contain a
 * secret even when the secret sits under an innocent parameter name.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { REDACTED, redactHeaders, redactJsonBody, redactUrl } from '../../src/contracts/redact'
import type { HttpExecutionResult } from '../../src/contracts/api'
import { redactExecutionResult } from '../../src/host/api/result-redaction'
import { createApiSecretStore, type CredentialProviderLike } from '../../src/host/api/secrets'
import { ApiHistoryStore } from '../../src/host/api/history-store'
import { createStatusHandler } from '../../src/host/agent/tools/status'
import { createObserveHandler } from '../../src/host/agent/tools/observe'
import type { PreviewSessionSnapshot } from '../../src/contracts/transport'

const SECRET = 's3cret-token-value'
const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('redaction primitives', () => {
  it('masks sensitive headers, query values and credentials', () => {
    expect(
      redactHeaders({
        Authorization: `Bearer ${SECRET}`,
        Cookie: `sid=${SECRET}`,
        'X-Api-Key': SECRET,
        'Content-Type': 'application/json',
      }),
    ).toEqual({
      Authorization: REDACTED,
      Cookie: REDACTED,
      'X-Api-Key': REDACTED,
      'Content-Type': 'application/json',
    })

    const output = redactUrl(`https://user:${SECRET}@example.test/path?token=${SECRET}&q=1`)
    expect(output).not.toContain(SECRET)
    expect(output).toContain('q=1')
  })

  it('masks a token in the fragment but leaves a plain anchor alone (F6)', () => {
    const withToken = redactUrl('http://127.0.0.1:4320/callback#access_token=abc123&state=xy')
    expect(withToken).not.toContain('abc123')
    expect(withToken).toContain('access_token=REDACTED')
    expect(withToken).toContain('state=xy')

    expect(redactUrl('http://127.0.0.1:4320/docs#installation')).toBe(
      'http://127.0.0.1:4320/docs#installation',
    )
    // A hash-router fragment keeps its encoding.
    expect(redactUrl('http://127.0.0.1:4320/app#/settings?tab=api')).toBe(
      'http://127.0.0.1:4320/app#/settings?tab=api',
    )
  })

  it('keeps {{variable}} placeholders while masking literal values', () => {
    expect(redactUrl('http://127.0.0.1:4320/?token={{apiToken}}&api_key=literal')).toBe(
      'http://127.0.0.1:4320/?token={{apiToken}}&api_key=REDACTED',
    )
  })

  it('redacts nested JSON without mutating the input', () => {
    const input = { user: { password: SECRET }, items: [{ accessToken: SECRET }], name: 'Ada' }
    const output = redactJsonBody(input) as Record<string, unknown>
    expect(output).toMatchObject({
      user: { password: REDACTED },
      items: [{ accessToken: REDACTED }],
      name: 'Ada',
    })
    expect(input.user.password).toBe(SECRET)
  })
})

describe('execution result scrubbing', () => {
  const result: HttpExecutionResult = {
    status: 200,
    statusText: 'OK',
    url: `http://127.0.0.1:4320/items/${SECRET}?session=${SECRET}&ok=1`,
    redirects: [
      {
        status: 302,
        url: `http://127.0.0.1:4320/start?token=${SECRET}`,
        location: `http://127.0.0.1:4320/items/${SECRET}`,
      },
    ],
    headers: { 'content-type': 'application/json', 'set-cookie': REDACTED },
    elapsedMs: 4,
    body: {
      text: `{"password":"${SECRET}"}`,
      base64: '',
      bytes: 30,
      truncated: false,
      contentType: 'application/json',
    },
  }

  it('removes host-resolved secrets from the final URL and every hop', () => {
    const output = redactExecutionResult(result, [SECRET])
    const urls = [output.url, ...output.redirects.flatMap((hop) => [hop.url, hop.location])]

    for (const value of urls) expect(value).not.toContain(SECRET)
    expect(output.url).toContain('session=REDACTED')
    expect(output.url).toContain('ok=1')
    // The response body is target data, not a request the host built.
    expect(output.body.text).toContain(SECRET)
  })
})

describe('credential seam', () => {
  it('describe() never returns the value', async () => {
    const provider: CredentialProviderLike = {
      async resolve() {
        return { value: SECRET, source: 'environment' }
      },
      async describe() {
        return { configured: true, source: 'environment', writable: false }
      },
      async set() {},
      async unset() {},
    }
    const store = createApiSecretStore({ credentials: provider })
    const description = await store.describe('API_TOKEN')

    expect(description).toEqual({ configured: true, source: 'environment', writable: false })
    expect(JSON.stringify(description)).not.toContain(SECRET)
    expect(await store.resolve('API_TOKEN')).toBe(SECRET)
  })

  it('reads as unavailable without a provider instead of inventing a store', async () => {
    const store = createApiSecretStore()
    expect(store.available).toBe(false)
    expect(await store.describe('API_TOKEN')).toEqual({ configured: false, writable: false })
    await expect(store.set('API_TOKEN', 'x')).rejects.toMatchObject({
      code: 'permission_denied',
    })
  })
})

describe('persistence on disk', () => {
  it('writes no plaintext secret into history.json', async () => {
    const dir = await mkdtemp(resolve('.tmp', 'security-redaction-'))
    tempDirs.push(dir)
    const store = new ApiHistoryStore(dir, {
      now: () => new Date('2026-10-31T00:00:00.000Z'),
      nextId: () => 'entry-1',
    })

    await store.append(
      {
        method: 'POST',
        url: `http://127.0.0.1:4320/items?token=${SECRET}&q=1`,
        headers: [{ name: 'Authorization', value: `Bearer ${SECRET}` }],
        body: { kind: 'json', text: JSON.stringify({ password: SECRET, name: 'Ada' }) },
        auth: { kind: 'api-key', in: 'header', name: 'X-Api-Key', value: SECRET },
      },
      { status: 201 },
    )

    const text = await readFile(join(dir, '.vibe', 'api', 'history.json'), 'utf8')
    expect(text).not.toContain(SECRET)
    expect(text).toContain(REDACTED)
    expect(text).toContain('Ada')
  })
})

const preview: PreviewSessionSnapshot = {
  status: 'ready',
  targetId: 'fixture',
  kind: 'web',
  url: `http://127.0.0.1:4320/app?token=${SECRET}`,
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  capabilities: null,
  frame: null,
  fps: 12,
  quality: 60,
}

const emptyBuffer = { entries: [], lastSeq: 0, dropped: 0 } as const

describe('agent tool output', () => {
  it('vibe_status redacts the preview URL before the model sees it', async () => {
    const status = createStatusHandler({
      preview: {
        status: () => preview,
        consoleList: () => emptyBuffer,
        networkList: () => emptyBuffer,
      },
      annotations: { list: async () => ({ total: 0 }) },
    })
    const output = await status({}, {} as never)

    expect(output.target?.url).toBe('http://127.0.0.1:4320/app?token=REDACTED')
    expect(output.summary).toContain('token=REDACTED')
    expect(JSON.stringify(output)).not.toContain(SECRET)
  })

  it('vibe_observe redacts the preview URL in its summary', async () => {
    const observe = createObserveHandler({
      preview: {
        status: () => preview,
        consoleList: () => emptyBuffer,
        networkList: () => emptyBuffer,
        domSnapshot: async () => ({ selector: null, nodeCount: 0, outline: '', truncated: false }),
      },
    })
    const output = await observe({ include: ['console'] }, {} as never)

    expect(output.summary).toContain('token=REDACTED')
    expect(output.summary).not.toContain(SECRET)
  })
})
