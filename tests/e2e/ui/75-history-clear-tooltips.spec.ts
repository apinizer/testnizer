/**
 * Tester findings 4 + 5 — History sidebar.
 *
 * 4: "Clear" deleted every project's History on the first click and was
 *    clickable on an empty list. Now it clears what the list shows — the active
 *    project — after the shared DeleteConfirmDialog (count from main), Cancel
 *    keeps the rows, Confirm deletes, another project's row survives, and an
 *    empty list disables it.
 * 5: an HTTP row's truncated URL titles with the full STORED url (masked by
 *    main, issue #195 — the secret query value never reaches the tooltip), and
 *    the icon-only row buttons (History trash, APIs tree "···") carry a name.
 *
 * Note: Clear empties the canonical project's History in the shared ui
 * Electron instance — the behaviour under test. Specs after this one send
 * their own requests before reading History.
 *
 * Cleanup: the IPC-created folder and the other project's seeded History row are deleted
 * via IPC, the tree filter and tabs are reset.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, sendAndWaitResponse } from '../helpers/ui/request-flow'
import { createFolder, getActiveProjectId } from '../helpers/ui/assert-ipc'
import { refreshWorkspaceTree } from '../helpers/ui/import-flow'
import { treeClearSearch, treeSearch } from '../helpers/ui/tree'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const shot = (page: Page, step: string) =>
  page.screenshot({ path: `test-results/screens/75-${step}.png` })
const entries = (page: Page) => page.getByTestId('history-entry')
const filter = (page: Page) => page.getByPlaceholder('Filter history...')

type HistoryBridge = {
  api: {
    workspace: { list: () => Promise<{ data?: Array<{ id: string }> }> }
    history: {
      add: (p: unknown) => Promise<unknown>
      list: (o: { project_id: string }) => Promise<{ data?: Array<{ url: string }> }>
      clear: (scope: { project_id: string }) => Promise<unknown>
    }
  }
}

/** A History row of ANOTHER project in the same workspace (no FK on history.project_id). */
async function seedOtherProjectRow(page: Page, projectId: string, url: string): Promise<void> {
  await page.evaluate(
    async ({ pid, u }) => {
      const w = window as unknown as Window & HistoryBridge
      const ws = (await w.api.workspace.list()).data?.[0]?.id
      await w.api.history.add({
        workspace_id: ws,
        project_id: pid,
        protocol: 'http',
        method: 'GET',
        url: u,
        request_snapshot: '{}',
      })
    },
    { pid: projectId, u: url },
  )
}

async function historyUrlsOf(page: Page, projectId: string): Promise<string[]> {
  return page.evaluate(async (pid) => {
    const w = window as unknown as Window & HistoryBridge
    return ((await w.api.history.list({ project_id: pid })).data ?? []).map((r) => r.url)
  }, projectId)
}

uiTest.describe('History — Clear asks first, rows show their full URL (findings 4 + 5)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('HTTP row tooltip is the full masked URL; trash is labelled', async ({ window }) => {
    const marker = `tip-${uid()}`
    const secret = `sekret${uid().replace(/-/g, '')}`
    try {
      await openHttpRequestTab(window)
      // `/get` echoes 200; the row shows host + `/get`, the query is only in the tooltip.
      await fillUrl(window, `${localHttpBin()}/get?marker=${marker}&api_key=${secret}&page=2`)
      await sendAndWaitResponse(window)

      await navigateSidebar(window, 'history')
      await filter(window).fill(marker)
      const row = entries(window).first()
      await expect(row).toBeVisible({ timeout: 15_000 })

      const label = row.getByTestId('history-entry-label')
      const title = (await label.getAttribute('title')) ?? ''
      // Full URL, more than the host+path the row shows.
      expect(title).toContain(marker)
      expect(title).toContain('page=2')
      expect(title.length).toBeGreaterThan(((await label.innerText()) || '').length)
      // Masked as stored: the secret never reaches the tooltip.
      expect(title).not.toContain(secret)
      expect(title).toMatch(/••••••|%E2%80%A2/)

      await row.hover()
      const del = row.getByTestId('history-entry-delete')
      await expect(del).toBeVisible()
      await expect(del).toHaveAttribute('aria-label', 'Delete')
      await expect(del).toHaveAttribute('title', 'Delete')
      await shot(window, 'row-hover')
    } finally {
      await filter(window)
        .fill('')
        .catch(() => {})
      await closeAllTabs(window).catch(() => {})
    }
  })

  uiTest('APIs tree "···" is labelled "More actions"', async ({ window }) => {
    // Independent of what earlier specs left in the shared instance (a tree
    // filter, a collapsed root, a long virtualised tree): the folder is created
    // via IPC, the tree is rebuilt from the DB and filtered on its unique name
    // — a self-matching folder is always rendered (spec 36's pattern).
    const name = `Labels ${uid()}`
    const projectId = await getActiveProjectId(window)
    let folderId: string | null = null
    try {
      await treeClearSearch(window)
      folderId = await createFolder(window, projectId, name)
      await refreshWorkspaceTree(window)
      await treeSearch(window, name)
      const node = window.getByTestId('tree-node').filter({ hasText: name }).first()
      await expect(node).toBeVisible({ timeout: 10_000 })
      await node.hover()
      const more = node.getByTestId('tree-node-more')
      await expect(more).toBeVisible()
      await expect(more).toHaveAttribute('aria-label', 'More actions')
      await expect(more).toHaveAttribute('title', 'More actions')
    } finally {
      await treeClearSearch(window).catch(() => {})
      if (folderId) {
        await window
          .evaluate(async (id) => {
            const w = window as unknown as Window & {
              api: { folder: { delete: (id: string) => Promise<unknown> } }
            }
            await w.api.folder.delete(id)
          }, folderId)
          .catch(() => {})
        await refreshWorkspaceTree(window).catch(() => {})
      }
    }
  })

  uiTest(
    'Settings → Data → Clear history asks first; Cancel keeps the rows',
    async ({ window }) => {
      const marker = `settings-${uid()}`
      try {
        await openHttpRequestTab(window)
        await fillUrl(window, `${localHttpBin()}/get?${marker}=1`)
        await sendAndWaitResponse(window)

        await window.getByTestId('nav-settings').click()
        await expect(window.getByTestId('project-detail-modal')).toBeVisible({ timeout: 8_000 })
        await window.getByTestId('project-detail-tab-data').click()
        await window.getByTestId('data-clear-history-btn').click()

        // The History sidebar's dialog: same title, the project's count from main.
        await expect(window.getByText('Delete project history')).toBeVisible()
        await expect(window.getByText(/this project's \d+ history entr(y|ies)/)).toBeVisible()
        await shot(window, 'settings-confirm-dialog')
        await window.getByTestId('delete-cancel-btn').click()
        await expect(window.getByTestId('delete-confirm-btn')).toHaveCount(0)

        await window.keyboard.press('Escape')
        await expect(window.getByTestId('project-detail-modal')).toBeHidden({ timeout: 5_000 })
        await navigateSidebar(window, 'history')
        await filter(window).fill(marker)
        await expect(entries(window)).toHaveCount(1, { timeout: 10_000 })
      } finally {
        await dismissOverlays(window).catch(() => {})
        await filter(window)
          .fill('')
          .catch(() => {})
        await closeAllTabs(window).catch(() => {})
      }
    },
  )

  uiTest(
    'Clear confirms; Cancel keeps rows, Confirm deletes, empty list disables it',
    async ({ window }) => {
      const marker = `clear-${uid()}`
      const otherProject = `e2e-other-project-${uid()}`
      const otherUrl = `${localHttpBin()}/get?other=${marker}`
      try {
        await seedOtherProjectRow(window, otherProject, otherUrl)
        for (const n of [1, 2]) {
          await openHttpRequestTab(window)
          await fillUrl(window, `${localHttpBin()}/get?${marker}=${n}`)
          await sendAndWaitResponse(window)
        }

        await navigateSidebar(window, 'history')
        await filter(window).fill(marker)
        await expect(entries(window)).toHaveCount(2, { timeout: 15_000 })
        await filter(window).fill('')

        const clearBtn = window.getByTestId('history-clear-btn')
        await expect(clearBtn).toBeEnabled()

        // Ask → Cancel: nothing deleted.
        await clearBtn.click()
        await expect(window.getByText('Delete project history')).toBeVisible()
        await expect(window.getByText(/this project's \d+ history entr(y|ies)/)).toBeVisible()
        await shot(window, 'confirm-dialog')
        await window.getByTestId('delete-cancel-btn').click()
        await expect(window.getByTestId('delete-confirm-btn')).toHaveCount(0)
        await filter(window).fill(marker)
        await expect(entries(window)).toHaveCount(2)
        await filter(window).fill('')

        // Ask → Confirm: the list empties.
        await clearBtn.click()
        await window.getByTestId('delete-confirm-btn').click()
        await expect(entries(window)).toHaveCount(0, { timeout: 10_000 })
        // Only this project: the other project's row is still in the database.
        expect(await historyUrlsOf(window, otherProject)).toEqual([otherUrl])

        // Empty list: Clear is disabled and opens nothing.
        await expect(clearBtn).toBeDisabled()
        await clearBtn.click({ force: true })
        await expect(window.getByTestId('delete-confirm-btn')).toHaveCount(0)
        await shot(window, 'empty-disabled')
      } finally {
        await filter(window)
          .fill('')
          .catch(() => {})
        await closeAllTabs(window).catch(() => {})
        await window
          .evaluate(async (pid) => {
            const w = window as unknown as Window & HistoryBridge
            await w.api.history.clear({ project_id: pid })
          }, otherProject)
          .catch(() => {})
      }
    },
  )
})
