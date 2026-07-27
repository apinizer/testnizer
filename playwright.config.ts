import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'default',
      testIgnore: /tests\/e2e\/ui\//,
    },
    {
      name: 'ui',
      testDir: './tests/e2e/ui',
      // No video here. Video is recorded per BROWSER CONTEXT, not per test, and
      // this project's Electron app is worker-scoped — one context for all 736
      // tests. So `retain-on-failure` does not produce a clip per failure; it
      // produces a single ~2.5-hour recording that tells you nothing about
      // which test broke, and finalizing it is what kept blowing the worker
      // teardown budget (733 passed, 0 failed, job red). Trace stays on: it IS
      // per-test, and it is what identified the leaked client certificate
      // behind F5.
      use: { video: 'off' },
      // 90s is calibrated on a developer machine. CI runs the same suite under
      // xvfb with software rendering on two shared cores, where Monaco-heavy
      // screens are an order of magnitude slower — opening ten tabs measured
      // 61s there against ~1s locally. Four specs consequently blew the 90s
      // budget and reported "Target page, context or browser has been closed",
      // which reads like a crash but is Playwright tearing the context down at
      // the timeout. Give CI room rather than chase phantom crashes; the app
      // being slow on weak hardware is tracked as its own concern.
      timeout: process.env.CI ? 240_000 : 90_000,
    },
  ],
})
