import { test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

/**
 * Shared setup for HTTP e2e specs. Uses **worker-scoped** fixtures so the
 * Electron app launches once per test worker (not once per test file or
 * once per test). With `workers: 1` (set in playwright.config.ts) this
 * means a single Electron instance is reused across the entire suite —
 * faster runs and no constant window-flickering during local development.
 *
 * To intentionally re-launch the app for a specific test, override the
 * `app` fixture with `test.use({ ... })` in that file.
 */
export interface HttpFixtures {
  app: ElectronApplication
  window: Page
}

export const httpTest = test.extend<object, HttpFixtures>({
  app: [
    async ({}, use) => {
      const mainPath = path.resolve(__dirname, '../../../out/main/index.js')
      if (!fs.existsSync(mainPath)) {
        throw new Error(
          `Build artifact not found: ${mainPath}. Run "npm run build" first.`,
        )
      }
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-http-e2e-'))
      const app = await electron.launch({
        args: [mainPath, `--user-data-dir=${userDataDir}`],
        env: { ...process.env, NODE_ENV: 'test', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
      })
      await use(app)
      await app.close()
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    },
    { scope: 'worker' },
  ],
  window: [
    async ({ app }, use) => {
      const win = await app.firstWindow()
      await win.waitForLoadState('domcontentloaded')
      await use(win)
    },
    { scope: 'worker' },
  ],
})
