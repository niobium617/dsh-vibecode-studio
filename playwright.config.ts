import { defineConfig } from '@playwright/test'

const PORT = 4320
const baseURL = `http://127.0.0.1:${PORT}`

/**
 * E2E runs against the Vite fixture with the locally installed Edge
 * (`channel: 'msedge'`); no browser download is required.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '.tmp/playwright-results',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  /**
   * The studio main-chain spec boots a real DSH carrier, so it gets its own
   * project and a longer budget; it skips itself when `VIBE_DSH_BIN` is unset.
   */
  projects: [
    { name: 'fixture', testMatch: /(fixture|source-adapters)\.spec\.ts/ },
    { name: 'studio', testMatch: /studio\.spec\.ts/, timeout: 240_000 },
  ],
  use: {
    baseURL,
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'pnpm fixture:dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
