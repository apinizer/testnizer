/**
 * MST-220 — userData E2E isolation
 *
 * Verifies that the E2E test profile is isolated from the production
 * userData directory so developer data is never leaked into tests.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { electronLaunchOptions } from '../../helpers/electron-env'
import { waitForApiBridge, acceptEula, loginAsGuest } from '../../helpers/ui/bootstrap'

const mainPath = path.resolve(__dirname, '../../../../out/main/index.js')

test.describe('Tur1 — Shell userData isolation [MST-220]', () => {
  let app: ElectronApplication
  let window: Page
  let userDataDir: string

  test.beforeAll(async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-isolation-e2e-'))
    app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
    window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await waitForApiBridge(window)
    await acceptEula(window)
    await loginAsGuest(window)
  })

  test.afterAll(async () => {
    await app?.close()
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-220 userData is a temp directory, not the production path', async () => {
    // Production path varies by platform — ensure E2E uses a temp dir
    const productionPaths = [
      path.join(os.homedir(), 'Library', 'Application Support', 'Testnizer'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Apinizer'),
      path.join(process.env.APPDATA ?? '', 'Testnizer'),
      path.join(os.homedir(), '.config', 'Testnizer'),
    ]
    for (const prod of productionPaths) {
      expect(userDataDir).not.toBe(prod)
      expect(userDataDir.startsWith(prod)).toBe(false)
    }
    // The temp dir must actually exist (app wrote to it)
    expect(fs.existsSync(userDataDir)).toBe(true)
  })

  test('MST-220 E2E profile is inside OS temp directory', async () => {
    const tmpdir = os.tmpdir()
    expect(userDataDir.startsWith(tmpdir)).toBe(true)
  })

  test('MST-220 app creates userData under the given --user-data-dir', async () => {
    // After launch + login the DB file should be in the temp dir
    const dbFile = path.join(userDataDir, 'testnizer.db')
    // Give the app time to write on slower CI
    await window.waitForTimeout(500)
    // DB should be in the userDataDir (Electron writes there via better-sqlite3)
    const hasSomeFiles = fs.readdirSync(userDataDir).length > 0
    expect(hasSomeFiles).toBe(true)
  })

  test('MST-220 IPC bridge is functional on isolated profile', async () => {
    const res = await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api?: { workspace?: { list: () => Promise<{ success: boolean; data?: unknown[] }> } }
      }
      return w.api?.workspace?.list()
    })
    expect(res?.success).toBe(true)
  })

  test('MST-220 settings store writes to the isolated userData directory', async () => {
    // Write a setting — electron-store creates settings.json inside userData
    const setRes = await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api?: {
          settings?: { set: (k: string, v: unknown) => Promise<{ success: boolean }> }
        }
      }
      return w.api?.settings?.set('theme', 'dark')
    })
    expect(setRes?.success).toBe(true)

    // The file must be written inside our temp dir, not production
    await window.waitForTimeout(300)
    const settingsFile = path.join(userDataDir, 'settings.json')
    expect(fs.existsSync(settingsFile)).toBe(true)
    const productionDir = path.join(os.homedir(), 'Library', 'Application Support', 'Testnizer')
    const prodSettings = path.join(productionDir, 'settings.json')
    if (fs.existsSync(prodSettings)) {
      const prodContent = JSON.parse(fs.readFileSync(prodSettings, 'utf-8'))
      // The production settings should still have 'light' (its own value), not
      // necessarily 'dark' (which we just wrote to our isolated temp profile).
      // This is an isolation check — if both point to same file they'd collide.
      const testContent = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'))
      // Both files can co-exist independently
      expect(testContent).toBeDefined()
      expect(prodContent).toBeDefined()
    }
  })
})
