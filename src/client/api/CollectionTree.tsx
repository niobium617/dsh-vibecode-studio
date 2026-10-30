/**
 * Collection tree for the API page (T044).
 *
 * Rows are summaries from the Host; expanding one reads that collection file
 * alone. Clicking a saved request hands the spec to the request builder
 * through the shared draft store — it is loaded into the form, never sent.
 * Deleting a collection asks for a second click and says what happens.
 */
import * as React from 'react'
import type { ApiCollection, ApiSavedRequest } from '../../contracts/api'
import { createTranslator, type Locale } from '../i18n'
import { EmptyState, ErrorState, LoadingState } from '../shell/StateViews'
import {
  duplicateCollection,
  loadCollectionDetail,
  loadCollections,
  removeCollection,
  renameCollection,
  toggleCollection,
  useApiCollections,
} from './collection-store'
import { openDraftInBuilder } from './draft-store'

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 12,
  borderTop: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  margin: 0,
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  font: '600 12px/1.4 system-ui, sans-serif',
}

const countStyle: React.CSSProperties = {
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.6,
}

const listStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  margin: 0,
  padding: 0,
  listStyle: 'none',
}

const collectionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const toggleStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  font: '12px/1.4 system-ui, sans-serif',
}

const nameStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const metaStyle: React.CSSProperties = {
  flex: '0 0 auto',
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.6,
}

const actionStyle: React.CSSProperties = {
  flex: '0 0 auto',
  font: '11px/1.4 system-ui, sans-serif',
  padding: '2px 8px',
  borderRadius: 4,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const renameFormStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flex: '0 1 auto',
  minWidth: 0,
}

const renameInputStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  background: 'transparent',
  color: 'inherit',
  minWidth: 0,
  width: 140,
}

const dangerStyle: React.CSSProperties = {
  ...actionStyle,
  borderColor: 'var(--dsw-danger-color, #d14343)',
  color: 'var(--dsw-danger-color, #d14343)',
}

const requestListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 2,
  margin: '2px 0 6px 16px',
  padding: 0,
  listStyle: 'none',
}

const requestStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '3px 6px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  overflow: 'hidden',
}

const folderStyle: React.CSSProperties = {
  margin: '2px 0 0 12px',
  font: '600 10px/1.4 system-ui, sans-serif',
  opacity: 0.6,
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  font: '10px/1.5 system-ui, sans-serif',
  opacity: 0.7,
}

const errorLineStyle: React.CSSProperties = {
  margin: 0,
  font: '10px/1.5 system-ui, sans-serif',
  color: 'var(--dsw-color-danger, #c62828)',
}

const confirmStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 8,
  borderRadius: 6,
  border: '1px solid var(--dsw-danger-color, #d14343)',
}

function requestsOf(collection: ApiCollection): readonly ApiSavedRequest[] {
  return collection.requests ?? []
}

export interface CollectionTreeProps {
  readonly locale?: Locale
}

export function CollectionTree({ locale }: CollectionTreeProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const state = useApiCollections()
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  /** Inline rename: the row being edited, its draft, and one shared error line. */
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState('')
  const [renaming, setRenaming] = React.useState(false)
  const [copyingId, setCopyingId] = React.useState<string | null>(null)
  const [rowError, setRowError] = React.useState<string | null>(null)

  // The disk is the source of truth, so each mount refreshes the summaries.
  React.useEffect(() => {
    void loadCollections()
  }, [])

  const handleOpen = (request: ApiSavedRequest): void => {
    openDraftInBuilder({ spec: request.request, source: 'collection' })
  }

  const handleDelete = async (id: string): Promise<void> => {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await removeCollection(id)
      setConfirmingId(null)
    } catch {
      setDeleteError(t('api.collections.deleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  const startRename = (id: string, name: string): void => {
    setRowError(null)
    setRenamingId(id)
    setRenameDraft(name)
  }

  const handleRename = async (id: string): Promise<void> => {
    const name = renameDraft.trim()
    if (renaming || name === '') return
    setRenaming(true)
    setRowError(null)
    try {
      await renameCollection(id, name)
      setRenamingId(null)
    } catch {
      setRowError(t('api.collections.renameFailed'))
    } finally {
      setRenaming(false)
    }
  }

  const handleCopy = async (id: string): Promise<void> => {
    if (copyingId !== null) return
    setCopyingId(id)
    setRowError(null)
    try {
      await duplicateCollection(id)
    } catch {
      setRowError(t('api.collections.copyFailed'))
    } finally {
      setCopyingId(null)
    }
  }

  const deleteTarget =
    confirmingId === null
      ? null
      : state.summaries.find((collection) => collection.id === confirmingId) ?? null

  return (
    <section data-vibe-collections="1" style={sectionStyle} aria-labelledby="vibe-collections-title">
      <div style={headerStyle}>
        <h3 id="vibe-collections-title" style={titleStyle}>
          {t('api.collections.title')}
        </h3>
        <span data-vibe-collections-count="1" style={countStyle}>
          {state.summaries.length}
        </span>
      </div>

      {state.status === 'loading' && state.summaries.length === 0 ? (
        <LoadingState label={t('api.collections.loading')} />
      ) : null}

      {state.status === 'error' ? (
        <ErrorState
          title={t('api.collections.error.title')}
          body={t('api.collections.error.body')}
          retryLabel={t('state.error.retry')}
          onRetry={() => void loadCollections()}
        />
      ) : null}

      {state.skipped > 0 ? (
        <p data-vibe-collections-skipped="1" role="status" style={noteStyle}>
          {t('api.collections.skipped', { count: state.skipped })}
        </p>
      ) : null}

      {state.status === 'ready' && state.summaries.length === 0 ? (
        <EmptyState
          title={t('api.collections.empty.title')}
          body={t('api.collections.empty.body')}
        />
      ) : null}

      {state.summaries.length > 0 ? (
        <ul data-vibe-collection-list="1" style={listStyle}>
          {state.summaries.map((collection) => {
            const expanded = state.expanded.includes(collection.id)
            const detail = state.details[collection.id]
            const detailStatus = state.detailStatus[collection.id]
            return (
              <li key={collection.id} data-vibe-collection={collection.id}>
                <div style={collectionRowStyle}>
                  <button
                    type="button"
                    style={toggleStyle}
                    data-vibe-collection-toggle="1"
                    aria-expanded={expanded}
                    onClick={() => toggleCollection(collection.id)}
                  >
                    <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                    <span style={nameStyle} title={collection.name}>
                      {collection.name}
                    </span>
                    <span style={metaStyle}>
                      {t('api.collections.requestCount', { count: collection.requestCount })}
                    </span>
                  </button>
                  {renamingId === collection.id ? (
                    <span style={renameFormStyle}>
                      <input
                        style={renameInputStyle}
                        data-vibe-collection-rename-input="1"
                        aria-label={t('api.collections.rename')}
                        value={renameDraft}
                        autoFocus
                        disabled={renaming}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void handleRename(collection.id)
                          if (event.key === 'Escape') setRenamingId(null)
                        }}
                      />
                      <button
                        type="button"
                        style={actionStyle}
                        data-vibe-collection-rename-save="1"
                        disabled={renaming || renameDraft.trim() === ''}
                        onClick={() => void handleRename(collection.id)}
                      >
                        {t('api.collections.renameSave')}
                      </button>
                      <button
                        type="button"
                        style={actionStyle}
                        data-vibe-collection-rename-cancel="1"
                        disabled={renaming}
                        onClick={() => setRenamingId(null)}
                      >
                        {t('api.collections.cancel')}
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        style={actionStyle}
                        data-vibe-collection-rename="1"
                        disabled={deleting || copyingId !== null}
                        onClick={() => startRename(collection.id, collection.name)}
                      >
                        {t('api.collections.rename')}
                      </button>
                      <button
                        type="button"
                        style={actionStyle}
                        data-vibe-collection-copy="1"
                        disabled={copyingId !== null || deleting}
                        onClick={() => void handleCopy(collection.id)}
                      >
                        {copyingId === collection.id
                          ? t('api.collections.copying')
                          : t('api.collections.copy')}
                      </button>
                      <button
                        type="button"
                        style={actionStyle}
                        data-vibe-collection-delete="1"
                        disabled={deleting || copyingId !== null}
                        onClick={() => {
                          setDeleteError(null)
                          setConfirmingId(collection.id)
                        }}
                      >
                        {t('api.collections.delete')}
                      </button>
                    </>
                  )}
                </div>

                {expanded ? (
                  <div data-vibe-collection-detail="1">
                    {detailStatus === 'loading' && detail === undefined ? (
                      <p style={noteStyle}>{t('api.collections.detail.loading')}</p>
                    ) : null}
                    {detailStatus === 'error' ? (
                      <p role="alert" style={errorLineStyle}>
                        {t('api.collections.detail.error')}{' '}
                        <button
                          type="button"
                          style={actionStyle}
                          data-vibe-collection-retry="1"
                          onClick={() => void loadCollectionDetail(collection.id)}
                        >
                          {t('state.error.retry')}
                        </button>
                      </p>
                    ) : null}
                    {detail === undefined ? null : (
                      <>
                        {detail.folders?.map((folder) => (
                          <div key={folder.id} data-vibe-collection-folder={folder.id}>
                            <p style={folderStyle}>{folder.name}</p>
                            <ul style={requestListStyle}>
                              {folder.requests.map((request) => (
                                <li key={request.id}>
                                  <button
                                    type="button"
                                    style={requestStyle}
                                    data-vibe-saved-request="1"
                                    title={request.request.url}
                                    onClick={() => handleOpen(request)}
                                  >
                                    {request.name}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                        {requestsOf(detail).length === 0 && (detail.folders?.length ?? 0) === 0 ? (
                          <p style={noteStyle}>{t('api.collections.detail.empty')}</p>
                        ) : null}
                        <ul style={requestListStyle}>
                          {requestsOf(detail).map((request) => (
                            <li key={request.id}>
                              <button
                                type="button"
                                style={requestStyle}
                                data-vibe-saved-request="1"
                                title={request.request.url}
                                onClick={() => handleOpen(request)}
                              >
                                {request.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {rowError === null ? null : (
        <p role="alert" style={errorLineStyle} data-vibe-collections-action-error="1">
          {rowError}
        </p>
      )}

      {deleteTarget === null ? null : (
        <div style={confirmStyle} role="alertdialog" data-vibe-collection-confirm="1">
          <strong style={titleStyle}>{t('api.collections.deleteConfirm.title')}</strong>
          <p style={noteStyle}>
            {t('api.collections.deleteConfirm.body', { name: deleteTarget.name })}
          </p>
          {deleteError === null ? null : (
            <p role="alert" style={errorLineStyle}>
              {deleteError}
            </p>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={actionStyle}
              data-vibe-collection-cancel="1"
              disabled={deleting}
              onClick={() => {
                setConfirmingId(null)
                setDeleteError(null)
              }}
            >
              {t('api.collections.cancel')}
            </button>
            <button
              type="button"
              style={dangerStyle}
              data-vibe-collection-confirm-delete="1"
              disabled={deleting}
              onClick={() => void handleDelete(deleteTarget.id)}
            >
              {t('api.collections.confirmDelete')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
