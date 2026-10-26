import { writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { createServer } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))
const fixturesDir = join(here, 'fixtures')
const resultsPath = join(here, 'results.json')

type Framework = 'react' | 'vue' | 'svelte'

type SourceInfo = {
  framework: string
  via: string
  file: string
  line: number | null
  column: number | null
}

type PickResult = {
  selector: string
  unique: boolean
  tag: string
  id: string | null
  classes: string[]
  text: string
  role: string | null
  box: { x: number; y: number; width: number; height: number }
  html: string
  source: SourceInfo | null
}

type PickRow = {
  id: string
  expectedLine: number
  selector: string
  unique: boolean
  source: SourceInfo | null
  fileMatch: boolean
  lineDelta: number | null
  hit: boolean
  clicksLeaked: number
}

type ModeResult = {
  framework: Framework
  url: string
  overlayInShadowRoot: boolean
  picks: PickRow[]
  hits: number
  total: number
  esc: { activeAfter: boolean; clicksAfter: number; passed: boolean }
  consoleErrors: string[]
  pageErrors: string[]
}

const EXPECTATIONS: Record<Framework, { file: string; elements: Record<string, number> }> = {
  react: {
    file: 'App.jsx',
    elements: {
      title: 9,
      name: 12,
      bio: 13,
      role: 14,
      agree: 18,
      submit: 19,
      'item-1': 22,
      'item-2': 23,
      'item-3': 24,
      footer: 26,
    },
  },
  vue: {
    file: 'App.vue',
    elements: {
      title: 10,
      name: 13,
      bio: 14,
      role: 15,
      agree: 19,
      submit: 20,
      'item-1': 23,
      'item-2': 24,
      'item-3': 25,
      footer: 27,
    },
  },
  svelte: {
    file: 'App.svelte',
    elements: {
      title: 9,
      name: 12,
      bio: 13,
      role: 14,
      agree: 18,
      submit: 19,
      'item-1': 22,
      'item-2': 23,
      'item-3': 24,
      footer: 26,
    },
  },
}

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

async function pickerBundle(): Promise<string> {
  const result = await build({
    entryPoints: [join(here, 'inject.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    logLevel: 'silent',
  })
  const file = result.outputFiles?.[0]
  if (!file) throw new Error('picker bundle produced no output')
  return file.text
}

function watchConsole(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  return { consoleErrors, pageErrors }
}

async function runFramework(browser: Browser, framework: Framework, bundle: string): Promise<ModeResult> {
  const root = join(fixturesDir, framework)
  const port = await freePort()
  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.js'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true },
  })
  await server.listen()
  const url = `http://127.0.0.1:${port}/`
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const { consoleErrors, pageErrors } = watchConsole(page)
  const expectation = EXPECTATIONS[framework]
  const picks: PickRow[] = []
  let overlayInShadowRoot = false
  let esc = { activeAfter: true, clicksAfter: -1, passed: false }

  try {
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForSelector('#title')
    await page.addScriptTag({ content: bundle })

    for (const [id, expectedLine] of Object.entries(expectation.elements)) {
      const box = await page.locator(`#${id}`).boundingBox()
      if (!box) {
        picks.push({
          id,
          expectedLine,
          selector: '',
          unique: false,
          source: null,
          fileMatch: false,
          lineDelta: null,
          hit: false,
          clicksLeaked: 0,
        })
        continue
      }
      await page.evaluate(() => {
        ;(window as unknown as { __clicks?: number }).__clicks = 0
      })
      await page.evaluate(() => {
        ;(window as unknown as { __vibePicker: { start: () => void } }).__vibePicker.start()
      })
      if (id === Object.keys(expectation.elements)[0]) {
        overlayInShadowRoot = await page.evaluate(
          () => Boolean(document.getElementById('__vibe-picker-host')?.shadowRoot),
        )
      }
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await page.mouse.click(x, y)
      await page.waitForTimeout(40)
      const pick = (await page.evaluate(() => {
        return (window as unknown as { __vibePicker: { getLastPick: () => PickResult | null } }).__vibePicker.getLastPick()
      })) as PickResult | null
      const clicksLeaked = (await page.evaluate(() => {
        return (window as unknown as { __clicks?: number }).__clicks ?? 0
      })) as number
      await page.evaluate(() => {
        ;(window as unknown as { __vibePicker: { stop: () => void } }).__vibePicker.stop()
      })

      const source = pick?.source ?? null
      const fileMatch = source?.file ? basename(source.file) === expectation.file : false
      const lineDelta = source?.line != null ? Math.abs(source.line - expectedLine) : null
      picks.push({
        id,
        expectedLine,
        selector: pick?.selector ?? '',
        unique: pick?.unique ?? false,
        source,
        fileMatch,
        lineDelta,
        hit: fileMatch && lineDelta != null && lineDelta <= 2,
        clicksLeaked,
      })
    }

    // Esc must exit picking and hand clicks back to the page.
    const titleBox = await page.locator('#title').boundingBox()
    await page.evaluate(() => {
      ;(window as unknown as { __clicks?: number }).__clicks = 0
      ;(window as unknown as { __vibePicker: { start: () => void } }).__vibePicker.start()
    })
    await page.keyboard.press('Escape')
    const activeAfter = (await page.evaluate(() => {
      return (window as unknown as { __vibePicker: { isActive: () => boolean } }).__vibePicker.isActive()
    })) as boolean
    if (titleBox) {
      await page.mouse.click(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2)
      await page.waitForTimeout(40)
    }
    const clicksAfter = (await page.evaluate(() => {
      return (window as unknown as { __clicks?: number }).__clicks ?? 0
    })) as number
    esc = { activeAfter, clicksAfter, passed: !activeAfter && clicksAfter === 1 }
  } finally {
    await context.close()
    await server.close()
  }

  const hits = picks.filter((pick) => pick.hit).length
  return {
    framework,
    url,
    overlayInShadowRoot,
    picks,
    hits,
    total: picks.length,
    esc,
    consoleErrors,
    pageErrors,
  }
}

function logMode(result: ModeResult): void {
  const via = result.picks.find((pick) => pick.source)?.source?.via ?? 'none'
  const unique = result.picks.filter((pick) => pick.unique).length
  const leaks = result.picks.reduce((sum, pick) => sum + pick.clicksLeaked, 0)
  console.log(
    `[${result.framework}] ${result.hits}/${result.total} hits · via ${via} · selector unique ${unique}/${result.total} · ` +
      `leaks ${leaks} · esc ${result.esc.passed ? 'pass' : 'FAIL'} · console ${result.consoleErrors.length} · pageerror ${result.pageErrors.length}`,
  )
}

async function main(): Promise<void> {
  const bundle = await pickerBundle()
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const modes: ModeResult[] = []
  try {
    for (const framework of ['react', 'vue', 'svelte'] as Framework[]) {
      modes.push(await runFramework(browser, framework, bundle))
      logMode(modes[modes.length - 1] as ModeResult)
    }
  } finally {
    await browser.close()
  }

  const totals = {
    hits: modes.reduce((sum, mode) => sum + mode.hits, 0),
    elements: modes.reduce((sum, mode) => sum + mode.total, 0),
  }
  const hitRate = totals.elements > 0 ? totals.hits / totals.elements : 0
  const leaks = modes.reduce(
    (sum, mode) => sum + mode.picks.reduce((inner, pick) => inner + pick.clicksLeaked, 0),
    0,
  )
  const consoleErrors = modes.reduce((sum, mode) => sum + mode.consoleErrors.length, 0)
  const pageErrors = modes.reduce((sum, mode) => sum + mode.pageErrors.length, 0)
  const escPassed = modes.every((mode) => mode.esc.passed)
  const overlayPassed = modes.every((mode) => mode.overlayInShadowRoot)
  const pass = hitRate >= 0.8 && leaks === 0 && consoleErrors === 0 && pageErrors === 0 && escPassed && overlayPassed

  const output = {
    generatedAt: new Date().toISOString(),
    pass,
    criteria: { hitRate: 0.8, lineTolerance: 2, leaks: 0, consoleErrors: 0, esc: true, overlayShadow: true },
    totals: { ...totals, hitRate: Number(hitRate.toFixed(3)), leaks, consoleErrors, pageErrors, escPassed, overlayPassed },
    frameworks: modes,
  }
  await writeFile(resultsPath, `${JSON.stringify(output, null, 2)}\n`)

  console.log(
    `\nTOTAL ${totals.hits}/${totals.elements} (${(hitRate * 100).toFixed(1)}%) · leaks ${leaks} · ` +
      `esc ${escPassed ? 'pass' : 'FAIL'} · overlay ${overlayPassed ? 'pass' : 'FAIL'} · ` +
      `console ${consoleErrors} · pageerror ${pageErrors} · ${pass ? 'PASS' : 'FAIL'}`,
  )
  console.log(`results -> ${resultsPath}`)
  if (!pass) process.exitCode = 1
}

await main()
