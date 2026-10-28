/**
 * Studio shell: internal page tabs and the page placeholder. The DSH sidebar
 * supplies docking, fullscreen, the pane title and the start-here guide; this
 * component only fills the pane body, so it no longer repeats the title.
 */
import * as React from 'react'
import { browserLocale, createTranslator, type Locale } from '../i18n'
import { AnnotationQueue, useAnnotationQueue } from '../inspect/AnnotationQueue'
import { PreviewPage } from '../preview/Canvas'
import { stopPreviewSession } from '../preview/lifecycle'
import { SettingsPage } from './settings/SettingsPage'
import { EmptyState, ShellErrorBoundary } from './StateViews'
import { useShellState, setActiveTab } from './store'
import { DEFAULT_TAB, STUDIO_TAB_DEFINITIONS } from './tabs'

const rootStyle: React.CSSProperties = {
  display: 'grid',
  // Two rows: the page tabs and the page body. The old title/subtitle header
  // was redundant — DSH already labels the pane with the tab name.
  gridTemplateRows: 'auto minmax(0, 1fr)',
  height: '100%',
  minHeight: 0,
  font: '13px/1.5 system-ui, sans-serif',
  color: 'var(--dsw-text-primary, inherit)',
}

const tabListStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: '6px 8px 0',
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

/** Queue size next to the tab label; hidden from the accessible name. */
const tabBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  minWidth: 14,
  marginLeft: 4,
  padding: '0 4px',
  borderRadius: 999,
  background: 'var(--dsw-accent-color, #4f8cff)',
  color: '#fff',
  font: '600 9px/1.6 system-ui, sans-serif',
  textAlign: 'center',
}

/**
 * The preview page is its own fixed-height layout (canvas plus drawers), so the
 * panel must not scroll it; scrolling would resize the canvas over and over.
 */
const previewPanelStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: 'hidden',
}

export interface StudioShellProps {
  /** Override the detected locale (tests); the client passes nothing. */
  readonly locale?: Locale
}

export function StudioShell({ locale }: StudioShellProps): React.ReactElement {
  const activeLocale = locale ?? browserLocale()
  const t = React.useMemo(() => createTranslator(activeLocale), [activeLocale])
  const { activeTab } = useShellState()
  const queuedAnnotations = useAnnotationQueue()
  const current =
    STUDIO_TAB_DEFINITIONS.find((tab) => tab.id === activeTab) ??
    STUDIO_TAB_DEFINITIONS.find((tab) => tab.id === DEFAULT_TAB)!
  const panelId = `vibe-studio-panel-${current.id}`

  // Closing the DSH panel unmounts the shell; an internal tab switch only
  // unmounts PreviewPage and keeps the live target. The lifecycle flag makes
  // that distinction, so a plain shell teardown never calls the Host.
  React.useEffect(() => {
    return () => {
      void stopPreviewSession()
    }
  }, [])

  return (
    <div data-vibe-shell="1" style={rootStyle}>
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
              {tab.id === 'annotations' && queuedAnnotations.length > 0 ? (
                <span aria-hidden="true" data-vibe-annotation-count={queuedAnnotations.length} style={tabBadgeStyle}>
                  {queuedAnnotations.length}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <section
        role="tabpanel"
        id={panelId}
        aria-labelledby={`vibe-studio-tab-${current.id}`}
        style={current.id === 'preview' ? previewPanelStyle : panelStyle}
      >
        <ShellErrorBoundary key={current.id} locale={activeLocale}>
          {current.id === 'settings' ? (
            <SettingsPage locale={activeLocale} />
          ) : current.id === 'preview' ? (
            <PreviewPage locale={activeLocale} />
          ) : current.id === 'annotations' ? (
            <AnnotationQueue locale={activeLocale} />
          ) : (
            <EmptyState title={t('state.empty.title')} body={t(current.emptyKey)} />
          )}
        </ShellErrorBoundary>
      </section>
    </div>
  )
}
