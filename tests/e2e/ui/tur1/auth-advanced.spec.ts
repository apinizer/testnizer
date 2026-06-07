/**
 * MST-003 P1 Password change + disable
 * MST-004 P1 Password recover (OS auth) — skipped, needs mock infra
 * MST-005 P1 Guest → QuickTestShell (password already set)
 * MST-009 P1 Wrong password UX (consecutive attempts)
 * MST-007 P2 EULA re-consent (legal hash change)
 *
 * IMPORTANT: These tests mutate login state. Each uses its own isolated
 * Electron instance (own mkdtemp userData) — the shared worker fixture is
 * intentionally NOT used here, so test pollution is impossible.
 */
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { electronLaunchOptions } from '../../helpers/electron-env'
import { acceptEula, waitForApiBridge } from '../../helpers/ui/bootstrap'
import {
  disablePasswordViaIpc,
  loginWithPassword,
  setPasswordViaIpc,
  TEST_PASSWORD,
} from '../../helpers/ui/login-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const MAIN = path.resolve(__dirname, '../../../../out/main/index.js')

function mkUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `testnizer-auth-adv-${uid()}-`))
}

async function coldStart(userDataDir: string) {
  const app = await electron.launch(electronLaunchOptions(MAIN, userDataDir))
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await waitForApiBridge(win)
  return { app, win }
}

/** Accept EULA + continue as guest, wait for project hub or workbench. */
async function bootstrapMinimal(win: import('@playwright/test').Page) {
  await acceptEula(win)
  const guestBtn = win.getByTestId('login-continue-anonymous')
  if (await guestBtn.isVisible().catch(() => false)) {
    await guestBtn.click()
  }
  await win.waitForFunction(
    () => {
      const t = document.body.innerText
      return t.includes('New Project') || t.includes('APIs') || t.includes('Send')
    },
    { timeout: 20_000 },
  )
}

// ---------------------------------------------------------------------------
// MST-003 — Password change + disable
// ---------------------------------------------------------------------------
test('MST-003 password change and disable', async () => {
  const dir = mkUserData()
  const { app, win } = await coldStart(dir)
  try {
    await bootstrapMinimal(win)

    // Set initial password.
    await setPasswordViaIpc(win, TEST_PASSWORD)

    // Relaunch → login gate appears.
    await app.close()
    const { app: app2, win: win2 } = await coldStart(dir)
    try {
      await loginWithPassword(win2, TEST_PASSWORD)
      await expect(
        win2.getByTestId('project-home').or(win2.getByTestId('nav-apis')),
      ).toBeVisible({ timeout: 15_000 })

      // Resolve the current user id from the session — changePassword and
      // disablePassword both require it (the handler looks up the user by id).
      const userId = await win2.evaluate(async () => {
        const w = window as Window & {
          api?: { auth?: { getSession: (t: string) => Promise<{ data?: { user?: { id: string } } }> } }
        }
        const token = localStorage.getItem('testnizer_session_token')
        if (!token) return null
        const sess = await w.api?.auth?.getSession(token)
        return sess?.data?.user?.id ?? null
      })
      expect(userId, 'session user id not found').toBeTruthy()

      // Change password via IPC (simulates Settings → change password flow).
      // newPassword must be ≥8 chars and contain a letter AND a number.
      const newPw = `NewPw1-${uid()}`
      const changeRes = await win2.evaluate(
        async ({ uid, oldPw, newPw }) => {
          const w = window as Window & {
            api?: {
              auth?: {
                changePassword: (p: {
                  userId: string
                  currentPassword: string
                  newPassword: string
                }) => Promise<{ success: boolean; error?: string }>
              }
            }
          }
          return w.api?.auth?.changePassword({ userId: uid, currentPassword: oldPw, newPassword: newPw })
        },
        { uid: userId as string, oldPw: TEST_PASSWORD, newPw },
      )
      expect(changeRes?.success).toBe(true)

      // Disable password with the new credentials (changePassword cleared the
      // session, so use the userId captured above).
      const disableRes = await win2.evaluate(
        async ({ uid, pw }) => {
          const w = window as Window & {
            api?: { auth?: { disablePassword: (p: unknown) => Promise<{ success: boolean; error?: string }> } }
          }
          return w.api?.auth?.disablePassword({ userId: uid, currentPassword: pw })
        },
        { uid: userId as string, pw: newPw },
      )
      expect(disableRes?.success).toBe(true)
    } finally {
      await app2.close()
    }

    // Relaunch after disable — no login prompt.
    const { app: app3, win: win3 } = await coldStart(dir)
    try {
      await acceptEula(win3).catch(() => {})
      const hasLogin = await win3.locator('input[type="password"]').isVisible().catch(() => false)
      expect(hasLogin).toBe(false)
    } finally {
      await app3.close()
    }
  } finally {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// MST-004 — Password recover via OS auth (Touch ID / Windows Hello)
// Skipped: requires real OS biometric hardware or a mock injection that is
// not yet available in the test infra. Needs hook: expose
// `auth.osAuthMock(enabled)` to bypass native prompt in test mode.
// ---------------------------------------------------------------------------
test.skip('MST-004 password recover via OS auth — needs mock infra', async () => {
  // When auth.osAuthMock() IPC is available:
  // 1. Set password, relaunch.
  // 2. Call auth.osAuthMock(true) to stub biometric OK.
  // 3. Click "Forgot password / Use OS auth" button.
  // 4. Expect workbench without entering password.
})

// ---------------------------------------------------------------------------
// MST-005 — Guest → QuickTestShell when password is set
// ---------------------------------------------------------------------------
test('MST-005 guest is redirected to QuickTestShell after password set', async () => {
  const dir = mkUserData()
  const { app, win } = await coldStart(dir)
  try {
    await bootstrapMinimal(win)

    // Set a password.
    await setPasswordViaIpc(win, TEST_PASSWORD)

    // Relaunch — login screen shows. There should be a "Quick Test" / guest
    // path (unauthenticated limited shell) as well as the password input.
    await app.close()
    const { app: app2, win: win2 } = await coldStart(dir)
    try {
      // Password input visible.
      await expect(win2.locator('input[type="password"]').first()).toBeVisible({ timeout: 15_000 })

      // On the password-login form the guest entry is the "Quick Test" button
      // (calls continueAsGuest). It has no testid here — the
      // login-continue-anonymous testid is only on the first-launch welcome.
      const quickTest = win2.getByRole('button', { name: /Quick Test|Hızlı Test/i }).first()
      await expect(quickTest).toBeVisible({ timeout: 10_000 })
      await quickTest.click()
      // QuickTestShell shows its own header ("Back to Login") plus the protocol
      // picker — assert on the unmistakable "Back to Login" affordance.
      await expect(
        win2.getByText(/Back to Login|Girişe Dön/i).first(),
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      await app2.close()
    }
  } finally {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// MST-009 — Wrong password UX (consecutive attempts)
// ---------------------------------------------------------------------------
test('MST-009 wrong password shows error and does not unlock', async () => {
  const dir = mkUserData()
  const { app, win } = await coldStart(dir)
  try {
    await bootstrapMinimal(win)
    await setPasswordViaIpc(win, TEST_PASSWORD)

    await app.close()
    const { app: app2, win: win2 } = await coldStart(dir)
    try {
      const input = win2.locator('input[type="password"]').first()
      await expect(input).toBeVisible({ timeout: 15_000 })

      // Attempt 1 — wrong password.
      await input.fill('WrongPassword1!')
      await win2.getByRole('button', { name: /Unlock|Sign in|Log in|Login/i }).click()

      // Error message must appear.
      await expect(
        win2.getByText(/incorrect|wrong|invalid|hatalı|geçersiz/i).first(),
      ).toBeVisible({ timeout: 8_000 })

      // Still on login screen.
      await expect(input).toBeVisible()

      // Attempt 2 — another wrong password.
      await input.fill('AnotherWrongPw!')
      await win2.getByRole('button', { name: /Unlock|Sign in|Log in|Login/i }).click()
      await expect(
        win2.getByText(/incorrect|wrong|invalid|hatalı|geçersiz/i).first(),
      ).toBeVisible({ timeout: 8_000 })

      // Correct password succeeds.
      await input.fill(TEST_PASSWORD)
      await win2.getByRole('button', { name: /Unlock|Sign in|Log in|Login/i }).click()
      await expect(
        win2.getByTestId('project-home').or(win2.getByTestId('nav-apis')),
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      await app2.close()
    }
  } finally {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// MST-007 — EULA re-consent (legal hash change) P2
// ---------------------------------------------------------------------------
test('MST-007 EULA re-consent gate appears after legal content hash changes', async () => {
  const dir = mkUserData()
  const { app, win } = await coldStart(dir)
  try {
    // Bootstrap normally (accepts EULA, marks consent hash in store).
    await acceptEula(win)
    const guestBtn = win.getByTestId('login-continue-anonymous')
    if (await guestBtn.isVisible().catch(() => false)) await guestBtn.click()
    await win.waitForFunction(
      () => document.body.innerText.includes('New Project') || document.body.innerText.includes('APIs'),
      { timeout: 20_000 },
    )

    // Verify consent is recorded via IPC. The bridge exposes eula.state →
    // { success, data: { state: { accepted }, consentValid } }.
    const consentRes = await win.evaluate(async () => {
      const w = window as Window & {
        api?: {
          eula?: {
            state: () => Promise<{ success: boolean; data?: { state?: { accepted?: boolean } } }>
          }
        }
      }
      return w.api?.eula?.state()
    })
    expect(consentRes?.data?.state?.accepted).toBe(true)

    // Simulate hash change: reset consent so next cold start re-shows gate.
    const resetRes = await win.evaluate(async () => {
      const w = window as Window & {
        api?: { eula?: { reset: () => Promise<{ success: boolean }> } }
      }
      return w.api?.eula?.reset()
    })
    expect(resetRes?.success).toBe(true)

    await app.close()
    const { app: app2, win: win2 } = await coldStart(dir)
    try {
      // EULA gate must reappear.
      await expect(win2.getByTestId('eula-gate')).toBeVisible({ timeout: 20_000 })
    } finally {
      await app2.close()
    }
  } finally {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
})
