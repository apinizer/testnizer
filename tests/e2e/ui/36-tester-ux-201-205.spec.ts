/**
 * The tester UX findings #201, #202, #204 and #205, walked through the real app.
 *
 *   #202  The left panel could only be hidden with Ctrl/Cmd+B — there was no
 *         visible control, and no visible way back.
 *   #205  The request editor forgot its sub-tab: pick Body on one request, look
 *         at another, come back — Params again.
 *   #201  A request added from a folder kept the name "New Endpoint" forever,
 *         even after it was given a URL and saved.
 *   #204  The Headers tab hid everything the engine adds on the wire (auth,
 *         User-Agent, Host …), so "why does the server see X?" had no answer
 *         on screen.
 *
 * All four have renderer unit tests. These exist because each one is about
 * what the user sees after a sequence of clicks — a remount, a save round trip,
 * a store shared between tabs — which is exactly the part a unit test stubs.
 *
 * The `ui` project shares ONE Electron instance, so everything here that would
 * outlive the test (a collapsed panel, an expanded auto-headers section, the
 * folders it creates, open tabs) is put back in `finally` / `afterAll`.
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
import { addHeader, clickRequestTab, fillUrl } from '../helpers/ui/request-flow'
import { setBearerAuth } from '../helpers/ui/auth-flow'
import { saveInPlace } from '../helpers/ui/save-flow'
import { createFolder, getActiveProjectId } from '../helpers/ui/assert-ipc'
import { refreshWorkspaceTree } from '../helpers/ui/import-flow'
import { treeAddHttpRequest, treeClearSearch, treeRename, treeSearch } from '../helpers/ui/tree'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => `${Date.now()}`.slice(-7) + Math.random().toString(36).slice(2, 5)

/** Folders created here — removed in afterAll (their requests go with them). */
const createdFolderIds: string[] = []

const activeTab = (page: Page) => page.locator('[data-testid="endpoint-tab"][data-active="true"]')

/** A tree row whose LABEL is exactly `label` (the row text also holds the method badge). */
const treeRow = (page: Page, label: string) =>
  page.getByTestId('tree-node').filter({ has: page.getByText(label, { exact: true }) })

uiTest.describe('tester UX findings #201 / #202 / #204 / #205', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
  })

  uiTest.afterAll(async ({ window }) => {
    // Tabs backed by these rows are closed by afterEach; drop the rows so the
    // canonical project is handed on the way this file found it.
    await window.evaluate(async (ids) => {
      const api = (
        window as unknown as { api?: { folder?: { delete?: (id: string) => Promise<unknown> } } }
      ).api
      for (const id of ids) {
        try {
          if (typeof api?.folder?.delete === 'function') await api.folder.delete(id)
        } catch {
          /* already gone */
        }
      }
    }, createdFolderIds)
    await refreshWorkspaceTree(window).catch(() => {})
    await treeClearSearch(window).catch(() => {})
  })

  uiTest(
    'the left panel collapses and expands from visible controls (issue #202)',
    async ({ window }) => {
      const leftPanel = window.getByTestId('left-panel')
      const tree = window.getByTestId('tree-search')
      await expect(leftPanel).toBeVisible({ timeout: 5_000 })
      await expect(tree).toBeVisible()
      // Nothing to expand while the panel is open.
      await expect(window.getByTestId('left-panel-expand')).toHaveCount(0)

      try {
        await window.getByTestId('left-panel-collapse').click()
        await expect(leftPanel).toBeHidden({ timeout: 5_000 })
        await expect(tree).toBeHidden()
        // The way back is on screen — the whole point of the issue.
        const expand = window.getByTestId('left-panel-expand')
        await expect(expand).toBeVisible()

        await expand.click()
        await expect(leftPanel).toBeVisible({ timeout: 5_000 })
        await expect(tree).toBeVisible()
        await expect(window.getByTestId('left-panel-expand')).toHaveCount(0)
      } finally {
        // `ui.leftPanelCollapsed` is persisted and the instance is shared: a
        // collapsed panel would hide the tree from every spec after this one.
        // A page icon re-expands it.
        if (!(await leftPanel.isVisible().catch(() => false))) {
          await window.getByTestId('nav-apis').click()
        }
        await expect(leftPanel).toBeVisible({ timeout: 5_000 })
      }
    },
  )

  uiTest('each request remembers its own editor sub-tab (issue #205)', async ({ window }) => {
    const base = localHttpBin()
    await closeAllTabs(window)

    await openHttpRequestTab(window)
    await fillUrl(window, `${base}/get?tab=a`)
    await openHttpRequestTab(window)
    await fillUrl(window, `${base}/get?tab=b`)

    const tabs = window.getByTestId('endpoint-tab')
    await expect(tabs).toHaveCount(2)
    const tabA = tabs.nth(0)
    const tabB = tabs.nth(1)

    // On A, choose Body.
    await tabA.click()
    await expect(tabA).toHaveAttribute('data-active', 'true')
    await clickRequestTab(window, 'body')
    await expect(window.getByTestId('req-tab-body')).toHaveAttribute('data-active', 'true')

    // B was never touched — it is still on Params.
    await tabB.click()
    await expect(tabB).toHaveAttribute('data-active', 'true')
    await expect(window.getByTestId('req-tab-params')).toHaveAttribute('data-active', 'true')
    await expect(window.getByTestId('req-tab-body')).toHaveAttribute('data-active', 'false')

    // Back on A: Body, not Params. Before the fix the editor remounted with
    // its local useState and landed on Params.
    await tabA.click()
    await expect(tabA).toHaveAttribute('data-active', 'true')
    await expect(window.getByTestId('req-tab-body')).toHaveAttribute('data-active', 'true')
    await expect(window.getByTestId('req-tab-params')).toHaveAttribute('data-active', 'false')
  })

  uiTest(
    'a request added from a folder is named from its URL on save (issue #201)',
    async ({ window }) => {
      const folderName = `UX201 ${uid()}`
      const origin = new URL(localHttpBin()).origin
      const projectId = await getActiveProjectId(window)
      createdFolderIds.push(await createFolder(window, projectId, folderName))
      await refreshWorkspaceTree(window)

      // Filter on the folder's unique name: a self-matching folder keeps its
      // whole subtree, so every row asserted below is scoped to THIS folder and
      // cannot collide with requests other specs left in the canonical project.
      await treeSearch(window, folderName)
      await expect(treeRow(window, folderName)).toBeVisible({ timeout: 10_000 })

      // ── A placeholder name is replaced by the URL's last path segment ──
      await treeAddHttpRequest(window, folderName)
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', 'New Endpoint', {
        timeout: 10_000,
      })
      await expect(treeRow(window, 'New Endpoint')).toHaveCount(1)

      await fillUrl(window, `${origin}/api/customers?x=1`)
      await saveInPlace(window)

      await expect(activeTab(window)).toHaveAttribute('data-tab-name', 'customers', {
        timeout: 10_000,
      })
      await expect(treeRow(window, 'customers')).toHaveCount(1, { timeout: 10_000 })
      await expect(treeRow(window, 'New Endpoint')).toHaveCount(0)

      // ── A name the user chose is never replaced ──
      const customName = `Custom ${uid()}`
      await treeAddHttpRequest(window, folderName)
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', 'New Endpoint', {
        timeout: 10_000,
      })
      await treeRename(window, 'New Endpoint', customName)
      await expect(treeRow(window, customName)).toHaveCount(1, { timeout: 10_000 })
      // The tree rename keeps the open tab in sync (issue #40) — so the save
      // below sees the custom name, not the placeholder.
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', customName)

      // A URL edit makes the tab dirty; without one saveInPlace would pass
      // without saving anything.
      await fillUrl(window, `${origin}/api/orders`)
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true')
      await saveInPlace(window)

      await expect(activeTab(window)).toHaveAttribute('data-tab-name', customName)
      await expect(treeRow(window, customName)).toHaveCount(1)
      await expect(treeRow(window, 'orders')).toHaveCount(0)
      // The first request kept its derived name through all of this.
      await expect(treeRow(window, 'customers')).toHaveCount(1)
    },
  )

  uiTest(
    'the Headers tab shows the auto-generated headers, auth masked (issue #204)',
    async ({ window }) => {
      const canary = 'CANARY-e2e-204-token'
      const toggle = window.getByTestId('auto-headers-toggle')

      await openHttpRequestTab(window)
      await fillUrl(window, `${localHttpBin()}/get`)
      await setBearerAuth(window, canary)
      await clickRequestTab(window, 'headers')

      try {
        const section = window.getByTestId('auto-headers')
        await expect(section).toBeVisible({ timeout: 10_000 })

        // The collapsed header already says how many headers are hidden.
        const countText = (await window.getByTestId('auto-headers-count').innerText()).trim()
        const count = Number(/\d+/.exec(countText)?.[0] ?? 'NaN')
        expect(count, `auto-headers-count read "${countText}"`).toBeGreaterThan(0)

        // The expanded state lives for the session (module-level), so another
        // spec may have left it open — only click when it is actually closed.
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')

        const rows = section.getByTestId('auto-header-row')
        await expect(rows.first()).toBeVisible()

        // Authorization from the Bearer auth — present, attributed to Auth, masked.
        const authRow = rows.filter({ hasText: 'Authorization' })
        await expect(authRow).toHaveCount(1)
        await expect(authRow).toHaveAttribute('data-source', 'auth')
        const authValue = authRow.getByTestId('auto-header-value')
        await expect(authValue).toContainText('Bearer')
        await expect(authValue).toContainText('••••••')
        await expect(authValue).not.toContainText(canary)
        // Not anywhere else in the section either (a tooltip, a second row …).
        await expect(section).not.toContainText(canary)
        expect(await section.innerHTML()).not.toContain(canary)

        // The engine's User-Agent is listed and, until the user sets one, sent.
        const uaRow = rows.filter({ hasText: 'User-Agent' })
        await expect(uaRow).toHaveCount(1)
        await expect(uaRow).toHaveAttribute('data-overridden', 'false')

        // A user header with the same name wins — the auto row says so.
        await addHeader(window, 'User-Agent', 'mine')
        await expect(uaRow).toHaveAttribute('data-overridden', 'true', { timeout: 5_000 })
        // Auth is untouched by an unrelated header.
        await expect(authRow).toHaveAttribute('data-overridden', 'false')
      } finally {
        // Collapsed is the default and the flag survives tab switches for the
        // whole session — leave it as found so later specs that read the
        // Headers tab do not see a list of extra "Authorization"/"Host" rows.
        if ((await toggle.getAttribute('aria-expanded').catch(() => null)) === 'true') {
          await toggle.click().catch(() => {})
        }
      }
    },
  )
})
