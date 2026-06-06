/**
 * MST-031, MST-032, MST-034 — Auth send journeys
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, sendAndReadStatus } from '../../helpers/ui/request-flow'
import {
  fetchOAuth2Token,
  setApiKeyAuth,
  setDigestAuth,
  setOAuth2ClientCredentials,
} from '../../helpers/ui/auth-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — Auth send [MST-031, MST-032, MST-034]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('MST-031 API key in header and query reaches echo', async ({ window }) => {
    const hv = `hk-${Math.random().toString(36).slice(2, 6)}`
    await setApiKeyAuth(window, { key: 'X-Api-Key', value: hv, in: 'header' })
    await fillUrl(window, `${http()}/headers`)
    expect(await sendAndReadStatus(window)).toBe(200)
    await window.getByTestId('res-tab-body').click()
    await expect(window.getByText(new RegExp(hv)).first()).toBeVisible()

    const qv = `qk-${Math.random().toString(36).slice(2, 6)}`
    await setApiKeyAuth(window, { key: 'apikey', value: qv, in: 'query' })
    await fillUrl(window, `${http()}/get`)
    expect(await sendAndReadStatus(window)).toBe(200)
    await expect(window.getByText(new RegExp(qv)).first()).toBeVisible()
  })

  uiTest('MST-032 OAuth2 client credentials token authorizes bearer send', async ({ window }) => {
    const tokenUrl = `${http()}/oauth/token`
    const token = await fetchOAuth2Token(window, {
      tokenUrl,
      clientId: 'e2e-client',
      clientSecret: 'e2e-secret',
    })
    await setOAuth2ClientCredentials(window, {
      tokenUrl,
      clientId: 'e2e-client',
      clientSecret: 'e2e-secret',
      token,
    })
    await fillUrl(window, `${http()}/bearer`)
    expect(await sendAndReadStatus(window)).toBe(200)
  })

  uiTest('MST-034 Digest auth passes with correct creds and 401s on wrong password', async ({ window }) => {
    await setDigestAuth(window, 'mufasa', 'Circle Of Life')
    await fillUrl(window, `${http()}/secure/resource`)
    expect(await sendAndReadStatus(window)).toBe(200)

    await setDigestAuth(window, 'mufasa', 'wrong-pass')
    expect(await sendAndReadStatus(window)).toBe(403)
  })
})
