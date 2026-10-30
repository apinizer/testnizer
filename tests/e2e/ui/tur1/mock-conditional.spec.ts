/**
 * MST-162 P1  Mock conditional response (header/query/body)
 * MST-163 P1  Mock response delay + status hot-reload
 * MST-164 P1  Mock logs panel + clear
 * MST-165 P1  Mock + env {{var}} template
 * MST-168 P1  Mock conditional + auth required
 *
 * Does NOT modify 09-mock-deep.spec.ts.
 * Each test creates its own mock server on a random port and stops it in afterEach.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar } from '../../helpers/ui/bootstrap'
import {
  addMockEndpoint,
  addMockResponse,
  createMockServer,
  fillLastResponseCondition,
  getMockEndpointUrl,
  randomMockPort,
  startMockServer,
  stopMockServer,
} from '../../helpers/ui/mock-flow'
import {
  openEnvModal,
  closeEnvModal,
  createEnvironment,
  addVariable,
  setActiveEnvironment,
} from '../../helpers/ui/env'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

/** Helper: hit the mock via IPC and return status. */
async function hitMock(
  page: import('@playwright/test').Page,
  url: string,
  opts: {
    method?: string
    headers?: Array<{ key: string; value: string }>
    body?: string
  } = {},
): Promise<number> {
  return page.evaluate(
    async ({ u, m, h, b }) => {
      const w = window as unknown as Window & {
        api?: {
          request?: {
            send: (p: unknown) => Promise<{ success: boolean; data?: { status?: number } }>
          }
        }
      }
      const res = await w.api?.request?.send({
        method: m ?? 'GET',
        url: u,
        headers: h?.map((hdr, i) => ({ id: `h${i}`, key: hdr.key, value: hdr.value, enabled: true })),
        body: b
          ? { type: 'raw', raw: b, format: 'json' }
          : undefined,
      })
      return res?.data?.status ?? 0
    },
    { u: url, m: opts.method, h: opts.headers, b: opts.body },
  )
}

uiTest.describe('Tur1 — Mock conditional [MST-162..168]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  /**
   * MST-162 — Conditional response by query parameter
   * Two responses on the same endpoint:
   *   response-1: condition = {"type":"query","name":"role","op":"eq","value":"admin"} → 200
   *   response-2: condition = {"type":"always"} → 403
   * Requests with ?role=admin → 200; without → 403.
   */
  uiTest('MST-162 query condition routes to different responses', async ({ window }) => {
    const port = randomMockPort()
    const name = `Cond162-${uid()}`
    await navigateSidebar(window, 'mocks')
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { method: 'GET', path: '/auth' })

    // Response 1: condition = query role eq admin → 200.
    await addMockResponse(window, { status: 200 })
    await fillLastResponseCondition(window, { type: 'query', name: 'role', op: 'eq', value: 'admin' })

    // Response 2: always → 403.
    await addMockResponse(window, { status: 403 })
    await window.waitForTimeout(400)

    await startMockServer(window)
    const baseUrl = await getMockEndpointUrl(window)
    const urlWithRole = baseUrl.includes('?') ? `${baseUrl}&role=admin` : `${baseUrl}?role=admin`

    const adminStatus = await hitMock(window, urlWithRole)
    const anonStatus = await hitMock(window, baseUrl)

    expect(adminStatus).toBe(200)
    expect(anonStatus).toBe(403)
    await stopMockServer(window)
  })

  /**
   * MST-162b — Conditional response by request header
   * Header X-Role: admin → 200; absent → 401.
   */
  uiTest('MST-162b header condition routes to different responses', async ({ window }) => {
    const port = randomMockPort()
    const name = `CondHdr162b-${uid()}`
    await navigateSidebar(window, 'mocks')
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { method: 'GET', path: '/check' })

    // Response 1: condition = header X-Role eq admin → 200.
    await addMockResponse(window, { status: 200 })
    await fillLastResponseCondition(window, { type: 'header', name: 'x-role', op: 'eq', value: 'admin' })

    // Response 2: always → 401.
    await addMockResponse(window, { status: 401 })
    await window.waitForTimeout(400)

    await startMockServer(window)
    const url = await getMockEndpointUrl(window)

    const withHeader = await hitMock(window, url, {
      headers: [{ key: 'x-role', value: 'admin' }],
    })
    const withoutHeader = await hitMock(window, url)

    expect(withHeader).toBe(200)
    expect(withoutHeader).toBe(401)
    await stopMockServer(window)
  })

  /**
   * MST-163 — Response delay
   * A 500 ms delay must make the round-trip take at least 400 ms.
   */
  uiTest('MST-163 response delay input persists and slows responses', async ({ window }) => {
    const port = randomMockPort()
    const name = `Delay163-${uid()}`
    await navigateSidebar(window, 'mocks')
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { method: 'GET', path: '/slow' })
    await addMockResponse(window, { status: 200 })

    const delayInput = window.getByTestId('mock-response-delay')
    await expect(delayInput).toBeVisible({ timeout: 5_000 })
    await delayInput.fill('500')
    await delayInput.blur()
    await window.waitForTimeout(400)
    await startMockServer(window)
    const url = await getMockEndpointUrl(window)

    const before = Date.now()
    const status = await hitMock(window, url)
    const elapsed = Date.now() - before

    expect(status).toBe(200)
    expect(elapsed).toBeGreaterThanOrEqual(400)
    await stopMockServer(window)
  })

  /**
   * MST-163b — Status hot-reload
   * Change the response status code while the server is running and confirm
   * that the next request gets the new status code.
   */
  uiTest('MST-163b status code hot-reload takes effect without restart', async ({ window }) => {
    const port = randomMockPort()
    const name = `HotReload163b-${uid()}`
    await navigateSidebar(window, 'mocks')
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { method: 'GET', path: '/reload' })
    await addMockResponse(window, { status: 200 })
    await startMockServer(window)
    const url = await getMockEndpointUrl(window)

    const s1 = await hitMock(window, url)
    expect(s1).toBe(200)

    // Change status to 204 while running.
    const statusInput = window.getByTestId('mock-response-status')
    await statusInput.fill('204')
    await statusInput.blur()
    await window.waitForTimeout(600)

    const s2 = await hitMock(window, url)
    expect(s2).toBe(204)
    await stopMockServer(window)
  })

  /**
   * MST-164 — Logs panel shows requests and can be cleared
   */
  uiTest('MST-164 logs panel records hits and clears', async ({ window }) => {
    const port = randomMockPort()
    const name = `Logs164-${uid()}`
    await navigateSidebar(window, 'mocks')
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { method: 'GET', path: '/ping' })
    await addMockResponse(window, { status: 200 })
    await startMockServer(window)
    const url = await getMockEndpointUrl(window)

    // Hit the endpoint twice.
    await hitMock(window, url)
    await hitMock(window, url)
    await window.waitForTimeout(500)

    // Switch to the Logs tab.
    const logsTab = window.getByTestId('mock-tab-logs')
    await expect(logsTab).toBeVisible({ timeout: 8_000 })
    await logsTab.click()

    // At least one log row should appear.
    await expect(window.getByText(/\/ping/i).first()).toBeVisible({ timeout: 10_000 })

    // Click Clear and confirm logs disappear.
    await expect(window.getByTestId('mock-log-count')).toContainText(/^[12] /)
    await window.getByRole('button', { name: /^Clear$|^Temizle$/ }).click()
    await expect(window.getByTestId('mock-log-count')).toContainText(/^0 /, { timeout: 5_000 })
    await expect(window.getByTestId('mock-log-row')).toHaveCount(0)
    await stopMockServer(window)
  })

  /**
   * MST-165 — Mock response body with {{envVar}} template substitution
   * Create an env var, set it active, add a mock response whose body contains
   * {{envVar}}, and confirm the response body sent to the client has the
   * resolved value.
   */
  uiTest('MST-165 mock response body resolves {{envVar}} template', async ({ window }) => {
    const tag = uid()
    const envName = `MockEnv165-${tag}`
    const varValue = `resolved-${tag}`
    const port = randomMockPort()
    const name = `EnvMock165-${tag}`

    // Create and activate environment.
    await openEnvModal(window)
    await createEnvironment(window, envName)
    await addVariable(window, { key: 'mockBodyVar', initialValue: varValue, currentValue: varValue })
    await setActiveEnvironment(window)
    await closeEnvModal(window)

    // Create mock server with a body that uses {{mockBodyVar}}.
    await navigateSidebar(window, 'mocks')
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { method: 'GET', path: '/greet' })
    await addMockResponse(window, { status: 200 })

    // Fill the response body Monaco editor with the template.
    // mock-response-body is the wrapper div; find the monaco editor inside it.
    const bodyEditor = window.getByTestId('mock-response-body').locator('.monaco-editor')
    await expect(bodyEditor).toBeVisible({ timeout: 5_000 })
    await bodyEditor.click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.press('Backspace')
    await window.keyboard.insertText(`{"msg":"{{mockBodyVar}}"}`)
    await window.waitForTimeout(500)

    await startMockServer(window)
    const url = await getMockEndpointUrl(window)

    // Fetch the mock response body via IPC.
    const responseBody = await window.evaluate(async (u) => {
      const w = window as unknown as Window & {
        api?: {
          request?: {
            send: (p: unknown) => Promise<{ success: boolean; data?: { status?: number; body?: string } }>
          }
        }
      }
      const res = await w.api?.request?.send({ method: 'GET', url: u })
      return res?.data?.body ?? ''
    }, url)

    expect(responseBody).toContain(varValue)
    expect(responseBody).not.toContain('{{mockBodyVar}}')
    await stopMockServer(window)
  })

  /**
   * MST-168 — Conditional response + auth required
   * Condition: Header Authorization contains "Bearer" → 200; absent → 401.
   */
  uiTest('MST-168 auth header condition returns 401 when missing', async ({ window }) => {
    const port = randomMockPort()
    const name = `Auth168-${uid()}`
    await navigateSidebar(window, 'mocks')
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { method: 'GET', path: '/secure' })

    // Response 1: header Authorization contains "Bearer" → 200.
    await addMockResponse(window, { status: 200 })
    await fillLastResponseCondition(window, { type: 'header', name: 'authorization', op: 'contains', value: 'Bearer' })

    // Response 2: always → 401.
    await addMockResponse(window, { status: 401 })
    await window.waitForTimeout(400)

    await startMockServer(window)
    const url = await getMockEndpointUrl(window)

    const withAuth = await hitMock(window, url, {
      headers: [{ key: 'Authorization', value: 'Bearer test-token' }],
    })
    const withoutAuth = await hitMock(window, url)

    expect(withAuth).toBe(200)
    expect(withoutAuth).toBe(401)
    await stopMockServer(window)
  })
})
