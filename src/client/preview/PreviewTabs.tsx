/**
 * Bottom drawer tabs (U01 Layout v2).
 *
 * The tabs are permanent so the canvas never reflows when a drawer opens: the
 * drawer itself is an overlay inside the stage. Each tab shows its live count
 * even while the drawer is closed, which is why the drawers stay mounted and
 * keep polling; this component is purely presentational.
 *
 * T056 adds an optional third tab for the verification panel. It has no live
 * count (runs are manual) and is available even while the preview is idle,
 * because opening it is how a beginner finds out the checks cannot run yet.
 */
import * as React from 'react'
import { createTranslator, type Locale } from '../i18n'

export type PreviewDrawerKind = 'console' | 'network' | 'verify'

export interface TabCount {
  readonly available: boolean
  readonly count: number
}

/** T056: the verification panel is manual, so its tab has no live count. */
export interface VerifyTab {
  /**
   * The panel can open even while the preview is idle (it explains why the
   * checks cannot run); the run button itself waits for `ready`.
   */
  readonly available: boolean
}

export interface PreviewTabsProps {
  readonly locale?: Locale
  readonly ready: boolean
  readonly console: TabCount
  readonly network: TabCount
  /** Optional: tabs without it keep the pre-T056 two-tab layout. */
  readonly verify?: VerifyTab
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
  verify: verifyTab,
  open,
  onToggle,
}: PreviewTabsProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const consoleEnabled = ready && consoleTab.available
  const networkEnabled = ready && networkTab.available
  const verifyEnabled = verifyTab?.available === true

  const renderTab = (
    kind: PreviewDrawerKind,
    label: string,
    enabled: boolean,
    count?: number,
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
      data-vibe-verify-toggle={kind === 'verify' ? '1' : undefined}
      style={tabStyle(open === kind)}
      onClick={() => onToggle(kind)}
    >
      {count === undefined ? label : `${label} (${count})`}
    </button>
  )

  return (
    <div
      role="tablist"
      aria-label={t('preview.drawer.tabs')}
      data-vibe-tabs="1"
      style={rootStyle}
    >
      {renderTab('console', t('preview.console.title'), consoleEnabled, consoleTab.count)}
      {renderTab('network', t('preview.network.title'), networkEnabled, networkTab.count)}
      {verifyTab === undefined
        ? null
        : renderTab('verify', t('verify.title'), verifyEnabled)}
    </div>
  )
}
