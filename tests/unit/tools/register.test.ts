/**
 * T047 registration: the four definitions are registry-ready, a missing body
 * fails with `unsupported`, handler failures keep one stable code prefix, and
 * the default render never exceeds the 8 KB observe budget.
 */
import { describe, expect, it, vi } from 'vitest'
import { utf8Bytes } from '../../../src/contracts/budget'
import {
  asVibeToolError,
  createVibeToolDefinitions,
  registerVibeTools,
  renderToolResult,
  VibeToolError,
  type VibeToolDefinition,
  type VibeToolHandlers,
  type VibeToolRegistry,
  type VibeToolRunContext,
} from '../../../src/host/agent/tools/register'

function fakeRegistry(): {
  readonly registry: VibeToolRegistry
  readonly definitions: Map<string, VibeToolDefinition>
} {
  const definitions = new Map<string, VibeToolDefinition>()
  return {
    definitions,
    registry: {
      register(definition) {
        definitions.set(definition.name, definition)
        return () => {
          definitions.delete(definition.name)
        }
      },
    },
  }
}

function definitionFor(
  name: VibeToolDefinition['name'],
  handlers: VibeToolHandlers = {},
): VibeToolDefinition {
  const definition = createVibeToolDefinitions(handlers).find((entry) => entry.name === name)
  if (!definition) throw new Error(`missing definition ${name}`)
  return definition
}

async function rejection(run: () => Promise<unknown>): Promise<VibeToolError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof VibeToolError) return error
    throw error
  }
  throw new Error('expected the call to reject')
}

describe('createVibeToolDefinitions', () => {
  it('returns four definitions with the registry contract fields', () => {
    const definitions = createVibeToolDefinitions()
    expect(definitions.map((definition) => definition.name)).toEqual([
      'vibe_status',
      'vibe_observe',
      'vibe_annotation_get',
      'vibe_preview',
    ])
    for (const definition of definitions) {
      expect(typeof definition.description).toBe('string')
      expect(definition.parameters).toMatchObject({ type: 'object' })
      expect(definition.output.schema).toMatchObject({ type: 'object' })
      expect(typeof definition.output.render).toBe('function')
      expect(typeof definition.execute).toBe('function')
    }
    expect(definitionFor('vibe_preview').timeoutMs).toBe(60_000)
  })
})

describe('registerVibeTools', () => {
  it('registers all four tools and disposes idempotently', () => {
    const { registry, definitions } = fakeRegistry()
    const dispose = registerVibeTools(registry)
    expect([...definitions.keys()].sort()).toEqual([
      'vibe_annotation_get',
      'vibe_observe',
      'vibe_preview',
      'vibe_status',
    ])
    dispose()
    dispose()
    expect(definitions.size).toBe(0)
  })

  it('runs the matching handler with parsed arguments and the run context', async () => {
    const signal = new AbortController().signal
    const handler = vi.fn(
      async (args: Readonly<Record<string, unknown>>, exec: VibeToolRunContext) => ({
        id: args.id,
        hasSignal: exec.signal === signal,
      }),
    )
    const definition = definitionFor('vibe_annotation_get', {
      vibe_annotation_get: handler,
    })

    await expect(definition.execute({ id: 'a1' }, { signal })).resolves.toEqual({
      id: 'a1',
      hasSignal: true,
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('fails a tool without a body with the unsupported code', async () => {
    const error = await rejection(async () => definitionFor('vibe_status').execute({}, {}))
    expect(error.code).toBe('unsupported')
    expect(error.message).toContain('vibe_status is not implemented')
  })

  it('rejects invalid arguments before calling the handler', async () => {
    const handler = vi.fn(async () => ({}))
    const definition = definitionFor('vibe_preview', { vibe_preview: handler })
    const error = await rejection(async () => definition.execute({ action: 'delete' }, {}))
    expect(error.code).toBe('invalid_input')
    expect(error.details?.violations).toEqual([
      'arguments.action must be one of "reload", "navigate", "screenshot", "start", "stop"',
    ])
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps a StudioError code and normalizes plain errors to internal', async () => {
    const notFound = definitionFor('vibe_annotation_get', {
      vibe_annotation_get: async () => {
        throw { code: 'not_found', message: 'annotation missing' }
      },
    })
    const notFoundError = await rejection(async () => notFound.execute({ id: 'x' }, {}))
    expect(notFoundError.code).toBe('not_found')
    expect(notFoundError.message).toBe('not_found: annotation missing')

    const boom = definitionFor('vibe_status', {
      vibe_status: async () => {
        throw new Error('boom')
      },
    })
    const boomError = await rejection(async () => boom.execute({}, {}))
    expect(boomError.code).toBe('internal')
    expect(boomError.message).toBe('internal: boom')
  })
})

describe('renderToolResult', () => {
  it('renders one compact text block', () => {
    expect(renderToolResult({ ok: true })).toEqual([{ type: 'text', text: '{"ok":true}' }])
    expect(renderToolResult(undefined)).toEqual([{ type: 'text', text: 'undefined' }])
  })

  it('caps the model-facing text at the 8 KB observe budget', () => {
    const blocks = renderToolResult({ outline: 'x'.repeat(100_000) })
    const text = blocks[0].text
    expect(utf8Bytes(text)).toBeLessThanOrEqual(8 * 1024)
    expect(text.endsWith('…')).toBe(true)
    expect(text.length).toBeLessThan(10_000)
  })

  it('degrades cyclic values instead of throwing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(renderToolResult(cyclic)).toEqual([
      { type: 'text', text: '{"error":"unserializable tool result"}' },
    ])
  })
})

describe('asVibeToolError', () => {
  it('passes through existing tool errors and normalizes unknown values', () => {
    const original = new VibeToolError('timeout', 'too slow')
    expect(asVibeToolError(original)).toBe(original)
    expect(asVibeToolError('nope').code).toBe('internal')
    expect(asVibeToolError('nope').message).toBe('internal: tool execution failed')
  })
})
