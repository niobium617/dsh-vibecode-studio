/**
 * T003 S3 driver — Playwright + Edge screencast, input and Chinese IME probe.
 *
 * Serves `fixture.html` over loopback, then for each mode (headless/headful):
 *   1. Captures CDP screencast frames for N seconds and measures fps, frame size
 *      and capture-to-receive latency.
 *   2. Measures dispatch-to-event and dispatch-to-paint latency for click,
 *      wheel, keyboard, `insertText`, per-character CJK typing and a simulated
 *      IME composition sequence (CDP `Input.imeSetComposition`).
 *   3. Records console/page errors and writes `spikes/s3/results.json`.
 *
 * Usage:
 *   pnpm tsx spikes/s3/run.ts [--seconds 10] [--mode both|headless|headful]
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(here, 'fixture.html')
const resultsPath = join(here, 'results.json')
const VIEWPORT = { width: 1280, height: 800 }
const QUALITY = 70

type Mode = 'headless' | 'headful'

interface FrameSample {
  at: number
  ts: number
  bytes: number
  hash: string
  valid: boolean
}

interface VibeEvent {
  type: string
  t: number
  perf?: number
  paint?: number
  data?: string | null
  isComposing?: boolean
  inputType?: string
  key?: string
  value?: string | null
  target?: string | null
  scrollY?: number
}

interface VibeSnapshot {
  now: number
  frames: number
  scrollY: number
  text: string
  ime: string
  status: string
  active: string | null
  events: VibeEvent[]
}

interface VibeWindow {
  __vibeReset: () => void
  __vibeSnapshot: () => VibeSnapshot
}

interface Latency {
  avg: number | null
  p95: number | null
  max: number | null
}

interface InputSample {
  action: string
  dispatchMs: number | null
  paintMs: number | null
  accepted: boolean
  detail: string
}

interface ScreencastResult {
  mode: Mode
  seconds: number
  frames: number
  uniqueFrames: number
  fps: number
  uniqueFps: number
  firstFrameMs: number | null
  bytesPerFrame: number
  fpsBySecond: number[]
  captureLatency: Latency
  jpegValid: boolean
  errors: number
}

interface ModeResult extends ScreencastResult {
  edgeVersion: string
  inputs: InputSample[]
  inputMaxMs: number | null
  cjk: {
    insertText: string
    typeCjk: string
    ime: string
    compositionEvents: number
    composingEvents: number
  }
  focus: {
    afterClick: string | null
    afterTab: string | null
    escReceived: boolean
  }
  consoleErrors: string[]
  pass: boolean
  failures: string[]
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function summarise(values: number[]): Latency {
  return {
    avg: round(average(values)),
    p95: round(percentile(values, 0.95)),
    max: round(values.length === 0 ? null : Math.max(...values)),
  }
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width)
}

function bucketise(times: number[], startedAt: number): number[] {
  const buckets: number[] = []
  for (const time of times) {
    const index = Math.floor((time - startedAt) / 1000)
    if (index < 0) continue
    while (buckets.length <= index) buckets.push(0)
    buckets[index] += 1
  }
  return buckets
}

function jpegLooksComplete(bytes: Buffer): boolean {
  return bytes.length > 4 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
}

function eventLatency(event: VibeEvent | undefined, startedAt: number): { dispatchMs: number | null; paintMs: number | null } {
  if (!event) return { dispatchMs: null, paintMs: null }
  return {
    dispatchMs: round(Math.max(0, event.t - startedAt)),
    paintMs: event.paint === undefined ? null : round(Math.max(0, event.paint - startedAt)),
  }
}

async function snapshot(page: Page): Promise<VibeSnapshot> {
  return page.evaluate(() => (window as unknown as VibeWindow).__vibeSnapshot())
}

async function resetLog(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as VibeWindow).__vibeReset())
}

async function clearField(page: Page, id: 'text' | 'ime'): Promise<void> {
  await page.evaluate((fieldId: string) => {
    const element = document.getElementById(fieldId)
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = ''
      element.focus()
      element.setSelectionRange(0, 0)
    }
  }, id)
}

function findEvent(events: VibeEvent[], type: string): VibeEvent | undefined {
  return events.find((event) => event.type === type)
}

function pushSample(samples: InputSample[], action: string, event: VibeEvent | undefined, startedAt: number, accepted: boolean, detail: string): void {
  const latency = eventLatency(event, startedAt)
  samples.push({ action, dispatchMs: latency.dispatchMs, paintMs: latency.paintMs, accepted, detail })
}

async function runScreencast(page: Page, mode: Mode, seconds: number): Promise<ScreencastResult> {
  const frames: FrameSample[] = []
  let firstFrameAt: number | null = null
  let errors = 0
  const startedAt = Date.now()

  await page.screencast.start({
    size: VIEWPORT,
    quality: QUALITY,
    onFrame: (frame) => {
      try {
        const now = Date.now()
        if (firstFrameAt === null) firstFrameAt = now
        frames.push({
          at: now,
          ts: frame.timestamp,
          bytes: frame.data.length,
          hash: createHash('sha1').update(frame.data).digest('hex'),
          valid: jpegLooksComplete(frame.data),
        })
      } catch {
        errors += 1
      }
    },
  })
  await page.waitForTimeout(seconds * 1000)
  await page.screencast.stop()
  const endedAt = Date.now()

  const unique = new Set(frames.map((frame) => frame.hash)).size
  const durationSeconds = Math.max(0.001, (endedAt - startedAt) / 1000)
  const captureLatencies = frames.map((frame) => Math.max(0, frame.at - frame.ts))
  const arrivals = frames.map((frame) => frame.at)
  const bytes = frames.reduce((sum, frame) => sum + frame.bytes, 0)

  return {
    mode,
    seconds,
    frames: frames.length,
    uniqueFrames: unique,
    fps: Math.round((frames.length / durationSeconds) * 10) / 10,
    uniqueFps: Math.round((unique / durationSeconds) * 10) / 10,
    firstFrameMs: firstFrameAt === null ? null : firstFrameAt - startedAt,
    bytesPerFrame: frames.length === 0 ? 0 : Math.round(bytes / frames.length),
    fpsBySecond: bucketise(arrivals, startedAt),
    captureLatency: summarise(captureLatencies),
    jpegValid: frames.length > 0 && frames.every((frame) => frame.valid),
    errors,
  }
}

async function runInputs(page: Page): Promise<{
  inputs: InputSample[]
  cjk: ModeResult['cjk']
  focus: ModeResult['focus']
  consoleErrors: string[]
}> {
  const samples: InputSample[] = []
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  // click — measure pointerdown (first event) and require the handler to run.
  const box = await page.locator('#hit').boundingBox()
  if (box === null) throw new Error('fixture #hit has no bounding box')
  await resetLog(page)
  const clickStart = Date.now()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(250)
  let snap = await snapshot(page)
  pushSample(
    samples,
    'click',
    findEvent(snap.events, 'pointerdown'),
    clickStart,
    snap.status.startsWith('clicked'),
    `status=${snap.status.slice(0, 24)}`,
  )

  // wheel — measure the first scroll event and require the page to move.
  await page.evaluate(() => window.scrollTo(0, 0))
  await resetLog(page)
  const wheelStart = Date.now()
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(500)
  snap = await snapshot(page)
  pushSample(
    samples,
    'wheel',
    findEvent(snap.events, 'scroll'),
    wheelStart,
    snap.scrollY > 0,
    `scrollY=${snap.scrollY}`,
  )

  // keyboard — ASCII typing.
  await page.locator('#text').click()
  await clearField(page, 'text')
  await resetLog(page)
  const keyStart = Date.now()
  await page.keyboard.type('abc')
  await page.waitForTimeout(200)
  snap = await snapshot(page)
  pushSample(samples, 'keyboard', findEvent(snap.events, 'keydown'), keyStart, snap.text === 'abc', `text=${snap.text}`)

  // Chinese via Input.insertText (the clipboard-free fallback path).
  await clearField(page, 'text')
  await resetLog(page)
  const insertStart = Date.now()
  await page.keyboard.insertText('你好，世界')
  await page.waitForTimeout(200)
  snap = await snapshot(page)
  const insertText = snap.text
  pushSample(
    samples,
    'insertText',
    findEvent(snap.events, 'input'),
    insertStart,
    insertText === '你好，世界',
    `text=${insertText}`,
  )

  // Chinese via per-character keyboard.type.
  await clearField(page, 'text')
  await resetLog(page)
  const typeStart = Date.now()
  await page.keyboard.type('中文')
  await page.waitForTimeout(200)
  snap = await snapshot(page)
  const typeCjk = snap.text
  pushSample(samples, 'typeCjk', findEvent(snap.events, 'input'), typeStart, typeCjk === '中文', `text=${typeCjk}`)

  // Simulated IME: composition updates, then a measured commit.
  await page.locator('#ime').click()
  await clearField(page, 'ime')
  await resetLog(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
  await page.waitForTimeout(80)
  await cdp.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 })
  await page.waitForTimeout(80)
  const commitStart = Date.now()
  await cdp.send('Input.insertText', { text: '你好' })
  await page.waitForTimeout(200)
  snap = await snapshot(page)
  const ime = snap.ime
  const compositionEvents = snap.events.filter((event) => event.type.startsWith('composition')).length
  const composingEvents = snap.events.filter((event) => event.isComposing === true).length
  const commitEvent = [...snap.events].reverse().find((event) => event.type === 'compositionend') ??
    [...snap.events].reverse().find((event) => event.type === 'input')
  pushSample(samples, 'imeCommit', commitEvent, commitStart, ime === '你好', `text=${ime}`)

  // Focus order + Esc/Tab responsiveness (plan S3 pass criteria).
  await page.locator('#text').click()
  await clearField(page, 'text')
  snap = await snapshot(page)
  const afterClick = snap.active
  await page.keyboard.press('Tab')
  await page.waitForTimeout(120)
  snap = await snapshot(page)
  const afterTab = snap.active
  await resetLog(page)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
  snap = await snapshot(page)
  const escReceived = snap.events.some((event) => event.type === 'keydown' && event.key === 'Escape')

  return {
    inputs: samples,
    cjk: { insertText, typeCjk, ime, compositionEvents, composingEvents },
    focus: { afterClick, afterTab, escReceived },
    consoleErrors,
  }
}

async function runMode(mode: Mode, seconds: number, base: string): Promise<ModeResult> {
  const browser: Browser = await chromium.launch({ channel: 'msedge', headless: mode === 'headless' })
  const edgeVersion = browser.version()
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'zh-CN' })
    const page = await context.newPage()
    await page.goto(base, { waitUntil: 'load' })
    await page.bringToFront()
    await page.waitForTimeout(400)

    const screencast = await runScreencast(page, mode, seconds)
    const { inputs, cjk, focus, consoleErrors } = await runInputs(page)

    const failures: string[] = []
    if (screencast.frames === 0) failures.push('no screencast frames')
    if (screencast.uniqueFps < 10) failures.push(`unique screencast fps ${screencast.uniqueFps} < 10`)
    if (!screencast.jpegValid) failures.push('invalid JPEG frame')
    for (const sample of inputs) {
      if (!sample.accepted) failures.push(`${sample.action} not accepted (${sample.detail})`)
      if (sample.dispatchMs === null || sample.dispatchMs >= 200) {
        failures.push(`${sample.action} dispatch latency ${sample.dispatchMs ?? '—'} ms >= 200`)
      }
      if (sample.paintMs !== null && sample.paintMs >= 200) {
        failures.push(`${sample.action} paint latency ${sample.paintMs} ms >= 200`)
      }
    }
    if (cjk.compositionEvents === 0 || cjk.composingEvents === 0) failures.push('IME composition events missing')
    if (focus.afterClick !== 'text') failures.push(`focus after click is ${focus.afterClick ?? 'null'}, expected text`)
    if (focus.afterTab !== 'ime') failures.push(`focus after Tab is ${focus.afterTab ?? 'null'}, expected ime`)
    if (!focus.escReceived) failures.push('Escape keydown not delivered')
    if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} console/page error(s)`)

    const inputMax = Math.max(...inputs.map((sample) => sample.dispatchMs ?? Infinity))
    return {
      ...screencast,
      edgeVersion,
      inputs,
      inputMaxMs: Number.isFinite(inputMax) ? round(inputMax) : null,
      cjk,
      focus,
      consoleErrors,
      pass: failures.length === 0,
      failures,
    }
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  const fixtureHtml = await readFile(fixturePath, 'utf8')
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (path === '/' || path === '/fixture.html') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(fixtureHtml)
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const bound = server.address()
  if (bound === null || typeof bound === 'string') throw new Error('fixture server did not bind')
  const base = `http://127.0.0.1:${bound.port}/`

  const seconds = Math.max(1, Number(flag('--seconds') ?? '10') || 10)
  const modeArg = flag('--mode') ?? 'both'
  const modes: Mode[] = modeArg === 'headless' || modeArg === 'headful' ? [modeArg] : ['headless', 'headful']

  const results: ModeResult[] = []
  try {
    for (const mode of modes) {
      console.log(`\n[vibe-s3] ${mode}: ${seconds}s screencast + input suite (Edge ${mode === 'headless' ? 'headless' : 'headful'}) …`)
      results.push(await runMode(mode, seconds, base))
    }
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  console.log('\nS3 screencast + input — Microsoft Edge (channel: msedge)')
  console.log(`${VIEWPORT.width}x${VIEWPORT.height} JPEG q${QUALITY} · target ${seconds} s capture per mode`)
  console.log([
    pad('mode', 10), pad('frames', 8), pad('fps', 7), pad('uniq fps', 10), pad('first', 8),
    pad('KB/frame', 10), pad('cap avg/p95', 14), pad('input max', 11), pad('pass', 6),
  ].join(''))
  console.log('-'.repeat(96))
  for (const result of results) {
    console.log([
      pad(result.mode, 10), pad(result.frames, 8), pad(result.fps, 7), pad(result.uniqueFps, 10),
      pad(`${result.firstFrameMs ?? '—'}ms`, 8),
      pad((result.bytesPerFrame / 1024).toFixed(1), 10),
      pad(`${result.captureLatency.avg ?? '—'}/${result.captureLatency.p95 ?? '—'}ms`, 14),
      pad(`${result.inputMaxMs ?? '—'}ms`, 11), pad(result.pass ? 'PASS' : 'FAIL', 6),
    ].join(''))
  }
  console.log('-'.repeat(96))
  for (const result of results) {
    console.log(`${result.mode}: fpsBySecond = [${result.fpsBySecond.join(', ')}]`)
    console.log(`${result.mode} inputs: ` + result.inputs.map((sample) =>
      `${sample.action} ${sample.dispatchMs ?? '—'}/${sample.paintMs ?? '—'}ms`).join(' · '))
    console.log(`${result.mode} CJK: insertText=${result.cjk.insertText} typeCjk=${result.cjk.typeCjk} ime=${result.cjk.ime} composition=${result.cjk.compositionEvents} composing=${result.cjk.composingEvents}`)
    console.log(`${result.mode} focus: click=${result.focus.afterClick ?? 'null'} tab=${result.focus.afterTab ?? 'null'} esc=${result.focus.escReceived}`)
    if (result.consoleErrors.length > 0) console.log(`${result.mode} console errors: ${result.consoleErrors.join(' | ')}`)
    for (const failure of result.failures) console.log(`${result.mode} FAIL: ${failure}`)
  }

  const pass = results.every((result) => result.pass)
  await writeFile(resultsPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    browser: 'msedge',
    viewport: VIEWPORT,
    quality: QUALITY,
    seconds,
    modes: results,
    pass,
  }, null, 2)}\n`, 'utf8')
  console.log(`\nresults JSON -> spikes/s3/results.json`)
  if (!pass) process.exitCode = 1
}

await main()
