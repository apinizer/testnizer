/**
 * A real GraphQL subscription over WebSocket against the e2e GraphQL server
 * (`tests/e2e/servers/graphql-server.ts`, one frame every 300 ms): type a
 * subscription, Subscribe, see events, switch tab and back during the stream,
 * Unsubscribe. Replaces the old stub, which invented events on a timer.
 */
import { expect } from '@playwright/test'
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

  uiTest('a port with no server shows the failure in the log', async ({ window }) => {
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill('ws://127.0.0.1:9/graphql')
    await fillMonaco(window, 'graphql-query-editor', 'subscription { tick }')
    await window.getByTestId('graphql-subscribe').click()
    await expect(window.getByTestId('graphql-subscription-error')).toBeVisible({ timeout: 20_000 })
    await expect(window.getByTestId('graphql-subscription-event')).toHaveCount(0)
  })
})
