import { defineConfig } from 'vitest/config'

/**
 * Two projects: logic tests stay in Node, component tests get jsdom plus
 * Testing Library cleanup. E2E lives in `tests/e2e` and runs under Playwright.
 */
export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: 'node',
          include: [
            'tests/smoke.test.ts',
            'tests/unit/**/*.test.ts',
            'tests/integration/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'component',
          include: ['tests/component/**/*.test.ts', 'tests/component/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/component.ts'],
        },
      },
    ],
  },
})
