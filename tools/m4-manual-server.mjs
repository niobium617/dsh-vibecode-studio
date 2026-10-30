/**
 * Manual-test server for the M4 API workbench (localhost only).
 *
 * The preview fixture (`pnpm fixture:dev`) only exposes `/api/echo`, `/api/boom`
 * and `/api/slow`. The API tab needs JSON trees, HTML sandboxing, images,
 * binary downloads, redirects, large bodies and status codes to exercise the
 * response viewer, so this companion serves them on a separate loopback port.
 *
 * Usage:
 *   node tools/m4-manual-server.mjs            # http://127.0.0.1:4325
 *   M4_PORT=4326 node tools/m4-manual-server.mjs
 *
 * Every hit is printed to stdout, which makes "nothing was sent" checks easy.
 * Not a product dependency; nothing imports this file.
 */
import { createServer } from 'node:http'
import { deflateSync } from 'node:zlib'

const HOST = '127.0.0.1'
const PORT = Number(process.env.M4_PORT ?? 4325)

const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A visible 96×64 gradient, so the response image preview is not a 1×1 dot. */
function createPng(width, height) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const rows = []
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x += 1) {
      const at = 1 + x * 4
      row[at] = Math.round((x / (width - 1)) * 255)
      row[at + 1] = Math.round((y / (height - 1)) * 255)
      row[at + 2] = 180
      row[at + 3] = 255
    }
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const PNG = createPng(96, 64)

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
)

let counter = 0

function sendJson(response, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    ...extraHeaders,
  })
  response.end(body)
}

function sendText(response, status, value, contentType = 'text/plain; charset=utf-8') {
  const body = Buffer.from(value, 'utf8')
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': body.length,
  })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`)
  const path = url.pathname
  console.log(`[m4] ${request.method} ${request.url ?? path}`)

  if (path === '/api/json') {
    sendJson(response, 200, {
      ok: true,
      name: 'm4-manual',
      items: [
        { id: 1, name: 'alpha', tags: ['a', 'b'] },
        { id: 2, name: 'beta', tags: [] },
      ],
      nested: { level2: { level3: { level4: 'deep', list: [1, 2, 3] } } },
    })
    return
  }

  if (path === '/api/count') {
    counter += 1
    sendJson(response, 200, { count: counter, method: request.method })
    return
  }

  if (path === '/api/echo') {
    const body = await readBody(request)
    sendJson(response, 200, {
      method: request.method,
      path,
      query: Object.fromEntries(url.searchParams),
      contentType: request.headers['content-type'] ?? null,
      body: body.toString('utf8'),
      authorization: request.headers.authorization ?? null,
      apiKey: request.headers['x-api-key'] ?? null,
      customHeader: request.headers['x-m4'] ?? null,
    })
    return
  }

  if (path === '/api/text') {
    sendText(response, 200, 'hello from the M4 manual server\n')
    return
  }

  if (path === '/api/empty') {
    response.writeHead(204)
    response.end()
    return
  }

  if (path === '/api/html') {
    sendText(
      response,
      200,
      '<!doctype html><html><body><h1>M4 HTML preview</h1>' +
        '<script>window.__m4xss = true</script>' +
        '<p>Scripts must not run in the response preview.</p></body></html>',
      'text/html; charset=utf-8',
    )
    return
  }

  if (path === '/api/image') {
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': PNG.length,
    })
    response.end(PNG)
    return
  }

  if (path === '/api/binary') {
    response.writeHead(200, {
      'content-type': 'application/pdf',
      'content-length': PDF.length,
    })
    response.end(PDF)
    return
  }

  if (path === '/api/headers') {
    sendJson(
      response,
      200,
      { ok: true },
      { 'x-m4-header': 'visible-in-headers-tab', 'cache-control': 'no-store' },
    )
    return
  }

  if (path === '/api/status/404') {
    sendJson(response, 404, { error: 'not found', code: 404 })
    return
  }

  if (path === '/api/status/500') {
    sendJson(response, 500, { error: 'boom', code: 500 })
    return
  }

  if (path === '/api/redirect') {
    response.writeHead(302, { location: '/api/json' })
    response.end()
    return
  }

  if (path === '/api/loop') {
    response.writeHead(302, { location: '/api/loop' })
    response.end()
    return
  }

  if (path === '/api/slow') {
    const requested = Number(url.searchParams.get('ms') ?? '3000')
    const wait = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), 10_000) : 3000
    setTimeout(() => sendJson(response, 200, { waited: wait }), wait)
    return
  }

  if (path === '/api/large') {
    // 5 MiB exceeds the executor's 4 MiB default, so the panel must show a
    // truncation badge instead of trying to render everything.
    const pad = 'x'.repeat(5 * 1024 * 1024)
    sendJson(response, 200, { pad })
    return
  }

  sendJson(response, 404, { error: 'unknown m4 endpoint', path })
})

server.listen(PORT, HOST, () => {
  console.log(`[m4] listening on http://${HOST}:${PORT}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
