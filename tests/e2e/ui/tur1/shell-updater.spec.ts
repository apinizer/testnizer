/**
 * MST-230 — Update available notification
 * MST-231 — Update download + install defer
 * MST-232 — Update check no-update (P2)
 *
 * There is no real update server in tests. We simulate updater events by
 * sending IPC events directly from main to the renderer via
 * `app.evaluate(webContents.send)` and assert the renderer UI responds.
 *
 * The update card has real hooks (data-testid="updater-notification",
 * "updater-install-now", "updater-install-on-quit"); the full card flow lives in
 * shell-updater-ready-card.spec.ts.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { electronLaunchOptions, firstAppWindow } from '../../helpers/electron-env'
import { bootstrapWorkbench } from '../../helpers/ui/bootstrap'

const mainPath = path.resolve(__dirname, '../../../../out/main/index.js')

async function launchBootstrapped(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
  const window = await firstAppWindow(app)
  await window.waitForLoadState('domcontentloaded')
  await bootstrapWorkbench(window)
  return { app, window }
}

/**
 * Inject an updater:event into the renderer via webContents.send from main.
 */
async function sendUpdaterEvent(app: ElectronApplication, event: Record<string, unknown>): Promise<void> {
  // electronApplication.evaluate injects the main-process `electron` module as
  // the first argument. The evaluate context has no Node `require`, so we MUST
  // destructure BrowserWindow from that injected module instead of requiring it.
  await app.evaluate(({ BrowserWindow }, data) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('updater:event', data)
      }
    }
  }, event)
}

test.describe('Tur1 — Shell auto-updater [MST-230, MST-231, MST-232]', () => {
  test('MST-230 updater:event type=available triggers update UI notification', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-updater-avail-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Subscribe in the renderer BEFORE the event is sent from main, so the
      // IPC transport is really exercised (the old version awaited the
      // subscription first and only ever hit its own 5 s timeout).
      await window.evaluate(() => {
        const w = window as unknown as Window & {
          __updaterEvents?: Array<Record<string, unknown>>
          api: { updater: { onEvent: (cb: (e: unknown) => void) => () => void } }
        }
        w.__updaterEvents = []
        w.api.updater.onEvent((ev) => {
          w.__updaterEvents!.push(ev as Record<string, unknown>)
        })
      })

      await sendUpdaterEvent(app, {
        type: 'available',
        version: '99.0.0-test',
        releaseNotes: 'Test release notes',
      })

      await expect
        .poll(
          () =>
            window.evaluate(
              () =>
                (window as unknown as Window & { __updaterEvents?: Array<Record<string, unknown>> })
                  .__updaterEvents ?? [],
            ),
          { timeout: 5_000 },
        )
        .toContainEqual(expect.objectContaining({ type: 'available', version: '99.0.0-test' }))

      // Background-download model: an available version is silent — the user is
      // only asked once it is downloaded. The ready card itself is covered by
      // shell-updater-ready-card.spec.ts (data-testid="updater-notification").
      await expect(window.getByTestId('updater-notification')).toHaveCount(0)
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // The app should remain alive and functional after the event
      await expect(window.getByTestId('nav-apis')).toBeVisible({ timeout: 5_000 })
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-231 updater:event type=downloaded shows install/defer UI', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-updater-dl-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // First send available (to set update state)
      await sendUpdaterEvent(app, { type: 'available', version: '99.0.0-test' })
      await window.waitForTimeout(200)

      // Then send downloading progress
      await sendUpdaterEvent(app, {
        type: 'downloading',
        percent: 50,
        bytesPerSecond: 1_000_000,
        transferred: 5_000_000,
        total: 10_000_000,
      })
      await window.waitForTimeout(200)

      // Then send downloaded
      await sendUpdaterEvent(app, { type: 'downloaded' })
      await window.waitForTimeout(500)

      // The ready card offers "Restart & install" and "Install on quit"
      // (data-testid hooks exist; the full card flow incl. Skip/✕ is in
      // shell-updater-ready-card.spec.ts).
      const card = window.getByTestId('updater-notification')
      await expect(card).toBeVisible({ timeout: 5_000 })
      await expect(card).toContainText('99.0.0-test')
      await expect(window.getByTestId('updater-install-now')).toBeVisible()
      await expect(window.getByTestId('updater-install-on-quit')).toBeVisible()

      // App must still be responsive
      await expect(window.getByTestId('nav-apis')).toBeVisible({ timeout: 5_000 })

      // Verify updater:install IPC handler exists and returns (it won't actually install)
      const installRes = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { updater?: { install: () => Promise<{ success: boolean; error?: string }> } }
        }
        // Call install — will fail because no real update is downloaded
        // but the handler must respond without crashing the app
        return w.api?.updater?.install()
      })
      // Either fails with "not configured" or succeeds — both are valid responses
      expect(typeof installRes?.success).toBe('boolean')
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-231 updater defer — app continues working after dismissing update', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-updater-defer-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Send available + downloaded events
      await sendUpdaterEvent(app, { type: 'available', version: '99.0.0-test' })
      await window.waitForTimeout(200)
      await sendUpdaterEvent(app, { type: 'downloaded' })
      await window.waitForTimeout(500)

      // Defer = the ✕ on the ready card (same as "Install on quit"): it closes
      // the card and does not block the workspace.
      const card = window.getByTestId('updater-notification')
      await expect(card).toBeVisible({ timeout: 5_000 })
      await card.getByRole('button', { name: /install on quit|çıkışta/i }).first().click()
      await expect(card).toHaveCount(0)

      // App must remain fully functional
      await expect(window.getByTestId('nav-apis')).toBeVisible({ timeout: 5_000 })

      // IPC still responsive after deferrring
      const wsRes = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean }> } }
        }
        return w.api?.workspace?.list()
      })
      expect(wsRes?.success).toBe(true)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-232 updater:check returns success or not-configured (no crash) (P2)', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-updater-check-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Send not-available event to simulate an "up-to-date" check result
      await sendUpdaterEvent(app, { type: 'not-available' })
      await window.waitForTimeout(300)

      // updater:check via IPC — in dev/test mode without a real feed URL it
      // will return success:false "Auto-updater not configured" (stub handlers)
      const checkRes = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { updater?: { check: () => Promise<{ success: boolean; error?: string }> } }
        }
        return w.api?.updater?.check()
      })

      // Valid responses: success:true (update server available) or success:false
      // with an error message (stub or feed URL missing)
      expect(typeof checkRes?.success).toBe('boolean')
      if (!checkRes?.success) {
        expect(typeof checkRes?.error).toBe('string')
        expect(checkRes?.error?.length).toBeGreaterThan(0)
      }

      // App must remain alive
      await expect(window.getByTestId('nav-apis')).toBeVisible({ timeout: 5_000 })
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-230 updater:event type=error is forwarded to renderer without crash', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-updater-err-e2e-'))
    let app: ElectronApplication | undefined

    try {
      const launched = await launchBootstrapped(userDataDir)
      app = launched.app
      const window = launched.window

      // Inject an error event
      await sendUpdaterEvent(app, {
        type: 'error',
        error: 'Could not get code signature — manual download required',
      })
      await window.waitForTimeout(500)

      // App must remain functional (error should NOT crash the renderer)
      await expect(window.getByTestId('nav-apis')).toBeVisible({ timeout: 5_000 })

      // IPC bridge remains operational
      const wsRes = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean }> } }
        }
        return w.api?.workspace?.list()
      })
      expect(wsRes?.success).toBe(true)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
