/**
 * MST-052 — Compression gzip / deflate / brotli
 *
 * Verifies that the HTTP engine transparently decompresses gzip, deflate,
 * and brotli (br) encoded responses, and that the response body displayed
 * in the UI contains the JSON payload (not raw bytes).
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, clickSend, waitForResponseStatus } from '../../helpers/ui/request-flow'
import { sendRequest } from '../../helpers/api'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — Compression UI [MST-052]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('MST-052a gzip response is decompressed and body is readable JSON', async ({ window }) => {
    const res = await sendRequest(window, {
      method: 'GET',
      url: `${http()}/gzip`,
      headers: [{ id: 'ae', key: 'Accept-Encoding', value: 'gzip', enabled: true }],
    })
    expect(res.status).toBe(200)
    expect(res.error).toBeUndefined()
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {})
    expect(body).toContain('gzipped')
  })

  uiTest('MST-052b deflate response is decompressed and body is readable JSON', async ({ window }) => {
    const res = await sendRequest(window, {
      method: 'GET',
      url: `${http()}/deflate`,
      headers: [{ id: 'ae', key: 'Accept-Encoding', value: 'deflate', enabled: true }],
    })
    expect(res.status).toBe(200)
    expect(res.error).toBeUndefined()
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {})
    expect(body).toContain('deflated')
  })

  uiTest('MST-052c brotli response is decompressed and body is readable JSON', async ({ window }) => {
    const res = await sendRequest(window, {
      method: 'GET',
      url: `${http()}/brotli`,
      headers: [{ id: 'ae', key: 'Accept-Encoding', value: 'br', enabled: true }],
    })
    expect(res.status).toBe(200)
    expect(res.error).toBeUndefined()
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {})
    expect(body).toContain('brotli')
  })

  uiTest('MST-052d gzip response displayed in UI body tab (not raw bytes)', async ({ window }) => {
    await fillUrl(window, `${http()}/gzip`)
    await clickSend(window)
    const status = await waitForResponseStatus(window, 20_000)
    expect(status).toBe(200)

    await window.getByTestId('res-tab-body').click()
    // Body content must contain the JSON word, not binary gibberish
    const body = window.getByTestId('res-body-content')
    await expect(body.getByText(/gzipped|gzip/i).first()).toBeVisible({ timeout: 10_000 })
  })
})
