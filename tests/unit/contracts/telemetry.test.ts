import { describe, expect, it } from 'vitest'
import {
  CONSOLE_ENTRY_BUDGET_BYTES,
  NETWORK_ENTRY_BUDGET_BYTES,
  REDACTED,
  renderConsoleEntry,
  renderNetworkEntry,
  utf8Bytes,
  type ConsoleEntry,
  type NetworkEntry,
} from '../../../src/contracts'

const consoleEntry: ConsoleEntry = {
  id: 'c1',
  level: 'error',
  text: 'Unhandled rejection: boom',
  timestamp: '2026-10-26T12:00:00.000Z',
  source: { url: 'http://localhost:5173/app?token=abc', line: 10, column: 2 },
}

const networkEntry: NetworkEntry = {
  id: 'n1',
  method: 'post',
  url: 'https://user:pass@api.example.test/items?api_key=k&q=1',
  status: 201,
  outcome: 'success',
  resourceType: 'fetch',
  startedAt: '2026-10-26T12:00:00.000Z',
  durationMs: 42.4,
}

describe('console and network entries', () => {
  it('renders a redacted console line', () => {
    const output = renderConsoleEntry(consoleEntry)

    expect(output).toBe(
      `[error] 2026-10-26T12:00:00.000Z Unhandled rejection: boom (http://localhost:5173/app?token=${REDACTED}:10:2)`,
    )
  })

  it('renders a redacted network line with status and duration', () => {
    const output = renderNetworkEntry(networkEntry)

    expect(output).toContain('POST https://api.example.test/items?api_key=REDACTED&q=1')
    expect(output).toContain('201 success 42ms')
    expect(output).not.toContain('user:pass')
  })

  it('reports pending and failed requests', () => {
    expect(
      renderNetworkEntry({ ...networkEntry, status: null, outcome: 'pending', durationMs: null }),
    ).toContain('-> pending')
    expect(
      renderNetworkEntry({
        ...networkEntry,
        status: null,
        outcome: 'error',
        durationMs: null,
        failure: 'ECONNRESET',
      }),
    ).toContain('-> error error=ECONNRESET')
  })

  it('keeps each line within its byte budget', () => {
    const consoleOutput = renderConsoleEntry({ ...consoleEntry, text: 'x'.repeat(5000) })
    const networkOutput = renderNetworkEntry({ ...networkEntry, url: `https://x.test/${'a'.repeat(5000)}` })

    expect(utf8Bytes(consoleOutput)).toBeLessThanOrEqual(CONSOLE_ENTRY_BUDGET_BYTES)
    expect(utf8Bytes(networkOutput)).toBeLessThanOrEqual(NETWORK_ENTRY_BUDGET_BYTES)
  })
})
