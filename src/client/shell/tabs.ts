import type { MessageKey } from '../i18n'

/** Internal Studio pages. Each is a placeholder until its milestone lands. */
export const STUDIO_TABS = ['preview', 'inspect', 'annotations', 'api'] as const
export type StudioTabId = (typeof STUDIO_TABS)[number]

export interface StudioTabDefinition {
  readonly id: StudioTabId
  readonly labelKey: MessageKey
  readonly emptyKey: MessageKey
}

export const STUDIO_TAB_DEFINITIONS: readonly StudioTabDefinition[] = [
  { id: 'preview', labelKey: 'tab.preview', emptyKey: 'page.preview.empty' },
  { id: 'inspect', labelKey: 'tab.inspect', emptyKey: 'page.inspect.empty' },
  { id: 'annotations', labelKey: 'tab.annotations', emptyKey: 'page.annotations.empty' },
  { id: 'api', labelKey: 'tab.api', emptyKey: 'page.api.empty' },
]

export const DEFAULT_TAB: StudioTabId = 'preview'

export function isStudioTab(value: unknown): value is StudioTabId {
  return typeof value === 'string' && (STUDIO_TABS as readonly string[]).includes(value)
}
