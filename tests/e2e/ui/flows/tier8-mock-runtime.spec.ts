/**
 * MST-160 — Mock create/start/stop lifecycle
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  addMockEndpoint,
  addMockResponse,
  createMockServer,
  getMockEndpointUrl,
  randomMockPort,
  startMockServer,
  stopMockServer,
} from '../../helpers/ui/mock-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 8 — Mock runtime [MST-160]', () => {
  uiTest('MST-160 mock server start → HTTP hit → stop lifecycle', async ({ window }) => {
    const port = randomMockPort()
    const name = `Lifecycle ${uid()}`
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { path: '/ping' })
    await addMockResponse(window, { status: 200 })
    await startMockServer(window)
    await expect(window.getByTestId('mock-status')).toContainText(/running/i)

    const url = await getMockEndpointUrl(window)
    const status = await window.evaluate(async (u) => {
      const w = window as Window & {
        api?: { request?: { send: (p: unknown) => Promise<{ success: boolean; data?: { status?: number } }> } }
      }
      const res = await w.api?.request?.send({ method: 'GET', url: u })
      return res?.data?.status
    }, url)
    expect(status).toBe(200)

    await stopMockServer(window)
    await expect(window.getByTestId('mock-status')).not.toContainText(/running/i)
  })
})
