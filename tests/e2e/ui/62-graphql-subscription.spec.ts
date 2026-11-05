/**
 * A real GraphQL subscription over WebSocket against the e2e GraphQL server
 * (`tests/e2e/servers/graphql-server.ts`, one frame every 300 ms): type a
 * subscription, Subscribe, see events, switch tab and back during the stream,
 * Unsubscribe. Replaces the old stub, which invented events on a timer.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
  openNewDropdownItem,
} from '../helpers/ui/bootstrap'
import { getTestServerUrls } from '../helpers/test-servers'
import { fillMonaco } from '../helpers/ui/monaco'
import { getActiveProjectId } from '../helpers/ui/assert-ipc'
import { startConnectProxy } from '../../helpers/connect-proxy'

type SettingsApi = {
  settings: {
    get: (k: string) => Promise<{ data?: Record<string, unknown> }>
    set: (k: string, v: unknown) => Promise<unknown>
  }
}

async function readSetting(window: Page, key: string): Promise<Record<string, unknown> | null> {
  return window.evaluate(async (k) => {
    const { api } = window as unknown as { api: SettingsApi }
    return (await api.settings.get(k)).data ?? null
  }, key)
}

async function writeSetting(window: Page, key: string, value: unknown): Promise<void> {
  await window.evaluate(
    async ({ k, v }) => {
      const { api } = window as unknown as { api: SettingsApi }
      await api.settings.set(k, v)
    },
    { k: key, v: value },
  )
}

uiTest.describe('GraphQL subscription over WebSocket', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  uiTest('streams, survives a tab switch, and stops on Unsubscribe', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)
    await fillMonaco(window, 'graphql-query-editor', 'subscription { tick }')

    await window.getByTestId('graphql-subscribe').click()

    const log = window.getByTestId('graphql-subscription-log')
    const status = window.getByTestId('graphql-subscription-status')
    const events = window.getByTestId('graphql-subscription-event')
    await expect(status).toHaveAttribute('data-state', 'connected', { timeout: 15_000 })
    await expect(events.first()).toBeVisible({ timeout: 8_000 })

    // Another tab has no events of this one.
    const before = await events.count()
    await openHttpRequestTab(window)
    await expect(log).toBeHidden()

    // Back: the events are there, and more arrived while away.
    await window.getByTestId('endpoint-tab').first().click()
    await expect(status).toHaveAttribute('data-state', 'connected')
    await expect.poll(() => events.count(), { timeout: 8_000 }).toBeGreaterThan(before + 1)

    await window.getByTestId('graphql-unsubscribe').click()
    await expect(status).toHaveAttribute('data-state', 'disconnected')
    await expect(window.getByTestId('graphql-subscription-end')).toHaveAttribute(
      'data-end',
      'unsubscribed',
    )
    const stopped = await events.count()
    await window.waitForTimeout(1_000)
    expect(await events.count()).toBe(stopped)
  })

  uiTest('a document with several operations runs the selected one', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)
    const select = window.getByTestId('graphql-operation-select')

    // One operation: nothing to choose, nothing on screen.
    await fillMonaco(window, 'graphql-query-editor', 'query A { hello(name: "one op") }')
    await expect(select).toBeHidden()

    await fillMonaco(
      window,
      'graphql-query-editor',
      'query A { hello(name: "first op") } query B { hello(name: "second op") } subscription T { tick }',
    )
    await expect(select).toHaveValue('A')

    // The selected query goes over HTTP, and only it runs.
    await select.selectOption('B')
    await window.getByTestId('graphql-run').click()
    await expect(window.getByText(/Hello\ssecond\sop/).first()).toBeVisible({ timeout: 15_000 })

    // The selected subscription subscribes.
    await select.selectOption('T')
    await expect(window.getByTestId('graphql-run')).toBeHidden()
    await window.getByTestId('graphql-subscribe').click()
    await expect(window.getByTestId('graphql-subscription-status')).toHaveAttribute(
      'data-state',
      'connected',
      { timeout: 15_000 },
    )
    await expect(window.getByTestId('graphql-subscription-event').first()).toBeVisible({
      timeout: 8_000,
    })
    await expect(select).toBeDisabled()

    // Leave while it runs: back on the tab, the same operation and more events.
    const events = window.getByTestId('graphql-subscription-event')
    const before = await events.count()
    await openHttpRequestTab(window)
    await expect(select).toBeHidden()
    await window.getByTestId('endpoint-tab').first().click()
    await expect(select).toHaveValue('T')
    await expect(select).toBeDisabled()
    await expect.poll(() => events.count(), { timeout: 8_000 }).toBeGreaterThan(before + 1)

    await window.getByTestId('graphql-unsubscribe').click()

    // Renamed away: the first operation shows, and the screen says so.
    await fillMonaco(
      window,
      'graphql-query-editor',
      'query A { hello(name: "first op") } query B { hello(name: "second op") }',
    )
    await expect(select).toHaveValue('A')
    await expect(window.getByTestId('graphql-operation-stale')).toBeVisible()
  })

  uiTest('goes through the proxy the project sets', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    const proxy = await startConnectProxy()
    const auth = { username: 'e2e-user', password: 'e2e-proxy-pass' }
    const projectKey = `project.${await getActiveProjectId(window)}.settings`
    const saved = await readSetting(window, projectKey)
    try {
      await writeSetting(window, projectKey, { ...(saved ?? {}), proxy: proxy.setting(auth) })
      await openNewDropdownItem(window, /GraphQL/i)
      await window.getByTestId('graphql-url').fill(graphql)
      await fillMonaco(window, 'graphql-query-editor', 'subscription { tick }')
      await window.getByTestId('graphql-subscribe').click()

      const status = window.getByTestId('graphql-subscription-status')
      await expect(status).toHaveAttribute('data-state', 'connected', { timeout: 15_000 })
      await expect(window.getByTestId('graphql-subscription-event').first()).toBeVisible({
        timeout: 8_000,
      })
      expect(proxy.connects[0].target).toBe(new URL(graphql).host)
      expect(proxy.connects[0].authorization).toBe(
        `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`,
      )
      await window.getByTestId('graphql-unsubscribe').click()
      await expect(status).toHaveAttribute('data-state', 'disconnected')
      await expect.poll(() => proxy.openSockets(), { timeout: 8_000 }).toBe(0)
    } finally {
      // `null` deletes the key. Writing the old value back without it would leave this
      // dead proxy on the project for every later spec in the shared Electron.
      await writeSetting(window, projectKey, { ...(saved ?? {}), proxy: saved?.proxy ?? null })
      await proxy.close()
    }
  })

  uiTest('a port with no server shows the failure in the log', async ({ window }) => {
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill('ws://127.0.0.1:9/graphql')
    await fillMonaco(window, 'graphql-query-editor', 'subscription { tick }')
    await window.getByTestId('graphql-subscribe').click()
    await expect(window.getByTestId('graphql-subscription-error')).toBeVisible({ timeout: 20_000 })
    await expect(window.getByTestId('graphql-subscription-event')).toHaveCount(0)
  })
})
