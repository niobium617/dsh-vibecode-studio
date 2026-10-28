/**
 * T027 acceptance on a real Edge page: hover overlay, click pick without
 * triggering the page's own handler, Esc cancel, Alt+Click while pick mode is
 * off, and selectors for ten different element shapes that resolve back to the
 * element that was clicked.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { createPreviewPicker, type PreviewPicker } from '../../../src/host/inspect/inject'
import type { ScreencastSessionLike } from '../../../src/host/targets/types'
import {
  createWebTargetAdapter,
  launchEdge,
  validateTargetConfig,
  type WebTargetAdapter,
} from '../../../src/host/index'

let server: ViteDevServer | undefined
let baseUrl = ''

/** T028 context each fixture target must report from the real page. */
const EXPECTED_CONTEXT: Record<
  string,
  { readonly role: string | null; readonly name: string; readonly text: string }
> = {
  testid: { role: 'button', name: 'Buy', text: 'Buy' },
  id: { role: 'textbox', name: '', text: '' },
  aria: { role: 'button', name: 'Pick close dialog', text: 'x' },
  name: { role: 'textbox', name: '', text: '' },
  className: { role: 'button', name: 'Pay', text: 'Pay' },
  nth: { role: 'listitem', name: '2', text: '2' },
  ghost: { role: 'button', name: 'B', text: 'B' },
  generated: { role: null, name: 'G', text: 'G' },
  shadow: { role: 'button', name: 'Inner', text: 'Inner' },
  path: { role: null, name: '2', text: '2' },
}

interface FixtureTarget {
  readonly name: string
  readonly expected: string
  readonly tag: string
  readonly x: number
  readonly y: number
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * Ten shapes covering every selector tier plus a shadow root. Each target is
 * fixed-positioned, so the viewport coordinates are exact and independent of
 * the fixture's layout.
 */
const FIXTURE = `
(() => {
  window.__leaks = { click: 0, pointerdown: 0 };
  // Registered after the picker's listener so a picked click never gets here.
  window.addEventListener('click', (event) => {
    window.__leaks.click += 1;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  window.addEventListener('pointerdown', () => {
    window.__leaks.pointerdown += 1;
  }, true);

  const at = (i) => 'position:fixed;left:24px;top:' + (40 + i * 56) + 'px;width:180px;height:40px';
  document.body.insertAdjacentHTML('beforeend', [
    '<button data-testid="buy-now" style="' + at(0) + '">Buy</button>',
    '<input id="email" style="' + at(1) + '">',
    '<button aria-label="Pick close dialog" style="' + at(2) + '">x</button>',
    '<input name="nickname" style="' + at(3) + '">',
    '<button class="checkout-primary" style="' + at(4) + '">Pay</button>',
    '<div id="pick-panel"><ul><li>1</li><li style="' + at(5) + '">2</li></ul></div>',
    '<div id="ghostbox">',
    '<button class="ghost" style="' + at(6) + '">A</button>',
    '<button class="ghost" style="' + at(7) + '">B</button>',
    '</div>',
    '<div id="genbox"><span class="css-1x2y3z" style="' + at(8) + '">G</span></div>',
    '<div id="shadow-host" style="' + at(9) + '"></div>',
    '<div class="rows"><div class="row"><span>1</span></div>' +
      '<div class="row"><span style="' + at(10) + '">2</span></div></div>',
  ].join(''));

  const shadowHost = document.getElementById('shadow-host');
  const shadow = shadowHost.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<button id="inner" style="width:100%;height:100%">Inner</button>';

  const targets = {
    testid: document.querySelector('[data-testid="buy-now"]'),
    id: document.getElementById('email'),
    aria: document.querySelector('[aria-label="Pick close dialog"]'),
    name: document.querySelector('[name="nickname"]'),
    className: document.querySelector('.checkout-primary'),
    nth: document.querySelector('#pick-panel li:nth-of-type(2)'),
    ghost: document.querySelectorAll('#ghostbox .ghost')[1],
    generated: document.querySelector('#genbox span'),
    shadow: shadow.querySelector('#inner'),
    path: document.querySelectorAll('.rows .row:nth-of-type(2) span')[0],
  };
  window.__pickTargets = targets;

  const meta = [
    ['testid', '[data-testid="buy-now"]', 'button'],
    ['id', '#email', 'input'],
    ['aria', 'button[aria-label="Pick close dialog"]', 'button'],
    ['name', 'input[name="nickname"]', 'input'],
    ['className', 'button.checkout-primary', 'button'],
    ['nth', '#pick-panel > ul > li:nth-of-type(2)', 'li'],
    ['ghost', '#ghostbox > button:nth-of-type(2)', 'button'],
    ['generated', '#genbox > span', 'span'],
    ['shadow', '#inner', 'button'],
    ['path', null, 'span'],
  ];
  return meta.map(([name, expected, tag]) => {
    const rect = targets[name].getBoundingClientRect();
    return {
      name,
      expected,
      tag,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      left: Math.round(rect.left + window.scrollX),
      top: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
})()
`

function playwrightEdgePids(): string[] {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*--user-data-dir=*playwright_chromiumdev_profile*' } | Select-Object -ExpandProperty ProcessId",
        ],
        { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] },
      )
      return output.split(/\s+/).filter(Boolean)
    }
    return []
  } catch {
    return []
  }
}

async function expectNoPlaywrightEdge(): Promise<void> {
  const deadline = Date.now() + 5_000
  let pids = playwrightEdgePids()
  while (pids.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    pids = playwrightEdgePids()
  }
  expect(pids).toEqual([])
}

async function evaluateJson(session: ScreencastSessionLike, expression: string): Promise<unknown> {
  const result = (await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  })) as { result?: { value?: unknown }; exceptionDetails?: unknown }
  if (result.exceptionDetails) {
    throw new Error(`page evaluation failed: ${JSON.stringify(result.exceptionDetails)}`)
  }
  return result.result?.value
}

async function waitFor<T>(read: () => Promise<T> | T, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 4_000
  for (;;) {
    const value = await read()
    if (ready(value)) return value
    if (Date.now() > deadline) throw new Error(`condition not met: ${String(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function inputFor(session: ScreencastSessionLike) {
  return {
    async move(x: number, y: number): Promise<void> {
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    },
    async click(x: number, y: number, modifiers = 0): Promise<void> {
      const base = { x, y, button: 'left', clickCount: 1, modifiers }
      await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
      await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
    },
    async escape(): Promise<void> {
      const base = {
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      }
      await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
      await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    },
  }
}

beforeAll(async () => {
  server = await createServer({
    configFile: fileURLToPath(
      new URL('../../../fixtures/vite-basic/vite.config.ts', import.meta.url),
    ),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  const local = server.resolvedUrls?.local[0]
  if (!local) throw new Error('fixture server did not report a local URL')
  baseUrl = local.replace(/\/$/, '')
}, 30_000)

afterAll(async () => {
  await server?.close()
})

describe('preview picker (Edge)', () => {
  it(
    'picks ten element shapes without leaking clicks, cancels on Esc and honours Alt+Click',
    { timeout: 120_000 },
    async () => {
      const browsers: Browser[] = []
      const adapter: WebTargetAdapter = createWebTargetAdapter({
        launch: async (launchOptions) => {
          const browser = await launchEdge(launchOptions)
          browsers.push(browser)
          return browser
        },
        navigationTimeoutMs: 10_000,
      })
      const config = validateTargetConfig({
        id: 'picker',
        name: 'Picker fixture',
        kind: 'web',
        url: `${baseUrl}/`,
        viewport: { width: 900, height: 700 },
      })

      let picker: PreviewPicker | undefined
      try {
        await adapter.start(config)
        const page = adapter.screencastPage()
        if (!page) throw new Error('adapter has no page after start')
        picker = createPreviewPicker({ page })
        await picker.install()

        const control = await page.createCdpSession()
        const input = inputFor(await page.createCdpSession())
        const targets = (await evaluateJson(control, FIXTURE)) as FixtureTarget[]
        expect(targets).toHaveLength(10)

        await picker.activate()
        expect(picker.snapshot().active).toBe(true)

        let lastSelector = ''
        for (const target of targets) {
          await input.move(target.x, target.y)
          const boxShown = await waitFor(
            () =>
              evaluateJson(
                control,
                `(() => {
                  const host = document.getElementById('__vibe-picker-host');
                  if (!host || !host.shadowRoot) return false;
                  const box = host.shadowRoot.querySelector('.box');
                  const label = host.shadowRoot.querySelector('.label');
                  return box.style.display === 'block' && label.textContent.length > 0;
                })()`,
              ),
            (value) => value === true,
          )
          expect(boxShown).toBe(true)

          const before = picker.snapshot().seq
          await input.click(target.x, target.y)
          const picked = await waitFor(
            () => picker!.snapshot(),
            (snapshot) => snapshot.seq > before,
          )
          if (!picked.pick) throw new Error(`no pick was reported for ${target.name}`)
          lastSelector = picked.pick.selector
          expect(picked.pick.tag).toBe(target.tag)
          expect(picked.pick.unique).toBe(true)
          if (target.expected !== null) {
            expect(picked.pick.selector).toBe(target.expected)
          } else {
            expect(picked.pick.selector).toContain('div:nth-of-type(2) > span')
          }
          expect(picked.pick.box).toEqual({
            x: target.left,
            y: target.top,
            width: target.width,
            height: target.height,
          })
          // T028: DOM/accessibility context must come from the real page.
          const context = EXPECTED_CONTEXT[target.name]
          expect(picked.pick.role).toBe(context.role)
          expect(picked.pick.name).toBe(context.name)
          expect(picked.pick.text).toBe(context.text)
          expect(picked.pick.visible).toBe(true)
          expect(picked.pick.html.length).toBeGreaterThan(0)
          expect(picked.pick.html.length).toBeLessThanOrEqual(2048)

          // The selector must resolve to exactly the element that was clicked,
          // including inside the shadow root.
          const resolves = await evaluateJson(
            control,
            `(() => {
              const element = window.__pickTargets[${JSON.stringify(target.name)}];
              try {
                return element.getRootNode().querySelector(${JSON.stringify(picked.pick.selector)}) === element;
              } catch {
                return false;
              }
            })()`,
          )
          expect(resolves).toBe(true)
        }

        // None of the ten picks reached the page's own handlers.
        expect(await evaluateJson(control, 'window.__leaks')).toEqual({
          click: 0,
          pointerdown: 0,
        })

        // Esc cancels, reports the cancel and removes the overlay.
        const beforeEscape = picker.snapshot().seq
        await input.escape()
        const cancelled = await waitFor(
          () => picker!.snapshot(),
          (snapshot) => snapshot.seq > beforeEscape,
        )
        expect(cancelled.active).toBe(false)
        expect(cancelled.pick?.selector).toBe(lastSelector)
        expect(await evaluateJson(control, "document.getElementById('__vibe-picker-host')")).toBeNull()

        // Alt+Click works while pick mode is off and is still swallowed.
        const beforeAlt = picker.snapshot().seq
        await input.click(targets[1]!.x, targets[1]!.y, 1)
        const altPick = await waitFor(
          () => picker!.snapshot(),
          (snapshot) => snapshot.seq > beforeAlt,
        )
        expect(altPick.active).toBe(false)
        expect(altPick.pick?.selector).toBe('#email')
        expect(await evaluateJson(control, 'window.__leaks')).toEqual({
          click: 0,
          pointerdown: 0,
        })

        // A normal click with the picker off does reach the page.
        await input.click(targets[0]!.x, targets[0]!.y)
        const leaks = await waitFor(
          () => evaluateJson(control, 'window.__leaks'),
          (value) => (value as { click: number }).click === 1,
        )
        expect(leaks).toMatchObject({ click: 1 })
        // ...and does not count as a pick.
        expect(picker.snapshot().seq).toBe(beforeAlt + 1)

        await picker.dispose()
        expect(await evaluateJson(control, "document.getElementById('__vibe-picker-host')")).toBeNull()
        await control.detach()
      } finally {
        await picker?.dispose()
        await adapter.stop()
      }

      expect(adapter.status).toBe('stopped')
      expect(browsers).toHaveLength(1)
      expect(browsers[0]!.isConnected()).toBe(false)
      await expectNoPlaywrightEdge()
    },
  )
})
