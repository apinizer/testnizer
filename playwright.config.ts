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
      timeout: 90_000,
    },
  ],
})
