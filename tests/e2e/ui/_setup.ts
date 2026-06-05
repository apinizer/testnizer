import { test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { bootstrapWorkbench } from '../helpers/ui/bootstrap'
import { electronLaunchOptions } from '../helpers/electron-env'

export interface UiFixtures {
  app: ElectronApplication
  window: Page
}

/**
 * Worker-scoped Electron fixture for UI E2E.
 * Bootstraps once per worker: EULA → guest login → test project.
 */
export const uiTest = test.extend<object, UiFixtures>({
  app: [
    async ({}, use) => {
      const mainPath = path.resolve(__dirname, '../../../out/main/index.js')
      if (!fs.existsSync(mainPath)) {
        throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
      }
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-ui-e2e-'))
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
      await bootstrapWorkbench(win)
      await use(win)
    },
    { scope: 'worker' },
  ],
})
