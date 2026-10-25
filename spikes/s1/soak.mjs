/**
 * T001 S1 soak driver.
 *
 * Runs one transport mode for a fixed duration, samples host/client memory,
 * stops the Runner explicitly, and writes a JSON summary. It refuses to trust
 * a run if the linked package was rebuilt during the measurement (DSH hot
 * reload would replace the running plugin and invalidate the result).
 *
 * Usage:
 *   node spikes/s1/soak.mjs web     "http://127.0.0.1:4317/?token=<token>" stream 600 .tmp/soak-web.json
 *   node spikes/s1/soak.mjs desktop -                                     pull   600 .tmp/soak-desktop.json
 *
 * Desktop mode attaches only to the already-started, loopback CDP endpoint
 * 127.0.0.1:9223; it never starts a browser or exposes CDP to the network.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from 'playwright-core'

const [target, url, mode, secondsArg, outPath] = process.argv.slice(2)
if (!target || !mode || !secondsArg || !outPath) {
  throw new Error('usage: node soak.mjs <web|desktop> <url-or-dash> <pull|stream> <seconds> <out.json>')
}
if (target !== 'web' && target !== 'desktop') throw new Error(`unsupported target: ${target}`)
if (mode !== 'pull' && mode !== 'stream') throw new Error(`unsupported mode: ${mode}`)
const seconds = Number(secondsArg)
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('seconds must be a positive number')
const consoleErrors = []
const packageFiles = ['spikes/s1/package/lib/client.js', 'spikes/s1/package/lib/index.js']
const packageMtimes = async () => Promise.all(packageFiles.map(async (file) => (await stat(file)).mtimeMs))
const mtimesBefore = await packageMtimes()

const browser = target === 'desktop'
  ? await chromium.connectOverCDP('http://127.0.0.1:9223')
  : await chromium.launch({ channel: 'msedge', headless: true })

let context
let page
if (target === 'desktop') {
  context = browser.contexts()[0]
  if (!context) throw new Error('no CDP context')
  page = context.pages().find((candidate) => candidate.url().startsWith('dsh-app://app')) ?? context.pages()[0]
} else {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
}
if (!page) throw new Error('no page')

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`))

await page.waitForFunction(() => Boolean(window.__vibeS1), undefined, { timeout: 60000 })
for (let attempt = 0; attempt < 120; attempt += 1) {
  const opened = await page.evaluate(() => window.__vibeS1.openTab())
  if (opened?.ok) break
  await page.waitForTimeout(500)
}
await page.waitForTimeout(1500)

const sample = () => page.evaluate(async () => {
  const heapUsed = performance.memory?.usedJSHeapSize ?? null
  let live = null
  try { live = window.__vibeS1.report() } catch (error) { live = { error: String(error) } }
  let health = null
  try { health = await window.__vibeS1.health() } catch (error) { health = { ok: false, error: String(error) } }
  return { at: new Date().toISOString(), heapUsed, report: live, health }
})

const samples = []
samples.push(await sample())
await page.evaluate((args) => window.__vibeS1.start(args.mode, args.seconds), { mode, seconds })

const started = Date.now()
while (Date.now() - started < seconds * 1000 - 2000) {
  const remaining = seconds * 1000 - (Date.now() - started)
  await page.waitForTimeout(Math.max(1000, Math.min(60000, remaining)))
  try { samples.push(await sample()) } catch (error) { consoleErrors.push(`sample: ${String(error).slice(0, 300)}`) }
}

// Do not rely solely on the page's auto-stop timer: a background/headless
// tab may throttle it. stop() is a no-op if the timer already fired.
await page.evaluate(() => window.__vibeS1.stop())
await page.waitForFunction(() => {
  const report = window.__vibeS1?.report?.()
  return Boolean(report && (report.postResult !== undefined || report.postError !== null))
}, undefined, { timeout: 60000 })
const report = await page.evaluate(async () => await window.__vibeS1.waitForReport())
samples.push(await sample())

const packageChanged = (await packageMtimes()).some((mtime, index) => mtime !== mtimesBefore[index])
if (packageChanged) consoleErrors.push('linked package changed during soak; DSH may have hot-reloaded the plugin')

const summary = {
  target,
  mode,
  seconds,
  startedAt: new Date(started).toISOString(),
  packageChanged,
  samples,
  report,
  consoleErrors,
}
await mkdir(dirname(outPath), { recursive: true })
await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  target,
  mode,
  samples: samples.map((item) => ({
    at: item.at,
    heapUsed: item.heapUsed,
    hostRss: item.health?.value?.hostRss,
    frames: item.report?.frames,
    fps: item.report?.fps,
  })),
  report: {
    frames: report?.frames,
    fps: report?.fps,
    seqGaps: report?.seqGaps,
    errors: report?.errors,
    reconnects: report?.reconnects,
    client: report?.client,
    postResult: report?.postResult,
  },
  consoleErrors,
}, null, 2))

if (target === 'web') await browser.close()
process.exit(0)
