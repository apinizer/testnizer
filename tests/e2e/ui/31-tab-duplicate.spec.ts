/**
 * Duplicate Tab on an APIs request opens a copy, not the protocol picker.
 *
 * Reported against RC3: right-click an APIs tab → Duplicate Tab landed on the
 * "New Request" grid. Tabs under Tests were fine.
 *
 * Two correct-looking pieces collided. `openTab` deduplicates on `endpointId` /
 * `savedRequestId` so one resource never opens twice; the duplicate handler
 * built its copy by carrying those same ids over. `openTab` therefore matched
 * the SOURCE tab, refocused it and created nothing, and the switch that
 * followed pointed `activeTabId` at an id that had never been added — leaving
 * no active tab, which is what renders the page welcome.
 *
 * The unit test pins that mechanism. This drives the actual menu item, because
 * the bug only shows up when the whole chain runs.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree } from '../helpers/ui/request-flow'
import { localHttpBin } from '../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Duplicate Tab (APIs)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
  })

  uiTest('opens a real copy instead of the protocol picker', async ({ window }) => {
    const name = `Dup ${uid()}`

    // A tab backed by a tree row — the case that was broken.
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?dup=1`)
    await saveRequestToTree(window, name)

    const tabs = window.getByTestId('endpoint-tab')
    const before = await tabs.count()

    await tabs.filter({ hasText: name }).first().click({ button: 'right' })
    await window.getByText('Duplicate Tab', { exact: true }).click()

    // A second tab appears…
    await expect(tabs).toHaveCount(before + 1, { timeout: 10_000 })
    await expect(tabs.filter({ hasText: /\(copy\)/ })).toHaveCount(1)

    // …and the request editor is on screen. The bug showed the protocol grid,
    // which has no URL bar.
    await expect(window.getByTestId('url-input')).toBeVisible()
    await expect(window.getByTestId('url-input')).toHaveValue(`${http()}/get?dup=1`)
  })

  uiTest('the copy is independent — editing it leaves the original alone', async ({ window }) => {
    const name = `Dup2 ${uid()}`

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?orig=1`)
    await saveRequestToTree(window, name)

    const tabs = window.getByTestId('endpoint-tab')
    await tabs.filter({ hasText: name }).first().click({ button: 'right' })
    await window.getByText('Duplicate Tab', { exact: true }).click()
    await expect(tabs.filter({ hasText: /\(copy\)/ })).toHaveCount(1)

    // Edit the copy…
    await fillUrl(window, `${http()}/get?copy=1`)

    // …then go back to the original. Carrying the source's row id over would
    // have meant one tab and one row for both.
    await tabs.filter({ hasText: name }).first().click()
    await expect(window.getByTestId('url-input')).toHaveValue(`${http()}/get?orig=1`)
  })
})
