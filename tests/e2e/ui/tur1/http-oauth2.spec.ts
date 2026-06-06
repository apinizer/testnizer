/**
 * MST-033 — OAuth2 auth code + refresh (client credentials smoke)
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, sendAndReadStatus } from '../../helpers/ui/request-flow'
import { fetchOAuth2Token, setOAuth2ClientCredentials } from '../../helpers/ui/auth-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — HTTP OAuth2 [MST-033]', () => {
  uiTest('MST-033 token endpoint returns bearer for authorized resource', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    const tokenUrl = `${http()}/oauth/token`
    const token = await fetchOAuth2Token(window, {
      tokenUrl,
      clientId: 'e2e-client',
      clientSecret: 'e2e-secret',
    })
    expect(token.length).toBeGreaterThan(5)
    await setOAuth2ClientCredentials(window, {
      tokenUrl,
      clientId: 'e2e-client',
      clientSecret: 'e2e-secret',
      token,
    })
    await fillUrl(window, `${http()}/bearer`)
    expect(await sendAndReadStatus(window)).toBe(200)
  })
})
