import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  E2E_PROJECT_NAME,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import {
  treeAddFolder,
  treeContextAction,
  treeRename,
  treeSearch,
} from '../../helpers/ui/tree'
import { importCurlCommand, importFromFile } from '../../helpers/ui/import-flow'
import { listEndpointsByProject, getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'
import { pressModShortcut } from '../../helpers/ui/keyboard'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 5 — Tree & Import journeys', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('F14 tree CRUD: folder, request, rename, duplicate, delete', async ({ window }) => {
    const folder = `Flow Folder ${uid()}`
    const request = `Flow Request ${uid()}`
    const renamed = `${request} Renamed`

    await treeAddFolder(window, E2E_PROJECT_NAME)
    await treeRename(window, 'New Folder', folder)
    await expect(window.getByTestId('tree-node').filter({ hasText: folder })).toBeVisible({
      timeout: 10_000,
    })

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?tree=1`)
    await saveRequestToTree(window, request)
    const projectId = await getActiveProjectId(window)
    await expect
      .poll(async () => {
        const items = (await listEndpointsByProject(window, projectId)) as Array<{ name: string }>
        return items.some((r) => r.name === request)
      })
      .toBe(true)
    await treeSearch(window, request)
    await expect(window.getByTestId('tree-node').filter({ hasText: request }).first()).toBeVisible({
      timeout: 15_000,
    })

    await treeRename(window, request, renamed)
    await treeContextAction(window, renamed, /Duplicate/i)
    await treeSearch(window, renamed)
    expect(await window.getByTestId('tree-node').filter({ hasText: renamed }).count()).toBeGreaterThanOrEqual(1)

    const saved = (await listEndpointsByProject(window, projectId)) as Array<{ name: string }>
    expect(saved.length).toBeGreaterThan(0)
  })

  uiTest('F15 import cURL fills tab and OpenAPI populates tree', async ({ window }) => {
    const folderName = `cURL ${uid()}`
    const curl = `curl -X GET '${http()}/get?curl=1' -H 'X-Flow: yes'`
    await importCurlCommand(window, curl, folderName)
    await treeSearch(window, 'GET')
    await window.getByTestId('tree-node').filter({ hasText: /GET/i }).first().click()
    await expect(window.getByTestId('url-input')).toHaveValue(/\/get/, { timeout: 10_000 })
    await fillUrl(window, `${http()}/get?curl=1`)
    await sendAndWaitResponse(window)
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })

    await importFromFile(window, /OpenAPI \/ Swagger/i, 'openapi-3.0.json', `OpenAPI ${uid()}`)
    await expect(window.getByTestId('tree-node').first()).toBeVisible({ timeout: 20_000 })
  })

  uiTest('F16 export project and code generator snippet', async ({ window }) => {
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?codegen=1`)
    await sendAndWaitResponse(window)
    await window.getByTestId('response-code-btn').click()
    await expect(window.getByText('Generate Code')).toBeVisible({ timeout: 8_000 })
    await expect(window.locator('.monaco-editor').last()).toContainText(/curl/i, { timeout: 8_000 })

    await pressModShortcut(window, 's', { shift: true })
    await expect(window.getByTestId('save-modal')).toBeVisible({ timeout: 8_000 })
    await window.keyboard.press('Escape')
  })
})
