/**
 * Shared `.vibe/api` file plumbing for the collection and history stores
 * (T037).
 *
 * The directory lives in a target project the user did not necessarily author,
 * so every resolved path must stay inside the project (junctions and symlinks
 * included), every file is size-capped before parsing, and writes replace a
 * same-directory temp file so a crash never leaves half a document behind.
 * Reads never throw for bad content: corrupt, foreign or oversized files read
 * as `undefined` and the caller decides how to report the skip.
 */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { utf8Bytes } from '../../contracts/budget'

export type ApiStoreErrorCode =
  | 'invalid_project_path'
  | 'project_missing'
  | 'path_outside_project'
  | 'invalid_id'
  | 'invalid_data'
  | 'too_large'
  | 'not_found'
  | 'io'

export class ApiStoreError extends Error {
  readonly code: ApiStoreErrorCode

  constructor(code: ApiStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApiStoreError'
    this.code = code
  }
}

/**
 * Windows can briefly hold a file a scanner or another process is touching,
 * so replacing it occasionally fails with EPERM/EBUSY/EACCES. Retry a few
 * times before reporting `io`; a real permissions problem still fails.
 */
const RENAME_RETRY_DELAYS_MS = [20, 50, 100, 200] as const

export type RenameFile = (from: string, to: string) => Promise<void>

export interface ApiStoreFileOptions {
  /** Overridable in tests; production always uses `fs.rename`. */
  readonly renameFile?: RenameFile
}

export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

function isRetryableRenameError(error: unknown): boolean {
  return isErrno(error, 'EPERM') || isErrno(error, 'EBUSY') || isErrno(error, 'EACCES')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function lstatSafe(target: string) {
  try {
    return await lstat(target)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined
    throw error
  }
}

async function replaceFile(
  tempPath: string,
  file: string,
  renameFile: RenameFile,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(tempPath, file)
      return
    } catch (error) {
      const wait = RENAME_RETRY_DELAYS_MS[attempt]
      if (wait === undefined || !isRetryableRenameError(error)) throw error
      await delay(wait)
    }
  }
}

/** Creates `dirPath` when needed and proves it resolves inside the project. */
export async function ensureDirInsideProject(
  projectDir: string,
  dirPath: string,
): Promise<string> {
  let realRoot: string
  try {
    realRoot = await realpath(projectDir)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      throw new ApiStoreError(
        'project_missing',
        `vibe-studio: project directory does not exist: ${projectDir}`,
        { cause: error },
      )
    }
    throw error
  }

  await mkdir(dirPath, { recursive: true })
  const realDir = await realpath(dirPath)
  if (!isInside(realRoot, realDir)) {
    throw new ApiStoreError(
      'path_outside_project',
      `vibe-studio: API storage resolves outside the project: ${realDir}`,
    )
  }
  return realDir
}

/** Resolves an existing `dirPath`, or `undefined` when it does not exist. */
export async function existingDirInsideProject(
  projectDir: string,
  dirPath: string,
): Promise<string | undefined> {
  const info = await lstatSafe(dirPath)
  if (!info) return undefined
  if (info.isSymbolicLink()) {
    throw new ApiStoreError(
      'path_outside_project',
      `vibe-studio: API storage is a link: ${dirPath}`,
    )
  }
  if (!info.isDirectory()) {
    throw new ApiStoreError('io', `vibe-studio: API storage is not a directory: ${dirPath}`)
  }
  const realDir = await realpath(dirPath)
  const realRoot = await realpath(projectDir)
  if (!isInside(realRoot, realDir)) {
    throw new ApiStoreError(
      'path_outside_project',
      `vibe-studio: API storage resolves outside the project: ${realDir}`,
    )
  }
  return realDir
}

/** Reads and parses one JSON file inside `dir`; anything unusable is `undefined`. */
export async function readJsonInside(
  dir: string,
  fileName: string,
  maxBytes: number,
): Promise<unknown> {
  const file = join(dir, fileName)
  const info = await lstatSafe(file)
  if (!info || info.isSymbolicLink() || !info.isFile()) return undefined
  if (info.size > maxBytes) return undefined
  const realFile = await realpath(file)
  if (!isInside(dir, realFile)) return undefined
  const text = await readFile(file, 'utf8')
  if (utf8Bytes(text) > maxBytes) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Size-checks `payload` and atomically replaces `fileName` inside `dir`.
 * Throws `too_large` before touching the filesystem.
 */
export async function writeJsonInside(
  dir: string,
  fileName: string,
  payload: string,
  maxBytes: number,
  options: ApiStoreFileOptions = {},
): Promise<void> {
  if (utf8Bytes(payload) > maxBytes) {
    throw new ApiStoreError(
      'too_large',
      `vibe-studio: ${fileName} exceeds ${maxBytes} bytes`,
    )
  }
  const renameFile = options.renameFile ?? rename
  const file = join(dir, fileName)
  const info = await lstatSafe(file)
  if (info) {
    if (info.isSymbolicLink()) {
      throw new ApiStoreError(
        'path_outside_project',
        `vibe-studio: API storage file is a link: ${file}`,
      )
    }
    if (!info.isFile()) {
      throw new ApiStoreError('io', `vibe-studio: API storage path is not a file: ${file}`)
    }
    const realFile = await realpath(file)
    if (!isInside(dir, realFile)) {
      throw new ApiStoreError(
        'path_outside_project',
        `vibe-studio: API storage file resolves outside storage: ${realFile}`,
      )
    }
  }

  const tempPath = join(dir, `.${fileName}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(tempPath, payload, { encoding: 'utf8', flag: 'wx' })
    await replaceFile(tempPath, file, renameFile)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Deletes `fileName` inside `dir`; returns whether a regular file was removed. */
export async function removeFileInside(dir: string, fileName: string): Promise<boolean> {
  const file = join(dir, fileName)
  const info = await lstatSafe(file)
  if (!info || info.isSymbolicLink() || !info.isFile()) return false
  await rm(file, { force: true })
  return true
}
