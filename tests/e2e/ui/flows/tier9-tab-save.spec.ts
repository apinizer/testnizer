import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree, saveRequestToFolder } from '../../helpers/ui/request-flow'
import { treeOpenNode } from '../../helpers/ui/tree'
import { pressModShortcut } from '../../helpers/ui/keyboard'
import {
  createFolder,
  getActiveProjectId,
  getEndpoint,
  listEndpointsByProject,
} from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

const activeTab = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="endpoint-tab"][data-active="true"]')

uiTest.describe('Tier 9 — Tab & save lifecycle journeys', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('F35 dirty indicator appears on edit and clears on save', async ({ window }) => {
    const name = `Dirty ${uid()}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?v=1`)
    await saveRequestToTree(window, name)

    // Freshly saved → clean.
    await expect(activeTab(window)).toHaveAttribute('data-dirty', 'false', { timeout: 8_000 })
    await expect(window.getByTestId('tab-dirty')).toHaveCount(0)

    // Editing the URL marks the tab dirty.
    await fillUrl(window, `${http()}/get?v=2`)
    await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true', { timeout: 8_000 })

    // Ctrl/Cmd+S persists in place and clears the dirty flag (no modal — the
    // request already exists in the tree).
    await pressModShortcut(window, 's')
    await expect(activeTab(window)).toHaveAttribute('data-dirty', 'false', { timeout: 10_000 })
  })

  uiTest('F36 closing a saved tab and reopening from the tree restores it', async ({ window }) => {
    const name = `Reopen ${uid()}`
    const marker = `reopen-${Math.random().toString(36).slice(2, 7)}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?m=${marker}`)
    await saveRequestToTree(window, name)

    const before = await window.getByTestId('endpoint-tab').count()
    // Close the active tab via its × (revealed on hover).
    const tab = activeTab(window)
    await tab.hover()
    await tab.getByTestId('tab-close').click()
    await expect(window.getByTestId('endpoint-tab')).toHaveCount(before - 1, { timeout: 8_000 })

    // Reopen from the tree — the saved URL (with our marker) comes back.
    await treeOpenNode(window, name)
    await expect(window.getByTestId('url-input')).toHaveValue(new RegExp(marker), { timeout: 10_000 })
  })

  uiTest('F37 a tree click opens a preview tab; double-click pins it', async ({ window }) => {
    const name = `Preview ${uid()}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?preview=1`)
    await saveRequestToTree(window, name)

    // Close everything so the next tree click yields a fresh preview tab.
    let tab = activeTab(window)
    await tab.hover()
    await tab.getByTestId('tab-close').click()

    // Single click on the tree node → italicised PREVIEW tab.
    await treeOpenNode(window, name)
    await expect(activeTab(window)).toHaveAttribute('data-preview', 'true', { timeout: 10_000 })

    // Double-clicking the tab label pins it (Postman behaviour).
    tab = activeTab(window)
    await tab.getByText(name).first().dblclick()
    await expect(activeTab(window)).toHaveAttribute('data-preview', 'false', { timeout: 8_000 })
  })

  uiTest('F38 Save As into a chosen folder persists the folder association', async ({ window }) => {
    const folderName = `Folder ${uid()}`
    const reqName = `InFolder ${uid()}`
    const projectId = await getActiveProjectId(window)
    const folderId = await createFolder(window, projectId, folderName)

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?infolder=1`)
    await saveRequestToFolder(window, reqName, folderName)

    // The saved request must carry the folder_id we picked in the modal.
    const endpoints = (await listEndpointsByProject(window, projectId)) as Array<{
      id: string
      name: string
    }>
    const saved = endpoints.find((e) => e.name === reqName)
    expect(saved?.id).toBeTruthy()
    const detail = (await getEndpoint(window, saved!.id)) as { folder_id?: string | null }
    expect(detail.folder_id).toBe(folderId)
  })
})
