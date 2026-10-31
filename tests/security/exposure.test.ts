/**
 * T059 exposure audit (FR-SEC-05, SPEC §9 "never expose CDP / never open a
 * public listener").
 *
 * These are static guarantees: a listener or a `remote-debugging` flag added
 * later must fail this suite instead of silently shipping. The assertions are
 * about where a construct may appear, not about runtime behaviour.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FRAME_PATH,
  HEALTH_PATH,
  REQUEST_PATH,
  STREAM_PATH,
  VIBE_API_PREFIX,
  appRoute,
} from '../../src/contracts/transport'

const SRC = 'src'

function sourceFiles(dir = SRC): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(full))
    else if (/\.(?:ts|tsx)$/.test(entry.name)) found.push(full)
  }
  return found
}

const files = sourceFiles().map((file) => ({
  path: relative(SRC, file).replaceAll('\\', '/'),
  text: readFileSync(file, 'utf8'),
}))

function offenders(pattern: RegExp): string[] {
  return files.filter((file) => pattern.test(file.text)).map((file) => file.path)
}

const DEBUG_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['connectOverCDP', /connectOverCDP/],
  ['remote-debugging flags', /remote-debugging/],
  ['a public bind address', /\b0\.0\.0\.0\b/],
]

const TELEMETRY_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['sendBeacon', /sendBeacon/],
  ['a WebSocket client', /new WebSocket/],
  ['console logging', /console\.(?:log|info|debug)\(/],
]

describe('no browser remote-debugging surface', () => {
  it.each(DEBUG_PATTERNS)('never contains %s', (_label, pattern) => {
    expect(offenders(pattern)).toEqual([])
  })

  it('opens CDP sessions only on the adapter page it launched', () => {
    const cdp = files.filter((file) => /newCDPSession/.test(file.text))
    expect(cdp.map((file) => file.path)).toEqual(['host/targets/web/adapter.ts'])
    const calls = cdp[0]!.text.match(/newCDPSession\(/g)?.length ?? 0
    expect(calls).toBe(1)
  })
})

describe('no host listener beyond the approved sample server', () => {
  it('creates an HTTP server only in the loopback sample server', () => {
    const servers = files.filter((file) => /createServer\(/.test(file.text))
    expect(servers.map((file) => file.path)).toEqual(['host/api/sample-server.ts'])
    const sample = servers[0]!.text
    expect(sample).toContain("'127.0.0.1'")
    expect(sample).toContain('.listen(0,')
  })

  it('never touches ctx.webServer', () => {
    expect(offenders(/ctx\.webServer/)).toEqual([])
  })
})

describe('no telemetry or background reporting', () => {
  it.each(TELEMETRY_PATTERNS)('never uses %s', (_label, pattern) => {
    expect(offenders(pattern)).toEqual([])
  })
})

describe('client stays on document-relative DSH routes', () => {
  it('uses the /api/vibe prefix and makes it relative for the desktop bridge', () => {
    for (const path of [HEALTH_PATH, REQUEST_PATH, FRAME_PATH, STREAM_PATH]) {
      expect(path.startsWith(`${VIBE_API_PREFIX}/`)).toBe(true)
      expect(appRoute(path)).toBe(path.replace(/^\/+/, ''))
      expect(appRoute(path)).not.toMatch(/^[a-z]+:/i)
    }
  })
})
