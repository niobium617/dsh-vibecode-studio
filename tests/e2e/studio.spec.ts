// T057: the studio main chain in a real DSH carrier —
// open Studio → start preview → pick → annotate → insert into the composer →
// send → the preview is still live. The fixture dev server is the Playwright
// `webServer` from playwright.config.ts.
//
// Requires a DSH install that links this package into `vibe-dev` and a fresh
// `pnpm build` (DSH loads `lib/client.js`). Set `VIBE_DSH_BIN` to the launcher,
// e.g. `<DSH_BIN>`; without it the spec is skipped so
// `pnpm test:e2e` stays green on machines with no DSH.
import { expect, test, type Page } from '@playwright/test'
import { resolveDshBin, startDsh, type DshCarrier } from './dsh-carrier'

const DSH_PORT = 4341
const FIXTURE_URL = 'http://127.0.0.1:4320/'
const COMMENT = 'e2e 标注：标题需要更大字号'

const BIN = resolveDshBin()

test.describe('studio main chain', () => {
  test('open Studio → pick → annotate → draft → send → preview visible', async (
    { page },
    testInfo,
  ) => {
    test.skip(BIN === null, 'set VIBE_DSH_BIN to a dsh launcher to run the DSH main-chain E2E')
    test.setTimeout(240_000)

    let carrier: DshCarrier | null = null
    try {
      carrier = await startDsh({ bin: BIN as string, port: DSH_PORT })

      await page.goto(carrier.url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await openNewConversation(page)
      await openStudioPanel(page)

      const preview = page.locator('[data-vibe-preview="1"]')
      await preview.waitFor({ state: 'visible', timeout: 30_000 })

      // 1. Start the preview against the fixture.
      await preview.locator('#vibe-preview-url').fill(FIXTURE_URL)
      await preview.locator('button[type="submit"]').click()
      await expect(preview.locator('[data-vibe-status="1"][data-state="ready"]')).toBeVisible({
        timeout: 60_000,
      })
      const canvas = preview.locator('canvas').first()
      await expect(canvas).toBeVisible()
      await expect.poll(() => sampleCanvas(page), { timeout: 30_000 }).toBeGreaterThan(0)

      // 2. Pick the fixture heading through the preview canvas.
      const pickToggle = preview.locator('[data-vibe-pick-toggle="1"]')
      await expect(pickToggle).toBeVisible()
      await pickToggle.click()
      await expect(pickToggle).toHaveAttribute('aria-pressed', 'true')
      await clickInPreview(page, 0.15, 0.1)
      await expect(preview.locator('[data-vibe-pick-card="1"]')).toBeVisible({ timeout: 20_000 })
      await expect(preview.locator('[data-vibe-annotation-bubble="1"]')).toBeVisible()

      // The card always reports a selector; source mapping is covered by the
      // source-adapters spec, and `vite-basic` carries no inspector metadata.
      const selector = await preview.locator('[data-vibe-pick-selector="1"]').innerText()
      expect(selector.trim().length).toBeGreaterThan(0)
      await expect(preview.locator('[data-vibe-pick-source]')).toHaveCount(1)

      // 3. Annotate: bubble → saved notice.
      await preview.locator('[data-vibe-annotation-input="1"]').fill(COMMENT)
      await preview.locator('[data-vibe-annotation-save="1"]').click()
      const notice = page.locator('[data-vibe-annotation-notice="1"]')
      await expect(notice).toBeVisible({ timeout: 15_000 })

      // 4. Insert the saved annotation into the conversation draft.
      await notice.locator('[data-vibe-annotation-send-now="1"]').click()
      const composer = page.locator('[contenteditable="true"]').first()
      await composer.waitFor({ state: 'visible', timeout: 15_000 })
      await expect.poll(() => composer.innerText(), { timeout: 20_000 }).toContain(COMMENT)

      // 5. Send it: the draft clears and the message lands in the transcript.
      await composer.click()
      await page.keyboard.press('Enter')
      await expect.poll(() => composer.innerText(), { timeout: 30_000 }).not.toContain(COMMENT)
      await expect(page.getByRole('button', { name: /停止|Stop/i }).first()).toBeVisible({
        timeout: 20_000,
      })
      await expect(
        page.locator('[data-chat-turn]').filter({ hasText: COMMENT }).first(),
      ).toBeVisible({ timeout: 20_000 })
      if (process.env.VIBE_E2E_DEBUG === '1') {
        const dump = await page.evaluate(() => ({
          turns: [...document.querySelectorAll('[data-chat-turn]')].map((element) => ({
            turn: element.getAttribute('data-chat-turn'),
            hidden: element.hasAttribute('hidden'),
            text: (element as HTMLElement).innerText.slice(0, 200),
          })),
        }))
        console.log('CHAT DUMP', JSON.stringify(dump))
      }

      // Do not wait for a model answer; only the send path is under test.
      await stopGenerating(page)

      // 6. The preview survived the whole loop and keeps painting frames.
      await expect(preview.locator('[data-vibe-status="1"][data-state="ready"]')).toBeVisible()
      await expect.poll(() => sampleCanvas(page), { timeout: 20_000 }).toBeGreaterThan(0)

      await testInfo.attach('studio-flow', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
      if (process.env.VIBE_E2E_ARTIFACTS === '1') {
        await page.screenshot({ path: '.tmp/logs/t057-studio-flow.png', fullPage: true })
      }
    } finally {
      if (carrier !== null) {
        await stopPreview(page).catch(() => {})
        await testInfo.attach('dsh-log', { body: carrier.log(), contentType: 'text/plain' })
        carrier.close()
      }
    }
  })
})

async function openNewConversation(page: Page): Promise<void> {
  const composer = page.locator('[contenteditable="true"]').first()
  if ((await composer.count()) > 0) return
  const newChat = page.getByRole('button', { name: /新建会话|新建对话|New chat/i }).first()
  if ((await newChat.count()) > 0) await newChat.click()
  // A preset menu may open; the standard mode keeps the tool list irrelevant.
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

/** Click a point given as a fraction of the rendered preview viewport. */
async function clickInPreview(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator('[data-vibe-preview="1"] canvas').first().boundingBox()
  if (box === null) throw new Error('preview canvas has no box')
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
}

/** Non-background pixels in the top band of the preview canvas. */
function sampleCanvas(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-vibe-preview="1"] canvas')
    if (canvas === null) return 0
    const context = canvas.getContext('2d')
    if (context === null) return 0
    const width = Math.min(96, canvas.width)
    const height = Math.min(96, canvas.height)
    if (width === 0 || height === 0) return 0
    const data = context.getImageData(0, 0, width, height).data
    let painted = 0
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] + data[index + 1] + data[index + 2] > 24) painted += 1
    }
    return painted
  })
}

async function stopGenerating(page: Page): Promise<void> {
  const stop = page.getByRole('button', { name: /停止|Stop/i }).first()
  if ((await stop.count()) > 0) await stop.click({ timeout: 5_000 }).catch(() => {})
}

async function stopPreview(page: Page): Promise<void> {
  const stop = page
    .locator('[data-vibe-preview="1"]')
    .getByRole('button', { name: /^(停止|Stop)$/ })
  if ((await stop.count()) > 0) await stop.first().click({ timeout: 5_000 })
}
