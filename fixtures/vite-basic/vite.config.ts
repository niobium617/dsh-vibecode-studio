import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Fixture API used by later preview/network/verify tasks. Keeping it in the
 * dev server avoids a second process and stays on localhost.
 */
function fixtureApi(): Plugin {
  return {
    name: 'fixture-api',
    configureServer(server) {
      server.middlewares.use('/api/echo', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(
            JSON.stringify({
              method: req.method,
              contentType: req.headers['content-type'] ?? null,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          )
        })
      })

      server.middlewares.use('/api/boom', (_req, res) => {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'fixture boom' }))
      })

      server.middlewares.use('/api/slow', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const requested = Number(url.searchParams.get('ms') ?? '500')
        const ms = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), 10_000) : 500
        setTimeout(() => {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ waited: ms }))
        }, ms)
      })
    },
  }
}

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  cacheDir: fileURLToPath(new URL('../../.tmp/vite-cache', import.meta.url)),
  plugins: [react(), fixtureApi()],
  server: {
    host: '127.0.0.1',
    port: 4320,
    strictPort: true,
  },
})
