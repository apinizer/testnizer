/**
 * Background update → non-blocking "ready" card.
 *
 * The update downloads in the background; the user is only asked once it is
 * ready, in a corner card (role=status, data-testid="updater-notification")
 * that never covers the workspace:
 *   Restart & install · Install on quit · Skip this version · ✕ (= on quit).
 *
 * No update server in tests: main's `updater:event` is injected with
 * webContents.send, exactly as shell-updater.spec.ts does.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { electronLaunchOptions } from '../../helpers/electron-env'
import { bootstrapWorkbench } from '../../helpers/ui/bootstrap'

const mainPath = path.resolve(__dirname, '../../../../out/main/index.js')

async function launchBootstrapped(
  userDataDir: string,
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await bootstrapWorkbench(window)
  return { app, window }
}

async function sendUpdaterEvent(
  app: ElectronApplication,
  event: Record<string, unknown>,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, data) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('updater:event', data)
    }
  }, event)
}

test.describe('Tur1 — background update ready card', () => {
  test('available is silent; downloaded shows the card; "Install on quit" dismisses it without a modal', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-updater-card-e2e-'))
    let app: ElectronApplication | undefined
    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // 1. A version becomes available: nothing pops up, the user keeps working.
      await sendUpdaterEvent(app, { type: 'available', version: '99.0.0-test' })
      await window.waitForTimeout(400)
      await expect(window.getByTestId('updater-notification')).toHaveCount(0)
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // 2. The background download finishes: the card appears, non-modal.
      await sendUpdaterEvent(app, { type: 'downloading', percent: 100 })
      await sendUpdaterEvent(app, { type: 'downloaded' })
      const card = window.getByTestId('updater-notification')
      await expect(card).toBeVisible({ timeout: 5_000 })
      await expect(card).toContainText('99.0.0-test')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(window.getByTestId('updater-install-now')).toBeVisible()
      await expect(window.getByTestId('updater-install-on-quit')).toBeVisible()
      await expect(window.getByTestId('updater-skip-version')).toBeVisible()

      const shot = process.env.UPDATER_CARD_SHOT
      if (shot) await window.screenshot({ path: shot })

      // 3. "Install on quit" closes the card; the app stays usable.
      await window.getByTestId('updater-install-on-quit').click()
      await expect(card).toHaveCount(0)
      await expect(window.getByRole('dialog')).toHaveCount(0)
    } finally {
      await app?.close()
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
