/**
 * T051: the bundled `vibecoding-studio` skill.
 *
 * The skill ships as files (`skills/vibecoding-studio/SKILL.md` plus
 * `references/*.md`) rather than as a `ctx.skills.register()` call: DSH's
 * filesystem provider discovers it, the `skill` tool loads it on demand, and
 * `references/` resolve through the provider's directory `resourceBase`.
 *
 * This module only answers three questions the rest of the package needs:
 * where the directory lives inside the package, which provider config mounts
 * it, and whether the bundle is still intact (frontmatter, size, reference
 * paths). It never reads or executes page content.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Skill name the `skill` tool resolves; kebab-case per DSH's grammar. */
export const VIBE_SKILL_NAME = 'vibecoding-studio'
/** DSH renders the skill body into the prompt, so it stays a routing card. */
export const VIBE_SKILL_MAX_CHARS = 8 * 1024
/** Provider label for the bundle row, distinct from DSH's own `filesystem`. */
export const VIBE_SKILL_PROVIDER = 'vibe-bundled'
/** Loader row id the profile/preset patch uses for the extra provider. */
export const VIBE_SKILL_PATCH_ROW_ID = 'vibe-skill-bundled'

const PACKAGE_NAME = 'dsh-vibecode-studio'
const SKILLS_DIR_NAME = 'skills'
const INSTRUCTION_FILE = 'SKILL.md'
/** package.json is at most this far above `lib/` or `src/host/agent/`. */
const ROOT_SEARCH_DEPTH = 8
const REFERENCE_PATTERN = /\breferences\/[A-Za-z0-9._-]+\.md\b/g

export interface VibeSkillFrontmatter {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
}

/** One parsed bundle: the directory, its instruction file and what it uses. */
export interface VibeSkillBundle {
  readonly dir: string
  readonly instructionPath: string
  readonly frontmatter: VibeSkillFrontmatter
  /** Characters in the raw `SKILL.md`, frontmatter included. */
  readonly chars: number
  /** `references/…` files the body points at, as written in the body. */
  readonly references: readonly string[]
}

/** The `dsh-skill-filesystem` fields that mount this package's skills root. */
export interface VibeSkillProviderConfig {
  readonly providerName: string
  readonly includeDefaultRoots: false
  readonly watch: false
  readonly bundledSkillDir: string
}

function toPath(from: string | URL): string {
  if (from instanceof URL) return fileURLToPath(from)
  return from.startsWith('file:') ? fileURLToPath(from) : from
}

/**
 * Walk up from this module to the package root. Works both from `src/` under
 * vitest and from `lib/index.js` in a built or installed package; the walk
 * checks the package name so a hoisted `node_modules` layout cannot pick the
 * wrong `package.json`.
 */
export function resolvePackageRoot(from: string | URL = import.meta.url): string {
  let current = dirname(toPath(from))
  for (let depth = 0; depth < ROOT_SEARCH_DEPTH; depth += 1) {
    const manifest = join(current, 'package.json')
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
      if (parsed.name === PACKAGE_NAME) return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`${PACKAGE_NAME}: cannot find the package root above ${toPath(from)}`)
}

/** `<package root>/skills`: the root the bundled provider scans. */
export function resolveBundledSkillDir(from: string | URL = import.meta.url): string {
  return join(resolvePackageRoot(from), SKILLS_DIR_NAME)
}

/** `<package root>/skills/vibecoding-studio`: this skill's own directory. */
export function resolveVibeSkillDir(from: string | URL = import.meta.url): string {
  return join(resolveBundledSkillDir(from), VIBE_SKILL_NAME)
}

/**
 * Split YAML frontmatter from the body. Only the flat `key: value` form DSH
 * skills use is accepted; nested structures belong in `references/`, not in a
 * routing card. Malformed input throws with the reason so validation can name it.
 */
export function parseSkillFrontmatter(text: string): {
  readonly frontmatter: Readonly<Record<string, string>>
  readonly body: string
} {
  const normalized = text.replace(/^﻿/, '')
  if (!normalized.startsWith('---\n')) {
    throw new Error('skill frontmatter must start on the first line with "---"')
  }
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) throw new Error('skill frontmatter is missing its closing "---"')
  const header = normalized.slice(4, end)
  const body = normalized.slice(end + 4).replace(/^\n+/, '')
  const frontmatter: Record<string, string> = {}
  for (const rawLine of header.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) throw new Error(`skill frontmatter line is not "key: value": ${line}`)
    const [, key, rawValue] = match as unknown as [string, string, string]
    const value = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2')
    frontmatter[key] = value
  }
  return { frontmatter, body }
}

function assertInside(dir: string, path: string, label: string): void {
  const rel = relative(dir, path)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} escapes the skill directory: ${path}`)
  }
  const realDir = realpathSync(dir)
  const realTarget = realpathSync(path)
  const realRel = relative(realDir, realTarget)
  if (realRel === '' || realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
    throw new Error(`${label} resolves outside the skill directory: ${path}`)
  }
}

/**
 * Validate the shipped bundle: frontmatter, size and every `references/…`
 * path named in the body. Throws on the first problem; tests and the profile
 * check both call this instead of trusting the files by eye.
 */
export function inspectVibeSkillBundle(
  dir: string = resolveVibeSkillDir(),
): VibeSkillBundle {
  const filePath = join(dir, INSTRUCTION_FILE)
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`skill instruction file is missing: ${filePath}`)
  }
  const text = readFileSync(filePath, 'utf8')
  if (text.length > VIBE_SKILL_MAX_CHARS) {
    throw new Error(
      `SKILL.md is ${text.length} characters; the limit is ${VIBE_SKILL_MAX_CHARS}`,
    )
  }
  const { frontmatter, body } = parseSkillFrontmatter(text)
  const name = frontmatter.name
  const description = frontmatter.description
  if (name !== VIBE_SKILL_NAME) {
    throw new Error(`SKILL.md name must be "${VIBE_SKILL_NAME}", got "${name ?? ''}"`)
  }
  if (!description) throw new Error('SKILL.md frontmatter is missing "description"')
  const references = [...new Set(body.match(REFERENCE_PATTERN) ?? [])]
  for (const reference of references) {
    const path = join(dir, reference)
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`SKILL.md points at a missing reference: ${reference}`)
    }
    assertInside(dir, path, `reference ${reference}`)
  }
  return {
    dir,
    instructionPath: filePath,
    frontmatter: { name, description, whenToUse: frontmatter.whenToUse },
    chars: text.length,
    references,
  }
}

/**
 * The extra `dsh-skill-filesystem` row that mounts this package's skills.
 * `includeDefaultRoots: false` and `watch: false` keep it from duplicating the
 * base provider's project/user roots or adding a second file watcher.
 */
export function vibeSkillProviderConfig(
  from: string | URL = import.meta.url,
): VibeSkillProviderConfig {
  return {
    providerName: VIBE_SKILL_PROVIDER,
    includeDefaultRoots: false,
    watch: false,
    bundledSkillDir: resolveBundledSkillDir(from),
  }
}
