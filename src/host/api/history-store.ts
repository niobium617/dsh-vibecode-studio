/**
 * `.vibe/api/history.json` persistence (T037).
 *
 * Sent requests accumulate in one bounded, newest-first JSON document: the
 * panel only needs search and clear, so a ring buffer beats one file per send.
 * Every entry stores the *redacted* request — variables stay as `{{name}}`,
 * sensitive headers/query/auth/JSON keys are masked — so a history file never
 * holds a plaintext secret even when the user pasted one into the panel.
 *
 * A corrupt or foreign document reads as empty rather than failing the panel;
 * individual entries that fail validation are skipped and counted.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  API_HISTORY_ENTRIES_MAX,
  API_HISTORY_FILE_BYTES_MAX,
  API_HISTORY_LIMIT_DEFAULT,
  isApiHistoryEntry,
  isApiHistoryQuery,
  isHttpRequestSpec,
  redactHttpRequest,
  type ApiHistoryEntry,
  type ApiHistoryQuery,
  type HttpRequestSpec,
} from '../../contracts/api'
import {
  ApiStoreError,
  ensureDirInsideProject,
  errorMessage,
  existingDirInsideProject,
  isInside,
  readJsonInside,
  removeFileInside,
  writeJsonInside,
  type ApiStoreFileOptions,
  type RenameFile,
} from './store-files'

export const API_HISTORY_FILE_NAME = 'history.json'
export const API_HISTORY_VERSION = 1

export interface ApiHistoryStoreOptions extends ApiStoreFileOptions {
  /** Overridable in tests so timestamps stay deterministic. */
  readonly now?: () => Date
  /** Overridable in tests so entry ids stay deterministic. */
  readonly nextId?: () => string
}

export interface ApiHistoryAppendDetails {
  readonly status?: number
  readonly elapsedMs?: number
  /** Defaults to now; a `Date` or ISO string. */
  readonly at?: Date | string
}

export interface ApiHistoryListResult {
  readonly entries: ApiHistoryEntry[]
  /** Matches before `limit` was applied. */
  readonly total: number
  /** Entries in the document that failed validation and were skipped. */
  readonly skipped: number
}

interface ApiHistoryDocument {
  readonly version: number
  readonly entries: readonly unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function matchesQuery(entry: ApiHistoryEntry, query: string): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  const haystack = `${entry.method} ${entry.url} ${entry.status ?? ''}`.toLowerCase()
  return haystack.includes(needle)
}

export class ApiHistoryStore {
  readonly projectDir: string
  readonly dirPath: string
  private readonly renameFile: RenameFile | undefined
  private readonly now: () => Date
  private readonly nextId: () => string

  constructor(projectDir: string, options: ApiHistoryStoreOptions = {}) {
    if (typeof projectDir !== 'string' || projectDir.trim() === '') {
      throw new ApiStoreError(
        'invalid_project_path',
        'vibe-studio: projectDir is required for API history',
      )
    }
    this.projectDir = projectDir
    this.dirPath = join(projectDir, '.vibe', 'api')
    if (!isInside(projectDir, this.dirPath)) {
      throw new ApiStoreError(
        'invalid_project_path',
        `vibe-studio: history resolves outside the project: ${this.dirPath}`,
      )
    }
    this.renameFile = options.renameFile
    this.now = options.now ?? (() => new Date())
    this.nextId = options.nextId ?? (() => randomUUID())
  }

  /** Records one send. The request is redacted before it reaches the file. */
  async append(
    request: HttpRequestSpec,
    details: ApiHistoryAppendDetails = {},
  ): Promise<ApiHistoryEntry> {
    if (!isHttpRequestSpec(request)) {
      throw new ApiStoreError('invalid_data', 'vibe-studio: refusing to store an invalid request')
    }
    const stored = redactHttpRequest(request)
    if (!isHttpRequestSpec(stored)) {
      throw new ApiStoreError('invalid_data', 'vibe-studio: redacted request is not storable')
    }
    const at =
      details.at === undefined
        ? this.now().toISOString()
        : details.at instanceof Date
          ? details.at.toISOString()
          : details.at
    const entry: ApiHistoryEntry = {
      id: this.nextId(),
      at,
      method: stored.method,
      url: stored.url,
      ...(details.status === undefined ? {} : { status: details.status }),
      ...(details.elapsedMs === undefined ? {} : { elapsedMs: details.elapsedMs }),
      request: stored,
    }
    if (!isApiHistoryEntry(entry)) {
      throw new ApiStoreError('invalid_data', 'vibe-studio: refusing to store an invalid history entry')
    }

    try {
      const existing = await this.readEntries()
      const entries = [entry, ...existing.entries].slice(0, API_HISTORY_ENTRIES_MAX)
      await this.write(entries)
      return entry
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError('io', `vibe-studio: cannot write API history: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }

  /** Newest-first, optionally filtered; `total` counts matches before `limit`. */
  async list(params?: ApiHistoryQuery): Promise<ApiHistoryListResult> {
    let query: ApiHistoryQuery = {}
    if (params !== undefined) {
      if (!isApiHistoryQuery(params)) {
        throw new ApiStoreError('invalid_data', 'vibe-studio: invalid API history query')
      }
      query = params
    }
    try {
      const { entries, skipped } = await this.readEntries()
      const matched = entries.filter((entry) => matchesQuery(entry, query.query ?? ''))
      const limit = query.limit ?? API_HISTORY_LIMIT_DEFAULT
      return { entries: matched.slice(0, limit), total: matched.length, skipped }
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError('io', `vibe-studio: cannot read API history: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }

  /** Deletes the history document; returns whether one existed. */
  async clear(): Promise<boolean> {
    try {
      const dir = await existingDirInsideProject(this.projectDir, this.dirPath)
      if (!dir) return false
      return await removeFileInside(dir, API_HISTORY_FILE_NAME)
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError('io', `vibe-studio: cannot clear API history: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }

  private async write(entries: readonly ApiHistoryEntry[]): Promise<void> {
    const dir = await ensureDirInsideProject(this.projectDir, this.dirPath)
    const document: ApiHistoryDocument = { version: API_HISTORY_VERSION, entries }
    const payload = `${JSON.stringify(document, null, 2)}\n`
    await writeJsonInside(dir, API_HISTORY_FILE_NAME, payload, API_HISTORY_FILE_BYTES_MAX, {
      renameFile: this.renameFile,
    })
  }

  /** Splits the stored document into valid entries and a skip count. */
  private async readEntries(): Promise<{ entries: ApiHistoryEntry[]; skipped: number }> {
    const dir = await existingDirInsideProject(this.projectDir, this.dirPath)
    if (!dir) return { entries: [], skipped: 0 }
    const parsed = await readJsonInside(dir, API_HISTORY_FILE_NAME, API_HISTORY_FILE_BYTES_MAX)
    if (!isRecord(parsed) || parsed.version !== API_HISTORY_VERSION || !Array.isArray(parsed.entries)) {
      return { entries: [], skipped: 0 }
    }
    const entries: ApiHistoryEntry[] = []
    let skipped = 0
    for (const raw of parsed.entries) {
      if (isApiHistoryEntry(raw)) entries.push(raw)
      else skipped += 1
    }
    return { entries, skipped }
  }
}

export function createApiHistoryStore(
  projectDir: string,
  options?: ApiHistoryStoreOptions,
): ApiHistoryStore {
  return new ApiHistoryStore(projectDir, options)
}
