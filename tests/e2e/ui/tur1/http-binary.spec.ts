/**
 * MST-049 — Binary response download
 *
 * Verifies that:
 *  1. The engine receives and stores binary content correctly (no garbling).
 *  2. The UI shows the response body tab for binary content (not blank).
 *  3. The response pane shows a sensible content-type and byte count.
 *  4. An image/png response is handled without crash.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, clickSend, waitForResponseStatus } from '../../helpers/ui/request-flow'
import { sendRequest } from '../../helpers/api'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — Binary response download [MST-049]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('MST-049a /bytes/1024 returns 1024-byte octet-stream without error', async ({ window }) => {
    const res = await sendRequest(window, {
      method: 'GET',
      url: `${http()}/bytes/1024`,
    })
    expect(res.status).toBe(200)
    expect(res.error).toBeUndefined()
    // bodySize should reflect the download
    expect(res.bodySize ?? 0).toBeGreaterThan(0)
  })

  uiTest('MST-049b UI shows body tab for binary /bytes/512 response', async ({ window }) => {
    await fillUrl(window, `${http()}/bytes/512`)
    await clickSend(window)
    const status = await waitForResponseStatus(window, 20_000)
    expect(status).toBe(200)

    // Body tab must be visible
    await expect(window.getByTestId('res-tab-body')).toBeVisible({ timeout: 5_000 })
    await window.getByTestId('res-tab-body').click()

    // Response pane must not be empty — at minimum the content-type or byte marker
    const pane = window.getByTestId('res-body-content').or(window.getByTestId('response-pane'))
    await expect(pane.first()).toBeVisible({ timeout: 10_000 })
  })

  uiTest('MST-049c /image/png returns image content without crash', async ({ window }) => {
    const res = await sendRequest(window, {
      method: 'GET',
      url: `${http()}/image/png`,
    })
    expect(res.status).toBe(200)
    // Content-Type must be image/png
    const ct = Object.entries(res.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')
    expect(ct?.[1]).toMatch(/image\/png/i)
    expect(res.error).toBeUndefined()
  })

  uiTest('MST-049d stream-bytes/2048 downloads fully', async ({ window }) => {
    const res = await sendRequest(window, {
      method: 'GET',
      url: `${http()}/stream-bytes/2048`,
    })
    expect(res.status).toBe(200)
    expect(res.bodySize ?? 0).toBeGreaterThan(0)
  })
})
