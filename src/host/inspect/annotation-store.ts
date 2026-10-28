/**
 * `.vibe/annotations/*.json` persistence (SPEC §6.5, task T030).
 *
 * One file per annotation, named by the annotation id so history can be listed
 * and reopened without an index file. Writes validate first, then atomically
 * replace the file through a same-directory temp file. Reads never throw for
 * bad content: an invalid, oversized or foreign file is reported as missing
 * from `read` and skipped by `list`, so one corrupt file cannot break history.
 *
 * The directory may live in a target project the user did not author, so every
 * resolved path must stay inside `.vibe/annotations` (junctions and symlinks
 * included) and each file is size-capped before parsing.
 */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  deserializeAnnotation,
  isAnnotation,
  isAnnotationId,
  serializeAnnotation,
  type Annotation,
} from '../../contracts'
import { utf8Bytes } from '../../contracts/budget'

export const ANNOTATION_DIR_NAME = 'annotations'
export const ANNOTATION_FILE_EXT = '.json'
export const MAX_ANNOTATION_FILE_BYTES = 64 * 1024

export type AnnotationStoreErrorCode =
  | 'invalid_project_path'
  | 'project_missing'
  | 'path_outside_project'
  | 'invalid_annotation'
  | 'annotation_too_large'
  | 'io'

export class AnnotationStoreError extends Error {
  readonly code: AnnotationStoreErrorCode

  constructor(code: AnnotationStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AnnotationStoreError'
    this.code = code
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function lstatSafe(target: string) {
  try {
    return await lstat(target)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined
    throw error
  }
}

/** Newest first; ties broken by id so listing stays deterministic. */
function byNewest(a: Annotation, b: Annotation): number {
  const delta = Date.parse(b.createdAt) - Date.parse(a.createdAt)
  return delta !== 0 ? delta : a.id.localeCompare(b.id)
}

export class AnnotationStore {
  readonly projectDir: string
  readonly vibeDir: string
  readonly dirPath: string

  constructor(projectDir: string) {
    if (typeof projectDir !== 'string' || projectDir.trim() === '') {
      throw new AnnotationStoreError(
        'invalid_project_path',
        'vibe-studio: projectDir is required for annotation storage',
      )
    }
    this.projectDir = resolve(projectDir)
    this.vibeDir = join(this.projectDir, '.vibe')
    this.dirPath = join(this.vibeDir, ANNOTATION_DIR_NAME)
    if (!isInside(this.projectDir, this.dirPath)) {
      throw new AnnotationStoreError(
        'invalid_project_path',
        `vibe-studio: annotations resolve outside the project: ${this.dirPath}`,
      )
    }
  }

  filePath(id: string): string {
    if (!isAnnotationId(id)) {
      throw new AnnotationStoreError(
        'invalid_annotation',
        `vibe-studio: "${id}" is not a usable annotation id`,
      )
    }
    return join(this.dirPath, `${id}${ANNOTATION_FILE_EXT}`)
  }

  /** Validates, size-checks and atomically writes one annotation file. */
  async save(annotation: Annotation): Promise<void> {
    if (!isAnnotation(annotation)) {
      throw new AnnotationStoreError(
        'invalid_annotation',
        'vibe-studio: refusing to store an invalid annotation',
      )
    }
    const payload = serializeAnnotation(annotation)
    if (utf8Bytes(payload) > MAX_ANNOTATION_FILE_BYTES) {
      throw new AnnotationStoreError(
        'annotation_too_large',
        `vibe-studio: annotation ${annotation.id} exceeds ${MAX_ANNOTATION_FILE_BYTES} bytes`,
      )
    }

    try {
      const dir = await this.ensureDir()
      const file = join(dir, `${annotation.id}${ANNOTATION_FILE_EXT}`)
      await this.rejectForeignFile(dir, file)
      const tempPath = join(dir, `.${annotation.id}.${process.pid}.${randomUUID()}.tmp`)
      try {
        await writeFile(tempPath, payload, { encoding: 'utf8', flag: 'wx' })
        await rename(tempPath, file)
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined)
        throw error
      }
    } catch (error) {
      if (error instanceof AnnotationStoreError) throw error
      throw new AnnotationStoreError(
        'io',
        `vibe-studio: cannot write annotation ${annotation.id}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  /** Reads one annotation; missing, foreign or invalid files read as `null`. */
  async read(id: string): Promise<Annotation | null> {
    if (!isAnnotationId(id)) return null
    try {
      const dir = await this.existingDir()
      if (!dir) return null
      return await this.readFile(dir, `${id}${ANNOTATION_FILE_EXT}`)
    } catch (error) {
      if (error instanceof AnnotationStoreError) throw error
      throw new AnnotationStoreError(
        'io',
        `vibe-studio: cannot read annotation ${id}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  /** All readable annotations, newest first; bad files are skipped. */
  async list(): Promise<Annotation[]> {
    try {
      const dir = await this.existingDir()
      if (!dir) return []
      const entries = await readdir(dir, { withFileTypes: true })
      const found: Annotation[] = []
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (!entry.name.endsWith(ANNOTATION_FILE_EXT)) continue
        const id = entry.name.slice(0, -ANNOTATION_FILE_EXT.length)
        if (!isAnnotationId(id)) continue
        const annotation = await this.readFile(dir, entry.name)
        if (annotation) found.push(annotation)
      }
      return found.sort(byNewest)
    } catch (error) {
      if (error instanceof AnnotationStoreError) throw error
      throw new AnnotationStoreError(
        'io',
        `vibe-studio: cannot list annotations: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  /** Deletes one annotation; returns whether a file was removed. */
  async remove(id: string): Promise<boolean> {
    if (!isAnnotationId(id)) return false
    try {
      const dir = await this.existingDir()
      if (!dir) return false
      const file = join(dir, `${id}${ANNOTATION_FILE_EXT}`)
      const info = await lstatSafe(file)
      if (!info || !info.isFile()) return false
      await rm(file, { force: true })
      return true
    } catch (error) {
      if (error instanceof AnnotationStoreError) throw error
      throw new AnnotationStoreError(
        'io',
        `vibe-studio: cannot delete annotation ${id}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  /** Creates `.vibe/annotations`, rejecting a `.vibe` that leaves the project. */
  private async ensureDir(): Promise<string> {
    let realRoot: string
    try {
      realRoot = await realpath(this.projectDir)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        throw new AnnotationStoreError(
          'project_missing',
          `vibe-studio: project directory does not exist: ${this.projectDir}`,
          { cause: error },
        )
      }
      throw error
    }

    await mkdir(this.dirPath, { recursive: true })
    const realDir = await realpath(this.dirPath)
    if (!isInside(realRoot, realDir)) {
      throw new AnnotationStoreError(
        'path_outside_project',
        `vibe-studio: annotations resolve outside the project: ${realDir}`,
      )
    }
    return realDir
  }

  /** Resolves the existing annotations directory, or `undefined` if absent. */
  private async existingDir(): Promise<string | undefined> {
    const info = await lstatSafe(this.dirPath)
    if (!info) return undefined
    if (info.isSymbolicLink()) {
      throw new AnnotationStoreError(
        'path_outside_project',
        `vibe-studio: annotations is a link: ${this.dirPath}`,
      )
    }
    if (!info.isDirectory()) {
      throw new AnnotationStoreError(
        'io',
        `vibe-studio: annotations is not a directory: ${this.dirPath}`,
      )
    }
    const realDir = await realpath(this.dirPath)
    const realRoot = await realpath(this.projectDir)
    if (!isInside(realRoot, realDir)) {
      throw new AnnotationStoreError(
        'path_outside_project',
        `vibe-studio: annotations resolve outside the project: ${realDir}`,
      )
    }
    return realDir
  }

  /** A pre-existing symlink at the target could redirect the rename elsewhere. */
  private async rejectForeignFile(dir: string, file: string): Promise<void> {
    const info = await lstatSafe(file)
    if (!info) return
    if (info.isSymbolicLink()) {
      throw new AnnotationStoreError(
        'path_outside_project',
        `vibe-studio: annotation file is a link: ${file}`,
      )
    }
    if (!info.isFile()) {
      throw new AnnotationStoreError('io', `vibe-studio: annotation path is not a file: ${file}`)
    }
    const realFile = await realpath(file)
    if (!isInside(dir, realFile)) {
      throw new AnnotationStoreError(
        'path_outside_project',
        `vibe-studio: annotation resolves outside annotations: ${realFile}`,
      )
    }
  }

  /** Reads and validates one file inside `dir`; anything unusable is `null`. */
  private async readFile(dir: string, name: string): Promise<Annotation | null> {
    const file = join(dir, name)
    const info = await lstatSafe(file)
    if (!info || info.isSymbolicLink() || !info.isFile()) return null
    if (info.size > MAX_ANNOTATION_FILE_BYTES) return null
    const realFile = await realpath(file)
    if (!isInside(dir, realFile)) return null
    const text = await readFile(file, 'utf8')
    if (utf8Bytes(text) > MAX_ANNOTATION_FILE_BYTES) return null
    try {
      return deserializeAnnotation(text)
    } catch {
      return null
    }
  }
}

export function createAnnotationStore(projectDir: string): AnnotationStore {
  return new AnnotationStore(projectDir)
}
