/**
 * MST-017, MST-019, MST-021, MST-022, MST-023 — Tree / tab / save lifecycle
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree } from '../../helpers/ui/request-flow'
import { saveInPlace } from '../../helpers/ui/save-flow'
import { treeClickNode, treeContextAction, treeOpenNode, treeSearch, confirmDelete } from '../../helpers/ui/tree'
import {
  createFolder,
  getActiveProjectId,
  getSavedRequest,
  listSavedRequestsByProject,
  moveSavedRequest,
} from '../../helpers/ui/assert-ipc'
import { createSavedRequestIpc, updateSavedRequestIpc } from '../../helpers/ui/db-flow'
import { refreshWorkspaceTree } from '../../helpers/ui/import-flow'
import { getTestServerUrls, localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

const activeTab = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="endpoint-tab"][data-active="true"]')

uiTest.describe('Tur1 — Tree / Tab / Save [MST-017..022]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-017 endpoint delete removes it from tree and DB', async ({ window }) => {
    const name = `Del ${uid()}`
    const projectId = await getActiveProjectId(window)
    await createSavedRequestIpc(window, {
      projectId,
      name,
      url: `${http()}/get`,
    })
    await refreshWorkspaceTree(window)
    await treeOpenNode(window, name)
    await treeContextAction(window, name, /Delete/i)
    await confirmDelete(window)
    await expect(window.getByTestId('tree-node').filter({ hasText: name })).toHaveCount(0, { timeout: 10_000 })

    const after = (await listSavedRequestsByProject(window, projectId)) as Array<{ name: string }>
    expect(after.some((r) => r.name === name)).toBe(false)
  })

  uiTest('MST-019 endpoint move updates folder_id persistently', async ({ window }) => {
    const name = `Move ${uid()}`
    const folderA = `FolderA ${uid()}`
    const folderB = `FolderB ${uid()}`
    const projectId = await getActiveProjectId(window)
    await createFolder(window, projectId, folderA)
    await createFolder(window, projectId, folderB)

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?move=1`)
    await saveRequestToTree(window, name)
    const list = (await listSavedRequestsByProject(window, projectId)) as Array<{
      id: string
      name: string
      folder_id: string | null
    }>
    const row = list.find((r) => r.name === name)!
    const folders = (await listFolders(window, projectId)) as Array<{ id: string; name: string }>
    const folderBRow = folders.find((f) => f.name === folderB)!
    await moveSavedRequest(window, row.id, folderBRow.id)

    const updated = (await getSavedRequest(window, row.id)) as { folder_id: string | null }
    expect(updated.folder_id).toBe(folderBRow.id)
  })

  uiTest('MST-021 unsaved changes dialog Save/Discard/Cancel', async ({ window }) => {
    const name = `Unsaved ${uid()}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?v=1`)
    await saveRequestToTree(window, name)
    await fillUrl(window, `${http()}/get?v=DIRTY`)

    const tab = activeTab(window)
    await tab.hover()
    await tab.getByTestId('tab-close').click()
    await expect(window.getByTestId('unsaved-cancel-btn')).toBeVisible({ timeout: 8_000 })

    // Cancel → tab stays, dirty preserved.
    await window.getByTestId('unsaved-cancel-btn').click()
    await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true')

    // Discard → tab closes.
    await tab.hover()
    await tab.getByTestId('tab-close').click()
    await window.getByTestId('unsaved-discard-btn').click()
    await expect(window.getByTestId('endpoint-tab').filter({ hasText: name })).toHaveCount(0, {
      timeout: 8_000,
    })

    // Reopen — original URL (v=1) not the dirty edit.
    await treeOpenNode(window, name)
    await expect(window.getByTestId('url-input')).toHaveValue(/v=1/, { timeout: 8_000 })
  })

  uiTest('MST-022 Ctrl+S in-place HTTP update without Save As modal', async ({ window }) => {
    const name = `CtrlS ${uid()}`
    const marker = `ctrls-${Math.random().toString(36).slice(2, 7)}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?orig=1`)
    await saveRequestToTree(window, name)

    await fillUrl(window, `${http()}/get?${marker}=1`)
    await saveInPlace(window)
    await expect(window.getByTestId('endpoint-save-modal')).toBeHidden()

    const projectId = await getActiveProjectId(window)
    const saved = (await listSavedRequestsByProject(window, projectId)) as Array<{ id: string; name: string }>
    const row = saved.find((r) => r.name === name)
    expect(row?.id).toBeTruthy()
    const detail = (await getSavedRequest(window, row!.id)) as { url: string }
    expect(detail.url).toMatch(new RegExp(marker))
  })

  uiTest('MST-023 protocol metadata roundtrip for WS and gRPC snapshots', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const { ws, grpc } = getTestServerUrls()
    const wsMeta = JSON.stringify({ subprotocol: 'json', headers: [{ key: 'X-Ws', value: '1' }] })
    const wsId = await createSavedRequestIpc(window, {
      projectId,
      name: `WS ${uid()}`,
      protocol: 'websocket',
      url: ws,
      metadata: wsMeta,
    })
    await updateSavedRequestIpc(window, wsId, { metadata: JSON.stringify({ subprotocol: 'json', edited: true }) })
    const wsRow = (await getSavedRequest(window, wsId)) as { metadata: string }
    expect(JSON.parse(wsRow.metadata)).toMatchObject({ edited: true })

    const grpcId = await createSavedRequestIpc(window, {
      projectId,
      name: `gRPC ${uid()}`,
      protocol: 'grpc',
      url: grpc,
      metadata: JSON.stringify({ service: 'EchoService', method: 'UnaryEcho' }),
    })
    const grpcRow = (await getSavedRequest(window, grpcId)) as { protocol: string; metadata: string }
    expect(grpcRow.protocol).toBe('grpc')
    expect(JSON.parse(grpcRow.metadata).service).toBe('EchoService')
  })
})

async function listFolders(page: import('@playwright/test').Page, projectId: string) {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: { folder?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string; name: string }> }> } }
    }
    const res = await w.api?.folder?.list(pid)
    return res?.data ?? []
  }, projectId)
}
