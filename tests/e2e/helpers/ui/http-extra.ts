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
  const headersTab = page.getByRole('button', { name: /^Headers$/i })
  if (await headersTab.isVisible().catch(() => false)) {
    await headersTab.click()
  }
  const addBtn = page.getByTestId('kv-add-row').first()
  if (await addBtn.isVisible().catch(() => false)) {
    await addBtn.click()
    const rows = page.locator('[data-testid^="kv-row-"]')
    const count = await rows.count()
    const last = rows.nth(count - 1)
    const keyInput = last.getByTestId('kv-key').locator('input')
    if (await keyInput.isVisible().catch(() => false)) {
      await keyInput.fill(key)
    }
    await last.getByTestId('kv-value').locator('input').fill(value)
  }
}

/**
 * Enable WS-Security in the SOAP editor security panel and select a mode.
 * Assumes the SOAP editor is already open (Manual mode visible).
 *
 * @param mode  'username-token' | 'sign' | 'encrypt' | 'timestamp'
 */
export async function enableWssMode(page: Page, mode: string): Promise<void> {
  // Expand WS-Security section if needed
  const wsBtn = page.getByRole('button', { name: /WS-Security/i })
  if (await wsBtn.isVisible().catch(() => false)) {
    // Check if it's already expanded by looking for the "Enable WS-Security" checkbox
    const enableCb = page.getByRole('checkbox', { name: /Enable WS-Security/i })
    if (!(await enableCb.isVisible().catch(() => false))) {
      await wsBtn.click()
    }
    if (!(await enableCb.isChecked().catch(() => false))) {
      await enableCb.check()
    }
  }

  // Tick the mode checkbox
  const modeLabel = page.getByText(new RegExp(mode.replace('-', '.?'), 'i')).first()
  if (await modeLabel.isVisible().catch(() => false)) {
    const modeCb = modeLabel
      .locator('xpath=preceding-sibling::input[@type="checkbox"]')
      .or(modeLabel.locator('..').locator('input[type="checkbox"]'))
    if (await modeCb.isVisible().catch(() => false) && !(await modeCb.isChecked())) {
      await modeCb.check()
    }
  }
}
