import type { Page } from '@playwright/test'

/** Click "+ Add …" in the active KeyValueTable. */
export async function kvAddRow(page: Page, label?: RegExp | string): Promise<void> {
  if (label) {
    await page.getByRole('button', { name: label }).first().click()
    return
  }
  await page.getByTestId('kv-add-row').click()
}

/** Fill the last key-value row in a table region. */
export async function kvFillLastRow(
  page: Page,
  opts: { key: string; value: string; tableTestId?: string },
): Promise<void> {
  const root = opts.tableTestId ? page.getByTestId(opts.tableTestId) : page
  const rows = root.locator('[data-testid^="kv-row-"]')
  const count = await rows.count()
  const row = count > 0 ? rows.nth(count - 1) : root.locator('tr, [class*="row"]').last()
  const keyEl = row.getByTestId('kv-key')
  if (await keyEl.locator('input').count()) {
    await keyEl.locator('input').fill(opts.key)
  } else {
    await keyEl.fill(opts.key)
  }
  await row.getByTestId('kv-value').locator('input').fill(opts.value)
}

/** Toggle bulk-edit mode. */
export async function kvToggleBulkEdit(page: Page): Promise<void> {
  await page.getByTestId('kv-bulk-toggle').click()
}

/** Fill bulk-edit textarea. */
export async function kvFillBulk(page: Page, text: string): Promise<void> {
  await page.getByTestId('kv-bulk-textarea').fill(text)
}

/** Disable/enable a row by index. */
export async function kvToggleRowEnabled(page: Page, index: number): Promise<void> {
  await page.getByTestId(`kv-row-${index}`).getByTestId('kv-enable').click()
}

/** Remove row by index. */
export async function kvRemoveRow(page: Page, index: number): Promise<void> {
  await page.getByTestId(`kv-row-${index}`).getByTestId('kv-remove').click()
}
