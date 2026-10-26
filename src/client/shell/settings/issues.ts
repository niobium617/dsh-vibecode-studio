/**
 * Maps Host validation issues onto settings fields (T014).
 *
 * The Host reports strings such as `settings.retentionDays: expected …` or
 * `settings.allowedOrigins[1]: invalid origin …`. Anything unrecognized stays
 * in `other` so it is still shown instead of being dropped.
 */
import {
  SETTINGS_FIELDS,
  type StudioSettingsField,
} from '../../../contracts/settings'
import { TransportError } from '../../transport'

export type SettingsIssues = Partial<Record<StudioSettingsField, string[]>>

export interface GroupedIssues {
  readonly byField: SettingsIssues
  readonly other: string[]
}

const ISSUE_PATTERN = /^settings\.([A-Za-z]+)(?:\[\d+\])?:/

const KNOWN_FIELDS: ReadonlySet<string> = new Set(SETTINGS_FIELDS)

export function groupSettingsIssues(issues: readonly string[]): GroupedIssues {
  const byField: Record<string, string[]> = {}
  const other: string[] = []
  for (const issue of issues) {
    const match = ISSUE_PATTERN.exec(issue)
    const field = match?.[1]
    if (field && KNOWN_FIELDS.has(field)) {
      ;(byField[field] ??= []).push(issue)
    } else {
      other.push(issue)
    }
  }
  return { byField: byField as SettingsIssues, other }
}

/** Turns a failed save into field issues when the Host supplied them. */
export function issuesFromError(error: unknown): GroupedIssues {
  if (error instanceof TransportError) {
    const raw = error.details?.issues
    if (error.code === 'invalid_input' && Array.isArray(raw)) {
      return groupSettingsIssues(raw.filter((issue): issue is string => typeof issue === 'string'))
    }
    return { byField: {}, other: [error.message] }
  }
  return { byField: {}, other: [error instanceof Error ? error.message : String(error)] }
}

export function hasIssues(issues: GroupedIssues): boolean {
  return Object.keys(issues.byField).length > 0 || issues.other.length > 0
}
