/**
 * MST-222 — Graceful quit with unsaved changes
 *
 * Verifies that the app handles the quit lifecycle correctly. When there are
 * unsaved changes the renderer shows a "you have unsaved changes" indicator
 * (dirty dot on the tab). The app should not crash on close.
 *
 * Note: Testing the OS-level "are you sure you want to quit" native dialog
 * requires intercepting the `before-quit` / `close` event at the main process
 * level. In E2E we assert the renderer-side indicator and that close() finishes
 * without an error.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { electronLaunchOptions, firstAppWindow } from '../../helpers/electron-env'
import { bootstrapWorkbench, openHttpRequestTab } from '../../helpers/ui/bootstrap'

const mainPath = path.resolve(__dirname, '../../../../out/main/index.js')

async function launchBootstrapped(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
  const window = await firstAppWindow(app)
  await window.waitForLoadState('domcontentloaded')
  await bootstrapWorkbench(window)
  return { app, window }
}

test.describe('Tur1 — Graceful quit [MST-222]', () => {
  test('MST-222 app closes cleanly without open tabs', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-quit-clean-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app

      // App should be running
      const windowCount = app.windows().length
      expect(windowCount).toBeGreaterThan(0)

      // Close should complete without throwing
      await app.close()
      app = undefined
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-222 dirty tab shows unsaved indicator before quit', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-quit-dirty-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Open a new HTTP request tab and make it dirty by typing a URL.
      await openHttpRequestTab(window)
      const activeTab = window.locator('[data-testid="endpoint-tab"][data-active="true"]')
      await expect(activeTab).toHaveAttribute('data-dirty', 'false')
      await window.getByTestId('url-input').fill('http://example.com/test')

      // The tab must carry the unsaved indicator (dirty dot) the user sees.
      await expect(activeTab).toHaveAttribute('data-dirty', 'true', { timeout: 8_000 })
      await expect(activeTab.getByTestId('tab-dirty')).toBeVisible()

      // Closing with open tabs should not throw
      await app.close()
      app = undefined
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-222 app handles Cmd/Ctrl+W tab close without unsaved dialog crash', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-quit-kbd-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      const tabs = window.getByTestId('endpoint-tab')
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

      // Clean tab: Cmd/Ctrl+W closes it right away, no unsaved-changes dialog.
      await openHttpRequestTab(window)
      const before = await tabs.count()
      expect(before).toBeGreaterThan(0)
      await window.keyboard.press(`${mod}+KeyW`)
      await expect(tabs).toHaveCount(before - 1, { timeout: 8_000 })
      await expect(window.getByTestId('unsaved-discard-btn')).toHaveCount(0)

      // Dirty tab: Cmd/Ctrl+W asks first. The Workbench Ctrl+W path (and
      // closeTabSafely) deliberately uses a native window.confirm, not the
      // Unsaved-changes modal (cleanup-tab-state.ts). Cancel keeps the tab,
      // OK closes it.
      await openHttpRequestTab(window)
      await window.getByTestId('url-input').fill('http://example.com/dirty')
      await expect(tabs.filter({ has: window.getByTestId('tab-dirty') })).toHaveCount(1, { timeout: 8_000 })
      const withDirty = await tabs.count()

      const dialogTexts: string[] = []
      window.once('dialog', async (d) => {
        dialogTexts.push(`${d.type()}: ${d.message()}`)
        await d.dismiss()
      })
      await window.keyboard.press(`${mod}+KeyW`)
      await expect.poll(() => dialogTexts.length, { timeout: 8_000 }).toBe(1)
      expect(dialogTexts[0]).toMatch(/^confirm: .*unsaved changes/i)
      await expect(tabs).toHaveCount(withDirty)

      window.once('dialog', async (d) => {
        await d.accept()
      })
      await window.keyboard.press(`${mod}+KeyW`)
      await expect(tabs).toHaveCount(withDirty - 1, { timeout: 8_000 })

      await app.close()
      app = undefined
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
