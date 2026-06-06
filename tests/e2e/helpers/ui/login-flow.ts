import { expect, type Page } from '@playwright/test'

const TEST_PASSWORD = 'Testnizer1!'

interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

/** Set app password via IPC (faster than walking the welcome UI). */
export async function setPasswordViaIpc(page: Page, password = TEST_PASSWORD): Promise<void> {
  const res = await page.evaluate(async (pw) => {
    const w = window as Window & {
      api?: { auth?: { setPassword: (p: { password: string }) => Promise<IpcResult<unknown>> } }
    }
    return w.api?.auth?.setPassword({ password: pw })
  }, password)
  if (!res?.success) throw new Error(res?.error ?? 'setPassword failed')
}

/** Login with password on the login screen. */
export async function loginWithPassword(page: Page, password = TEST_PASSWORD): Promise<void> {
  const input = page.locator('input[type="password"]').first()
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(password)
  await page.getByRole('button', { name: /Unlock|Sign in|Log in|Login/i }).click()
  await page.waitForFunction(
    () => {
      const body = document.body.innerText
      return body.includes('New Project') || body.includes('APIs') || body.includes('Send')
    },
    { timeout: 20_000 },
  )
}

/** Disable password protection (requires current password + session). */
export async function disablePasswordViaIpc(page: Page, password = TEST_PASSWORD): Promise<void> {
  await page.evaluate(async (pw) => {
    const w = window as Window & {
      api?: {
        auth?: {
          getSession: (t: string) => Promise<IpcResult<{ userId: string }>>
          disablePassword: (p: { userId: string; currentPassword: string }) => Promise<IpcResult<unknown>>
        }
      }
    }
    const token = localStorage.getItem('testnizer_session_token')
    if (!token) throw new Error('no session token')
    const sess = await w.api?.auth?.getSession(token)
    const userId = (sess?.data as { user?: { id: string } } | undefined)?.user?.id
    if (!userId) throw new Error('no userId in session')
    const res = await w.api?.auth?.disablePassword({ userId, currentPassword: pw })
    if (!res?.success) throw new Error(res?.error ?? 'disablePassword failed')
  }, password)
}

export { TEST_PASSWORD }
