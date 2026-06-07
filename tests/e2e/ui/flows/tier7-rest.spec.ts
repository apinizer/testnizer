import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  bootstrapWorkbench,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openCommandPalette,
  openHttpRequestTab,
  openNewDropdownItem,
  waitForApiBridge,
} from '../../helpers/ui/bootstrap'
import { switchToDefaultBranch } from '../../helpers/ui/branch-flow'
import { fillUrl, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import { TOOL_NAMES } from '../../helpers/ui/inventory'
import { assertToolFunctional } from '../../helpers/ui/tools-flow'
import { getTestServerUrls } from '../../helpers/test-servers'
import { pressModShortcut } from '../../helpers/ui/keyboard'
import { localHttpBin } from '../../helpers/test-servers'
import { assertJsonField, sendViaIpc } from '../../helpers/ui/assert-ipc'
import {
  addMockEndpoint,
  addMockResponse,
  createMockServer,
  getMockEndpointUrl,
  randomMockPort,
  startMockServer,
  stopMockServer,
} from '../../helpers/ui/mock-flow'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 7 — Mock, Tools, AI, History, Settings, Git', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  // F29 creates + switches to a feature branch; restore the default branch so it
  // doesn't hide the canonical tree from later specs sharing this worker window.
  uiTest.afterEach(async ({ window }) => {
    await switchToDefaultBranch(window).catch(() => {})
  })

  uiTest('F24 mock server serves the configured response over HTTP', async ({ window }) => {
    const mockName = `Flow Mock ${uid()}`
    const port = randomMockPort()
    const mockPath = `/flow-${Math.random().toString(36).slice(2, 7)}`

    await createMockServer(window, mockName, port)
    await addMockEndpoint(window, { path: mockPath, method: 'GET' })
    await addMockResponse(window, { status: 201 })
    await startMockServer(window)

    // Hit the live mock through the app's own HTTP engine and prove it returns
    // the rule we configured (custom 201 + default {"ok":true} body) — not just
    // that an editor opened.
    const url = await getMockEndpointUrl(window)
    expect(url).toContain(`:${port}${mockPath}`)
    const res = await sendViaIpc(window, { method: 'GET', url })
    expect(res.status).toBe(201)
    assertJsonField(res, 'ok', true)

    await stopMockServer(window)
  })

  uiTest('F25 tools functional outputs', async ({ window }) => {
    for (const toolName of TOOL_NAMES) {
      await assertToolFunctional(window, toolName)
    }
  })

  uiTest('F26 AI chat fake LLM stream reply', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    const { llm } = getTestServerUrls()
    await openNewDropdownItem(window, /AI Chat/i)
    await window
      .getByPlaceholder(/chat completions|Endpoint URL|https:\/\/\.\.\./i)
      .fill(`${llm}/v1/chat/completions`)
    await window.getByPlaceholder('sk-...').fill('e2e-test-key')
    await window.getByPlaceholder(/Ask anything/i).fill('Say hello Flow E2E')
    await window.getByRole('button', { name: /^Send$|^Gönder$/i }).click()
    await expect(window.getByText(/E2E stub reply|hello Flow E2E/i).first()).toBeVisible({ timeout: 20_000 })
  })

  uiTest('F27 history restore repopulates the exact request and resends', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    const marker = `hist-${Math.random().toString(36).slice(2, 8)}`
    const url = `${http()}/get?history=${marker}`
    await fillUrl(window, url)
    await sendAndWaitResponse(window)

    // The entry we just sent is the newest; restoring it must bring back the
    // exact URL — not just "a" GET request. (The list shows host+path only, so
    // we target the newest row and verify the restored URL carries our marker.)
    await navigateSidebar(window, 'history')
    await window.getByTestId('history-entry').first().click()
    await expect(window.getByTestId('url-input')).toHaveValue(new RegExp(marker), { timeout: 8_000 })

    // Resending the restored request round-trips the same marker back.
    await sendAndWaitResponse(window)
    await window.getByTestId('res-tab-body').click()
    await expect(window.getByText(new RegExp(marker)).first()).toBeVisible({ timeout: 10_000 })
  })

  uiTest('F28 theme setting persists across a full window reload', async ({ window }) => {
    await dismissOverlays(window)
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Switch theme: Dark|Tema: Koyu/i }).click()
    await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 8_000 })

    // Reload the renderer entirely; theme must be rehydrated from persisted
    // settings (electron-store), proving it was actually saved — not just held
    // in session memory.
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    await waitForApiBridge(window)
    await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 15_000 })

    // Restore the shared worker window to a clean baseline for later tests.
    await bootstrapWorkbench(window)
    await dismissOverlays(window)
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Switch theme: Light|Tema: Açık/i }).click()
    await expect(window.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 8_000 })
  })

  uiTest('F29 git branch create and switch', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await window.getByTestId('branch-pill').click()
    await window.getByTestId('branch-new').click()
    const branchName = `flow-${uid()}`
    await window.getByPlaceholder(/New branch from/i).fill(branchName)
    await window.getByRole('button', { name: /^OK$/i }).click()
    await expect(window.getByTestId('branch-pill')).toContainText(branchName, { timeout: 15_000 })
  })
})
