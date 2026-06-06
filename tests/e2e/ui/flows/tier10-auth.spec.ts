import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, sendAndReadStatus } from '../../helpers/ui/request-flow'
import { setApiKeyAuth, setBasicAuth, setBearerAuth } from '../../helpers/ui/auth-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tier 10 — Authentication journeys', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('F39 Bearer token authenticates, and removing it is rejected', async ({ window }) => {
    const token = `tok-${Math.random().toString(36).slice(2, 8)}`
    await setBearerAuth(window, token)
    await fillUrl(window, `${http()}/bearer`)
    expect(await sendAndReadStatus(window)).toBe(200)
    await window.getByTestId('res-tab-body').click()
    await expect(window.getByText(new RegExp(token)).first()).toBeVisible({ timeout: 10_000 })

    // Drop the auth → the protected endpoint now 401s.
    await window.getByTestId('req-tab-auth').click()
    await window.getByTestId('auth-type-noAuth').click()
    expect(await sendAndReadStatus(window)).toBe(401)
  })

  uiTest('F40 Basic auth passes with correct creds and 401s on wrong password', async ({ window }) => {
    const user = 'alice'
    const pass = 's3cret'
    await setBasicAuth(window, user, pass)
    await fillUrl(window, `${http()}/basic-auth/${user}/${pass}`)
    expect(await sendAndReadStatus(window)).toBe(200)

    // Same URL (expects s3cret) but send a wrong password → 401.
    await setBasicAuth(window, user, 'wrong-pass')
    expect(await sendAndReadStatus(window)).toBe(401)
  })

  uiTest('F41 API key in a header reaches the server', async ({ window }) => {
    const value = `hk-${Math.random().toString(36).slice(2, 8)}`
    await setApiKeyAuth(window, { key: 'X-Api-Key', value, in: 'header' })
    await fillUrl(window, `${http()}/headers`)
    expect(await sendAndReadStatus(window)).toBe(200)
    await window.getByTestId('res-tab-body').click()
    await expect(window.getByText(new RegExp(value)).first()).toBeVisible({ timeout: 10_000 })
  })

  uiTest('F42 API key in the query string reaches the server', async ({ window }) => {
    const value = `qk-${Math.random().toString(36).slice(2, 8)}`
    await setApiKeyAuth(window, { key: 'apikey', value, in: 'query' })
    await fillUrl(window, `${http()}/get`)
    expect(await sendAndReadStatus(window)).toBe(200)
    await window.getByTestId('res-tab-body').click()
    await expect(window.getByText(new RegExp(value)).first()).toBeVisible({ timeout: 10_000 })
  })
})
