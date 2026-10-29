/**
 * T042 remote `$ref` policy: no network by default, loopback only when asked,
 * redirects refused, sizes capped, one fetch per document and nested refs
 * gated by the same policy.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importOpenApi } from '../../../src/host/api/openapi/mapper'
import type { OpenApiFetch } from '../../../src/host/api/openapi/resolver'

type Handler = (request: IncomingMessage, response: ServerResponse) => void

let server: ReturnType<typeof createServer> | null = null
let baseUrl = ''
let hits: string[] = []

async function startServer(handler: Handler): Promise<void> {
  hits = []
  server = createServer((request, response) => {
    hits.push(request.url ?? '')
    handler(request, response)
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  if (server !== null) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    )
    server = null
  }
})

beforeEach(() => {
  baseUrl = ''
})

function documentWithRef(ref: string): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Remote', version: '1' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/things': {
        post: {
          requestBody: {
            content: { 'application/json': { schema: { $ref: ref } } },
          },
        },
      },
    },
  })
}

const REMOTE_SCHEMA = JSON.stringify({
  components: {
    schemas: { Thing: { type: 'object', properties: { id: { type: 'string' } } } },
  },
})

describe('remote $ref policy', () => {
  it('refuses a public remote ref before any fetch when the policy is default', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('must not be called')
    })
    await expect(
      importOpenApi(documentWithRef('https://example.com/schema.json#/components/schemas/Thing'), {
        fetch: fetchSpy as unknown as OpenApiFetch,
      }),
    ).rejects.toMatchObject({ code: 'remote_ref_blocked' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses loopback unless allowLoopback is set', async () => {
    await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(REMOTE_SCHEMA)
    })
    const fetchSpy = vi.fn(async () => {
      throw new Error('must not be called')
    })
    await expect(
      importOpenApi(documentWithRef(`${baseUrl}/schema.json#/components/schemas/Thing`), {
        fetch: fetchSpy as unknown as OpenApiFetch,
      }),
    ).rejects.toMatchObject({ code: 'remote_ref_blocked' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(hits).toEqual([])
  })

  it('fetches an allowed loopback document once and maps its schema', async () => {
    await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(REMOTE_SCHEMA)
    })
    const ref = `${baseUrl}/schema.json#/components/schemas/Thing`
    const doc = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Remote', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/one': { post: { requestBody: { content: { 'application/json': { schema: { $ref: ref } } } } } },
        '/two': { post: { requestBody: { content: { 'application/json': { schema: { $ref: ref } } } } } },
      },
    })
    const result = await importOpenApi(doc, { allowLoopback: true })
    expect(result.endpoints).toHaveLength(2)
    expect(result.endpoints[0]!.request.body).toEqual({
      kind: 'json',
      text: JSON.stringify({ id: 'string' }),
    })
    expect(result.remoteDocuments).toEqual([`${baseUrl}/schema.json`])
    expect(hits).toEqual(['/schema.json'])
  })

  it('refuses redirects instead of following them', async () => {
    await startServer((_request, response) => {
      response.writeHead(302, { location: 'http://metadata.google.internal/latest' })
      response.end()
    })
    await expect(
      importOpenApi(documentWithRef(`${baseUrl}/schema.json#/components/schemas/Thing`), {
        allowLoopback: true,
      }),
    ).rejects.toMatchObject({ code: 'remote_ref_redirect' })
    expect(hits).toEqual(['/schema.json'])
  })

  it('caps the remote document size', async () => {
    await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(REMOTE_SCHEMA)
    })
    await expect(
      importOpenApi(documentWithRef(`${baseUrl}/schema.json#/components/schemas/Thing`), {
        allowLoopback: true,
        maxBytes: 32,
      }),
    ).rejects.toMatchObject({ code: 'remote_ref_too_large' })
  })

  it('applies the same gate to refs nested inside a fetched document', async () => {
    await startServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      if (request.url === '/nested.json') {
        response.end(
          JSON.stringify({
            components: {
              schemas: {
                Thing: { $ref: 'https://example.com/other.json#/components/schemas/Thing' },
              },
            },
          }),
        )
        return
      }
      response.end(REMOTE_SCHEMA)
    })
    await expect(
      importOpenApi(documentWithRef(`${baseUrl}/nested.json#/components/schemas/Thing`), {
        allowLoopback: true,
      }),
    ).rejects.toMatchObject({ code: 'remote_ref_blocked' })
    expect(hits).toEqual(['/nested.json'])
  })

  it('reports a missing fragment in a fetched document', async () => {
    await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(REMOTE_SCHEMA)
    })
    await expect(
      importOpenApi(documentWithRef(`${baseUrl}/schema.json#/components/schemas/Nope`), {
        allowLoopback: true,
      }),
    ).rejects.toMatchObject({ code: 'ref_unresolved' })
  })

  it('blocks metadata hosts even when they would be explicitly allowed', async () => {
    await expect(
      importOpenApi(
        documentWithRef('http://169.254.169.254/latest/meta-data.json#/components/schemas/Thing'),
        { allowedOrigins: ['http://169.254.169.254'] },
      ),
    ).rejects.toMatchObject({ code: 'remote_ref_blocked' })
  })

  it('refuses relative external refs', async () => {
    await expect(
      importOpenApi(documentWithRef('./schema.json#/components/schemas/Thing'), {
        allowLoopback: true,
      }),
    ).rejects.toMatchObject({ code: 'remote_ref_blocked' })
  })
})
