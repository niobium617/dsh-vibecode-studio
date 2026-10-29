/**
 * API page layout (T044): the request builder with the collection tree and the
 * send log underneath. The builder is the only place a request is sent; the
 * two panels below it load drafts and refresh each other's data.
 *
 * Save is deliberately one click: it appends to the default collection named
 * by the active locale, and the tree expands that collection so the saved row
 * is visible without another click.
 */
import * as React from 'react'
import type { HttpRequestSpec } from '../../contracts/api'
import { createTranslator, type Locale } from '../i18n'
import { CollectionTree } from './CollectionTree'
import { EnvironmentPanel } from './EnvironmentPanel'
import { HistoryList } from './HistoryList'
import { OpenApiImportPanel } from './OpenApiImportPanel'
import { RequestBuilder } from './RequestBuilder'
import { saveRequestToCollection } from './collection-store'
import { loadApiHistory } from './history-store'

const rootStyle: React.CSSProperties = {
  display: 'grid',
  gap: 0,
  alignContent: 'start',
}

export interface ApiWorkbenchProps {
  readonly locale?: Locale
}

export function ApiWorkbench({ locale }: ApiWorkbenchProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
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
      <RequestBuilder locale={locale} save={save} onSent={onSent} />
      <EnvironmentPanel locale={locale} />
      <CollectionTree locale={locale} />
      <OpenApiImportPanel locale={locale} />
      <HistoryList locale={locale} />
    </div>
  )
}
