import { test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { electronLaunchOptions } from '../helpers/electron-env'

/**
 * Shared setup for WS-Security e2e specs. Mirrors the worker-scoped fixture
 * pattern in `tests/e2e/http/_setup.ts` so the Electron app launches once per
 * test worker.
 */
export interface WsseFixtures {
  app: ElectronApplication
  window: Page
}

export const wsseTest = test.extend<object, WsseFixtures>({
  app: [
    async ({}, use) => {
      const mainPath = path.resolve(__dirname, '../../../out/main/index.js')
      if (!fs.existsSync(mainPath)) {
        throw new Error(
          `Build artifact not found: ${mainPath}. Run "npm run build" first.`,
        )
      }
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-wsse-e2e-'))
      const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
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
