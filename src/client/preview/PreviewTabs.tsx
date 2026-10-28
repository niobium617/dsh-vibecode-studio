/**
 * Bottom drawer tabs (U01 Layout v2).
 *
 * The tabs are permanent so the canvas never reflows when a drawer opens: the
 * drawer itself is an overlay inside the stage. Each tab shows its live count
 * even while the drawer is closed, which is why the drawers stay mounted and
 * keep polling; this component is purely presentational.
 */
import * as React from 'react'
import { createTranslator, type Locale } from '../i18n'

export type PreviewDrawerKind = 'console' | 'network'

export interface TabCount {
  readonly available: boolean
  readonly count: number
}

export interface PreviewTabsProps {
  readonly locale?: Locale
  readonly ready: boolean
  readonly console: TabCount
  readonly network: TabCount
  readonly open: PreviewDrawerKind | null
  onToggle(kind: PreviewDrawerKind): void
}

const rootStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 2,
  minHeight: 28,
  borderTop: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    flex: 1,
    minWidth: 0,
    border: 'none',
    borderTop: `2px solid ${active ? 'var(--dsw-accent-color, #4f8cff)' : 'transparent'}`,
    background: 'transparent',
    color: 'inherit',
    opacity: active ? 1 : 0.7,
    cursor: 'pointer',
    font: '12px/1.4 system-ui, sans-serif',
    padding: '4px 8px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }
}

export function PreviewTabs({
  locale,
  ready,
  console: consoleTab,
  network: networkTab,
  open,
  onToggle,
}: PreviewTabsProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const consoleEnabled = ready && consoleTab.available
  const networkEnabled = ready && networkTab.available

  const renderTab = (
    kind: PreviewDrawerKind,
    label: string,
    tab: TabCount,
    enabled: boolean,
  ): React.ReactElement => (
    <button
      key={kind}
      type="button"
      role="tab"
      aria-selected={open === kind}
      aria-controls={`vibe-${kind}-drawer`}
      disabled={!enabled}
      data-vibe-console-toggle={kind === 'console' ? '1' : undefined}
      data-vibe-network-toggle={kind === 'network' ? '1' : undefined}
      style={tabStyle(open === kind)}
      onClick={() => onToggle(kind)}
    >
      {label} ({tab.count})
    </button>
  )

  return (
    <div
      role="tablist"
      aria-label={t('preview.drawer.tabs')}
      data-vibe-tabs="1"
      style={rootStyle}
    >
      {renderTab('console', t('preview.console.title'), consoleTab, consoleEnabled)}
      {renderTab('network', t('preview.network.title'), networkTab, networkEnabled)}
    </div>
  )
}
