/**
 * Client entry for dsh-vibecode-studio.
 *
 * Registered as a right-sidebar tab type plus one pane body. T006 scaffold
 * stays the host side; T010 grows the pane into the Studio shell.
 */
import * as React from 'react'
import { Hello } from './hello'

export const CLIENT_ID = 'dsh-vibecode-studio'

export const inject = ['slots', 'sidebarRightTabs']

const KIND = 'vibe-studio'

export function apply(ctx: any): void {
  const panel = React.createElement(Hello)

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: CLIENT_ID,
    kind: KIND,
    title: () => 'Vibe Studio',
    guide: [{
      id: CLIENT_ID,
      title: () => 'Vibe Studio',
      description: () => 'Preview, inspect and annotate the running app',
      order: 12,
    }],
    keepMounted: true,
  }), 'vibe-studio: tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CLIENT_ID,
  }, () => panel)), 'vibe-studio: tab body')
}
