/**
 * Extra HTTP helpers for deep protocol tests (MST-045, 048, 049, 050, 052, 053).
 *
 * These are thin wrappers that augment the core request-flow helpers
 * without modifying the existing files.
 */
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Wait for the response status badge, then return status AND the full
 * body text from the response body tab.  Clicks the body tab automatically.
 */
export async function sendAndReadBody(
  page: Page,
  timeoutMs = 30_000,
): Promise<{ status: number; body: string }> {
  await page.getByTestId('send-btn').click()
  const badge = page.getByTestId('response-status')
  await expect(badge).toBeVisible({ timeout: timeoutMs })
  const text = (await badge.textContent())?.trim() ?? ''
  const match = text.match(/(\d{3})/)
  const status = match ? Number(match[1]) : 0

  await page.getByTestId('res-tab-body').click()
  const body = await page
    .getByTestId('res-body-content')
    .innerText({ timeout: 10_000 })
    .catch(() => '')

  return { status, body }
}

/**
 * Add a SOAP custom header via the Headers tab of the SOAP editor.
 * Assumes the SOAP editor is already open and the Headers sub-tab is visible.
 */
export async function addSoapHeader(page: Page, key: string, value: string): Promise<void> {
  await page.getByTestId('soap-detail-tab-headers').click()
  await page.getByTestId('kv-add-row').first().click()
  const rows = page.locator('[data-testid^="kv-row-"]')
  const count = await rows.count()
  const last = rows.nth(count - 1)
  await last.getByTestId('kv-key').locator('input').fill(key)
  await last.getByTestId('kv-value').locator('input').fill(value)
}

/**
 * Enable WS-Security in the SOAP editor security panel and select a mode.
 * Assumes the SOAP editor is already open (Manual mode visible).
 *
 * @param mode  'username-token' | 'sign' | 'encrypt' | 'timestamp'
 */
export async function enableWssMode(page: Page, mode: string): Promise<void> {
  // Expand the WS-Security section if its "Enable" checkbox is not on screen yet.
  const enableCb = page.getByRole('checkbox', { name: /Enable WS-Security/i })
  // optional: the section may already be expanded by an earlier step.
  if (!(await enableCb.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /WS-Security/i }).click()
  }
  await enableCb.check()

  // Tick the mode checkbox (its label reads e.g. "username token", "sign").
  await page.getByRole('checkbox', { name: new RegExp(`^${mode.replace('-', '[ -]?')}$`, 'i') }).check()
}
