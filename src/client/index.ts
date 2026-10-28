/**
 * Client entry for dsh-vibecode-studio.
 *
 * Registered as a right-sidebar tab type plus one pane body. T006 scaffold
 * stays the host side; T010 grows the pane into the Studio shell.
 */
import * as React from 'react'
import { browserLocale, translate } from './i18n'
import { ComposerHandoffSlot } from './inspect/handoff'
import { StudioShell } from './shell/StudioShell'

export const CLIENT_ID = 'dsh-vibecode-studio'

export const inject = ['slots', 'sidebarRightTabs']

const KIND = 'vibe-studio'

export function apply(ctx: any): void {
  const panel = React.createElement(StudioShell)
  const title = (): string => translate('shell.title', { locale: browserLocale() })
  const description = (): string =>
    translate('shell.guide.description', { locale: browserLocale() })

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: CLIENT_ID,
    kind: KIND,
    title,
    guide: [{
      id: CLIENT_ID,
      title,
      description,
      order: 12,
    }],
    keepMounted: true,
  }), 'vibe-studio: tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CLIENT_ID,
  }, () => panel)), 'vibe-studio: tab body')

  // T032: a null-rendering session-scoped slot forwards the public composer
  // `inputActions` to the handoff bridge. The scoped `inject` shape (id +
  // order + sessionId) is required — a bare `key` fails plugin boot (S2 §8.1).
  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: CLIENT_ID,
    order: 20,
    inject: (sessionId: string) => ({ sessionId }),
  }, ComposerHandoffSlot as unknown as React.ComponentType<Record<string, unknown>>)),
  'vibe-studio: composer handoff')
}
