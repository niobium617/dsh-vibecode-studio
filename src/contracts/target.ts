import type { StudioError } from './errors'
import type { SessionId, TargetId } from './ids'

export const TARGET_KINDS = ['web', 'desktop', 'api'] as const
export type TargetKind = (typeof TARGET_KINDS)[number]

export interface TargetViewport {
  readonly width: number
  readonly height: number
  readonly deviceScaleFactor?: number
}

/**
 * A target is either addressed by URL or started from a command. Port is kept
 * separately so the host can free it on stop.
 */
export interface TargetConfig {
  readonly id: TargetId
  readonly name: string
  readonly kind: TargetKind
  readonly url?: string
  readonly command?: string
  readonly cwd?: string
  readonly port?: number
  readonly viewport?: TargetViewport
}

export interface TargetCapabilities {
  readonly screencast: boolean
  readonly input: boolean
  readonly pick: boolean
  readonly sourceMap: boolean
  readonly console: boolean
  readonly network: boolean
  readonly screenshot: boolean
}

export type TargetSessionStatus = 'starting' | 'ready' | 'degraded' | 'failed' | 'closed'

export interface TargetSession {
  readonly id: SessionId
  readonly targetId: TargetId
  readonly kind: TargetKind
  readonly status: TargetSessionStatus
  readonly url: string | null
  readonly capabilities: TargetCapabilities
  readonly startedAt: string
  readonly lastError?: StudioError
}

export type CapabilityName = keyof TargetCapabilities

export function hasCapability(
  capabilities: TargetCapabilities,
  name: CapabilityName,
): boolean {
  return capabilities[name]
}
