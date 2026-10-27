import { asSessionId, asTargetId, type Annotation } from '../../../src/contracts'

export function annotationFixture(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    targetId: asTargetId('web-local'),
    sessionId: asSessionId('session-1'),
    createdAt: '2026-10-26T12:00:00.000Z',
    source: 'element',
    comment: 'Tighten the spacing to 16px.',
    element: {
      selector: 'main > button.primary',
      unique: true,
      tag: 'button',
      id: null,
      classes: ['primary'],
      role: 'button',
      text: 'Save changes',
      html: '<button class="primary">Save changes</button>',
      box: { x: 10, y: 20, width: 120, height: 32 },
      source: {
        framework: 'react',
        via: 'data-inspector',
        file: 'src/components/SaveButton.tsx',
        line: 42,
        column: 7,
      },
    },
    ...overrides,
  }
}
