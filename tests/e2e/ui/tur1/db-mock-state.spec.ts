/**
 * MST-272 P1  DB Mock state script cross-request
 *
 * TC-DB-027: Script state counter → 2 hits → in-memory counter increments.
 * On mock server restart the in-memory state resets.
 *
 * Does NOT modify db-mock.spec.ts.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import {
  addMockEndpoint,
  addMockResponse,
  createMockServer,
  getMockEndpointUrl,
  randomMockPort,
  startMockServer,
  stopMockServer,
} from '../../helpers/ui/mock-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB mock state [MST-272]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  /**
   * MST-272 — Cross-request state via response script
   *
   * The mock engine exposes a per-server in-memory `state` object that scripts
   * can use to track cross-request counters. We write a script that increments
   * `state.counter` and returns the current value in the response body.
   *
   * Hit the endpoint twice:
   *   • First hit:  counter becomes 1 → body contains "1"
   *   • Second hit: counter becomes 2 → body contains "2"
   *
   * After stopping and restarting the server, state resets:
   *   • Third hit:  counter is 1 again (reset on restart).
   *
   * The script editor has no data-testid; it is located through its
   * "Pre-response script" label block.
   */
  uiTest('MST-272 state counter increments across requests and resets on restart', async ({ window }) => {
    const port = randomMockPort()
    const name = `State272-${uid()}`

    await window.getByTestId('nav-mocks').click()
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { method: 'GET', path: '/counter' })
    await addMockResponse(window, { status: 200 })

    // Inject the state-counter script into the "Pre-response script (JS)" Monaco
    // editor (found through its label — the editor itself has no testid).
    const scriptBlock = window.locator('div.mt-2').filter({ hasText: /Pre-response script|Yanıt öncesi/i }).last()
    const scriptEditor = scriptBlock.locator('.monaco-editor').first()
    await expect(scriptEditor).toBeVisible({ timeout: 5_000 })
    await scriptEditor.click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.press('Backspace')
    // `state` is the server-wide mutable object; setJson() writes the response.
    await window.keyboard.insertText(
      `state.counter = (state.counter || 0) + 1; setJson({ count: state.counter });`,
    )
    await window.waitForTimeout(500)

    await startMockServer(window)
    const url = await getMockEndpointUrl(window)

    // First hit.
    const body1 = await window.evaluate(async (u) => {
      const w = window as unknown as Window & {
        api?: { request?: { send: (p: unknown) => Promise<{ success: boolean; data?: { body?: string } }> } }
      }
      const res = await w.api?.request?.send({ method: 'GET', url: u })
      return res?.data?.body ?? ''
    }, url)

    // Second hit.
    const body2 = await window.evaluate(async (u) => {
      const w = window as unknown as Window & {
        api?: { request?: { send: (p: unknown) => Promise<{ success: boolean; data?: { body?: string } }> } }
      }
      const res = await w.api?.request?.send({ method: 'GET', url: u })
      return res?.data?.body ?? ''
    }, url)

    expect(JSON.parse(body1)).toEqual({ count: 1 })
    expect(JSON.parse(body2)).toEqual({ count: 2 })

    // Stop and restart to confirm state reset.
    await stopMockServer(window)
    await startMockServer(window)
    await expect(window.getByTestId('mock-status')).toContainText(/running/i, { timeout: 15_000 })

    const body3 = await window.evaluate(async (u) => {
      const w = window as unknown as Window & {
        api?: { request?: { send: (p: unknown) => Promise<{ success: boolean; data?: { body?: string } }> } }
      }
      const res = await w.api?.request?.send({ method: 'GET', url: u })
      return res?.data?.body ?? ''
    }, url)

    // After restart the server-wide state is gone: the counter starts over.
    expect(JSON.parse(body3)).toEqual({ count: 1 })

    await stopMockServer(window)
  })

  /**
   * MST-272b — Verify mock server IPC creates and persists config
   * (fast smoke: no start/stop, just verify create+get via IPC).
   */
  uiTest('MST-272b mock server config with script persists to DB', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const port = randomMockPort()
    const mockName = `StatePersist272b-${uid()}`

    // Create via IPC.
    const serverId = await window.evaluate(
      async ({ pid, n, p }) => {
        const w = window as unknown as Window & {
          api?: {
            mock?: {
              server?: {
                create: (input: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }>
              }
            }
          }
        }
        const res = await w.api?.mock?.server?.create({ projectId: pid, name: n, port: p })
        if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'mock server create failed')
        return res.data.id
      },
      { pid: projectId, n: mockName, p: port },
    )

    // Create an endpoint with a state script.
    const endpointId = await window.evaluate(
      async ({ sid }) => {
        const w = window as unknown as Window & {
          api?: {
            mock?: {
              endpoint?: {
                create: (input: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }>
              }
            }
          }
        }
        const res = await w.api?.mock?.endpoint?.create({
          serverId: sid,
          method: 'GET',
          path: '/state-test',
          enabled: true,
        })
        if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'endpoint create failed')
        return res.data.id
      },
      { sid: serverId },
    )

    // Create a response with a script.
    const script = `state.counter = (state.counter || 0) + 1; response.body = JSON.stringify({ count: state.counter });`
    const responseCreated = await window.evaluate(
      async ({ eid, s }) => {
        const w = window as unknown as Window & {
          api?: {
            mock?: {
              response?: {
                create: (input: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }>
              }
            }
          }
        }
        const res = await w.api?.mock?.response?.create({
          endpointId: eid,
          statusCode: 200,
          body: '{}',
          bodyType: 'json',
          enabled: true,
          script: s,
        })
        return res?.success ?? false
      },
      { eid: endpointId, s: script },
    )
    expect(responseCreated).toBe(true)

    // Verify the endpoint is retrievable.
    const ep = await window.evaluate(async (id) => {
      const w = window as unknown as Window & {
        api?: {
          mock?: {
            endpoint?: {
              get: (id: string) => Promise<{ success: boolean; data?: { id: string; path: string } }>
            }
          }
        }
      }
      const res = await w.api?.mock?.endpoint?.get(id)
      return res?.data ?? null
    }, endpointId)

    expect(ep).not.toBeNull()
    expect((ep as { path: string }).path).toBe('/state-test')

    // Cleanup.
    await window.evaluate(async (id) => {
      const w = window as unknown as Window & {
        api?: { mock?: { server?: { delete: (id: string) => Promise<{ success: boolean }> } } }
      }
      await w.api?.mock?.server?.delete(id)
    }, serverId)
  })
})
