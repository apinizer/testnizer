import type { Locator, Page } from '@playwright/test'
import { clickContextMenuItem, clickContextSubmenuItem } from './context-menu'

/** Search the APIs tree. */
export async function treeSearch(page: Page, query: string): Promise<void> {
  await page.getByTestId('tree-search').fill(query)
}

/** Clear the tree search filter — stale filters hide nodes from later tests. */
export async function treeClearSearch(page: Page): Promise<void> {
  const search = page.getByTestId('tree-search')
  // optional: cleanup: clears the tree filter when the search box is on screen
  if (await search.isVisible().catch(() => false)) {
    await search.fill('')
  }
}

/** Scroll the APIs tree's virtual list; false when it could not move (end reached). */
async function scrollTree(page: Page, mode: 'top' | 'page'): Promise<boolean> {
  return page
    .getByTestId('tree-node')
    .first()
    .evaluate((el, m) => {
      const box = el.closest('.overflow-y-auto') as HTMLElement | null
      if (!box) return false
      const before = box.scrollTop
      box.scrollTop = m === 'top' ? 0 : before + box.clientHeight * 0.8
      return m === 'top' || box.scrollTop !== before
    }, mode)
}

/** Scroll the APIs tree back to its first row (the project root). */
export async function treeScrollToTop(page: Page): Promise<void> {
  await scrollTree(page, 'top')
  await page.waitForTimeout(50)
}

/**
 * Bring the tree row labelled `label` into the virtual window and return it.
 *
 * The APIs tree is virtualized: only the rows near its scroll position exist
 * in the DOM. The scroll position outlives a spec in the shared ui window
 * (a created folder is revealed, i.e. scrolled to — so a later spec can find
 * the tree scrolled to the bottom), and a long canonical project has rows far
 * below the first screen. So: clear the filter, scroll to the top (the project
 * root is always row 0), then page down until the row is rendered.
 */
export async function treeScrollToRow(page: Page, label: string): Promise<Locator> {
  await treeClearSearch(page)
  const row = page.getByTestId('tree-node').filter({ hasText: label }).first()
  await treeScrollToTop(page)
  for (let i = 0; i < 200; i++) {
    // optional: probe — the row is either rendered at this scroll position or we page on
    if (await row.isVisible().catch(() => false)) return row
    if (!(await scrollTree(page, 'page'))) break
    await page.waitForTimeout(50)
  }
  await row.waitFor({ state: 'visible', timeout: 5_000 })
  return row
}

/** Click a tree node by label text. */
export async function treeClickNode(page: Page, label: string): Promise<void> {
  await page.getByTestId('tree-node').filter({ hasText: label }).first().click()
}

/** Search then click — reliable when the tree is large or folders are collapsed. */
export async function treeOpenNode(page: Page, label: string): Promise<void> {
  await treeSearch(page, label)
  await treeClickNode(page, label)
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

/**
 * Add a folder under a project root or another folder, via the context menu.
 *
 * Since issue #68 the menu entry PROMPTS: an inline editor appears and nothing
 * is written until the name is confirmed. The helper therefore types a name —
 * `New Folder` by default, so specs that were written against the old
 * create-then-rename behaviour keep working unchanged.
 */
export async function treeAddFolder(
  page: Page,
  parentLabel: string,
  name = 'New Folder',
): Promise<void> {
  const node = await treeScrollToRow(page, parentLabel)
  await node.click({ button: 'right' })
  await clickContextMenuItem(page, /Add Folder/i)

  const draft = page.getByTestId('new-folder-input')
  await draft.waitFor({ state: 'visible', timeout: 10_000 })
  await draft.fill(name)
  await draft.press('Enter')

  await page
    .getByTestId('tree-node')
    .filter({ hasText: name })
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

/**
 * Inline rename the PROJECT ROOT row (issue #126). `treeRename` filters by
 * label and would pick a descendant whose name contains the project name; the
 * root is always the first virtual row.
 */
export async function treeRenameRoot(page: Page, newName: string): Promise<void> {
  // Row 0 is the first rendered row only when the tree is scrolled to the top.
  await treeScrollToTop(page)
  const root = page.getByTestId('tree-node').first()
  await root.click({ button: 'right' })
  await clickContextMenuItem(page, /Rename/i)
  const input = root.locator('input[type="text"]')
  await input.waitFor({ state: 'visible', timeout: 5_000 })
  await input.fill(newName)
  await input.press('Enter')
}
