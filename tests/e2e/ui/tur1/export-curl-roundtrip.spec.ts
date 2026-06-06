/**
 * MST-095 — cURL export roundtrip
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl } from '../../helpers/ui/request-flow'
import { exportCurlIpc } from '../../helpers/ui/export-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — Export cURL [MST-095]', () => {
  uiTest('MST-095 exportCurl includes method and URL', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    const url = `${http()}/post?curl=1`
    await fillUrl(window, url)
    const curl = await exportCurlIpc(window, {
      method: 'POST',
      url,
      headers: [{ key: 'X-Curl', value: 'yes', enabled: true }],
    })
    expect(curl).toMatch(/curl/i)
    expect(curl).toContain('POST')
    expect(curl).toMatch(/127\.0\.0\.1|localhost/)
    expect(curl).toMatch(/X-Curl|x-curl/i)
  })
})
