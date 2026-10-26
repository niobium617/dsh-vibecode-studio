/**
 * Studio shell: header, internal page tabs and the page placeholder. The DSH
 * sidebar supplies docking, fullscreen and start-here guide; this component
 * only fills the pane body.
 */
import * as React from 'react'
import { browserLocale, createTranslator, type Locale } from '../i18n'
import { EmptyState, ShellErrorBoundary } from './StateViews'
import { useShellState, setActiveTab } from './store'
import { DEFAULT_TAB, STUDIO_TAB_DEFINITIONS } from './tabs'

const rootStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateRows: 'auto auto minmax(0, 1fr)',
  height: '100%',
  minHeight: 0,
  font: '13px/1.5 system-ui, sans-serif',
  color: 'var(--dsw-text-primary, inherit)',
}

const headerStyle: React.CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: '12px 12px 8px',
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  font: '600 14px/1.4 system-ui, sans-serif',
}

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  font: '12px/1.5 system-ui, sans-serif',
  opacity: 0.7,
}

const tabListStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: '0 8px',
  borderBottom: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--dsw-accent-color, #4f8cff)' : 'transparent'}`,
    background: 'transparent',
    color: 'inherit',
    opacity: active ? 1 : 0.7,
    cursor: 'pointer',
    font: '12px/1.4 system-ui, sans-serif',
    padding: '8px 10px 6px',
  }
}

const panelStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
}

export interface StudioShellProps {
  /** Override the detected locale (tests); the client passes nothing. */
  readonly locale?: Locale
}

export function StudioShell({ locale }: StudioShellProps): React.ReactElement {
  const activeLocale = locale ?? browserLocale()
  const t = React.useMemo(() => createTranslator(activeLocale), [activeLocale])
  const { activeTab } = useShellState()
  const current =
    STUDIO_TAB_DEFINITIONS.find((tab) => tab.id === activeTab) ??
    STUDIO_TAB_DEFINITIONS.find((tab) => tab.id === DEFAULT_TAB)!
  const panelId = `vibe-studio-panel-${current.id}`

  return (
    <div data-vibe-shell="1" style={rootStyle}>
      <header style={headerStyle}>
        <h2 style={titleStyle}>{t('shell.title')}</h2>
        <p style={subtitleStyle}>{t('shell.subtitle')}</p>
      </header>

      <div role="tablist" aria-label={t('shell.title')} style={tabListStyle}>
        {STUDIO_TAB_DEFINITIONS.map((tab) => {
          const selected = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`vibe-studio-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`vibe-studio-panel-${tab.id}`}
              style={tabStyle(selected)}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          )
        })}
      </div>

      <section
        role="tabpanel"
        id={panelId}
        aria-labelledby={`vibe-studio-tab-${current.id}`}
        style={panelStyle}
      >
        <ShellErrorBoundary key={current.id} locale={activeLocale}>
          <EmptyState title={t('state.empty.title')} body={t(current.emptyKey)} />
        </ShellErrorBoundary>
      </section>
    </div>
  )
}
