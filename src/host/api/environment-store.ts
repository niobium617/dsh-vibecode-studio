/**
 * `.vibe/api/environments/<id>.json` persistence (T046 R4, FR-API-04).
 *
 * Same shape as the collection store: one file per environment, named by id,
 * written atomically inside the project and size-capped before parsing. A
 * secret variable stores the *name* of a credential, never a value, so the
 * stored document and the client-safe view (`describeEnvironment`) stay one
 * step apart: only the view carries `configured` / `source`.
 *
 * Reads never throw for bad content: invalid, oversized or foreign files are
 * counted as `skipped` by `list` and read as missing by `read`.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  API_ENVIRONMENT_FILE_BYTES_MAX,
  API_NAME_CHARS_MAX,
  isApiEnvironment,
  isApiStoreId,
  type ApiEnvironment,
  type ApiEnvironmentSummary,
} from '../../contracts/api'
import { parseApiEnvironment } from './environment'
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

export const API_ENVIRONMENT_DIR_NAME = 'environments'
export const API_ENVIRONMENT_FILE_EXT = '.json'

export interface ApiEnvironmentListResult {
  readonly environments: ApiEnvironment[]
  /** `.json` files with a valid id stem that read as invalid or missing. */
  readonly skipped: number
}

type StoredEnvironment = ApiEnvironment & { readonly id: string; readonly name: string }

/** Saved name is required and bounded; the id must be file-stem safe. */
function storedEnvironment(environment: ApiEnvironment): StoredEnvironment {
  const parsed = parseApiEnvironment(environment)
  if (parsed.id === undefined || !isApiStoreId(parsed.id)) {
    throw new ApiStoreError('invalid_data', 'vibe-studio: an environment needs a usable id')
  }
  const name = parsed.name?.trim() ?? ''
  if (name === '' || name.length > API_NAME_CHARS_MAX) {
    throw new ApiStoreError('invalid_data', 'vibe-studio: an environment needs a name')
  }
  return { id: parsed.id, name, variables: parsed.variables }
}

function invalidStored(parsed: unknown, id: string): boolean {
  if (!isApiEnvironment(parsed)) return true
  if (parsed.id !== id) return true
  const name = parsed.name?.trim() ?? ''
  return name === '' || name.length > API_NAME_CHARS_MAX
}

function byName(a: ApiEnvironment, b: ApiEnvironment): number {
  const delta = (a.name ?? '').localeCompare(b.name ?? '')
  return delta !== 0 ? delta : (a.id ?? '').localeCompare(b.id ?? '')
}

export function summarizeEnvironment(environment: ApiEnvironment): ApiEnvironmentSummary {
  return {
    id: environment.id ?? '',
    name: environment.name ?? '',
    variableCount: environment.variables.length,
    secretCount: environment.variables.filter((variable) => variable.secret === true).length,
  }
}

export class ApiEnvironmentStore {
  readonly projectDir: string
  readonly dirPath: string
  private readonly renameFile: RenameFile | undefined

  constructor(projectDir: string, options: ApiStoreFileOptions = {}) {
    if (typeof projectDir !== 'string' || projectDir.trim() === '') {
      throw new ApiStoreError(
        'invalid_project_path',
        'vibe-studio: projectDir is required for API environments',
      )
    }
    this.projectDir = projectDir
    this.dirPath = join(projectDir, '.vibe', 'api', API_ENVIRONMENT_DIR_NAME)
    if (!isInside(projectDir, this.dirPath)) {
      throw new ApiStoreError(
        'invalid_project_path',
        `vibe-studio: environments resolve outside the project: ${this.dirPath}`,
      )
    }
    this.renameFile = options.renameFile
  }

  filePath(id: string): string {
    if (!isApiStoreId(id)) {
      throw new ApiStoreError('invalid_id', `vibe-studio: "${id}" is not a usable environment id`)
    }
    return join(this.dirPath, `${id}${API_ENVIRONMENT_FILE_EXT}`)
  }

  /** Validates (unique names, credential references) and atomically writes. */
  async save(environment: ApiEnvironment): Promise<void> {
    const stored = storedEnvironment(environment)
    const payload = `${JSON.stringify(stored, null, 2)}\n`
    try {
      const dir = await ensureDirInsideProject(this.projectDir, this.dirPath)
      await writeJsonInside(
        dir,
        `${stored.id}${API_ENVIRONMENT_FILE_EXT}`,
        payload,
        API_ENVIRONMENT_FILE_BYTES_MAX,
        { renameFile: this.renameFile },
      )
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError(
        'io',
        `vibe-studio: cannot write environment ${environment.id ?? ''}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  /** Reads one environment; missing, foreign, oversized or invalid reads `null`. */
  async read(id: string): Promise<ApiEnvironment | null> {
    if (!isApiStoreId(id)) return null
    try {
      const dir = await existingDirInsideProject(this.projectDir, this.dirPath)
      if (!dir) return null
      const parsed = await readJsonInside(
        dir,
        `${id}${API_ENVIRONMENT_FILE_EXT}`,
        API_ENVIRONMENT_FILE_BYTES_MAX,
      )
      return invalidStored(parsed, id) ? null : (parsed as ApiEnvironment)
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError(
        'io',
        `vibe-studio: cannot read environment ${id}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  /** All readable environments by name; bad files are counted, not thrown. */
  async list(): Promise<ApiEnvironmentListResult> {
    try {
      const dir = await existingDirInsideProject(this.projectDir, this.dirPath)
      if (!dir) return { environments: [], skipped: 0 }
      const entries = await readdir(dir, { withFileTypes: true })
      const found: ApiEnvironment[] = []
      let skipped = 0
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(API_ENVIRONMENT_FILE_EXT)) continue
        const id = entry.name.slice(0, -API_ENVIRONMENT_FILE_EXT.length)
        if (!isApiStoreId(id)) continue
        const parsed = await readJsonInside(dir, entry.name, API_ENVIRONMENT_FILE_BYTES_MAX)
        if (invalidStored(parsed, id)) skipped += 1
        else found.push(parsed as ApiEnvironment)
      }
      return { environments: found.sort(byName), skipped }
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError('io', `vibe-studio: cannot list environments: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }

  /** Deletes one environment; returns whether a file was removed. */
  async remove(id: string): Promise<boolean> {
    if (!isApiStoreId(id)) return false
    try {
      const dir = await existingDirInsideProject(this.projectDir, this.dirPath)
      if (!dir) return false
      return await removeFileInside(dir, `${id}${API_ENVIRONMENT_FILE_EXT}`)
    } catch (error) {
      if (error instanceof ApiStoreError) throw error
      throw new ApiStoreError(
        'io',
        `vibe-studio: cannot delete environment ${id}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }
}

export function createApiEnvironmentStore(
  projectDir: string,
  options?: ApiStoreFileOptions,
): ApiEnvironmentStore {
  return new ApiEnvironmentStore(projectDir, options)
}
