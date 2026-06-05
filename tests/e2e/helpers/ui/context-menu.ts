import type { Page } from '@playwright/test'

/** Open context menu on a locator via right-click. */
export async function openContextMenu(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click({ button: 'right' })
  await page.locator('[data-context-menu]').waitFor({ state: 'visible', timeout: 5_000 })
}

/** Click a context menu item by visible label. */
export async function clickContextMenuItem(page: Page, label: RegExp | string): Promise<void> {
  const menu = page.locator('[data-context-menu]')
  await menu.getByRole('button', { name: label }).click()
}

/** Click submenu item (e.g. Add Request → HTTP). */
export async function clickContextSubmenuItem(
  page: Page,
  parentLabel: RegExp | string,
  childLabel: RegExp | string,
): Promise<void> {
  const menu = page.locator('[data-context-menu]')
  await menu.getByRole('button', { name: parentLabel }).hover()
  await menu.getByRole('button', { name: childLabel }).click()
}
