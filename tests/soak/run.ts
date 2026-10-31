/**
 * T058 soak driver — 30 minutes of real use plus 100 annotations.
 *
 * Boots the fixture dev server and a real DSH carrier (the same `vibe-dev`
 * profile the extension runs in), drives the studio through Edge, saves 100
 * annotations, then keeps sampling until the duration elapses. Every sample
 * records the renderer heap, DOM node count, and the RSS of the whole process
 * tree below this script; periodic windows measure delivered frame rate by
 * hashing the preview canvas while the picker overlay repaints.
 *
 * At the end the driver stops the preview, closes the browser and the carrier,
 * verifies within 5 s that no child process survived, and writes
 * `tasks/soak-report.md` plus a full JSON log under `.tmp/logs/`.
 *
 * Usage:
 *   pnpm test:soak
 *   pnpm test:soak -- --seconds=120 --annotations=10 --json=.tmp/logs/smoke.json --report=.tmp/logs/smoke.md
 *
 * Requirements: `VIBE_DSH_BIN` pointing at a dsh launcher whose `vibe-dev`
 * profile links this package, and a fresh `pnpm build` (DSH loads
 * lib/client.js). Preview targets stay on loopback.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import { resolveDshBin, startDsh, type DshCarrier } from '../e2e/dsh-carrier'

const DSH_PORT = 4341
const FIXTURE_PORT = 4320
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}/`
const SAMPLE_INTERVAL_MS = 15_000
const FPS_WINDOW_MS = 5_000
const FPS_EVERY_MS = 5 * 60_000
const TAB_SWITCH_EVERY_MS = 10 * 60_000
const CLEANUP_BUDGET_MS = 5_000

interface Options {
  readonly seconds: number
  readonly annotations: number
  readonly profile: string
  readonly report: string
  readonly json: string
  readonly headful: boolean
}

interface ProcRow {
  readonly ProcessId: number
  readonly ParentProcessId: number
  readonly Name: string
  readonly WorkingSetSize: number
  /** WMI datetime (opaque); pid + creation time identifies one process. */
  readonly CreationDate: string
}

interface ProcSnapshot {
  readonly at: string
  readonly total: number
  readonly rssBytes: number
  readonly byName: Record<string, { count: number; rssBytes: number }>
  readonly driverRss: number
  readonly dshRootAlive: boolean
}

interface RendererSample {
  readonly heapUsed: number | null
  readonly domNodes: number
  readonly queueCount: number | null
  readonly previewState: string | null
}

interface Sample {
  readonly at: string
  readonly elapsedSec: number
  readonly renderer: RendererSample
  readonly procs: ProcSnapshot
}

interface FpsWindow {
  readonly elapsedSec: number
  readonly fps: number
  readonly changes: number
  readonly samples: number
  /** Transport frame-count delta over the window, when the details panel read it. */
  readonly frames?: number | null
}

interface SoakResult {
  readonly ok: boolean
  readonly checks: Record<string, boolean>
  readonly annotations: { saved: number; badge: number | null; historyDelta: number }
  readonly latencyMs: readonly number[]
  readonly fpsWindows: readonly FpsWindow[]
  readonly samples: readonly Sample[]
  readonly errors: readonly string[]
  readonly leftovers: readonly string[]
  readonly portsClosed: Record<string, boolean>
  readonly actualSeconds: number
  readonly fixtureSpawned: boolean
}

function parseArgs(argv: readonly string[]): Options {
  const get = (name: string): string | undefined => {
    const prefix = `--${name}=`
    const hit = argv.find((arg) => arg.startsWith(prefix))
    return hit === undefined ? undefined : hit.slice(prefix.length)
  }
  const number = (name: string, fallback: number): number => {
    const raw = get(name)
    if (raw === undefined) return fallback
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`)
    return value
  }
  return {
    seconds: number('seconds', 30 * 60),
    annotations: number('annotations', 100),
    profile: get('profile') ?? 'vibe-dev',
    report: get('report') ?? 'tasks/soak-report.md',
    json: get('json') ?? '.tmp/logs/t058-soak.json',
    headful: argv.includes('--headful'),
  }
}

function collectErrors(page: Page, errors: string[]): void {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.slice(0, 300)}`))
  page.on('crash', () => errors.push('page crashed'))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 300)}`)
  })
}

async function responds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
    return response.status > 0
  } catch {
    return false
  }
}

async function ensureFixture(): Promise<{ child: ChildProcess | null; log: string[] }> {
  if (await responds(FIXTURE_URL)) return { child: null, log: [] }
  const log: string[] = []
  const child = spawn('cmd.exe', ['/c', 'pnpm', 'fixture:dev'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const append = (chunk: Buffer): void => {
    log.push(chunk.toString())
    if (log.join('').length > 10_000) log.shift()
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await responds(FIXTURE_URL)) return { child, log }
    await sleep(500)
  }
  stopTree(child)
  throw new Error(`fixture did not start:\n${log.join('').slice(-1_500)}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

function stopTree(child: ChildProcess | null): void {
  if (child === null || child.exitCode !== null || child.pid === undefined) return
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // Already gone.
  }
}

function isProcRow(value: unknown): value is ProcRow {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.ProcessId === 'number' &&
    typeof row.ParentProcessId === 'number' &&
    typeof row.Name === 'string' &&
    typeof row.WorkingSetSize === 'number' &&
    typeof row.CreationDate === 'string'
  )
}

function readProcessTable(): ProcRow[] {
  const script =
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CreationDate | ConvertTo-Json -Compress'
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    timeout: 30_000,
  })
  const parsed: unknown = JSON.parse(output)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.filter(isProcRow)
}

function descendants(rows: readonly ProcRow[], root: number): ProcRow[] {
  const byParent = new Map<number, ProcRow[]>()
  for (const row of rows) {
    const list = byParent.get(row.ParentProcessId) ?? []
    list.push(row)
    byParent.set(row.ParentProcessId, list)
  }
  const seen = new Set<number>([root])
  const result: ProcRow[] = []
  const queue = [root]
  while (queue.length > 0) {
    const pid = queue.shift() as number
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.ProcessId)) continue
      seen.add(child.ProcessId)
      result.push(child)
      queue.push(child.ProcessId)
    }
  }
  return result
}

/** Child processes below this script, minus the transient PowerShell query. */
function soakProcesses(rows: readonly ProcRow[]): ProcRow[] {
  return descendants(rows, process.pid).filter(
    (row) => !/^(powershell|pwsh)\.exe$/i.test(row.Name),
  )
}

function identityOf(row: ProcRow): string {
  return `${row.ProcessId}:${row.CreationDate}`
}

/**
 * Ids of the processes this script started and may therefore stop. The name
 * allow-list matters: on Windows a dead PID can be reused within seconds, and
 * a reused PID must never be killed just because its parent link lands in our
 * tree.
 */
const TEST_PROCESS = /^(node|esbuild|cmd|conhost|msedge|chrome|dsh)(\.exe)?$/i

/** Records every live descendant so cleanup can match pid + creation time. */
function rememberOwned(rows: readonly ProcRow[], owned: Map<string, ProcRow>): void {
  for (const row of soakProcesses(rows)) owned.set(identityOf(row), row)
}

function processSnapshot(rows: readonly ProcRow[], dshRoot: ProcRow | null): ProcSnapshot {
  const tree = soakProcesses(rows)
  const byName: Record<string, { count: number; rssBytes: number }> = {}
  for (const row of tree) {
    const key = row.Name.toLowerCase()
    const entry = (byName[key] ??= { count: 0, rssBytes: 0 })
    entry.count += 1
    entry.rssBytes += row.WorkingSetSize
  }
  const driver = rows.find((row) => row.ProcessId === process.pid)
  return {
    at: new Date().toISOString(),
    total: tree.length,
    rssBytes: tree.reduce((sum, row) => sum + row.WorkingSetSize, 0),
    byName,
    driverRss: driver?.WorkingSetSize ?? 0,
    dshRootAlive:
      dshRoot !== null && rows.some((row) => identityOf(row) === identityOf(dshRoot)),
  }
}

function readRenderer(page: Page): Promise<RendererSample> {
  return page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
    const badge = document.querySelector('[data-vibe-annotation-count]')
    const status = document.querySelector('[data-vibe-status="1"]')
    const parsed = badge === null ? Number.NaN : Number.parseInt(badge.textContent ?? '', 10)
    return {
      heapUsed: memory?.usedJSHeapSize ?? null,
      domNodes: document.getElementsByTagName('*').length,
      queueCount: Number.isFinite(parsed) ? parsed : null,
      previewState: status?.getAttribute('data-state') ?? null,
    }
  })
}

async function collectSample(
  page: Page,
  startedAt: number,
  dshRoot: ProcRow | null,
  owned: Map<string, ProcRow>,
): Promise<Sample> {
  const rows = readProcessTable()
  rememberOwned(rows, owned)
  return {
    at: new Date().toISOString(),
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    renderer: await readRenderer(page),
    procs: processSnapshot(rows, dshRoot),
  }
}

function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-vibe-preview="1"] canvas')
    if (canvas === null) return { x: 0, y: 0, width: 0, height: 0 }
    const box = canvas.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  })
}

/**
 * Counts visible frames for `FPS_WINDOW_MS`. CDP screencast only emits on a
 * paint, and the fixture is static, so the window scrolls the remote page with
 * alternating wheel steps while hashing the canvas; the transport's own frame
 * counter (toolbar details) is read alongside for cross-checking.
 */
async function measureFps(page: Page): Promise<FpsWindow> {
  const preview = page.locator('[data-vibe-preview="1"]')
  const toggle = preview.locator('[data-vibe-pick-toggle="1"]')
  const wasPicking = (await toggle.getAttribute('aria-pressed')) === 'true'
  if (wasPicking) await toggle.click()

  const statusButton = preview.locator('[data-vibe-status="1"]')
  const details = page.locator('#vibe-preview-details')
  const detailsOpen = (await details.count()) > 0
  if (!detailsOpen) await statusButton.click()
  const framesCell = page.locator('#vibe-preview-details > div').nth(1).locator('span').nth(1)
  const framesBefore = Number.parseInt((await framesCell.textContent()) ?? '', 10)

  const box = await canvasBox(page)
  const traced = page.evaluate(async (durationMs) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-vibe-preview="1"] canvas')
    const context = canvas?.getContext('2d') ?? null
    if (canvas === null || context === null) return null
    const width = Math.min(320, canvas.width)
    const height = Math.min(180, canvas.height)
    if (width === 0 || height === 0) return null
    const left = Math.floor((canvas.width - width) / 2)
    const top = Math.floor((canvas.height - height) / 2)
    const hashes: number[] = []
    const start = performance.now()
    while (performance.now() - start < durationMs) {
      const data = context.getImageData(left, top, width, height).data
      let hash = 0
      for (let index = 0; index < data.length; index += 53) hash = (hash * 31 + data[index]) | 0
      hashes.push(hash)
      await new Promise((done) => setTimeout(done, 40))
    }
    return { hashes, width: canvas.width, height: canvas.height }
  }, FPS_WINDOW_MS)

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const scrollUntil = Date.now() + FPS_WINDOW_MS
  let direction = 1
  while (Date.now() < scrollUntil) {
    await page.mouse.wheel(0, 160 * direction)
    direction = -direction
    await sleep(40)
  }
  const trace = await traced

  const framesAfter = Number.parseInt((await framesCell.textContent()) ?? '', 10)
  if (!detailsOpen) await statusButton.click().catch(() => {})
  if (wasPicking) await toggle.click().catch(() => {})

  if (trace === null) return { elapsedSec: 0, fps: 0, changes: 0, samples: 0 }
  const hashes = trace.hashes
  let changes = 0
  for (let index = 1; index < hashes.length; index += 1) {
    if (hashes[index] !== hashes[index - 1]) changes += 1
  }
  if (process.env.VIBE_SOAK_DEBUG === '1') {
    console.log(
      'FPS TRACE',
      JSON.stringify({
        canvas: [trace.width, trace.height],
        samples: hashes.length,
        distinct: new Set(hashes).size,
        first: hashes.slice(0, 6),
        framesBefore,
        framesAfter,
      }),
    )
  }
  const frames =
    Number.isFinite(framesBefore) && Number.isFinite(framesAfter) ? framesAfter - framesBefore : null
  return {
    elapsedSec: 0,
    fps: changes / (FPS_WINDOW_MS / 1000),
    changes,
    samples: hashes.length,
    frames,
  }
}

async function openNewConversation(page: Page): Promise<void> {
  const composer = page.locator('[contenteditable="true"]').first()
  if ((await composer.count()) > 0) return
  const newChat = page.getByRole('button', { name: /新建会话|新建对话|New chat/i }).first()
  if ((await newChat.count()) > 0) await newChat.click()
  const standard = page.locator('button', { hasText: '标准模式' }).first()
  if ((await standard.count()) > 0) await standard.click()
  await composer.waitFor({ state: 'visible', timeout: 20_000 })
}

async function openStudioPanel(page: Page): Promise<void> {
  const shell = page.locator('[data-vibe-shell="1"]')
  if ((await shell.count()) === 0) {
    const opener = page.getByRole('button', { name: /open right sidebar|打开右侧边栏/i }).first()
    if ((await opener.count()) === 0) throw new Error('no right-sidebar opener in the DSH chrome')
    await opener.click({ timeout: 20_000 })
    await page.getByText('Vibe Studio', { exact: true }).first().click()
  }
  await shell.waitFor({ state: 'visible', timeout: 30_000 })
}

async function startPreview(page: Page): Promise<void> {
  const preview = page.locator('[data-vibe-preview="1"]')
  await preview.waitFor({ state: 'visible', timeout: 30_000 })
  await preview.locator('#vibe-preview-url').fill(FIXTURE_URL)
  await preview.locator('button[type="submit"]').click()
  await preview.locator('[data-vibe-status="1"][data-state="ready"]').waitFor({
    state: 'visible',
    timeout: 60_000,
  })
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-vibe-preview="1"] canvas')
      const context = canvas?.getContext('2d') ?? null
      if (canvas === null || context === null) return false
      // The fixture centres its content, so the page background in a corner of
      // a centred region is the reference for "the canvas has drawn something".
      const width = Math.min(320, canvas.width)
      const height = Math.min(180, canvas.height)
      const data = context.getImageData(
        Math.floor((canvas.width - width) / 2),
        Math.floor((canvas.height - height) / 2),
        width,
        height,
      ).data
      const [baseR, baseG, baseB] = [data[0], data[1], data[2]]
      let painted = 0
      for (let index = 0; index < data.length; index += 4) {
        const delta =
          Math.abs(data[index] - baseR) +
          Math.abs(data[index + 1] - baseG) +
          Math.abs(data[index + 2] - baseB)
        if (delta > 60) painted += 1
      }
      return painted > 100
    },
    undefined,
    { timeout: 30_000 },
  )
}

async function clickInPreview(page: Page, x: number, y: number): Promise<void> {
  const box = await canvasBox(page)
  if (box.width === 0 || box.height === 0) throw new Error('preview canvas has no box')
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
}

const POINTS: readonly (readonly [number, number])[] = [
  [0.15, 0.1],
  [0.45, 0.1],
  [0.75, 0.1],
  [0.15, 0.3],
  [0.45, 0.3],
  [0.75, 0.3],
  [0.15, 0.5],
  [0.45, 0.5],
]

async function saveAnnotations(
  page: Page,
  count: number,
  latencyMs: number[],
): Promise<void> {
  const preview = page.locator('[data-vibe-preview="1"]')
  const toggle = preview.locator('[data-vibe-pick-toggle="1"]')
  await toggle.click()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-vibe-pick-toggle="1"]')?.getAttribute('aria-pressed') === 'true',
    undefined,
    { timeout: 15_000 },
  )
  const bubble = preview.locator('[data-vibe-annotation-bubble="1"]')
  const input = preview.locator('[data-vibe-annotation-input="1"]')
  const save = preview.locator('[data-vibe-annotation-save="1"]')
  for (let index = 0; index < count; index += 1) {
    const point = POINTS[index % POINTS.length] as readonly [number, number]
    const started = Date.now()
    await clickInPreview(page, point[0], point[1])
    await bubble.waitFor({ state: 'visible', timeout: 30_000 })
    await input.fill(`soak 标注 #${index + 1}: 检查标题字号与按钮间距`)
    await save.click()
    await bubble.waitFor({ state: 'hidden', timeout: 15_000 })
    latencyMs.push(Date.now() - started)
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))
  return sorted[index]
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** True when a local TCP socket is still LISTENING on `port` (foreign ports ignored). */
function portListening(port: number): boolean {
  const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
  })
  const suffix = `:${port}`
  return output.split(/\r?\n/).some((line) => {
    const columns = line.trim().split(/\s+/)
    return (
      columns[0] === 'TCP' &&
      columns[3] === 'LISTENING' &&
      (columns[1] ?? '').endsWith(suffix)
    )
  })
}

async function annotationFileCount(): Promise<number> {
  try {
    const entries = await readdir(join(process.cwd(), '.vibe', 'annotations'))
    return entries.filter((name) => name.endsWith('.json')).length
  } catch {
    return 0
  }
}

async function waitForCleanup(
  owned: Map<string, ProcRow>,
  dshRoot: ProcRow | null,
): Promise<string[]> {
  const deadline = Date.now() + CLEANUP_BUDGET_MS
  let leftovers: string[] = []
  while (Date.now() < deadline) {
    const rows = readProcessTable()
    const alive = new Map(rows.map((row) => [identityOf(row), row]))
    // Only identities this run actually observed and names it actually starts;
    // an orphaned esbuild service or conhost can outlive the tree kill.
    const remaining = [...owned.values()].filter(
      (row) => alive.has(identityOf(row)) && TEST_PROCESS.test(row.Name),
    )
    leftovers = remaining.map((row) => `${row.Name}#${row.ProcessId}`)
    const dshAlive =
      dshRoot !== null && alive.has(identityOf(dshRoot)) && TEST_PROCESS.test(dshRoot.Name)
    if (leftovers.length === 0 && !dshAlive) return []
    for (const row of remaining) killPid(row.ProcessId)
    await sleep(500)
  }
  return leftovers
}

function killPid(pid: number): void {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true })
  } catch {
    // Already gone.
  }
}

function buildReport(
  options: Options,
  result: SoakResult,
  fixtureSpawned: boolean,
): string {
  const lines: string[] = []
  const first = result.samples[0]
  const last = result.samples[result.samples.length - 1]
  lines.push(
    `# T058 soak 报告（${Math.round(options.seconds / 60)} 分钟使用 + ${options.annotations} 次标注）`,
  )
  lines.push('')
  lines.push(`- 日期：${new Date().toISOString().slice(0, 10)}`)
  lines.push(`- 计划时长：${options.seconds} 秒；实际：${result.actualSeconds} 秒`)
  lines.push(`- DSH：真实载体，启动器由 \`VIBE_DSH_BIN\` 提供，profile \`${options.profile}\``)
  lines.push(`- Fixture：\`${FIXTURE_URL}\`（本驱动${fixtureSpawned ? '自行启动' : '复用已有服务'}）`)
  lines.push(`- 浏览器：Edge（headless=${options.headful ? 'false' : 'true'}），视口 1280×800`)
  lines.push('')
  lines.push('## 1. 结论')
  lines.push('')
  lines.push(result.ok ? '**通过**：无崩溃、无进程泄漏、内存增长可解释。' : '**未通过**：见下表未通过项，需修复后重跑。')
  lines.push('')
  lines.push('| 检查 | 结果 |')
  lines.push('|---|---|')
  for (const [name, passed] of Object.entries(result.checks)) {
    lines.push(`| ${name} | ${passed ? '通过' : '**未通过**'} |`)
  }
  lines.push('')
  lines.push('## 2. 标注')
  lines.push('')
  lines.push(`- 保存成功：${result.annotations.saved} / ${options.annotations}`)
  lines.push(`- 队列徽标：${result.annotations.badge ?? '未读到'}`)
  lines.push(`- \`.vibe/annotations\` 新增文件：${result.annotations.historyDelta}`)
  lines.push(
    `- 单次标注耗时（点选 → 气泡 → 保存）：中位 ${median(result.latencyMs)} ms，p95 ${percentile(result.latencyMs, 0.95)} ms，最大 ${result.latencyMs.length === 0 ? 0 : Math.max(...result.latencyMs)} ms；含 300 ms 点选轮询`,
  )
  lines.push('')
  lines.push('## 3. 内存与 DOM')
  lines.push('')
  lines.push('| 时刻 | 渲染器堆 | DOM 节点 | 进程树 RSS | 进程数 |')
  lines.push('|---|---|---|---|---|')
  const moments: Array<[string, Sample | undefined]> = [
    ['开始时', first],
    ['结束时', last],
  ]
  for (const [label, sample] of moments) {
    if (sample === undefined) continue
    lines.push(
      `| ${label} | ${sample.renderer.heapUsed === null ? '未提供' : formatBytes(sample.renderer.heapUsed)} | ${sample.renderer.domNodes} | ${formatBytes(sample.procs.rssBytes)} | ${sample.procs.total} |`,
    )
  }
  const heaps = result.samples
    .map((sample) => sample.renderer.heapUsed)
    .filter((value): value is number => value !== null)
  const doms = result.samples.map((sample) => sample.renderer.domNodes)
  lines.push('')
  lines.push(
    `- 采样 ${result.samples.length} 次；堆范围 ${heaps.length === 0 ? '未提供' : `${formatBytes(Math.min(...heaps))} – ${formatBytes(Math.max(...heaps))}`}；DOM 节点 ${doms.length === 0 ? '-' : `${Math.min(...doms)} – ${Math.max(...doms)}`}`,
  )
  const burst = result.samples[1]
  if (burst !== undefined && last !== undefined) {
    lines.push(
      `- 标注结束后进程树 RSS：${formatBytes(burst.procs.rssBytes)}；结束时 ${formatBytes(last.procs.rssBytes)}`,
    )
  }
  lines.push(
    `- 判定口径：结束后渲染器堆 ≤ 标注后堆 × 1.5 + 16 MiB 且进程树 RSS ≤ 标注后 × 1.5 + 128 MiB，视为可解释（Edge 自身波动计入）。`,
  )
  lines.push('')
  lines.push('## 4. 帧率')
  lines.push('')
  if (result.fpsWindows.length === 0) {
    lines.push('- 未采样到窗口。')
  } else {
    lines.push('| 运行秒数 | 可见帧率 | 画面变化次数 | 采样次数 | 传输帧增量 |')
    lines.push('|---|---|---|---|---|')
    for (const window of result.fpsWindows) {
      lines.push(
        `| ${window.elapsedSec} | ${window.fps.toFixed(1)} fps | ${window.changes} | ${window.samples} | ${window.frames ?? '未读到'} |`,
      )
    }
    lines.push('')
    lines.push(
      `- 中位 ${median(result.fpsWindows.map((window) => window.fps)).toFixed(1)} fps（验收口径 ≥ 10 fps）。`,
    )
    lines.push(
      '- 测量方式：CDP screencast 只在页面重绘时出帧，静态 fixture 无自发动画，因此窗口内用交替滚轮驱动远端页面滚动，页面侧每 40 ms 哈希一次 canvas；传输帧增量取自工具栏“帧数”详情，用以区分“有帧但像素相同”和“没有帧”。',
    )
  }
  lines.push('')
  lines.push('## 5. 进程与清理')
  lines.push('')
  const peak = result.samples.reduce<Sample | undefined>(
    (best, sample) =>
      best === undefined || sample.procs.rssBytes > best.procs.rssBytes ? sample : best,
    undefined,
  )
  if (peak !== undefined) {
    lines.push(
      `- 进程树峰值：${formatBytes(peak.procs.rssBytes)} / ${peak.procs.total} 个进程（第 ${peak.elapsedSec} 秒）`,
    )
  }
  if (last !== undefined) {
    const names = Object.entries(last.procs.byName)
      .map(([name, entry]) => `${name}×${entry.count}（${formatBytes(entry.rssBytes)}）`)
      .join('、')
    lines.push(`- 结束时进程构成：${names || '无'}`)
  }
  lines.push(`- 停止后 5 秒内残留：${result.leftovers.length === 0 ? '无' : result.leftovers.join('、')}`)
  lines.push(
    `- 端口：${Object.entries(result.portsClosed)
      .map(([port, closed]) => `${port} ${closed ? '已关闭' : '仍在监听'}`)
      .join('；')}`,
  )
  lines.push('')
  lines.push('## 6. 错误')
  lines.push('')
  if (result.errors.length === 0) {
    lines.push('- 无页面错误、崩溃或 console error。')
  } else {
    for (const error of result.errors.slice(0, 20)) lines.push(`- ${error}`)
    if (result.errors.length > 20) lines.push(`- …共 ${result.errors.length} 条，见 JSON。`)
  }
  lines.push('')
  lines.push('## 7. 复现与限制')
  lines.push('')
  lines.push('```bash')
  lines.push('pnpm build')
  lines.push('VIBE_DSH_BIN="<path-to-dsh.cmd>" pnpm test:soak')
  lines.push('```')
  lines.push('')
  lines.push(`- 完整 JSON：\`${options.json}\`。`)
  lines.push(
    '- 帧率是“可见变化”口径：headless Edge + 静态 fixture 下由交替滚轮驱动远端重绘，测得值受滚动节奏与 Edge 合成节奏影响；真实桌面环境的动画帧率可能不同。',
  )
  lines.push('- 本驱动不清理 `.vibe/annotations` 下的历史文件（已被 gitignore），重复运行时请按需手动清理。')
  lines.push('- 未覆盖：窗口缩放、切后台、IME、多标签页；这些仍按计划在手动验收中检查。')
  lines.push('')
  return lines.join('\n')
}

function summarize(result: SoakResult): string {
  const annotations = `annotations=${result.annotations.saved}/${result.annotations.badge ?? '?'}`
  const fps = result.fpsWindows.length === 0 ? 'fps=n/a' : `fps median=${median(result.fpsWindows.map((w) => w.fps)).toFixed(1)}`
  const leftovers = result.leftovers.length === 0 ? 'leftovers=none' : `leftovers=${result.leftovers.join(',')}`
  return `${result.ok ? 'PASS' : 'FAIL'} ${annotations} ${fps} ${leftovers} errors=${result.errors.length} seconds=${result.actualSeconds}`
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const bin = resolveDshBin()
  if (bin === null) {
    throw new Error(
      'VIBE_DSH_BIN is not set. Point it at a dsh launcher whose vibe-dev profile links this package.',
    )
  }

  const errors: string[] = []
  const latencyMs: number[] = []
  const samples: Sample[] = []
  const fpsWindows: FpsWindow[] = []

  const historyBefore = await annotationFileCount()
  const fixture = await ensureFixture()
  const carrier: DshCarrier = await startDsh({ bin, port: DSH_PORT, profile: options.profile })
  const startupRows = readProcessTable()
  const dshRoot = startupRows.find((row) => row.ProcessId === carrier.pid) ?? null
  const owned = new Map<string, ProcRow>()
  rememberOwned(startupRows, owned)
  const browser: Browser = await chromium.launch({
    channel: 'msedge',
    headless: !options.headful,
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  collectErrors(page, errors)

  let startedAt = Date.now()
  let saved = 0
  let badge: number | null = null
  let leftovers: string[] = []
  let cleanups: Record<string, boolean> = { [DSH_PORT]: false, [FIXTURE_PORT]: false }
  try {
    await page.goto(carrier.url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await openNewConversation(page)
    await openStudioPanel(page)
    await startPreview(page)

    startedAt = Date.now()
    samples.push(await collectSample(page, startedAt, dshRoot, owned))

    await saveAnnotations(page, options.annotations, latencyMs)
    saved = latencyMs.length
    samples.push(await collectSample(page, startedAt, dshRoot, owned))

    let nextFpsAt = 0
    let nextTabAt = TAB_SWITCH_EVERY_MS
    while (true) {
      const elapsed = Date.now() - startedAt
      const remaining = options.seconds * 1000 - elapsed
      if (remaining <= 0) break
      await sleep(Math.min(SAMPLE_INTERVAL_MS, remaining))
      samples.push(await collectSample(page, startedAt, dshRoot, owned))
      const now = Date.now() - startedAt
      if (now >= nextFpsAt) {
        const window = await measureFps(page)
        fpsWindows.push({ ...window, elapsedSec: Math.round(now / 1000) })
        nextFpsAt = now + FPS_EVERY_MS
      }
      if (now >= nextTabAt) {
        await page.locator('#vibe-studio-tab-annotations').click({ timeout: 10_000 })
        await sleep(500)
        await page.locator('#vibe-studio-tab-preview').click({ timeout: 10_000 })
        nextTabAt = now + TAB_SWITCH_EVERY_MS
      }
    }

    await page.locator('#vibe-studio-tab-annotations').click({ timeout: 10_000 })
    await sleep(500)
    badge = await page
      .locator('[data-vibe-annotation-count]')
      .first()
      .textContent()
      .then((text) => Number.parseInt(text ?? '', 10))
      .catch(() => null)
    if (badge !== null && Number.isNaN(badge)) badge = null
    await page.locator('#vibe-studio-tab-preview').click({ timeout: 10_000 })
  } catch (error) {
    errors.push(`driver: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`)
  } finally {
    const historyAfter = await annotationFileCount()
    const historyDelta = historyAfter - historyBefore

    await page
      .locator('[data-vibe-preview="1"]')
      .getByRole('button', { name: /^(停止|Stop)$/ })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => {})
    await sleep(1_000)
    await browser.close().catch(() => {})
    carrier.close()
    stopTree(fixture.child)
    leftovers = await waitForCleanup(owned, dshRoot)
    cleanups = {
      [DSH_PORT]: !portListening(DSH_PORT),
      [FIXTURE_PORT]: fixture.child === null ? true : !portListening(FIXTURE_PORT),
    }

    const heaps = samples
      .map((sample) => sample.renderer.heapUsed)
      .filter((value): value is number => value !== null)
    const burstHeap = samples[1]?.renderer.heapUsed ?? null
    const endHeap = heaps.length === 0 ? null : heaps[heaps.length - 1]
    const burstRss = samples[1]?.procs.rssBytes ?? null
    const endRss = samples.length === 0 ? null : (samples[samples.length - 1]?.procs.rssBytes ?? null)
    const checks: Record<string, boolean> = {
      [`${options.annotations} 次标注全部保存`]: saved === options.annotations,
      '队列徽标与标注数一致': badge === null || badge === options.annotations,
      无崩溃与页面错误: errors.length === 0,
      '帧率中位 ≥ 10 fps':
        fpsWindows.length > 0 && median(fpsWindows.map((window) => window.fps)) >= 10,
      '渲染器堆增长可解释':
        burstHeap === null || endHeap === null
          ? true
          : endHeap <= burstHeap * 1.5 + 16 * 1024 * 1024,
      '进程树 RSS 增长可解释':
        burstRss === null || endRss === null
          ? true
          : endRss <= burstRss * 1.5 + 128 * 1024 * 1024,
      进程树全程存活: samples.every((sample) => sample.procs.dshRootAlive),
      '5 秒内无进程残留': leftovers.length === 0,
      端口已释放: Object.values(cleanups).every(Boolean),
    }
    const result: SoakResult = {
      ok: Object.values(checks).every(Boolean),
      checks,
      annotations: { saved, badge, historyDelta },
      latencyMs,
      fpsWindows,
      samples,
      errors,
      leftovers,
      portsClosed: cleanups,
      actualSeconds: Math.round((Date.now() - startedAt) / 1000),
      fixtureSpawned: fixture.child !== null,
    }

    await mkdir(dirname(resolve(options.json)), { recursive: true })
    await writeFile(resolve(options.json), `${JSON.stringify({ options, result }, null, 2)}\n`, 'utf8')
    await mkdir(dirname(resolve(options.report)), { recursive: true })
    await writeFile(resolve(options.report), buildReport(options, result, fixture.child !== null), 'utf8')
    console.log(summarize(result))
    process.exitCode = result.ok ? 0 : 1
  }
}

await main()
