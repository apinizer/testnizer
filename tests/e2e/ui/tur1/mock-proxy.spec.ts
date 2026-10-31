/**
 * MST-169 P1  Mock proxy mode upstream
 *
 * When proxyEnabled is true and no endpoint matches the request,
 * the mock server forwards to proxyTarget (our local http-echo server).
 * The response must match what the upstream returns.
 *
 * Does NOT modify 09-mock-deep.spec.ts.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar } from '../../helpers/ui/bootstrap'
import {
  addMockEndpoint,
  addMockResponse,
  createMockServer,
  randomMockPort,
  startMockServer,
  stopMockServer,
} from '../../helpers/ui/mock-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Mock proxy [MST-169]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  /**
   * MST-169 — Proxy mode upstream
   *
   * Setup:
   *   - Mock server on randomPort, proxyEnabled = true, proxyTarget = http-echo.
   *   - Define GET /known → 202 (matched by mock).
   *   - Request GET /unknown → should proxy to http-echo and return 200 or whatever echo returns.
   */
  uiTest('MST-169 proxy mode forwards unmatched requests to upstream', async ({ window }) => {
    const port = randomMockPort()
    const name = `Proxy169-${uid()}`
    const upstream = `${http()}`

    await navigateSidebar(window, 'mocks')
    await createMockServer(window, name, port)

    // Add a known endpoint.
    await addMockEndpoint(window, { method: 'GET', path: '/known' })
    await addMockResponse(window, { status: 202 })

    // Navigate to Settings tab to enable proxy.
    const settingsTab = window.getByTestId('mock-tab-settings')
    await expect(settingsTab).toBeVisible({ timeout: 8_000 })
    await settingsTab.click()

    // Enable proxy: the checkbox is wrapped in a <label>, so its accessible name
    // is the label text (EN/TR) — no testid needed.
    const proxyCheckbox = window.getByRole('checkbox', {
      name: /Proxy unmatched requests to upstream|Eşleşmeyen istekleri upstream/i,
    })
    await proxyCheckbox.check()
    await expect(proxyCheckbox).toBeChecked()

    // The target input only renders once proxy is enabled.
    const proxyTargetInput = window.getByPlaceholder('https://api.example.com')
    await expect(proxyTargetInput).toBeVisible({ timeout: 5_000 })
    await proxyTargetInput.fill(upstream)
    await proxyTargetInput.blur()
    await window.waitForTimeout(500)

    await startMockServer(window)
    const mockBase = `http://127.0.0.1:${port}`

    // Request the known mock endpoint → 202.
    const knownStatus = await window.evaluate(async (u) => {
      const w = window as unknown as Window & {
        api?: { request?: { send: (p: unknown) => Promise<{ success: boolean; data?: { status?: number } }> } }
      }
      const res = await w.api?.request?.send({ method: 'GET', url: u })
      return res?.data?.status ?? 0
    }, `${mockBase}/known`)
    expect(knownStatus).toBe(202)

    // Request an unknown path — proxied to http-echo /get → 200.
    const proxiedStatus = await window.evaluate(async (u) => {
      const w = window as unknown as Window & {
        api?: { request?: { send: (p: unknown) => Promise<{ success: boolean; data?: { status?: number } }> } }
      }
      const res = await w.api?.request?.send({ method: 'GET', url: u })
      return res?.data?.status ?? 0
    }, `${mockBase}/get?proxy=169`)
    // The echo server returns 200 for GET /get.
    expect(proxiedStatus).toBe(200)

    await stopMockServer(window)
  })
})
