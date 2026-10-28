/**
 * T029 source adapters, end to end: each framework fixture exposes 30 elements
 * on known lines; a pick must report the framework, the file and (within 2
 * lines) the position. The scripts are the real `buildPickerScript` output and
 * the payloads go through the real Host `normalizePickedElement`, so the test
 * covers the serialized page adapter and the validator together.
 *
 * Dev servers come from the Vite JS API on free ports; the fallback case builds
 * each fixture for production (`__svelte_meta`, `_debugSource` and the
 * inspector attributes are dev-only) and asserts a pick still succeeds with
 * `source: null` — no source is not an error.
 */
import { readFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build, createServer, preview, type PreviewServer, type ViteDevServer } from 'vite'
import {
  buildPickerScript,
  normalizePickedElement,
} from '../../src/host/inspect/inject'
import type { ElementContext, SourceContext } from '../../src/contracts/inspect'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))

interface Target {
  readonly name: 'react' | 'vue' | 'svelte'
  /** Expected `via` values, primary path first. */
  readonly vias: readonly string[]
  /** App source whose lines carry the 30 `id="..."` anchors. */
  readonly appFile: string
}

const TARGETS: readonly Target[] = [
  {
    name: 'react',
    vias: ['data-inspector', 'fiber._debugSource'],
    appFile: 'fixtures/source/react/src/App.jsx',
  },
  {
    name: 'vue',
    vias: ['__v_inspector', 'data-v-inspector', '__file'],
    appFile: 'fixtures/source/vue/src/App.vue',
  },
  {
    name: 'svelte',
    vias: ['__svelte_meta'],
    appFile: 'fixtures/source/svelte/src/App.svelte',
  },
]

const BINDING = '__vibePickTest'
const LINE_TOLERANCE = 2
const MIN_HITS = 24 // 80% of 30

const DEV_SCRIPT = buildPickerScript({ binding: BINDING, overlayId: '__vibe-picker-host' })

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/**
 * Vite's JS API only defaults `process.env.NODE_ENV` when it is unset, and the
 * Vue/Svelte plugins compile dev-only source metadata from the resolved
 * `isProduction` flag. Pin it per server so a dev server earlier in the run
 * cannot make a production build keep `__file`/`__svelte_meta`.
 */
async function withNodeEnv<T>(mode: 'development' | 'production', run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = mode
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
}

async function startDev(name: string): Promise<{ url: string; server: ViteDevServer }> {
  const root = join(projectRoot, 'fixtures/source', name)
  const port = await freePort()
  const server = await withNodeEnv('development', () =>
    createServer({
      root,
      configFile: join(root, 'vite.config.js'),
      logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true },
    }),
  )
  await server.listen()
  return { url: `http://127.0.0.1:${port}/`, server }
}

async function startProd(name: string): Promise<{ url: string; server: PreviewServer }> {
  const root = join(projectRoot, 'fixtures/source', name)
  const outDir = join(projectRoot, '.tmp/source-adapters', name)
  const configFile = join(root, 'vite.config.js')
  await withNodeEnv('production', () =>
    build({
      root,
      configFile,
      logLevel: 'error',
      build: { outDir, emptyOutDir: true },
    }),
  )
  const port = await freePort()
  const server = await withNodeEnv('production', () =>
    preview({
      root,
      configFile,
      logLevel: 'error',
      build: { outDir },
      preview: { host: '127.0.0.1', port, strictPort: true },
    }),
  )
  return { url: `http://127.0.0.1:${port}/`, server }
}

/** id → 1-based line of the `id="..."` anchor in the framework's app source. */
async function expectedAnchors(file: string): Promise<Map<string, number>> {
  const text = await readFile(join(projectRoot, file), 'utf8')
  const anchors = new Map<string, number>()
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /id="([^"]+)"/.exec(line)
    if (match) anchors.set(match[1], index + 1)
  })
  return anchors
}

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

async function installPicker(page: Page): Promise<void> {
  await page.evaluate((binding) => {
    const scope = window as unknown as {
      __picks: unknown[]
      [key: string]: unknown
    }
    scope.__picks = []
    scope[binding] = (text: string) => {
      scope.__picks.push(JSON.parse(text))
    }
  }, BINDING)
  await page.addScriptTag({ content: DEV_SCRIPT })
}

async function setPicking(page: Page, active: boolean): Promise<void> {
  await page.evaluate((on) => {
    const picker = (window as unknown as { __vibePicker?: { start?: () => void; stop?: () => void } })
      .__vibePicker
    if (!picker) throw new Error('picker is not installed')
    if (on) picker.start?.()
    else picker.stop?.()
  }, active)
}

function lastPick(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const picks = (window as unknown as { __picks: unknown[] }).__picks
    return picks.length > 0 ? picks[picks.length - 1] : null
  })
}

/** Dispatches on the element itself so container ids are targeted exactly. */
async function pickElement(page: Page, id: string): Promise<ElementContext | null> {
  await page.evaluate(() => {
    ;(window as unknown as { __picks: unknown[] }).__picks = []
  })
  await setPicking(page, true)
  await page.evaluate((elementId) => {
    const element = document.getElementById(elementId)
    if (!element) throw new Error(`missing #${elementId}`)
    element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }),
    )
  }, id)
  const raw = await lastPick(page)
  await setPicking(page, false)
  return raw && typeof raw === 'object'
    ? normalizePickedElement(raw as Record<string, unknown>)
    : null
}

function fileLeaf(source: SourceContext | null): string | null {
  if (!source) return null
  return basename(source.file.replace(/\\/g, '/'))
}

function isHit(source: SourceContext | null, appFile: string, expectedLine: number): boolean {
  if (!source) return false
  if (fileLeaf(source) !== basename(appFile)) return false
  if (source.line === null) return false
  return Math.abs(source.line - expectedLine) <= LINE_TOLERANCE
}

test.describe('source adapters', () => {
  test.setTimeout(180_000)

  for (const target of TARGETS) {
    test(`${target.name}: 30 elements resolve to source lines in dev`, async ({ page }) => {
      const errors = watchErrors(page)
      const anchors = await expectedAnchors(target.appFile)
      expect(anchors.size).toBe(30)
      const { url, server } = await startDev(target.name)

      try {
        await page.goto(url, { waitUntil: 'networkidle' })
        await expect(page.locator('#title')).toBeVisible()
        await installPicker(page)

        const misses: string[] = []
        let hits = 0
        for (const [id, expectedLine] of anchors) {
          const element = await pickElement(page, id)
          if (!element) {
            misses.push(`${id}: no pick`)
            continue
          }
          const source = element.source
          const frameworkOk = source === null || source.framework === target.name
          const viaOk = source === null || target.vias.includes(source.via)
          if (isHit(source, target.appFile, expectedLine)) hits += 1
          else {
            misses.push(
              `${id}: expected ${basename(target.appFile)}:${expectedLine}, got ` +
                `${source ? `${fileLeaf(source)}:${source.line} (${source.via})` : 'null'}`,
            )
          }
          expect(frameworkOk, `${id}: framework must be ${target.name}`).toBe(true)
          expect(viaOk, `${id}: unknown via ${source?.via}`).toBe(true)
        }

        // A real mouse click must agree with the synthetic dispatch.
        const titleBox = await page.locator('#title').boundingBox()
        expect(titleBox).not.toBeNull()
        await page.evaluate(() => {
          ;(window as unknown as { __picks: unknown[] }).__picks = []
        })
        await setPicking(page, true)
        await page.mouse.move(titleBox!.x + titleBox!.width / 2, titleBox!.y + titleBox!.height / 2)
        await page.mouse.click(titleBox!.x + titleBox!.width / 2, titleBox!.y + titleBox!.height / 2)
        await setPicking(page, false)
        const mouseRaw = await lastPick(page)
        const mousePick = mouseRaw
          ? normalizePickedElement(mouseRaw as Record<string, unknown>)
          : null
        expect(isHit(mousePick?.source ?? null, target.appFile, anchors.get('title')!)).toBe(true)

        expect(misses, `${target.name} misses: ${misses.join(' | ')}`).toEqual([])
        expect(hits).toBeGreaterThanOrEqual(MIN_HITS)
        expect(errors).toEqual([])
      } finally {
        await server.close()
      }
    })

    test(`${target.name}: production build falls back to source: null without errors`, async ({
      page,
    }) => {
      const errors = watchErrors(page)
      const anchors = await expectedAnchors(target.appFile)
      const { url, server } = await startProd(target.name)

      try {
        await page.goto(url, { waitUntil: 'networkidle' })
        await expect(page.locator('#title')).toBeVisible()
        await installPicker(page)

        const withSource: string[] = []
        for (const id of anchors.keys()) {
          const element = await pickElement(page, id)
          expect(element, `${id}: a pick must still succeed without source`).not.toBeNull()
          expect(element!.selector.length).toBeGreaterThan(0)
          if (element!.source !== null) {
            withSource.push(`${id}: ${element!.source.via} ${element!.source.file}`)
          }
        }

        expect(withSource, `production leaked source metadata: ${withSource.join(' | ')}`).toEqual([])
        expect(errors).toEqual([])
      } finally {
        await server.close()
      }
    })
  }
})
