/**
 * T042 `$ref` behaviour: alias loops are a readable `ref_cycle`, structural
 * recursion is bounded by the example generator, and neither crashes an
 * import.
 */
import { describe, expect, it } from 'vitest'
import { isHttpRequestSpec } from '../../../src/contracts'
import { importOpenApi } from '../../../src/host/api/openapi/mapper'
import { OpenApiError, parseOpenApiDocument } from '../../../src/host/api/openapi/parser'
import { OpenApiRefResolver, resolveRemotePolicy } from '../../../src/host/api/openapi/resolver'

function documentWithSchema(schema: unknown): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Refs', version: '1' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/items': {
        post: {
          requestBody: { content: { 'application/json': { schema } } },
        },
      },
    },
    components: { schemas: {} },
  })
}

describe('$ref cycles', () => {
  it('reports an alias loop as ref_cycle and still maps a valid request', async () => {
    const doc = {
      openapi: '3.0.3',
      info: { title: 'Refs', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/items': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/A' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
        },
      },
    }
    const result = await importOpenApi(JSON.stringify(doc), { fetch: null })
    const endpoint = result.endpoints[0]!
    expect(isHttpRequestSpec(endpoint.request)).toBe(true)
    expect(endpoint.request.body).toEqual({ kind: 'none' })
    expect(endpoint.warnings.some((warning) => warning.startsWith('ref_cycle:'))).toBe(true)
  })

  it('throws ref_cycle when the resolver follows an alias loop directly', () => {
    const parsed = parseOpenApiDocument(
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Refs', version: '1' },
        paths: { '/a': { get: {} } },
        components: {
          schemas: {
            A: { $ref: '#/components/schemas/B' },
            B: { $ref: '#/components/schemas/A' },
          },
        },
      }),
    )
    const resolver = new OpenApiRefResolver(parsed.root, new Map(), resolveRemotePolicy({}))
    expect(() => resolver.resolveRef('#/components/schemas/A', '')).toThrowError(OpenApiError)
    try {
      resolver.resolveRef('#/components/schemas/A', '')
    } catch (error) {
      expect((error as OpenApiError).code).toBe('ref_cycle')
      expect((error as OpenApiError).message).toContain('circular $ref')
    }
  })

  it('bounds a self-referential schema instead of recursing forever', async () => {
    const doc = documentWithSchema({
      type: 'object',
      properties: {
        id: { type: 'string' },
        child: { $ref: '#/components/schemas/Node' },
      },
    })
    const parsed = JSON.parse(doc) as {
      components: { schemas: Record<string, unknown> }
    }
    parsed.components.schemas.Node = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        child: { $ref: '#/components/schemas/Node' },
      },
    }
    const result = await importOpenApi(JSON.stringify(parsed), { fetch: null })
    const body = result.endpoints[0]!.request.body
    expect(body?.kind).toBe('json')
    if (body?.kind !== 'json') throw new Error('expected a JSON body')
    expect(body.text.length).toBeLessThan(4 * 1024)
    const value = JSON.parse(body.text) as Record<string, unknown>
    expect(value.id).toBe('string')
    // One expansion is allowed; the second visit to Node stops at the stack.
    expect(value.child).toEqual({ id: 'string' })
  })

  it('bounds a mutually recursive pair of object schemas', async () => {
    const doc = {
      openapi: '3.0.3',
      info: { title: 'Refs', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/pairs': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/A' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
          B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
        },
      },
    }
    const result = await importOpenApi(JSON.stringify(doc), { fetch: null })
    const body = result.endpoints[0]!.request.body
    expect(body?.kind).toBe('json')
    if (body?.kind !== 'json') throw new Error('expected a JSON body')
    expect(body.text.length).toBeLessThan(4 * 1024)
    expect(() => JSON.parse(body.text)).not.toThrow()
  })
})
