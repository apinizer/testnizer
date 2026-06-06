import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tier 12 — Response viewer actions', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('F46 response body Pretty/Raw toggle and filter narrow the payload', async ({ window }) => {
    const a = `AAA${Math.random().toString(36).slice(2, 6)}`
    const b = `BBB${Math.random().toString(36).slice(2, 6)}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?alpha=${a}&beta=${b}`)
    await sendAndWaitResponse(window)
    await window.getByTestId('res-tab-body').click()
    const bodyContent = window.getByTestId('res-body-content')

    // Raw view renders the unformatted payload — our value is present.
    await window.getByTestId('res-body-raw').click()
    await expect(bodyContent.getByText(new RegExp(a)).first()).toBeVisible({ timeout: 10_000 })

    // Pretty view also shows it (formatted).
    await window.getByTestId('res-body-preview').click()
    await expect(bodyContent.getByText(new RegExp(a)).first()).toBeVisible({ timeout: 10_000 })

    // Filtering keeps lines that match the value visible (scoped to the body
    // editor — the URL bar still holds the raw query string).
    await window.getByTestId('res-body-filter').click()
    const filterInput = window.getByTestId('res-body-filter-input')
    await filterInput.fill(a)
    await expect(bodyContent.getByText(new RegExp(a)).first()).toBeVisible({ timeout: 10_000 })

    // A filter that matches nothing collapses the body — even alpha is gone.
    await filterInput.fill('zzz-no-such-token-zzz')
    await expect(bodyContent.getByText(new RegExp(a))).toHaveCount(0, { timeout: 10_000 })

    // Clearing the filter restores the full payload.
    await filterInput.fill('')
    await expect(bodyContent.getByText(new RegExp(a)).first()).toBeVisible({ timeout: 10_000 })
  })

  uiTest('F47 copying the response body places it on the system clipboard', async ({ window, app }) => {
    const marker = `COPY${Math.random().toString(36).slice(2, 8)}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?clip=${marker}`)
    await sendAndWaitResponse(window)
    await window.getByTestId('res-tab-body').click()

    // Seed the clipboard with a sentinel so we can prove the copy actually ran
    // (not just that the value happened to already be there).
    await app.evaluate(({ clipboard }) => clipboard.writeText('clipboard-empty-sentinel'))

    await window.getByTestId('res-body-copy').click()

    await expect
      .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 })
      .toContain(marker)
  })
})
