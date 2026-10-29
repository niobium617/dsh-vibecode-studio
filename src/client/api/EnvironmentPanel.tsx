/**
 * Environment panel wiring (T046 R4, FR-API-04).
 *
 * Owns the editable draft, the picker and the save/delete calls; the rendering
 * and read-only view stay in `EnvironmentEditor`. The selected environment id
 * lives in the environment store, and `RequestBuilder` sends it — the document
 * itself (credential references included) only travels once, on save.
 *
 * Rows are dropped when their name is blank, so a fresh empty row does not
 * block a save; the Host still validates the rest (placeholder grammar,
 * duplicate names, credential references).
 */
import * as React from 'react'
import type { ApiEnvironment } from '../../contracts/api'
import type { Locale } from '../i18n'
import {
  loadEnvironments,
  removeEnvironment,
  saveEnvironment,
  selectEnvironment,
  useApiEnvironments,
} from './environment-store'
import {
  EnvironmentEditor,
  type EnvironmentEditorStatus,
} from './EnvironmentEditor'

const EMPTY_DRAFT: ApiEnvironment = { name: '', variables: [] }

function normalized(draft: ApiEnvironment): ApiEnvironment {
  return {
    ...(draft.id === undefined ? {} : { id: draft.id }),
    name: (draft.name ?? '').trim(),
    variables: draft.variables
      .filter((variable) => variable.name.trim() !== '')
      .map((variable) => ({ ...variable, name: variable.name.trim() })),
  }
}

export interface EnvironmentPanelProps {
  readonly locale?: Locale
}

export function EnvironmentPanel({ locale }: EnvironmentPanelProps): React.ReactElement {
  const state = useApiEnvironments()
  const [draft, setDraft] = React.useState<ApiEnvironment>(EMPTY_DRAFT)
  const [status, setStatus] = React.useState<EnvironmentEditorStatus>({ kind: 'idle' })

  // Load the picker once; a failure stays visible in the status line.
  React.useEffect(() => {
    if (state.status === 'idle') void loadEnvironments()
  }, [state.status])

  // A selected environment becomes the draft. Saving replaces the selection
  // with the saved document, so this also refreshes ids assigned by the Host.
  React.useEffect(() => {
    if (state.active) setDraft(state.active.environment)
  }, [state.active])

  React.useEffect(() => {
    if (state.activeStatus === 'error') {
      setStatus({ kind: 'failed', detail: state.error ?? undefined })
    }
  }, [state.activeStatus, state.error])

  const busy = status.kind === 'saving'

  const handleSave = React.useCallback((): void => {
    setStatus({ kind: 'saving' })
    void saveEnvironment(normalized(draft))
      .then(() => setStatus({ kind: 'saved' }))
      .catch((error: unknown) =>
        setStatus({
          kind: 'failed',
          detail: error instanceof Error ? error.message : String(error),
        }),
      )
  }, [draft])

  const handleRemove = React.useCallback((): void => {
    if (draft.id === undefined) return
    setStatus({ kind: 'saving' })
    void removeEnvironment(draft.id)
      .then(() => {
        setDraft(EMPTY_DRAFT)
        setStatus({ kind: 'idle' })
      })
      .catch((error: unknown) =>
        setStatus({
          kind: 'failed',
          detail: error instanceof Error ? error.message : String(error),
        }),
      )
  }, [draft.id])

  const handleSelect = React.useCallback((id: string): void => {
    setStatus({ kind: 'idle' })
    if (id === '') {
      void selectEnvironment(null)
      setDraft(EMPTY_DRAFT)
      return
    }
    void selectEnvironment(id)
  }, [])

  const handleCreate = React.useCallback((): void => {
    void selectEnvironment(null)
    setDraft(EMPTY_DRAFT)
    setStatus({ kind: 'idle' })
  }, [])

  return (
    <EnvironmentEditor
      view={state.active?.view ?? { variables: [] }}
      draft={draft}
      summaries={state.summaries}
      busy={busy}
      status={status}
      locale={locale}
      onChange={setDraft}
      onSelect={handleSelect}
      onCreate={handleCreate}
      onSave={handleSave}
      onRemove={handleRemove}
    />
  )
}
