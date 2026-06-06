/**
 * MST-001, MST-002, MST-006, MST-008 — Auth / EULA bootstrap
 */
import { expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { uiTest } from './_setup'
import { acceptEula, waitForApiBridge } from '../../helpers/ui/bootstrap'
import {
  disablePasswordViaIpc,
  loginWithPassword,
  setPasswordViaIpc,
  TEST_PASSWORD,
} from '../../helpers/ui/login-flow'
import { electronLaunchOptions } from '../../helpers/electron-env'

uiTest.describe('Tur1 — Auth & EULA [MST-001, MST-008]', () => {
  uiTest('MST-001 EULA accept reveals workbench', async ({ window }) => {
    await expect(window.getByTestId('workbench')).toBeVisible()
    await expect(window.getByTestId('nav-apis')).toBeVisible()
    await expect(window.getByTestId('footer-env')).toBeVisible()
  })
})

uiTest.describe('Tur1 — Password lifecycle [MST-002]', () => {
  uiTest('MST-002 password set, login, logout, disable', async () => {
    const mainPath = path.resolve(__dirname, '../../../../out/main/index.js')
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-tur1-auth-'))
    const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
    try {
      const win = await app.firstWindow()
      await win.waitForLoadState('domcontentloaded')
      await waitForApiBridge(win)
      await acceptEula(win)
      await win.getByTestId('login-continue-anonymous').click()
      await win.waitForFunction(
        () => document.body.innerText.includes('New Project') || document.body.innerText.includes('APIs'),
        { timeout: 20_000 },
      )
      await setPasswordViaIpc(win)

      // Relaunch → login gate.
      await app.close()
      const app2 = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
      const win2 = await app2.firstWindow()
      await win2.waitForLoadState('domcontentloaded')
      await waitForApiBridge(win2)
      await loginWithPassword(win2, TEST_PASSWORD)
      // Authenticated session lands on project hub until a project tab is opened.
      await expect(
        win2.getByTestId('project-home').or(win2.getByTestId('nav-apis')),
      ).toBeVisible({ timeout: 15_000 })

      // Disable password → next launch skips login.
      await disablePasswordViaIpc(win2, TEST_PASSWORD)
      await app2.close()

      const app3 = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
      const win3 = await app3.firstWindow()
      await win3.waitForLoadState('domcontentloaded')
      await waitForApiBridge(win3)
      await acceptEula(win3).catch(() => {})
      // Guest path or project home without password prompt.
      const hasLogin = await win3.locator('input[type="password"]').isVisible().catch(() => false)
      expect(hasLogin).toBe(false)
      await app3.close()
    } finally {
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
