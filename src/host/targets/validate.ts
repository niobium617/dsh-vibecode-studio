/**
 * Target config validation (T016).
 *
 * User, API and file input all land here, so every failure is a stable
 * `invalid_config` StudioError with a field hint instead of a raw TypeError.
 * The returned config is normalized (trimmed name/url, default viewport) and is
 * the only shape adapters receive.
 */
import { isAbsolute } from 'node:path'
import { studioError, type StudioError } from '../../contracts/errors'
import { isTargetId, type TargetId } from '../../contracts/ids'
import {
  TARGET_KINDS,
  type TargetKind,
  type TargetViewport,
} from '../../contracts/target'
import { DEFAULT_VIEWPORT, type ValidatedTargetConfig } from './types'

const TARGET_KEYS = new Set([
  'id',
  'name',
  'kind',
  'url',
  'command',
  'cwd',
  'port',
  'viewport',
])

const VIEWPORT_KEYS = new Set(['width', 'height', 'deviceScaleFactor'])

type UnknownRecord = Record<string, unknown>

function invalid(field: string, message: string): StudioError {
  return studioError('invalid_config', `vibe-studio: target config: ${message}`, { field })
}

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw studioError('invalid_config', 'vibe-studio: target config must be an object')
  }
  return value as UnknownRecord
}

function assertKnownKeys(record: UnknownRecord, known: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      throw studioError('invalid_config', `vibe-studio: ${label}: unknown key "${key}"`, {
        field: key,
      })
    }
  }
}

function readString(
  value: unknown,
  field: string,
  maxLength: number,
  label: string,
): string {
  if (typeof value !== 'string') throw invalid(field, `"${label}" must be a string`)
  const trimmed = value.trim()
  if (trimmed.length === 0) throw invalid(field, `"${label}" must not be empty`)
  if (trimmed.length > maxLength) {
    throw invalid(field, `"${label}" must be at most ${maxLength} characters`)
  }
  if (trimmed.includes('\0')) throw invalid(field, `"${label}" must not contain null bytes`)
  return trimmed
}

function readId(record: UnknownRecord): TargetId {
  const value = record.id
  if (typeof value !== 'string' || !isTargetId(value)) {
    throw invalid('id', 'invalid "id" (expected 1-64 letters, digits, ".", "_" or "-")')
  }
  return value
}

function readName(record: UnknownRecord): string {
  return readString(record.name, 'name', 80, 'name')
}

function readKind(record: UnknownRecord): TargetKind {
  const value = record.kind
  if (typeof value !== 'string' || !(TARGET_KINDS as readonly string[]).includes(value)) {
    throw invalid('kind', `unknown "kind" (expected ${TARGET_KINDS.join(', ')})`)
  }
  return value as TargetKind
}

function readUrl(record: UnknownRecord): string | undefined {
  if (record.url === undefined) return undefined
  const raw = readString(record.url, 'url', 2048, 'url')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw invalid('url', 'invalid "url"')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid('url', '"url" must use http or https')
  }
  if (url.username || url.password) {
    throw invalid('url', '"url" must not contain credentials')
  }
  return url.toString()
}

function readCommand(record: UnknownRecord): string | undefined {
  if (record.command === undefined) return undefined
  return readString(record.command, 'command', 4096, 'command')
}

function readCwd(record: UnknownRecord): string | undefined {
  if (record.cwd === undefined) return undefined
  const cwd = readString(record.cwd, 'cwd', 1024, 'cwd')
  if (!isAbsolute(cwd)) throw invalid('cwd', '"cwd" must be an absolute path')
  return cwd
}

function readPort(record: UnknownRecord): number | undefined {
  if (record.port === undefined) return undefined
  const port = record.port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalid('port', '"port" must be an integer between 1 and 65535')
  }
  return port
}

function readViewport(record: UnknownRecord): TargetViewport {
  if (record.viewport === undefined) return DEFAULT_VIEWPORT
  const viewport = asRecord(record.viewport)
  assertKnownKeys(viewport, VIEWPORT_KEYS, 'target viewport')

  const readSize = (field: 'width' | 'height'): number => {
    const value = viewport[field]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 64 || value > 7680) {
      throw invalid(`viewport.${field}`, `"viewport.${field}" must be an integer between 64 and 7680`)
    }
    return value
  }

  const deviceScaleFactor = viewport.deviceScaleFactor ?? 1
  if (
    typeof deviceScaleFactor !== 'number' ||
    !Number.isFinite(deviceScaleFactor) ||
    deviceScaleFactor < 0.1 ||
    deviceScaleFactor > 4
  ) {
    throw invalid(
      'viewport.deviceScaleFactor',
      '"viewport.deviceScaleFactor" must be a number between 0.1 and 4',
    )
  }

  return {
    width: readSize('width'),
    height: readSize('height'),
    deviceScaleFactor,
  }
}

/** Validates and normalizes one target definition. Throws `invalid_config`. */
export function validateTargetConfig(input: unknown): ValidatedTargetConfig {
  const record = asRecord(input)
  assertKnownKeys(record, TARGET_KEYS, 'target config')

  const id = readId(record)
  const name = readName(record)
  const kind = readKind(record)
  const url = readUrl(record)
  const command = readCommand(record)
  const cwd = readCwd(record)
  const port = readPort(record)
  const viewport = readViewport(record)

  if (!url && !command) {
    throw invalid('url', `target "${id}" needs a "url" or a "command"`)
  }
  if (kind === 'api' && !url) {
    throw invalid('url', 'an "api" target needs a "url"')
  }

  return {
    id,
    name,
    kind,
    ...(url ? { url } : {}),
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    ...(port ? { port } : {}),
    viewport,
  }
}
