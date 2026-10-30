/**
 * `.vibe/artifacts` storage (T049, FR-AGENT-09/10).
 *
 * Screenshots never travel through a tool result: the host writes the bytes
 * here and hands the model an `ArtifactRef` (id, kind, mime type, size), so the
 * turn budget stays bounded and the image only reaches the user through the
 * panel. Each artifact is a pair of files named by id: `<id>.png` holds the
 * bytes, `<id>.json` the `ArtifactRef`. Bytes are written first and the
 * metadata second, so a half-written artifact is invisible to `read`.
 *
 * The directory sits inside a target project the user may not own, so every
 * resolved path must stay inside `.vibe/artifacts` (symlinks included) and each
 * file is size-capped before (and after) it is parsed or written.
 */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ARTIFACT_KINDS, type ArtifactKind, type ArtifactRef } from '../../contracts/artifacts'
import { studioError, type StudioError } from '../../contracts/errors'

export const ARTIFACT_DIR_NAME = 'artifacts'
export const SCREENSHOT_FILE_EXT = '.png'
export const ARTIFACT_META_FILE_EXT = '.json'
/** One 1280x720 PNG is ~100-300 KB; 8 MB leaves room for larger viewports. */
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
/** A metadata sidecar is a handful of fields; anything larger is not ours. */
export const MAX_ARTIFACT_META_BYTES = 4 * 1024
export const ARTIFACT_META_VERSION = 1

/** Artifact ids are file stems, so they use the same conservative shape. */
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const RENAME_RETRY_DELAYS_MS = [20, 50, 100, 200] as const

export type RenameFile = (from: string, to: string) => Promise<void>

export interface ArtifactStoreOptions {
  readonly now?: () => Date
  /** Overridable in tests; production always uses `fs.rename`. */
  readonly renameFile?: RenameFile
}

export interface SaveScreenshotOptions {
  readonly retentionDays: number
  readonly label?: string
}

export interface StoredArtifact {
  readonly ref: ArtifactRef
  readonly bytes: Uint8Array
}

export type ArtifactStoreErrorCode =
  | 'invalid_project_path'
  | 'project_missing'
  | 'path_outside_project'
  | 'invalid_artifact'
  | 'artifact_too_large'
  | 'io'

export class ArtifactStoreError extends Error {
  readonly code: ArtifactStoreErrorCode

  constructor(code: ArtifactStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ArtifactStoreError'
    this.code = code
  }
}

export function isArtifactId(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_ID_PATTERN.test(value)
}

/**
 * Store failures carry storage vocabulary; callers speaking the Studio error
 * codes get a stable mapping instead of a bare `internal` for every case.
 */
export function toArtifactStudioError(error: unknown): StudioError {
  if (!(error instanceof ArtifactStoreError)) {
    return studioError(
      'internal',
      error instanceof Error && error.message
        ? `vibe-studio: artifact storage failed: ${error.message}`
        : 'vibe-studio: artifact storage failed',
    )
  }
  switch (error.code) {
    case 'invalid_project_path':
    case 'project_missing':
      return studioError('invalid_config', error.message)
    case 'path_outside_project':
      return studioError('permission_denied', error.message, { reason: error.code })
    case 'invalid_artifact':
    case 'artifact_too_large':
      // The caller never supplied these bytes; the capture did.
      return studioError('preview_failed', error.message, { reason: error.code })
    default:
      return studioError('internal', error.message, { reason: error.code })
  }
}

function isInside(parent: string, child: string): boolean {
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
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
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

function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === 'string' && (ARTIFACT_KINDS as readonly string[]).includes(value)
}

/** A sidecar must describe the file it sits next to, or it is not trusted. */
function parseArtifactRef(raw: unknown, id: string): ArtifactRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record.version !== ARTIFACT_META_VERSION) return null
  const artifact = record.artifact
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null
  const ref = artifact as Record<string, unknown>
  if (ref.id !== id) return null
  if (!isArtifactKind(ref.kind)) return null
  if (typeof ref.mimeType !== 'string' || ref.mimeType.length === 0) return null
  if (typeof ref.bytes !== 'number' || !Number.isInteger(ref.bytes) || ref.bytes < 0) return null
  if (typeof ref.createdAt !== 'string' || Number.isNaN(Date.parse(ref.createdAt))) return null
  if (
    ref.expiresAt !== undefined &&
    (typeof ref.expiresAt !== 'string' || Number.isNaN(Date.parse(ref.expiresAt)))
  ) {
    return null
  }
  if (ref.label !== undefined && typeof ref.label !== 'string') return null
  return {
    id,
    kind: ref.kind,
    mimeType: ref.mimeType,
    bytes: ref.bytes,
    createdAt: ref.createdAt,
    ...(ref.expiresAt === undefined ? {} : { expiresAt: ref.expiresAt }),
    ...(ref.label === undefined ? {} : { label: ref.label }),
  }
}

export class ArtifactStore {
  readonly projectDir: string
  readonly vibeDir: string
  readonly dirPath: string
  private readonly now: () => Date
  private readonly renameFile: RenameFile

  constructor(projectDir: string, options: ArtifactStoreOptions = {}) {
    if (typeof projectDir !== 'string' || projectDir.trim() === '') {
      throw new ArtifactStoreError(
        'invalid_project_path',
        'vibe-studio: projectDir is required for artifact storage',
      )
    }
    this.projectDir = resolve(projectDir)
    this.vibeDir = join(this.projectDir, '.vibe')
    this.dirPath = join(this.vibeDir, ARTIFACT_DIR_NAME)
    this.now = options.now ?? (() => new Date())
    this.renameFile = options.renameFile ?? rename
    if (!isInside(this.projectDir, this.dirPath)) {
      throw new ArtifactStoreError(
        'invalid_project_path',
        `vibe-studio: artifacts resolve outside the project: ${this.dirPath}`,
      )
    }
  }

  bytesPath(id: string): string {
    this.requireId(id)
    return join(this.dirPath, `${id}${SCREENSHOT_FILE_EXT}`)
  }

  metaPath(id: string): string {
    this.requireId(id)
    return join(this.dirPath, `${id}${ARTIFACT_META_FILE_EXT}`)
  }

  /** Writes one screenshot and returns the reference the model receives. */
  async saveScreenshot(
    bytes: Uint8Array,
    options: SaveScreenshotOptions,
  ): Promise<ArtifactRef> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new ArtifactStoreError(
        'invalid_artifact',
        'vibe-studio: refusing to store an empty screenshot',
      )
    }
    if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
      throw new ArtifactStoreError(
        'artifact_too_large',
        `vibe-studio: screenshot exceeds ${MAX_ARTIFACT_BYTES} bytes`,
      )
    }
    if (!Number.isFinite(options.retentionDays) || options.retentionDays <= 0) {
      throw new ArtifactStoreError(
        'invalid_artifact',
        'vibe-studio: retentionDays must be a positive number',
      )
    }

    const createdAt = this.now()
    const id = randomUUID()
    const ref: ArtifactRef = {
      id,
      kind: 'screenshot',
      mimeType: 'image/png',
      bytes: bytes.byteLength,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + options.retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
      ...(options.label === undefined ? {} : { label: options.label }),
    }
    const meta = JSON.stringify({ version: ARTIFACT_META_VERSION, artifact: ref })

    try {
      const dir = await this.ensureDir()
      await this.rejectForeignFile(dir, join(dir, `${id}${SCREENSHOT_FILE_EXT}`))
      await this.rejectForeignFile(dir, join(dir, `${id}${ARTIFACT_META_FILE_EXT}`))
      await this.writeAtomic(dir, `${id}${SCREENSHOT_FILE_EXT}`, bytes)
      await this.writeAtomic(dir, `${id}${ARTIFACT_META_FILE_EXT}`, meta)
      return ref
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error
      throw new ArtifactStoreError(
        'io',
        `vibe-studio: cannot write artifact ${id}: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  /**
   * Reads one artifact back. Missing, foreign, oversized or inconsistent files
   * read as `null`, so a corrupt artifact never breaks the caller.
   */
  async read(id: string): Promise<StoredArtifact | null> {
    if (!isArtifactId(id)) return null
    try {
      const dir = await this.existingDir()
      if (!dir) return null
      const metaFile = join(dir, `${id}${ARTIFACT_META_FILE_EXT}`)
      const metaInfo = await lstatSafe(metaFile)
      if (!metaInfo || metaInfo.isSymbolicLink() || !metaInfo.isFile()) return null
      if (metaInfo.size > MAX_ARTIFACT_META_BYTES) return null
      if (!isInside(dir, await realpath(metaFile))) return null
      let raw: unknown
      try {
        raw = JSON.parse(await readFile(metaFile, 'utf8'))
      } catch {
        return null
      }
      const parsed = parseArtifactRef(raw, id)
      if (!parsed) return null

      const bytesFile = join(dir, `${id}${SCREENSHOT_FILE_EXT}`)
      const bytesInfo = await lstatSafe(bytesFile)
      if (!bytesInfo || bytesInfo.isSymbolicLink() || !bytesInfo.isFile()) return null
      if (bytesInfo.size > MAX_ARTIFACT_BYTES) return null
      if (!isInside(dir, await realpath(bytesFile))) return null
      const bytes = new Uint8Array(await readFile(bytesFile))
      // The sidecar is the commit point; a size mismatch means the pair is not
      // the artifact it claims to be.
      if (bytes.byteLength !== parsed.bytes) return null
      return { ref: parsed, bytes }
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error
      throw new ArtifactStoreError('io', `vibe-studio: cannot read artifact ${id}: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }

  private requireId(id: string): void {
    if (!isArtifactId(id)) {
      throw new ArtifactStoreError(
        'invalid_artifact',
        `vibe-studio: "${id}" is not a usable artifact id`,
      )
    }
  }

  /** Writes `data` through a same-directory temp file, then renames it. */
  private async writeAtomic(dir: string, name: string, data: Uint8Array | string): Promise<void> {
    const tempPath = join(dir, `.${name}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await writeFile(tempPath, data, { flag: 'wx' })
      await this.replaceFile(tempPath, join(dir, name))
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async replaceFile(tempPath: string, file: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.renameFile(tempPath, file)
        return
      } catch (error) {
        const wait = RENAME_RETRY_DELAYS_MS[attempt]
        if (wait === undefined || !isRetryableRenameError(error)) throw error
        await delay(wait)
      }
    }
  }

  /** Creates `.vibe/artifacts`, rejecting a `.vibe` that leaves the project. */
  private async ensureDir(): Promise<string> {
    let realRoot: string
    try {
      realRoot = await realpath(this.projectDir)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        throw new ArtifactStoreError(
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
      throw new ArtifactStoreError(
        'path_outside_project',
        `vibe-studio: artifacts resolve outside the project: ${realDir}`,
      )
    }
    return realDir
  }

  private async existingDir(): Promise<string | undefined> {
    const info = await lstatSafe(this.dirPath)
    if (!info) return undefined
    if (info.isSymbolicLink()) {
      throw new ArtifactStoreError(
        'path_outside_project',
        `vibe-studio: artifacts is a link: ${this.dirPath}`,
      )
    }
    if (!info.isDirectory()) {
      throw new ArtifactStoreError('io', `vibe-studio: artifacts is not a directory: ${this.dirPath}`)
    }
    const realDir = await realpath(this.dirPath)
    const realRoot = await realpath(this.projectDir)
    if (!isInside(realRoot, realDir)) {
      throw new ArtifactStoreError(
        'path_outside_project',
        `vibe-studio: artifacts resolve outside the project: ${realDir}`,
      )
    }
    return realDir
  }

  /** A pre-existing symlink at the target could redirect the rename elsewhere. */
  private async rejectForeignFile(dir: string, file: string): Promise<void> {
    const info = await lstatSafe(file)
    if (!info) return
    if (info.isSymbolicLink()) {
      throw new ArtifactStoreError(
        'path_outside_project',
        `vibe-studio: artifact file is a link: ${file}`,
      )
    }
    if (!info.isFile()) {
      throw new ArtifactStoreError('io', `vibe-studio: artifact path is not a file: ${file}`)
    }
    if (!isInside(dir, await realpath(file))) {
      throw new ArtifactStoreError(
        'path_outside_project',
        `vibe-studio: artifact resolves outside artifacts: ${file}`,
      )
    }
  }
}

export function createArtifactStore(
  projectDir: string,
  options?: ArtifactStoreOptions,
): ArtifactStore {
  return new ArtifactStore(projectDir, options)
}
