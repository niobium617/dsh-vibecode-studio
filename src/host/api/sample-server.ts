/**
 * Loopback sample endpoint for the API workbench (U04).
 *
 * The review asked for a request that runs on the first screen. A public demo
 * API would make that first Send depend on the internet, so the Host owns a
 * tiny echo server instead: it binds `127.0.0.1` on an ephemeral port, answers
 * `GET /sample` with a small JSON document and refuses everything else. It is
 * started lazily (the panel asks for its URL) and closed with the plugin.
 *
 * Nothing here reads the project, the environment or a credential; the response
 * is a fixed envelope plus a timestamp.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ApiSampleInfo } from '../../contracts/api'
import { studioError } from '../../contracts/errors'

export interface ApiSampleServer {
  /** URL of the sample request; starts the server on first use. */
  info(): Promise<ApiSampleInfo>
  /** Closes the listener; safe to call more than once. */
  dispose(): Promise<void>
}

const SAMPLE_PATH = '/sample'

function writeJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  response.end(body)
}

function handle(request: IncomingMessage, response: ServerResponse): void {
  const rawUrl = request.url ?? '/'
  const path = rawUrl.split('?')[0] ?? '/'
  if (path !== SAMPLE_PATH && path !== `${SAMPLE_PATH}/`) {
    writeJson(response, 404, { ok: false, error: 'not_found' })
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    writeJson(response, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, HEAD' })
    return
  }
  const payload = {
    ok: true,
    message: 'This is the built-in sample endpoint. Your request reached it.',
    service: 'DSH Vibe Coding Studio',
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    time: new Date().toISOString(),
    items: [
      { id: 1, name: 'first item' },
      { id: 2, name: 'second item' },
    ],
  }
  if (request.method === 'HEAD') {
    const body = JSON.stringify(payload)
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end()
    return
  }
  writeJson(response, 200, payload)
}

export function createApiSampleServer(): ApiSampleServer {
  let server: Server | null = null
  let starting: Promise<Server> | null = null
  let disposed = false
  let url: string | null = null

  const start = (): Promise<Server> => {
    if (server !== null) return Promise.resolve(server)
    if (starting !== null) return starting
    starting = new Promise<Server>((resolve, reject) => {
      const next = createServer((request, response) => {
        try {
          handle(request, response)
        } catch {
          if (!response.headersSent) writeJson(response, 500, { ok: false, error: 'internal' })
          else response.destroy()
        }
      })
      next.once('error', (error: NodeJS.ErrnoException) => {
        starting = null
        reject(error)
      })
      next.listen(0, '127.0.0.1', () => {
        const address = next.address()
        if (address === null || typeof address === 'string') {
          next.close()
          starting = null
          reject(new Error('vibe-studio: sample server has no address'))
          return
        }
        server = next
        starting = null
        resolve(next)
      })
    })
    return starting
  }

  return {
    async info(): Promise<ApiSampleInfo> {
      if (disposed) {
        throw studioError('internal', 'vibe-studio: sample endpoint is unavailable', {
          reason: 'disposed',
        })
      }
      try {
        const started = await start()
        if (url === null) {
          const address = started.address() as AddressInfo | null
          if (address === null) throw new Error('vibe-studio: sample server has no address')
          url = `http://127.0.0.1:${address.port}${SAMPLE_PATH}`
        }
        return { url, method: 'GET' }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('vibe-studio: sample endpoint')) {
          throw error
        }
        throw studioError('internal', 'vibe-studio: sample endpoint is unavailable', {
          reason: 'listen_failed',
        })
      }
    },
    async dispose(): Promise<void> {
      disposed = true
      url = null
      const current = server
      server = null
      starting = null
      if (current === null) return
      await new Promise<void>((resolve) => {
        current.close(() => resolve())
        current.closeAllConnections?.()
      })
    },
  }
}
