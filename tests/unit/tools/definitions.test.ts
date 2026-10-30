/**
 * T047 tool schemas: four tools, DSH-subset schemas, strict argument checks.
 * The schemas are the model-facing contract, so every drift here is a model
 * calling a tool with arguments the Host cannot serve.
 */
import { describe, expect, it } from 'vitest'
import {
  VIBE_TOOL_NAMES,
  VIBE_TOOL_SPECS,
  isVibeToolName,
  validateToolArguments,
  validateToolSpecs,
  type VibeToolSpec,
} from '../../../src/host/agent/tools/definitions'

function spec(
  name: VibeToolSpec['name'],
  parameters: VibeToolSpec['parameters'],
): VibeToolSpec {
  return {
    name,
    description: 'test tool',
    parameters,
    outputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }
}

function findBy(name: VibeToolSpec['name']): VibeToolSpec {
  const found = VIBE_TOOL_SPECS.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing spec ${name}`)
  return found
}

describe('VIBE_TOOL_SPECS', () => {
  it('declares exactly the four tools, each once', () => {
    expect(VIBE_TOOL_SPECS.map((entry) => entry.name)).toEqual([...VIBE_TOOL_NAMES])
    expect(new Set(VIBE_TOOL_SPECS.map((entry) => entry.name)).size).toBe(4)
    expect(isVibeToolName('vibe_status')).toBe(true)
    expect(isVibeToolName('vibe_unknown')).toBe(false)
    expect(isVibeToolName(42)).toBe(false)
  })

  it('passes every schema check the Host applies before registration', () => {
    expect(validateToolSpecs()).toEqual([])
  })

  it('keeps parameters strict and output schemas object-rooted', () => {
    for (const entry of VIBE_TOOL_SPECS) {
      expect(entry.parameters.type).toBe('object')
      expect(entry.parameters.additionalProperties).toBe(false)
      expect(entry.outputSchema.type).toBe('object')
      expect(entry.description.length).toBeGreaterThan(20)
      expect(entry.timeoutMs).toBeGreaterThan(0)
    }
  })

  it('keeps the model-facing argument surface small', () => {
    expect(findBy('vibe_status').parameters.properties).toEqual({})
    expect(findBy('vibe_annotation_get').parameters.required).toEqual(['id'])
    expect(findBy('vibe_preview').parameters.required).toEqual(['action'])
    expect(findBy('vibe_preview').parameters.properties?.action?.enum).toEqual([
      'reload',
      'navigate',
      'screenshot',
      'start',
      'stop',
    ])
    expect(findBy('vibe_observe').parameters.properties?.detail?.enum).toEqual([
      'summary',
      'full',
    ])
    expect(findBy('vibe_observe').parameters.properties?.include?.items?.enum).toEqual([
      'dom',
      'console',
      'network',
    ])
  })
})

describe('validateToolSpecs', () => {
  it('rejects keywords outside the DSH JSON-Schema subset', () => {
    const violations = validateToolSpecs([
      spec('vibe_status', {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1 } as never,
        },
        additionalProperties: false,
      }),
    ])
    expect(violations.join('\n')).toContain('minimum is not supported')
  })

  it('rejects required names that are not declared', () => {
    const violations = validateToolSpecs([
      spec('vibe_status', {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id', 'missing'],
        additionalProperties: false,
      }),
    ])
    expect(violations.join('\n')).toContain('required names undeclared property "missing"')
  })

  it('rejects nested schema keywords on the wrong type', () => {
    const violations = validateToolSpecs([
      spec('vibe_status', {
        type: 'object',
        properties: {
          items: { type: 'string', items: { type: 'string' } },
          props: { properties: { a: { type: 'string' } } },
        },
        additionalProperties: false,
      }),
    ])
    const joined = violations.join('\n')
    expect(joined).toContain('items requires type "array"')
    expect(joined).toContain('properties requires type "object"')
  })

  it('rejects ambiguous oneOf branches and mixed oneOf constraints', () => {
    const violations = validateToolSpecs([
      spec('vibe_status', {
        type: 'object',
        properties: {
          only: { oneOf: [{ type: 'string' }] },
          mixed: { oneOf: [{ type: 'string' }, { type: 'null' }], type: 'string' },
        },
        additionalProperties: false,
      }),
    ])
    const joined = violations.join('\n')
    expect(joined).toContain('oneOf needs at least two branches')
    expect(joined).toContain('oneOf cannot be combined with type')
  })
})

describe('validateToolArguments', () => {
  it('accepts an empty status call and rejects non-object arguments', () => {
    expect(validateToolArguments(findBy('vibe_status').parameters, {})).toEqual([])
    expect(validateToolArguments(findBy('vibe_status').parameters, null)).toEqual([
      'arguments must be an object',
    ])
    expect(validateToolArguments(findBy('vibe_status').parameters, { extra: true })).toEqual([
      'arguments.extra is not a declared property',
    ])
  })

  it('requires the annotation id and keeps unknown keys out', () => {
    const parameters = findBy('vibe_annotation_get').parameters
    expect(validateToolArguments(parameters, { id: 'a1' })).toEqual([])
    expect(validateToolArguments(parameters, {})).toEqual(['arguments.id is required'])
    expect(validateToolArguments(parameters, { id: 1 })).toEqual([
      'arguments.id must be a string',
    ])
    expect(validateToolArguments(parameters, { id: 'a1', offset: 2 })).toEqual([
      'arguments.offset is not a declared property',
    ])
  })

  it('checks observe enums and array items', () => {
    const parameters = findBy('vibe_observe').parameters
    expect(validateToolArguments(parameters, {})).toEqual([])
    expect(
      validateToolArguments(parameters, { detail: 'full', include: ['dom', 'network'] }),
    ).toEqual([])
    expect(validateToolArguments(parameters, { detail: 'all' })).toEqual([
      'arguments.detail must be one of "summary", "full"',
    ])
    expect(validateToolArguments(parameters, { include: ['api'] })).toEqual([
      'arguments.include[0] must be one of "dom", "console", "network"',
    ])
    expect(validateToolArguments(parameters, { include: 'dom' })).toEqual([
      'arguments.include must be an array',
    ])
  })

  it('requires a valid preview action', () => {
    const parameters = findBy('vibe_preview').parameters
    expect(validateToolArguments(parameters, { action: 'reload' })).toEqual([])
    expect(validateToolArguments(parameters, { action: 'delete' })).toEqual([
      'arguments.action must be one of "reload", "navigate", "screenshot", "start", "stop"',
    ])
    expect(validateToolArguments(parameters, {})).toEqual(['arguments.action is required'])
  })
})
