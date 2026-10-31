/**
 * T048 `vibe_annotation_get`: the comment is the user's instruction and stays
 * outside the untrusted wrapper; page-derived element data lives inside
 * `content`; a missing id keeps the host's `not_found` code.
 */
import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../../src/contracts/annotation'
import { OBSERVE_BUDGET_BYTES, utf8Bytes } from '../../../src/contracts/budget'
import { studioError } from '../../../src/contracts/errors'
import type { TargetId } from '../../../src/contracts/ids'
import type { ElementContext } from '../../../src/contracts/inspect'
import {
  createAnnotationGetHandler,
  toAnnotationToolOutput,
  type AnnotationToolDeps,
} from '../../../src/host/agent/tools/annotation'
import { createVibeToolDefinitions } from '../../../src/host/agent/tools/register'

const ELEMENT: ElementContext = {
  selector: '#save',
  unique: true,
  tag: 'button',
  id: 'save',
  classes: ['btn', 'primary'],
  role: 'button',
  name: 'Save changes',
  text: 'Save',
  html: '<button id="save" class="btn primary">Save</button>',
  visible: true,
  box: { x: 10, y: 20, width: 80, height: 32 },
  source: {
    framework: 'react',
    via: 'data-inspector-file',
    file: 'src/components/SaveButton.tsx',
    line: 12,
    column: 3,
  },
}

const ANNOTATION: Annotation = {
  id: 'annotation-1',
  targetId: 'fixture' as TargetId,
  createdAt: '2026-10-30T10:00:00.000Z',
  source: 'element',
  comment: 'Make this button green and a bit wider.',
  element: ELEMENT,
}

function deps(annotation: Annotation): AnnotationToolDeps {
  return { history: { get: async () => annotation } }
}

function failingDeps(error: unknown): AnnotationToolDeps {
  return {
    history: {
      get: async () => {
        throw error
      },
    },
  }
}

describe('vibe_annotation_get (T048)', () => {
  it('returns the comment and a wrapped, prompt-ready content block', async () => {
    const output = await createAnnotationGetHandler(deps(ANNOTATION))({ id: ANNOTATION.id }, {})

    expect(output).toMatchObject({
      id: 'annotation-1',
      targetId: 'fixture' as TargetId,
      createdAt: '2026-10-30T10:00:00.000Z',
      source: 'element',
      comment: 'Make this button green and a bit wider.',
      element: {
        selector: '#save',
        unique: true,
        tag: 'button',
        role: 'button',
        name: 'Save changes',
        text: 'Save',
        visible: true,
        source: {
          framework: 'react',
          via: 'data-inspector-file',
          file: 'src/components/SaveButton.tsx',
          line: 12,
          column: 3,
        },
      },
    })
    // The raw markup stays inside the wrapper only; no structured copy.
    expect(output.element).not.toHaveProperty('html')
    expect(output.content).toContain('<untrusted-page-content source="element-context">')
    expect(output.content).toContain('selector: #save')
    expect(output.content).toContain('Make this button green and a bit wider.')
    expect(output.content.indexOf('Make this button green')).toBeLessThan(
      output.content.indexOf('<untrusted-page-content'),
    )
  })

  it('handles a region annotation without an element', () => {
    const output = toAnnotationToolOutput({
      id: 'annotation-2',
      targetId: 'fixture' as TargetId,
      createdAt: '2026-10-30T10:01:00.000Z',
      source: 'region',
      comment: 'The spacing here is too tight.',
    })
    expect(output.element).toBeUndefined()
    expect(output.content).toContain('No element selected.')
  })

  it('keeps null source line and column out of the payload', () => {
    const output = toAnnotationToolOutput({
      ...ANNOTATION,
      element: {
        ...ELEMENT,
        role: null,
        name: '',
        source: { framework: 'unknown', via: 'dom', file: 'unknown', line: null, column: null },
      },
    })
    expect(output.element).toMatchObject({
      source: { framework: 'unknown', via: 'dom', file: 'unknown' },
    })
    expect(output.element?.source).not.toHaveProperty('line')
    expect(output.element?.role).toBeUndefined()
    expect(output.element?.name).toBeUndefined()
  })

  it('passes a missing annotation through as not_found', async () => {
    const definitions = createVibeToolDefinitions({
      vibe_annotation_get: createAnnotationGetHandler(
        failingDeps(studioError('not_found', 'vibe-studio: annotation gone was not found')),
      ),
    })
    const definition = definitions.find((entry) => entry.name === 'vibe_annotation_get')
    expect(definition).toBeDefined()
    if (!definition) return

    await expect(definition.execute({ id: 'gone' }, {})).rejects.toMatchObject({
      code: 'not_found',
    })
    // Missing id is rejected before the store is touched.
    await expect(definition.execute({}, {})).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('caps a long comment so the payload stays under the 8 KB budget', () => {
    const output = toAnnotationToolOutput({ ...ANNOTATION, comment: '长'.repeat(4000) })
    const text = JSON.stringify(output)
    expect(utf8Bytes(text)).toBeLessThanOrEqual(OBSERVE_BUDGET_BYTES)
    expect(output.comment.endsWith('…')).toBe(true)
    expect(() => JSON.parse(text)).not.toThrow()
  })

  it('renders through the definition as a single JSON text block', async () => {
    const definitions = createVibeToolDefinitions({
      vibe_annotation_get: createAnnotationGetHandler(deps(ANNOTATION)),
    })
    const definition = definitions.find((entry) => entry.name === 'vibe_annotation_get')
    if (!definition) throw new Error('definition missing')
    const value = await definition.execute({ id: ANNOTATION.id }, {})
    const content = definition.output.render({}, value)
    expect(content).toHaveLength(1)
    expect(JSON.parse(content[0].text)).toMatchObject({ id: 'annotation-1' })
  })
})
