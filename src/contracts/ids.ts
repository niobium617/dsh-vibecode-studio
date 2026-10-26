import { studioError } from './errors'

/**
 * Branded IDs keep session and target identifiers from being swapped at
 * compile time. The runtime form is a short, URL-safe token.
 */

declare const sessionIdBrand: unique symbol
declare const targetIdBrand: unique symbol

export type SessionId = string & { readonly [sessionIdBrand]: 'SessionId' }
export type TargetId = string & { readonly [targetIdBrand]: 'TargetId' }

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function isSessionId(value: unknown): value is SessionId {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export function isTargetId(value: unknown): value is TargetId {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

function asId<T extends string>(label: string, value: string, valid: (input: unknown) => boolean): T {
  if (!valid(value)) {
    throw studioError('invalid_input', `invalid ${label}: ${value}`, { label, value })
  }
  return value as T
}

export function asSessionId(value: string): SessionId {
  return asId<SessionId>('session id', value, isSessionId)
}

export function asTargetId(value: string): TargetId {
  return asId<TargetId>('target id', value, isTargetId)
}
