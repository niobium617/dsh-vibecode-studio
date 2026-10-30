/**
 * API page layout (T044, U04): one core row on top, the response underneath,
 * and every secondary tool behind a single "more tools" entry.
 *
 * Beginner is the default mode. Professional mode adds cURL and result checks
 * inside the builder and keeps the drawer contents available; both modes keep
 * the same panel instances mounted, so switching never loses a draft or a list.
 *
 * Save is deliberately one click: it appends to the default collection named
 * by the active locale, and the tree expands that collection so the saved row
 * is visible without another click.
 */
import * as React from 'react'
import {
  API_SAMPLE_INFO_METHOD,
  isApiSampleInfo,
  type ApiSampleInfo,
  type HttpRequestSpec,
} from '../../contracts/api'
import { createTranslator, type Locale } from '../i18n'
import { callUnary } from '../transport'
import { CollectionTree } from './CollectionTree'
import { EnvironmentPanel } from './EnvironmentPanel'
import { HistoryList } from './HistoryList'
import { OpenApiImportPanel } from './OpenApiImportPanel'
import { RequestBuilder } from './RequestBuilder'
import { saveRequestToCollection } from './collection-store'
import { loadApiHistory } from './history-store'
import { loadApiUiMode, saveApiUiMode, type ApiUiMode } from './ui-mode'

const rootStyle: React.CSSProperties = {
  display: 'grid',
  gap: 0,
  alignContent: 'start',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minHeight: 32,
}

const toolsButtonStyle: React.CSSProperties = {
  appearance: 'none',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.75,
  padding: '2px 0',
}

const modeSwitchStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 999,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.28))',
}

function modeButtonStyle(active: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    borderRadius: 999,
    background: active ? 'var(--dsw-accent-color, #4f8cff)' : 'transparent',
    color: active ? '#fff' : 'inherit',
    cursor: 'pointer',
    font: '11px/1.4 system-ui, sans-serif',
    opacity: active ? 1 : 0.75,
    padding: '3px 10px',
  }
}

function drawerStyle(open: boolean): React.CSSProperties {
  return {
    display: open ? 'grid' : 'none',
    gap: 10,
    padding: 10,
    marginBottom: 8,
    borderRadius: 8,
    border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.25))',
  }
}

const drawerHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}

const drawerTitleStyle: React.CSSProperties = {
  font: '600 11px/1.4 system-ui, sans-serif',
  opacity: 0.8,
}

export interface ApiWorkbenchProps {
  readonly locale?: Locale
}

export function ApiWorkbench({ locale }: ApiWorkbenchProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [mode, setMode] = React.useState<ApiUiMode>(() => loadApiUiMode())
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  // U04: the Host may run a loopback sample endpoint. Its URL fills an untouched
  // empty request so the first Send works with no typing; when the call fails
  // (bare provider, old Host) the builder simply keeps its empty URL.
  const [sampleUrl, setSampleUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void callUnary<ApiSampleInfo>(API_SAMPLE_INFO_METHOD)
      .then((info) => {
        if (!cancelled && isApiSampleInfo(info)) setSampleUrl(info.url)
      })
      .catch(() => {
        // No endpoint is a normal configuration, not an error for the user.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const chooseMode = React.useCallback((next: ApiUiMode): void => {
    setMode(next)
    saveApiUiMode(next)
  }, [])

  const save = React.useMemo(
    () =>
      async (spec: HttpRequestSpec): Promise<void> => {
        await saveRequestToCollection(spec, t('api.collections.defaultName'))
      },
    [t],
  )
  const onSent = React.useCallback((): void => {
    void loadApiHistory()
  }, [])

  return (
    <div style={rootStyle} data-vibe-api-workbench="1">
      <div style={headerStyle} data-vibe-api-header="1">
        <button
          type="button"
          style={toolsButtonStyle}
          aria-expanded={drawerOpen}
          data-vibe-tools-toggle="1"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          {drawerOpen ? `▾ ${t('api.drawer.toggle')}` : `▸ ${t('api.drawer.toggle')}`}
        </button>
        <div
          role="group"
          aria-label={t('api.mode.label')}
          style={modeSwitchStyle}
          data-vibe-mode-toggle="1"
        >
          <button
            type="button"
            aria-pressed={mode === 'beginner'}
            data-vibe-mode="beginner"
            style={modeButtonStyle(mode === 'beginner')}
            onClick={() => chooseMode('beginner')}
          >
            {t('api.mode.beginner')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'pro'}
            data-vibe-mode="pro"
            style={modeButtonStyle(mode === 'pro')}
            onClick={() => chooseMode('pro')}
          >
            {t('api.mode.pro')}
          </button>
        </div>
      </div>

      <div style={drawerStyle(drawerOpen)} data-vibe-drawer="1" aria-hidden={!drawerOpen}>
        <div style={drawerHeaderStyle}>
          <span style={drawerTitleStyle}>{t('api.drawer.title')}</span>
          <button
            type="button"
            style={toolsButtonStyle}
            data-vibe-drawer-close="1"
            onClick={() => setDrawerOpen(false)}
          >
            {t('api.drawer.close')}
          </button>
        </div>
        <CollectionTree locale={locale} />
        <HistoryList locale={locale} />
        <EnvironmentPanel locale={locale} />
        <OpenApiImportPanel locale={locale} />
      </div>

      <RequestBuilder
        locale={locale}
        save={save}
        onSent={onSent}
        mode={mode}
        sampleUrl={sampleUrl}
      />
    </div>
  )
}
