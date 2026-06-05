import type { Page } from '@playwright/test'
import { clickContextMenuItem, clickContextSubmenuItem, openContextMenu } from './context-menu'

/** Search the APIs tree. */
export async function treeSearch(page: Page, query: string): Promise<void> {
  await page.getByTestId('tree-search').fill(query)
}

/** Click a tree node by label text. */
export async function treeClickNode(page: Page, label: string): Promise<void> {
  await page.getByTestId('tree-node').filter({ hasText: label }).first().click()
}

/** Right-click tree node and pick context action. */
export async function treeContextAction(
  page: Page,
  nodeLabel: string,
  action: RegExp | string,
): Promise<void> {
  const node = page.getByTestId('tree-node').filter({ hasText: nodeLabel }).first()
  await node.click({ button: 'right' })
  await clickContextMenuItem(page, action)
}

/** Add HTTP request via folder context menu. */
export async function treeAddHttpRequest(page: Page, folderLabel: string): Promise<void> {
  const node = page.getByTestId('tree-node').filter({ hasText: folderLabel }).first()
  await node.click({ button: 'right' })
  await clickContextSubmenuItem(page, /Add Request/i, /HTTP/i)
}

/** Add folder under project root or folder via context menu (creates "New Folder"). */
export async function treeAddFolder(page: Page, parentLabel: string): Promise<void> {
  const node = page.getByTestId('tree-node').filter({ hasText: parentLabel }).first()
  await node.click({ button: 'right' })
  await clickContextMenuItem(page, /Add Folder/i)
  await page
    .getByTestId('tree-node')
    .filter({ hasText: /New Folder/i })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
}

/** Confirm delete dialog (type "delete" when required). */
export async function confirmDelete(page: Page, typeConfirm = false): Promise<void> {
  if (typeConfirm) {
    await page.getByTestId('delete-confirm-input').fill('delete')
  }
  await page.getByTestId('delete-confirm-btn').click()
}

/** Inline rename a tree node. */
export async function treeRename(page: Page, nodeLabel: string, newName: string): Promise<void> {
  const node = page.getByTestId('tree-node').filter({ hasText: nodeLabel }).last()
  await node.click({ button: 'right' })
  await clickContextMenuItem(page, /Rename/i)
  const input = page.getByTestId('tree-node').locator('input[type="text"]').last()
  await input.waitFor({ state: 'visible', timeout: 5_000 })
  await input.fill(newName)
  await input.press('Enter')
}
