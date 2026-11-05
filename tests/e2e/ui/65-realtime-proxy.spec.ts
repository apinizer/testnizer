/**
 * WebSocket, Socket.IO, MQTT and SSE through a real CONNECT proxy, set in the app
 * Settings. The proxy here only tunnels, so what reaches the local servers has come
 * through it; a proxy that never answers has to leave Cancel working. The GraphQL
 * case is in `62-graphql-subscription.spec.ts`.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../helpers/ui/bootstrap'
import { getTestServerUrls } from '../helpers/test-servers'
import { startConnectProxy, type ConnectProxy } from '../../helpers/connect-proxy'

type SettingsApi = {
  settings: {
    get: (k: string) => Promise<{ data?: unknown }>
    set: (k: string, v: unknown) => Promise<unknown>
  }
}

async function appProxy(window: Page): Promise<unknown> {
  return window.evaluate(async () => {
    const { api } = window as unknown as { api: SettingsApi }
    return (await api.settings.get('proxy')).data
  })
}

async function setAppProxy(window: Page, value: unknown): Promise<void> {
  await window.evaluate(async (v) => {
    const { api } = window as unknown as { api: SettingsApi }
    await api.settings.set('proxy', v)
  }, value)
}

const AUTH = { username: 'e2e-user', password: 'e2e-proxy-pass' }
const BASIC = `Basic ${Buffer.from(`${AUTH.username}:${AUTH.password}`).toString('base64')}`

uiTest.describe('The proxy setting on realtime connections', () => {
  let proxy: ConnectProxy
  let saved: unknown

  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
    proxy = await startConnectProxy()
    saved = await appProxy(window)
    await setAppProxy(window, proxy.setting(AUTH))
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
    await setAppProxy(window, saved ?? { mode: 'system' })
    await proxy.close()
  })

  function expectTunnelTo(url: string): void {
    const { host } = new URL(url)
    expect(proxy.connects.length).toBeGreaterThan(0)
    for (const seen of proxy.connects) {
      expect(seen.target).toBe(host)
      expect(seen.authorization).toBe(BASIC)
    }
  }

  uiTest('WebSocket connects through it', async ({ window }) => {
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
    expectTunnelTo(ws)
    await window.getByTestId('ws-disconnect').click()
    await expect(window.getByTestId('ws-connect')).toBeVisible()
  })

  uiTest('Socket.IO connects through it', async ({ window }) => {
    const { socketio } = getTestServerUrls()
    await openNewDropdownItem(window, /Socket\.IO/i)
    await window.getByTestId('socketio-url').fill(socketio)
    await window.getByTestId('socketio-connect').click()
    await expect(window.getByTestId('socketio-emit')).toBeEnabled({ timeout: 15_000 })
    expectTunnelTo(socketio)
  })

  uiTest('MQTT connects through it', async ({ window }) => {
    const { mqtt } = getTestServerUrls()
    // A broker that never started is a skip locally, a failure on CI (silent green otherwise).
    if (!mqtt && process.env.CI) throw new Error('MQTT test broker did not start on CI')
    uiTest.skip(!mqtt, 'The MQTT broker did not start')
    await openNewDropdownItem(window, /MQTT/)
    await window.getByTestId('mqtt-url').fill(mqtt ?? '')
    await window.getByTestId('mqtt-version').selectOption('4')
    await window.getByTestId('mqtt-connect').click()
    await expect(window.getByTestId('mqtt-status')).toHaveAttribute('data-state', 'connected', {
      timeout: 15_000,
    })
    expect(proxy.connects[0].authorization).toBe(BASIC)
  })

  uiTest('SSE connects through it, and events arrive', async ({ window }) => {
    const { sse } = getTestServerUrls()
    await openNewDropdownItem(window, /SSE/i)
    await window.getByTestId('sse-url').fill(sse)
    await window.getByTestId('sse-connect').click()
    await expect(window.getByTestId('sse-disconnect')).toBeVisible({ timeout: 15_000 })
    await expect(window.getByTestId('sse-event-row').first()).toBeVisible({ timeout: 15_000 })
    expectTunnelTo(sse)
  })

  uiTest('Cancel ends a connection the proxy never answers', async ({ window }) => {
    proxy.answer = 'hang'
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)
    await window.getByTestId('ws-connect').click()
    await expect.poll(() => proxy.connects.length, { timeout: 10_000 }).toBeGreaterThan(0)
    await window.getByTestId('ws-cancel').click()
    await expect(window.getByTestId('ws-connect')).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => proxy.openSockets(), { timeout: 10_000 }).toBe(0)
  })

  uiTest('a proxy refusing the credentials is named in the error', async ({ window }) => {
    await proxy.close()
    proxy = await startConnectProxy('407')
    await setAppProxy(window, proxy.setting(AUTH))
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-connect')).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText(/Proxy connection failed/i).first()).toBeVisible()
    await expect(window.locator('body')).not.toContainText(AUTH.password)
  })
})
