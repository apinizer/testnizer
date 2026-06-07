import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  E2E_PROJECT_NAME,
  ensureCanonicalProject,
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
import { importCurlCommand, importFixtureViaIpc } from '../../helpers/ui/import-flow'
import { listEndpointsByProject, getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'
import { pressModShortcut } from '../../helpers/ui/keyboard'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 5 — Tree & Import journeys', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
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

    await importFixtureViaIpc(window, 'openapi', 'openapi-3.0.json', `OpenAPI ${uid()}`)
    await expect(window.getByTestId('tree-node').first()).toBeVisible({ timeout: 20_000 })

    await importFixtureViaIpc(window, 'postman', 'postman-v2.1.json', `Postman ${uid()}`)
    await treeSearch(window, 'Get user by id')
    await expect(window.getByTestId('tree-node').filter({ hasText: /Get user by id/i }).first()).toBeVisible({
      timeout: 15_000,
    })

    await importFixtureViaIpc(window, 'insomnia', 'insomnia-v4.json', `Insomnia ${uid()}`)
    await treeSearch(window, 'Get user by id')
    expect(await window.getByTestId('tree-node').filter({ hasText: /Get user by id/i }).count()).toBeGreaterThanOrEqual(1)

    await importFixtureViaIpc(window, 'har', 'sample.har', `HAR ${uid()}`)
    await expect(window.getByTestId('tree-node').first()).toBeVisible({ timeout: 15_000 })

    await importFixtureViaIpc(window, 'wsdl', 'sample.wsdl', `WSDL ${uid()}`)
    await treeSearch(window, 'Add')
    await expect(window.getByTestId('tree-node').filter({ hasText: /Add/i }).first()).toBeVisible({
      timeout: 20_000,
    })
  })

  uiTest('F16 export project and code generator snippet', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await expect(window.getByTestId('url-input')).toBeVisible({ timeout: 8_000 })
    await fillUrl(window, `${http()}/get?codegen=1`)
    await expect(window.getByTestId('url-input')).toHaveValue(/codegen=1/)
    await sendAndWaitResponse(window)
    await window.getByTestId('response-code-btn').click()
    await expect(window.getByRole('heading', { name: 'Generate Code' })).toBeVisible({
      timeout: 8_000,
    })
    await expect(window.locator('.monaco-editor').last()).toContainText(/curl/i, { timeout: 8_000 })

    await window.getByRole('button', { name: 'JavaScript (fetch)' }).click()
    await expect(window.locator('.monaco-editor').last()).toContainText(/fetch/i, { timeout: 8_000 })

    await window.getByRole('button', { name: 'Python' }).click()
    await expect(window.locator('.monaco-editor').last()).toContainText(/requests/i, { timeout: 8_000 })
    await window.keyboard.press('Escape')

    const projectId = await getActiveProjectId(window)
    const exported = await window.evaluate(async (pid) => {
      const w = window as unknown as Window & {
        api?: { importExport?: { exportPostman: (id: string) => Promise<{ success: boolean; data?: unknown }> } }
      }
      return w.api?.importExport?.exportPostman(pid)
    }, projectId)
    expect(exported?.success).toBe(true)
    expect(JSON.stringify(exported?.data ?? '')).toMatch(/info|collection/i)

    await pressModShortcut(window, 's', { shift: true })
    await expect(window.getByTestId('save-modal')).toBeVisible({ timeout: 8_000 })
    await window.keyboard.press('Escape')
  })
})
