/**
 * MST-161 — Mock rule matching (method + path + priority)
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

uiTest.describe('Tur1 — Mock deep [MST-161]', () => {
  uiTest('MST-161 GET and POST rules return distinct status codes', async ({ window }) => {
    const port = randomMockPort()
    const name = `MockRules ${uid()}`
    await createMockServer(window, name, port)
    await addMockEndpoint(window, { method: 'GET', path: '/items' })
    await addMockResponse(window, { status: 200 })
    await addMockEndpoint(window, { method: 'POST', path: '/items' })
    await addMockResponse(window, { status: 201 })
    await startMockServer(window)

    const getUrl = await getMockEndpointUrl(window)
    const hit = await window.evaluate(async (url) => {
      const w = window as unknown as Window & {
        api?: { request?: { send: (p: unknown) => Promise<{ success: boolean; data?: { status?: number } }> } }
      }
      const getRes = await w.api?.request?.send({ method: 'GET', url })
      const postRes = await w.api?.request?.send({
        method: 'POST',
        url,
        body: { type: 'raw', raw: '{}', format: 'json' },
        headers: [{ id: '1', key: 'Content-Type', value: 'application/json', enabled: true }],
      })
      return { get: getRes?.data?.status, post: postRes?.data?.status }
    }, getUrl)
    expect(hit.get).toBe(200)
    expect(hit.post).toBe(201)
    await stopMockServer(window)
  })
})
