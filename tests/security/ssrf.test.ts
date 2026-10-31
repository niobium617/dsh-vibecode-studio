/**
 * T059 SSRF audit (SPEC §9 "never reach metadata or link-local services").
 *
 * Findings F1–F3 from the audit are the regression targets here: trailing-dot
 * metadata FQDNs, IPv4-mapped/compatible IPv6 and cross-origin redirect hops.
 * The API executor is still an API client, so private LAN ranges stay allowed;
 * only metadata and link-local addresses are refused.
 */
import { describe, expect, it, vi } from 'vitest'
import { isStudioError } from '../../src/contracts/errors'
import type { HttpRequestSpec } from '../../src/contracts/api'
import { createHttpExecutor } from '../../src/host/api/executor'
import { isBlockedHost, normalizeHttpRequest } from '../../src/host/api/request'
import {
  assertRemoteAllowed,
  resolveRemotePolicy,
} from '../../src/host/api/openapi/resolver'
import { OpenApiError } from '../../src/host/api/openapi/parser'
import { importOpenApi } from '../../src/host/api/openapi/mapper'

const BLOCKED = [
  'metadata',
  'metadata.google.internal',
  'metadata.google.internal.',
  'METADATA.GOOG.',
  '169.254.169.254',
  '169.254.0.1',
  '100.100.100.200',
  '[::ffff:a9fe:a9fe]',
  '::ffff:a9fe:a9fe',
  '[::a9fe:a9fe]',
  '::a9fe:a9fe',
  'fe80::1',
  '[fe80::1]',
  'fd00:ec2::254',
  '',
]

const ALLOWED = [
  '127.0.0.1',
  'localhost',
  'example.com',
  '10.0.0.1',
  '192.168.1.10',
  '172.16.0.1',
  '8.8.8.8',
  'fe00::1',
]

describe('blocked host predicate', () => {
  it.each(BLOCKED)('blocks %s', (host) => {
    expect(isBlockedHost(host)).toBe(true)
  })

  it.each(ALLOWED)('allows %s', (host) => {
    expect(isBlockedHost(host)).toBe(false)
  })

  it('normalizes alternative IPv4 spellings before deciding', () => {
    for (const url of [
      'http://0xA9FEA9FE/',
      'http://2852039166/',
      'http://0251.0376.0251.0376/',
    ]) {
      expect(isBlockedHost(new URL(url).hostname)).toBe(true)
    }
  })
})

describe('request normalization', () => {
  it.each([
    'http://metadata.google.internal./latest/meta-data/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/',
    'http://100.100.100.200/latest/meta-data/',
  ])('refuses %s with permission_denied', (url) => {
    try {
      normalizeHttpRequest({ method: 'GET', url })
      throw new Error('expected normalizeHttpRequest to fail')
    } catch (error) {
      expect(isStudioError(error)).toBe(true)
      if (isStudioError(error)) {
        expect(error.code).toBe('permission_denied')
        expect(error.details).toMatchObject({ reason: 'blocked_host' })
      }
    }
  })

  it('still accepts loopback and normal public hosts', () => {
    expect(normalizeHttpRequest({ method: 'GET', url: 'http://127.0.0.1:4320/' }).url).toBe(
      'http://127.0.0.1:4320/',
    )
    expect(normalizeHttpRequest({ method: 'GET', url: 'https://example.com/x' }).url).toBe(
      'https://example.com/x',
    )
  })
})

describe('redirect handling', () => {
  function redirectExecutor(location: string) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as unknown as Record<string, string>,
      })
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location } })
      }
      return new Response('ok', { status: 200 })
    })
    return { executor: createHttpExecutor({ fetchImpl, now: () => 0 }), calls }
  }

  it.each(['http://169.254.169.254/latest/meta-data/', 'http://[::ffff:169.254.169.254]/'])(
    'refuses a redirect to %s before following it',
    async (location) => {
      const { executor, calls } = redirectExecutor(location)
      await expect(
        executor.execute({ method: 'GET', url: 'http://127.0.0.1:4320/start' }),
      ).rejects.toMatchObject({ code: 'permission_denied' })
      expect(calls).toHaveLength(1)
    },
  )

  it('drops secret headers on a cross-origin hop (F3)', async () => {
    const { executor, calls } = redirectExecutor('http://127.0.0.1:4321/next')
    const spec: HttpRequestSpec = {
      method: 'GET',
      url: 'http://127.0.0.1:4320/start',
      headers: [
        { name: 'Authorization', value: 'Bearer super-secret' },
        { name: 'Cookie', value: 'session=abc' },
        { name: 'X-Api-Key', value: 'key-super-secret' },
        { name: 'X-Trace', value: 'keep-me' },
      ],
    }
    const result = await executor.execute(spec)

    expect(result.status).toBe(200)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.headers).not.toHaveProperty('Authorization')
    expect(calls[1]?.headers).not.toHaveProperty('Cookie')
    expect(calls[1]?.headers).not.toHaveProperty('X-Api-Key')
    expect(calls[1]?.headers).toMatchObject({ 'X-Trace': 'keep-me' })
  })

  it('keeps credentials on a same-origin hop', async () => {
    const { executor, calls } = redirectExecutor('/next')
    await executor.execute({
      method: 'GET',
      url: 'http://127.0.0.1:4320/start',
      headers: [{ name: 'Authorization', value: 'Bearer super-secret' }],
    })
    expect(calls[1]?.headers).toMatchObject({ Authorization: 'Bearer super-secret' })
  })
})

describe('OpenAPI remote documents', () => {
  it('blocks metadata hosts even when the origin was explicitly allowed', () => {
    const policy = resolveRemotePolicy({ allowedOrigins: ['http://metadata.google.internal.'] })
    expect(() =>
      assertRemoteAllowed(new URL('http://metadata.google.internal./latest'), policy, undefined),
    ).toThrow(OpenApiError)
    expect(() =>
      assertRemoteAllowed(new URL('http://[::ffff:169.254.169.254]/'), policy, undefined),
    ).toThrow(OpenApiError)
  })

  it('refuses a public remote $ref before any socket is opened', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('must not be called')
    })
    const document = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Remote', version: '1' },
      paths: {
        '/things': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: 'https://example.com/schema.json#/Thing' },
                  },
                },
              },
            },
          },
        },
      },
    })

    await expect(
      importOpenApi(document, { fetch: fetchSpy as unknown as never }),
    ).rejects.toMatchObject({ code: 'remote_ref_blocked' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
