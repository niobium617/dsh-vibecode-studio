/**
 * T035 executor against a real local echo server: bodies survive the wire in
 * every encoding, redirects follow/stop by policy, oversized responses are
 * truncated while streaming, and cancellation plus timeout close the socket
 * instead of leaving a request in flight.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type HttpExecutionResult,
  type HttpRequestSpec,
} from '../../../src/contracts/api'
import type { StudioError } from '../../../src/contracts/errors'
import { HttpExecutor } from '../../../src/host/api/executor'

interface SeenRequest {
  readonly method: string
  readonly url: string
  readonly headers: IncomingMessage['headers']
  readonly body: string
}

let server: Server
let baseUrl: string
let seen: SeenRequest[]
let hangingClosed: number

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  const body = await readBody(req)
  seen.push({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, body })

  switch (path) {
    case '/echo':
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'session=abc' })
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }))
      return
    case '/bytes': {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length) })
      res.end(png)
      return
    }
    case '/missing':
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    case '/empty':
      res.writeHead(204)
      res.end()
      return
    case '/redirect302':
    case '/redirect303':
    case '/redirect307': {
      const status = Number(path.slice('/redirect'.length))
      res.writeHead(status, { location: '/echo' })
      res.end()
      return
    }
    case '/loop':
      res.writeHead(302, { location: '/loop' })
      res.end()
      return
    case '/to-metadata':
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
      res.end()
      return
    case '/big': {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('a'.repeat(64 * 1024))
      return
    }
    case '/hang': {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.flushHeaders()
      // `res` closes only when the client tears the connection down, which is
      // exactly what cancellation and timeout must do.
      res.on('close', () => {
        hangingClosed += 1
      })
      return
    }
    default:
      res.writeHead(404)
      res.end()
  }
}

beforeEach(async () => {
  seen = []
  hangingClosed = 0
  server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function request(overrides: Partial<HttpRequestSpec> = {}): HttpRequestSpec {
  return { method: 'GET', url: `${baseUrl}/echo`, ...overrides }
}

async function rejection(run: () => Promise<unknown>): Promise<StudioError> {
  try {
    await run()
  } catch (error) {
    return error as StudioError
  }
  throw new Error('expected the request to reject')
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition was not met in time')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('HttpExecutor', () => {
  it('sends a JSON body and returns the echo with redacted headers', async () => {
    const executor = new HttpExecutor()
    const result = await executor.execute(
      request({
        method: 'POST',
        url: `${baseUrl}/echo?existing=1`,
        query: [{ name: 'q', value: 'a b' }],
        headers: [{ name: 'X-Trace', value: 'on' }],
        body: { kind: 'json', text: '{"hello":"世界"}' },
      }),
    )

    expect(result.status).toBe(200)
    expect(result.url).toBe(`${baseUrl}/echo?existing=1&q=a+b`)
    expect(result.redirects).toEqual([])
    expect(result.headers['set-cookie']).toBe('REDACTED')
    expect(typeof result.elapsedMs).toBe('number')
    expect(result.body.truncated).toBe(false)

    const echoed = JSON.parse(result.body.text ?? 'null') as {
      method: string
      url: string
      headers: Record<string, string>
      body: string
    }
    expect(echoed.method).toBe('POST')
    expect(echoed.url).toBe('/echo?existing=1&q=a+b')
    expect(echoed.headers['x-trace']).toBe('on')
    expect(echoed.headers['content-type']).toBe('application/json')
    expect(echoed.body).toBe('{"hello":"世界"}')
    expect(result.body.base64).toBe(Buffer.from(result.body.text ?? '', 'utf8').toString('base64'))
  })

  it('applies bearer auth and urlencoded forms on the wire', async () => {
    const executor = new HttpExecutor()
    await executor.execute(
      request({
        method: 'POST',
        body: { kind: 'form', fields: [{ name: 'a', value: '1 2' }, { name: 'b', value: '&' }] },
        auth: { kind: 'bearer', token: 'secret-token' },
      }),
    )

    const received = seen.at(-1)
    expect(received?.headers.authorization).toBe('Bearer secret-token')
    expect(received?.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(received?.body).toBe('a=1+2&b=%26')
  })

  it('sends multipart fields and file bytes', async () => {
    const executor = new HttpExecutor({ boundary: () => 'BOUNDARY' })
    await executor.execute(
      request({
        method: 'POST',
        body: {
          kind: 'multipart',
          fields: [{ name: 'note', value: 'hello' }],
          files: [
            {
              field: 'file',
              fileName: 'a.txt',
              contentType: 'text/plain',
              base64: Buffer.from('hello file').toString('base64'),
            },
          ],
        },
      }),
    )

    const received = seen.at(-1)
    expect(received?.headers['content-type']).toBe('multipart/form-data; boundary=BOUNDARY')
    expect(received?.body).toContain('name="note"')
    expect(received?.body).toContain('filename="a.txt"')
    expect(received?.body).toContain('hello file')
  })

  it('keeps HEAD bodyless and reports an empty body', async () => {
    const executor = new HttpExecutor()
    const result = await executor.execute(request({ method: 'HEAD' }))

    expect(result.status).toBe(200)
    expect(result.body.bytes).toBe(0)
    expect(result.body.text).toBe('')
    expect(result.body.base64).toBe('')
  })

  it('returns binary responses as base64 with a null text body', async () => {
    const executor = new HttpExecutor()
    const result = await executor.execute(request({ url: `${baseUrl}/bytes` }))

    const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(result.body.text).toBeNull()
    expect(result.body.contentType).toBe('image/png')
    expect(result.body.bytes).toBe(expected.length)
    expect(result.body.base64).toBe(expected.toString('base64'))
  })

  it('returns 4xx and 204 as results instead of throwing', async () => {
    const executor = new HttpExecutor()
    const missing = await executor.execute(request({ url: `${baseUrl}/missing` }))
    expect(missing.status).toBe(404)
    expect(missing.body.text).toBe('not found')

    const empty = await executor.execute(request({ url: `${baseUrl}/empty` }))
    expect(empty.status).toBe(204)
    expect(empty.body.bytes).toBe(0)
  })

  it('follows a 302 and records the hop', async () => {
    const executor = new HttpExecutor()
    const result: HttpExecutionResult = await executor.execute(
      request({ url: `${baseUrl}/redirect302` }),
    )

    expect(result.status).toBe(200)
    expect(result.url).toBe(`${baseUrl}/echo`)
    expect(result.redirects).toEqual([
      { status: 302, url: `${baseUrl}/redirect302`, location: `${baseUrl}/echo` },
    ])
    expect(seen.map((entry) => entry.url)).toEqual(['/redirect302', '/echo'])
  })

  it('preserves method and body across a 307 redirect', async () => {
    const executor = new HttpExecutor()
    await executor.execute(
      request({
        method: 'POST',
        url: `${baseUrl}/redirect307`,
        body: { kind: 'json', text: '{"keep":true}' },
      }),
    )

    const final = seen.at(-1)
    expect(final?.url).toBe('/echo')
    expect(final?.method).toBe('POST')
    expect(final?.body).toBe('{"keep":true}')
    expect(final?.headers['content-type']).toBe('application/json')
  })

  it('rewrites POST to a bodyless GET on 303', async () => {
    const executor = new HttpExecutor()
    await executor.execute(
      request({
        method: 'POST',
        url: `${baseUrl}/redirect303`,
        body: { kind: 'json', text: '{"drop":true}' },
      }),
    )

    const final = seen.at(-1)
    expect(final?.url).toBe('/echo')
    expect(final?.method).toBe('GET')
    expect(final?.body).toBe('')
    expect(final?.headers['content-type']).toBeUndefined()
  })

  it('stops at the redirect under the manual policy', async () => {
    const executor = new HttpExecutor()
    const result = await executor.execute(
      request({ url: `${baseUrl}/redirect302`, redirect: 'manual' }),
    )

    expect(result.status).toBe(302)
    expect(result.headers.location).toBe('/echo')
    expect(result.redirects).toEqual([])
    expect(seen.map((entry) => entry.url)).toEqual(['/redirect302'])
  })

  it('refuses any redirect under the error policy', async () => {
    const executor = new HttpExecutor()
    const error = await rejection(() =>
      executor.execute(request({ url: `${baseUrl}/redirect302`, redirect: 'error' })),
    )
    expect(error.code).toBe('network_error')
    expect(error.details?.reason).toBe('redirect_not_allowed')
  })

  it('fails after maxRedirects hops', async () => {
    const executor = new HttpExecutor()
    const error = await rejection(() =>
      executor.execute(request({ url: `${baseUrl}/loop`, maxRedirects: 2 })),
    )
    expect(error.code).toBe('network_error')
    expect(error.details?.reason).toBe('too_many_redirects')
    expect(seen).toHaveLength(3)
  })

  it('blocks redirects that point at a metadata endpoint', async () => {
    const executor = new HttpExecutor()
    const error = await rejection(() => executor.execute(request({ url: `${baseUrl}/to-metadata` })))
    expect(error.code).toBe('permission_denied')
    expect(error.details?.reason).toBe('blocked_redirect')
    expect(seen).toHaveLength(1)
  })

  it('truncates a large response while streaming', async () => {
    const executor = new HttpExecutor()
    const result = await executor.execute(
      request({ url: `${baseUrl}/big`, maxResponseBytes: 1024 }),
    )

    expect(result.status).toBe(200)
    expect(result.body.truncated).toBe(true)
    expect(result.body.bytes).toBe(1024)
    expect(result.body.text).toHaveLength(1024)
    expect(result.body.base64).toBe(Buffer.alloc(1024, 'a').toString('base64'))
  })

  it('times out and closes the hanging request', async () => {
    const executor = new HttpExecutor()
    const startedAt = Date.now()
    const error = await rejection(() =>
      executor.execute(request({ url: `${baseUrl}/hang`, timeoutMs: 150 })),
    )

    expect(error.code).toBe('timeout')
    expect(error.details?.reason).toBe('timeout')
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    await waitFor(() => hangingClosed > 0)
  })

  it('cancels through the caller signal without leaving the request open', async () => {
    const executor = new HttpExecutor()
    const controller = new AbortController()
    const pending = executor.execute(request({ url: `${baseUrl}/hang` }), {
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 100)

    const error = await rejection(() => pending)
    expect(error.code).toBe('network_error')
    expect(error.details?.reason).toBe('cancelled')
    await waitFor(() => hangingClosed > 0)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const executor = new HttpExecutor()
    const controller = new AbortController()
    controller.abort()

    const error = await rejection(() => executor.execute(request({ url: `${baseUrl}/hang` }), {
      signal: controller.signal,
    }))
    expect(error.code).toBe('network_error')
    expect(error.details?.reason).toBe('cancelled')
    expect(seen).toHaveLength(0)
  })

  it('maps a refused connection to network_error', async () => {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const address = probe.address()
    if (address === null || typeof address === 'string') throw new Error('probe did not bind')
    await new Promise<void>((resolve) => probe.close(() => resolve()))

    const executor = new HttpExecutor()
    const error = await rejection(() =>
      executor.execute(request({ url: `http://127.0.0.1:${address.port}/echo` })),
    )
    expect(error.code).toBe('network_error')
    expect(error.details?.reason).toBe('request_failed')
  })

  it('surfaces validation errors before any socket is opened', async () => {
    const executor = new HttpExecutor()
    const error = await rejection(() => executor.execute({ method: 'GET', url: 'file:///etc/passwd' }))
    expect(error.code).toBe('invalid_input')
    expect(seen).toHaveLength(0)
  })
})
