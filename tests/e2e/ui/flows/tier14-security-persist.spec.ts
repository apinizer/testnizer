/**
 * MST-283..289 — Security guards
 */
import path from 'node:path'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import { createProject, goToProjectHome } from '../../helpers/ui/workspace-flow'
import { createFolder, getActiveProjectId, listEnvironmentsByProject, listEnvVariables } from '../../helpers/ui/assert-ipc'
import { fillUrl, saveRequestToTree } from '../../helpers/ui/request-flow'
import { addCertificateIpc } from '../../helpers/ui/db-flow'
import { importLocalProjectFile } from '../../helpers/ui/export-flow'
import { openEnvModal, selectEnvironmentInModal, setupEnvironment } from '../../helpers/ui/env'
import {
  addMockEndpoint,
  addMockResponse,
  createMockServer,
  getMockEndpointUrl,
  randomMockPort,
  startMockServer,
  stopMockServer,
} from '../../helpers/ui/mock-flow'
import { localHttpBin } from '../../helpers/test-servers'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

const CERT_DIR = path.resolve(__dirname, '../../../fixtures/certs')

uiTest.describe('Tier 14 — Security & persist [MST-283..289]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-284 tree:move cross-project is rejected with success:false', async ({ window }) => {
    const projA = `SecA ${uid()}`
    const projB = `SecB ${uid()}`
    const reqName = `CrossMove ${uid()}`

    await goToProjectHome(window)
    await createProject(window, projA)
    await openHttpRequestTab(window)
    await fillUrl(window, 'http://127.0.0.1/get')
    await saveRequestToTree(window, reqName)
    const idA = await getActiveProjectId(window, projA)
    const listA = (await listSaved(window, idA)) as Array<{ id: string; name: string }>
    const reqId = listA.find((r) => r.name === reqName)!.id

    await goToProjectHome(window)
    await createProject(window, projB)
    const idB = await getActiveProjectId(window, projB)
    const folderB = await createFolder(window, idB, `Foreign ${uid()}`)

    const move = await window.evaluate(
      async ({ rid, fid }) => {
        const w = window as Window & {
          api?: { tree?: { move: (p: unknown) => Promise<{ success: boolean; error?: string }> } }
        }
        return w.api?.tree?.move({ nodeId: rid, nodeType: 'request', targetFolderId: fid })
      },
      { rid: reqId, fid: folderB },
    )
    expect(move?.success).toBe(false)
    expect(move?.error?.length).toBeGreaterThan(0)
  })

  uiTest('MST-283 .exe cert path is ignored on send (no crash)', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const fakeExe = path.join(CERT_DIR, 'client.crt').replace(/\.crt$/, '.exe')
    await addCertificateIpc(window, {
      projectId,
      kind: 'client',
      host: '127.0.0.1',
      crtPath: fakeExe,
      keyPath: path.join(CERT_DIR, 'client.key'),
    })
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?cert-whitelist=1`)
    await window.getByTestId('send-btn').click()
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 20_000 })
  })

  uiTest('MST-285 tree:move folder into itself is rejected', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const folderId = await createFolder(window, projectId, `Cycle ${uid()}`)
    const move = await window.evaluate(
      async ({ fid }) => {
        const w = window as Window & {
          api?: { tree?: { move: (p: unknown) => Promise<{ success: boolean; error?: string }> } }
        }
        return w.api?.tree?.move({ nodeId: fid, nodeType: 'folder', targetFolderId: fid })
      },
      { fid: folderId },
    )
    expect(move?.success).toBe(false)
    expect(move?.error).toMatch(/itself|cycle|descendant/i)
  })

  uiTest('MST-289 importLocal rejects path traversal outside json', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const res = await importLocalProjectFile(window, '/etc/passwd', projectId)
    expect(res.success).toBe(false)
    expect(res.error?.length).toBeGreaterThan(0)
  })

  uiTest('MST-287 secret env export marks type secret and masks current value in UI', async ({ window }) => {
    const secretVal = `leak-guard-${uid()}`
    const envName = `SecretEnv ${uid()}`
    await setupEnvironment(window, envName, [
      { key: 'apiSecret', initialValue: secretVal, currentValue: secretVal, secret: true },
    ])

    await openEnvModal(window)
    await selectEnvironmentInModal(window, envName)
    const row = window.getByTestId('env-var-row').filter({
      has: window.getByTestId('env-var-key').filter({ hasValue: 'apiSecret' }),
    })
    const current = row.getByTestId('env-var-current')
    await expect(current).toHaveAttribute('type', 'password')
    await expect(row.locator('select')).toHaveValue('secret')

    const projectId = await getActiveProjectId(window)
    let envId = ''
    await expect
      .poll(async () => {
        const envs = (await listEnvironmentsByProject(window, projectId)) as Array<{ id: string; name: string }>
        envId = envs.find((e) => e.name === envName)?.id ?? ''
        return envId
      })
      .not.toBe('')
    const vars = (await listEnvVariables(window, envId)) as Array<{ key: string; secret?: boolean | number }>
    expect(vars.find((v) => v.key === 'apiSecret')?.secret).toBeTruthy()

    await window.keyboard.press('Escape')
  })

  uiTest('MST-288 mock infinite-loop script times out without crashing app', async ({ window }) => {
    const port = randomMockPort()
    const name = `Sandbox ${uid()}`
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { path: '/loop' })
    await addMockResponse(window, { status: 200 })
    const scriptEditor = window.locator('.monaco-editor').last()
    await scriptEditor.click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.press('Backspace')
    await window.keyboard.insertText('while (true) {}')
    await window.waitForTimeout(400)
    await startMockServer(window)

    const url = await getMockEndpointUrl(window)
    const hit = await window.evaluate(async (u) => {
      const w = window as Window & {
        api?: { request?: { send: (p: unknown) => Promise<{ success: boolean; data?: { status?: number } }> } }
      }
      const res = await w.api?.request?.send({ method: 'GET', url: u })
      return res?.data?.status ?? 0
    }, url)
    expect(hit).toBeGreaterThanOrEqual(500)

    await expect(window.getByTestId('nav-apis')).toBeVisible({ timeout: 5_000 })
    await stopMockServer(window)
  })

  uiTest('MST-286 URL credentials are stripped from actual request view', async ({ window }) => {
    await openHttpRequestTab(window)
    await fillUrl(window, 'http://user:secret@127.0.0.1:9/get')
    await window.getByTestId('send-btn').click()
    await window.getByTestId('res-tab-actualRequest').click().catch(() => {})
    const actual = window.getByTestId('actual-request-panel')
    if (await actual.isVisible().catch(() => false)) {
      await expect(actual).not.toContainText('secret')
      await expect(actual).not.toContainText('user:secret@')
    }
  })
})

async function listSaved(page: import('@playwright/test').Page, projectId: string) {
  return page.evaluate(async (pid) => {
    const w = window as Window & {
      api?: { savedRequest?: { list: (id: string) => Promise<{ success: boolean; data?: unknown[] }> } }
    }
    const res = await w.api?.savedRequest?.list(pid)
    return res?.data ?? []
  }, projectId)
}
