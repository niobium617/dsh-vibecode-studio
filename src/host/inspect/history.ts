/**
 * Annotation history (T033) on top of the T030 store.
 *
 * `.vibe/annotations/<id>.json` stays the single source of truth, so a panel
 * restart loses nothing and the list/search/delete operations are just views
 * over the same files the store already validates. Bad files never fail a
 * request: `list` reports how many were skipped, `get` answers `not_found`,
 * and `remove` deletes a readable file by id.
 *
 * All persistence arrives over the authenticated unary transport. Nothing here
 * sends an annotation to the chat or submits it; saving is local history only.
 */
import {
  ANNOTATION_HISTORY_LIMIT_DEFAULT,
  isAnnotation,
  isAnnotationHistoryQuery,
  isAnnotationIdParams,
  matchesAnnotationQuery,
  toAnnotationHistoryEntry,
  type Annotation,
  type AnnotationHistoryQuery,
  type AnnotationHistoryRemoveResult,
  type AnnotationHistoryResult,
  type AnnotationHistorySaveResult,
} from '../../contracts/annotation'
import { studioError, type StudioError } from '../../contracts/errors'
import {
  ANNOTATION_HISTORY_GET_METHOD,
  ANNOTATION_HISTORY_LIST_METHOD,
  ANNOTATION_HISTORY_REMOVE_METHOD,
  ANNOTATION_HISTORY_SAVE_METHOD,
} from '../../contracts/transport'
import type { UnaryRegistry } from '../transport'
import {
  AnnotationStoreError,
  createAnnotationStore,
  type AnnotationStore,
} from './annotation-store'

export interface AnnotationHistoryServiceOptions {
  /** Project root that owns `.vibe/annotations`. */
  readonly projectDir: string
  /** Injected in tests; defaults to a store for `projectDir`. */
  readonly store?: AnnotationStore
}

/** Keeps store errors inside the contract's stable error codes. */
export function toAnnotationHistoryError(error: unknown): StudioError {
  if (error instanceof AnnotationStoreError) {
    switch (error.code) {
      case 'invalid_annotation':
      case 'annotation_too_large':
        return studioError('invalid_input', error.message)
      case 'project_missing':
        return studioError('not_found', error.message)
      case 'path_outside_project':
        return studioError('permission_denied', error.message)
      case 'invalid_project_path':
        return studioError('invalid_config', error.message)
      default:
        return studioError('internal', 'vibe-studio: annotation storage failed')
    }
  }
  return studioError('internal', 'vibe-studio: annotation storage failed')
}

function invalidParams(field = 'params'): StudioError {
  return studioError('invalid_input', 'vibe-studio: invalid annotation history params', {
    field,
  })
}

export class AnnotationHistoryService {
  readonly store: AnnotationStore

  constructor(options: AnnotationHistoryServiceOptions) {
    if (!options || typeof options.projectDir !== 'string' || options.projectDir.trim() === '') {
      throw new Error('vibe-studio: annotation history requires a projectDir')
    }
    this.store = options.store ?? createAnnotationStore(options.projectDir)
  }

  /**
   * Lists summaries newest first, optionally filtered by a case-insensitive
   * substring. `total` counts matches before `limit`; `skipped` counts
   * unreadable files so the panel can surface them without failing.
   */
  async list(params?: unknown): Promise<AnnotationHistoryResult> {
    let query: AnnotationHistoryQuery = {}
    if (params !== undefined) {
      if (!isAnnotationHistoryQuery(params)) throw invalidParams()
      query = params
    }

    try {
      const result = await this.store.listWithIssues()
      const matched = result.annotations.filter((annotation) =>
        matchesAnnotationQuery(annotation, query.query ?? ''),
      )
      const limit = query.limit ?? ANNOTATION_HISTORY_LIMIT_DEFAULT
      return {
        entries: matched.slice(0, limit).map(toAnnotationHistoryEntry),
        total: matched.length,
        skipped: result.skipped,
      }
    } catch (error) {
      throw toAnnotationHistoryError(error)
    }
  }

  /** Returns the full annotation for reopening; missing or corrupt is `not_found`. */
  async get(params?: unknown): Promise<Annotation> {
    if (!isAnnotationIdParams(params)) throw invalidParams()
    let annotation: Annotation | null
    try {
      annotation = await this.store.read(params.id)
    } catch (error) {
      throw toAnnotationHistoryError(error)
    }
    if (annotation === null) {
      throw studioError('not_found', `vibe-studio: annotation ${params.id} was not found`)
    }
    return annotation
  }

  /** Persists a new or edited annotation, replacing any file with the same id. */
  async save(params?: unknown): Promise<AnnotationHistorySaveResult> {
    if (!isAnnotation(params)) throw invalidParams()
    try {
      await this.store.save(params)
    } catch (error) {
      throw toAnnotationHistoryError(error)
    }
    return { id: params.id }
  }

  /** Deletes one annotation file; an unknown id reports `removed: false`. */
  async remove(params?: unknown): Promise<AnnotationHistoryRemoveResult> {
    if (!isAnnotationIdParams(params)) throw invalidParams()
    try {
      return { id: params.id, removed: await this.store.remove(params.id) }
    } catch (error) {
      throw toAnnotationHistoryError(error)
    }
  }
}

export function createAnnotationHistoryService(
  options: AnnotationHistoryServiceOptions,
): AnnotationHistoryService {
  return new AnnotationHistoryService(options)
}

/** Registers the four history methods; returns an idempotent unregister. */
export function registerAnnotationHistoryMethods(
  registry: UnaryRegistry,
  service: AnnotationHistoryService,
): () => void {
  const offList = registry.register(ANNOTATION_HISTORY_LIST_METHOD, (params) =>
    service.list(params),
  )
  const offGet = registry.register(ANNOTATION_HISTORY_GET_METHOD, (params) => service.get(params))
  const offSave = registry.register(ANNOTATION_HISTORY_SAVE_METHOD, (params) =>
    service.save(params),
  )
  const offRemove = registry.register(ANNOTATION_HISTORY_REMOVE_METHOD, (params) =>
    service.remove(params),
  )
  return () => {
    offList()
    offGet()
    offSave()
    offRemove()
  }
}
