import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import {
  cancelInFlightRequest,
  clickSend,
  fillUrl,
  sendAndReadStatus,
  sendAndWaitResponse,
  waitForResponseError,
  waitForResponseStatus,
} from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

// A port nothing listens on → deterministic ECONNREFUSED. 127.0.0.1:1 is the
// classic "always refused" target on dev machines.
const DEAD_URL = 'http://127.0.0.1:1/get'

uiTest.describe('Tier 8 — Error & recovery journeys', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('F30 connection refused surfaces an error, then a fixed URL recovers', async ({ window }) => {
    await openHttpRequestTab(window)

    // 1. Hit a dead port — the response pane shows the connection error panel
    //    (no HTTP status at all), not a 2xx.
    await fillUrl(window, DEAD_URL)
    await clickSend(window)
    await waitForResponseError(window)

    // 2. Fix the URL to a live endpoint and resend in the SAME tab — the error
    //    clears and a real 200 comes back. This is the genuine "I typed the
    //    wrong host, fixed it, retried" loop.
    await fillUrl(window, `${http()}/get?recovered=1`)
    await sendAndWaitResponse(window)
    const status = await waitForResponseStatus(window)
    expect(status).toBe(200)
    await window.getByTestId('res-tab-body').click()
    await expect(window.getByText(/recovered/i).first()).toBeVisible({ timeout: 10_000 })
  })

  uiTest('F31 server 500 is surfaced, then recovers to 200', async ({ window }) => {
    await openHttpRequestTab(window)

    await fillUrl(window, `${http()}/status/500`)
    expect(await sendAndReadStatus(window)).toBe(500)

    // Same tab, point at a healthy status and retry.
    await fillUrl(window, `${http()}/status/200`)
    expect(await sendAndReadStatus(window)).toBe(200)
  })

  uiTest('F32 unknown route returns 404 (still a real HTTP response)', async ({ window }) => {
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/no-such-route-${Date.now()}`)
    // A 404 is a successful round-trip with a 4xx status — distinct from the
    // connection-refused error panel in F30.
    expect(await sendAndReadStatus(window)).toBe(404)
  })

  uiTest('F33 an in-flight request can be cancelled', async ({ window }) => {
    await openHttpRequestTab(window)
    // /delay/5 holds the response open long enough to hit Cancel deterministically.
    await fillUrl(window, `${http()}/delay/5`)
    await clickSend(window)
    // The aborted request surfaces as an error response (see request.store
    // cancelRequest), and the Send button flips back from its red Cancel state.
    await cancelInFlightRequest(window)
    await waitForResponseError(window)
    await expect(window.getByTestId('send-btn')).not.toContainText(/Cancel|İptal/i, {
      timeout: 10_000,
    })

    // After cancelling, the tab is usable again — a fresh fast request succeeds.
    await fillUrl(window, `${http()}/get?after-cancel=1`)
    await sendAndWaitResponse(window)
    expect(await waitForResponseStatus(window)).toBe(200)
  })

  uiTest('F34 cookie jar persists a Set-Cookie across two sends', async ({ window }) => {
    const value = `choco-${Math.random().toString(36).slice(2, 7)}`
    await openHttpRequestTab(window)

    // 1. Server sets a cookie via Set-Cookie. The main-process per-project
    //    tough-cookie jar stores it.
    await fillUrl(window, `${http()}/cookies/set/e2e/${value}`)
    await sendAndWaitResponse(window)

    // 2. A second send to the same host (same project jar) must replay the
    //    stored cookie back to the server, which echoes it in the body.
    await fillUrl(window, `${http()}/cookies`)
    await sendAndWaitResponse(window)
    await window.getByTestId('res-tab-body').click()
    await expect(window.getByText(new RegExp(value)).first()).toBeVisible({ timeout: 10_000 })
  })
})
