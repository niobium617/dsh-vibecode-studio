/**
 * T051 bundled skill: the shipped `skills/vibecoding-studio` bundle is intact
 * (frontmatter, size, reference paths), the resolver finds it from `src/` and
 * from a built package layout, and the profile row that mounts it still points
 * at this package's `skills/` root.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  inspectVibeSkillBundle,
  parseSkillFrontmatter,
  resolveBundledSkillDir,
  resolvePackageRoot,
  resolveVibeSkillDir,
  VIBE_SKILL_MAX_CHARS,
  VIBE_SKILL_NAME,
  VIBE_SKILL_PATCH_ROW_ID,
  VIBE_SKILL_PROVIDER,
  vibeSkillProviderConfig,
} from '../../../src/host/agent/skills'

let tempRoot: string

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'vibe-skill-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

interface BundleOptions {
  readonly name?: string
  readonly description?: string
  readonly body?: string
  readonly skillMd?: string
}

async function writeBundle(dir: string, options: BundleOptions = {}): Promise<string> {
  const name = options.name ?? VIBE_SKILL_NAME
  const description = options.description ?? '预览状态、标注与报错'
  const body = options.body ?? '细节见 `references/tools.md`。'
  await mkdir(join(dir, 'references'), { recursive: true })
  const skillMd =
    options.skillMd ?? `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
  await writeFile(join(dir, 'SKILL.md'), skillMd)
  await writeFile(join(dir, 'references', 'tools.md'), '# tools\n')
  return dir
}

describe('bundled skill location', () => {
  it('resolves the package root from the source module', () => {
    const root = resolvePackageRoot()
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name?: string
    }
    expect(manifest.name).toBe('dsh-vibecode-studio')
  })

  it('points at the shipped skill directory', () => {
    expect(resolveBundledSkillDir()).toBe(join(resolvePackageRoot(), 'skills'))
    expect(resolveVibeSkillDir()).toBe(join(resolvePackageRoot(), 'skills', VIBE_SKILL_NAME))
    expect(existsSync(join(resolveVibeSkillDir(), 'SKILL.md'))).toBe(true)
  })

  it('refuses a path with no package root above it', () => {
    expect(() =>
      resolvePackageRoot(join(tmpdir(), 'vibe-studio-no-package', 'nested', 'skills.ts')),
    ).toThrow(/cannot find the package root/)
  })
})

describe('parseSkillFrontmatter', () => {
  it('reads flat keys, quotes, comments and blank lines', () => {
    const parsed = parseSkillFrontmatter(
      ['---', '# routing', 'name: "vibecoding-studio"', "whenToUse: '预览报错时'", '', '---', '', 'body'].join(
        '\n',
      ),
    )
    expect(parsed.frontmatter).toEqual({ name: 'vibecoding-studio', whenToUse: '预览报错时' })
    expect(parsed.body).toBe('body')
  })

  it('rejects a file without frontmatter', () => {
    expect(() => parseSkillFrontmatter('# just a heading\n')).toThrow(/must start on the first line/)
  })

  it('rejects frontmatter without a closing marker', () => {
    expect(() => parseSkillFrontmatter('---\nname: x\n')).toThrow(/missing its closing/)
  })

  it('rejects a line that is not a flat key', () => {
    expect(() => parseSkillFrontmatter('---\nname: x\ntags:\n  - a\n---\n')).toThrow(
      /not "key: value"/,
    )
  })
})

describe('inspectVibeSkillBundle', () => {
  it('accepts the shipped bundle and lists every reference it names', () => {
    const bundle = inspectVibeSkillBundle()
    expect(bundle.frontmatter.name).toBe(VIBE_SKILL_NAME)
    expect(bundle.frontmatter.description.length).toBeGreaterThan(0)
    expect(bundle.frontmatter.whenToUse?.length).toBeGreaterThan(0)
    expect(bundle.chars).toBeLessThanOrEqual(VIBE_SKILL_MAX_CHARS)
    expect(bundle.references).toContain('references/tools.md')
    expect(bundle.references).toContain('references/workflows.md')
    for (const reference of bundle.references) {
      expect(existsSync(join(bundle.dir, reference))).toBe(true)
    }
  })

  it('rejects a SKILL.md over the character limit', async () => {
    const dir = await writeBundle(join(tempRoot, 'oversize'), {
      body: 'x'.repeat(VIBE_SKILL_MAX_CHARS),
    })
    expect(() => inspectVibeSkillBundle(dir)).toThrow(/the limit is 8192/)
  })

  it('rejects a reference the body names but the bundle does not ship', async () => {
    const dir = await writeBundle(join(tempRoot, 'missing-ref'), {
      body: '见 `references/tools.md` 与 `references/absent.md`。',
    })
    expect(() => inspectVibeSkillBundle(dir)).toThrow(/missing reference: references\/absent\.md/)
  })

  it('rejects a different skill name', async () => {
    const dir = await writeBundle(join(tempRoot, 'wrong-name'), { name: 'other-skill' })
    expect(() => inspectVibeSkillBundle(dir)).toThrow(/name must be "vibecoding-studio"/)
  })

  it('rejects frontmatter without a description', async () => {
    const dir = await writeBundle(join(tempRoot, 'no-description'), {
      skillMd: `---\nname: ${VIBE_SKILL_NAME}\n---\n\nbody\n`,
    })
    expect(() => inspectVibeSkillBundle(dir)).toThrow(/missing "description"/)
  })

  it('rejects a directory without SKILL.md', async () => {
    const dir = join(tempRoot, 'empty')
    await mkdir(dir, { recursive: true })
    expect(() => inspectVibeSkillBundle(dir)).toThrow(/instruction file is missing/)
  })
})

describe('profile wiring', () => {
  it('mounts only this package skills root', () => {
    const config = vibeSkillProviderConfig()
    expect(config.providerName).toBe(VIBE_SKILL_PROVIDER)
    expect(config.includeDefaultRoots).toBe(false)
    expect(config.watch).toBe(false)
    expect(config.bundledSkillDir).toBe(resolveBundledSkillDir())
  })

  it('ships the skills directory with the package', () => {
    const manifest = JSON.parse(
      readFileSync(join(resolvePackageRoot(), 'package.json'), 'utf8'),
    ) as { files?: string[] }
    expect(manifest.files).toContain('skills')
  })

  it('declares the bundled provider row in cordis.patch.yml', () => {
    const patch = readFileSync(join(resolvePackageRoot(), 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain(`id: ${VIBE_SKILL_PATCH_ROW_ID}`)
    expect(patch).toContain("name: '@deepseek-ai/dsh-skill-filesystem'")
    expect(patch).toContain('providerName: vibe-bundled')
    expect(patch).toContain('bundledSkillDir:')
  })
})
