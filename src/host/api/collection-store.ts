/**
 * `.vibe/api/collections/<id>.json` persistence (T037).
 *
 * One file per collection, named by collection id, so a collection can be
 * listed, reopened, copied and deleted without an index file. Writes validate
 * first and redact every stored request, then atomically replace the file.
 * Reads never throw for bad content: invalid, oversized or foreign files are
 * reported as `skipped` by `list` and read as missing by `read`.
 */
import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  API_COLLECTION_FILE_BYTES_MAX,
  API_NAME_CHARS_MAX,
  isApiCollection,
  isApiStoreId,
  redactHttpRequest,
  type ApiCollection,
  type ApiCollectionFolder,
  type ApiSavedRequest,
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

export const API_COLLECTION_DIR_NAME = 'collections'
export const API_COLLECTION_FILE_EXT = '.json'

export interface ApiCollectionListResult {
  readonly collections: ApiCollection[]
  /** `.json` files with a valid id stem that read as invalid or missing. */
  readonly skipped: number
}

/** Alphabetical by name, ties broken by id so listing stays deterministic. */
function byName(a: ApiCollection, b: ApiCollection): number {
  const delta = a.name.localeCompare(b.name)
  return delta !== 0 ? delta : a.id.localeCompare(b.id)
}

function redactSavedRequest(saved: ApiSavedRequest): ApiSavedRequest {
  return { id: saved.id, name: saved.name, request: redactHttpRequest(saved.request) }
}

export function redactCollection(collection: ApiCollection): ApiCollection {
  return {
    id: collection.id,
    name: collection.name,
    ...(collection.folders === undefined
      ? {}
      : { folders: collection.folders.map((folder) => ({ ...folder, requests: folder.requests.map(redactSavedRequest) })) }),
    ...(collection.requests === undefined
      ? {}
      : { requests: collection.requests.map(redactSavedRequest) }),
  }
}

export class ApiCollectionStore {
  readonly projectDir: string
  readonly dirPath: string
  private readonly renameFile: RenameFile | undefined

  constructor(projectDir: string, options: ApiStoreFileOptions = {}) {
    if (typeof projectDir !== 'string' || projectDir.trim() === '') {
      throw new ApiStoreError(
        'invalid_project_path',
        'vibe-studio: projectDir is required for API collections',
      )
    }
    this.projectDir = projectDir
    this.dirPath = join(projectDir, '.vibe', 'api', API_COLLECTION_DIR_NAME)
    if (!isInside(projectDir, this.dirPath)) {
      throw new ApiStoreError(
        'invalid_project_path',
        `vibe-studio: collections resolve outside the project: ${this.dirPath}`,
      )
    }
    this.renameFile = options.renameFile
  }

  filePath(id: string): string {
    if (!isApiStoreId(id)) {
      throw new ApiStoreError('invalid_id', `vibe-studio: "${id}" is not a usable collection id`)
    }
    return join(this.dirPath, `${id}${API_COLLECTION_FILE_EXT}`)
  }

  /** Validates, redacts and atomically writes one collection file. */
  async save(collection: ApiCollection): Promise<void> {
    if (!isApiCollection(collection)) {
      throw new ApiStoreError(
        'invalid_data',
        'vibe-studio: refusing to store an invalid API collection',
      )
    }
    const stored = redactCollection(collection)
    const payload = `${JSON.stringify(stored, null, 2)}\n`
    try {
      const dir = await ensureDirInsideProject(this.projectDir, this.dirPath)
      await writeJsonInside(dir, `${stored.id}${API_COLLECTION_FILE_EXT}`, payload, API_COLLECTION_FILE_BYTES_MAX, {
        renameFile: this.renameFile,
      })
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError(
        'io',
        `vibe-studio: cannot write collection ${collection.id}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  /** Reads one collection; missing, foreign, oversized or invalid reads as `null`. */
  async read(id: string): Promise<ApiCollection | null> {
    if (!isApiStoreId(id)) return null
    try {
      const dir = await existingDirInsideProject(this.projectDir, this.dirPath)
      if (!dir) return null
      const parsed = await readJsonInside(
        dir,
        `${id}${API_COLLECTION_FILE_EXT}`,
        API_COLLECTION_FILE_BYTES_MAX,
      )
      return isApiCollection(parsed) ? parsed : null
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError('io', `vibe-studio: cannot read collection ${id}: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }

  /** All readable collections by name; bad files are counted, not thrown. */
  async list(): Promise<ApiCollectionListResult> {
    try {
      const dir = await existingDirInsideProject(this.projectDir, this.dirPath)
      if (!dir) return { collections: [], skipped: 0 }
      const entries = await readdir(dir, { withFileTypes: true })
      const found: ApiCollection[] = []
      let skipped = 0
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(API_COLLECTION_FILE_EXT)) continue
        const id = entry.name.slice(0, -API_COLLECTION_FILE_EXT.length)
        if (!isApiStoreId(id)) continue
        const parsed = await readJsonInside(dir, entry.name, API_COLLECTION_FILE_BYTES_MAX)
        if (isApiCollection(parsed) && parsed.id === id) found.push(parsed)
        else skipped += 1
      }
      return { collections: found.sort(byName), skipped }
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError(
        'io',
        `vibe-studio: cannot list collections: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  /** Deletes one collection; returns whether a file was removed. */
  async remove(id: string): Promise<boolean> {
    if (!isApiStoreId(id)) return false
    try {
      const dir = await existingDirInsideProject(this.projectDir, this.dirPath)
      if (!dir) return false
      return await removeFileInside(dir, `${id}${API_COLLECTION_FILE_EXT}`)
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError(
        'io',
        `vibe-studio: cannot delete collection ${id}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  /**
   * Renames a collection in place (T046 R5). The id and every request/folder id
   * stay, so an open row, a saved draft and a history entry keep pointing at
   * the same file; only the display name changes. The name is trimmed and
   * capped exactly like a save, and a blank name is refused before any write.
   */
  async rename(id: string, name: string): Promise<ApiCollection> {
    const trimmed = name.trim()
    if (trimmed === '') {
      throw new ApiStoreError('invalid_data', 'vibe-studio: a collection needs a name')
    }
    const source = await this.read(id)
    if (!source) {
      throw new ApiStoreError('not_found', `vibe-studio: collection not found: ${id}`)
    }
    const renamed: ApiCollection = {
      ...source,
      name: trimmed.slice(0, API_NAME_CHARS_MAX),
    }
    await this.save(renamed)
    return renamed
  }

  /**
   * Copies a collection under a new id (and every nested id), leaving the
   * source untouched. The copy inherits the already-redacted stored spec.
   */
  async duplicate(
    id: string,
    options: { id?: string; name?: string } = {},
  ): Promise<ApiCollection> {
    const source = await this.read(id)
    if (!source) {
      throw new ApiStoreError('not_found', `vibe-studio: collection not found: ${id}`)
    }
    const copy: ApiCollection = {
      id: options.id ?? randomUUID(),
      name: (options.name ?? `${source.name} copy`).slice(0, API_NAME_CHARS_MAX),
      ...(source.folders === undefined
        ? {}
        : {
            folders: source.folders.map(
              (folder): ApiCollectionFolder => ({
                id: randomUUID(),
                name: folder.name,
                requests: folder.requests.map(cloneRequest),
              }),
            ),
          }),
      ...(source.requests === undefined
        ? {}
        : { requests: source.requests.map(cloneRequest) }),
    }
    await this.save(copy)
    return copy
  }
}

function cloneRequest(saved: ApiSavedRequest): ApiSavedRequest {
  const request: HttpRequestSpec = { ...saved.request }
  return { id: randomUUID(), name: saved.name, request }
}

export function createApiCollectionStore(
  projectDir: string,
  options?: ApiStoreFileOptions,
): ApiCollectionStore {
  return new ApiCollectionStore(projectDir, options)
}
