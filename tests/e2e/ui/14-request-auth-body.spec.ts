import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../helpers/ui/bootstrap'
import { fillMonaco } from '../helpers/ui/monaco'
import { expectAuthTypeActive } from '../helpers/ui/assertions'
import { localHttpBin } from '../helpers/test-servers'

uiTest.describe('Request Auth & Body (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  for (const type of ['noAuth', 'bearer', 'basic', 'apiKey', 'oauth2', 'digest', 'ntlm'] as const) {
    uiTest(`auth type ${type} is selectable`, async ({ window }) => {
      await window.getByTestId('req-tab-auth').click()
      await window.getByTestId(`auth-type-${type}`).click()
      await expectAuthTypeActive(window.getByTestId(`auth-type-${type}`))
    })
  }

  uiTest('bearer token field accepts value', async ({ window }) => {
    await window.getByTestId('req-tab-auth').click()
    await window.getByTestId('auth-type-bearer').click()
    await window.getByTestId('auth-bearer-token').fill('secret-token')
    await expect(window.getByTestId('auth-bearer-token')).toHaveValue('secret-token')
  })

  uiTest('basic auth fields accept credentials', async ({ window }) => {
    await window.getByTestId('req-tab-auth').click()
    await window.getByTestId('auth-type-basic').click()
    await window.getByTestId('auth-basic-user').fill('user')
    await window.getByTestId('auth-basic-pass').fill('pass')
    await expect(window.getByTestId('auth-basic-user')).toHaveValue('user')
  })

  uiTest('body raw JSON accepts content', async ({ window }) => {
    await window.getByTestId('req-tab-body').click()
    await window.getByTestId('body-type-raw').click()
    await fillMonaco(window, 'body-raw-editor', '{"e2e":true}')
    const url = window.locator('input[placeholder*="URL"], input[placeholder*="url"]')
    await url.fill(`${localHttpBin()}/post`)
    await window.getByTestId('send-btn').click()
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })
  })

  uiTest('body type none shows empty state', async ({ window }) => {
    await window.getByTestId('req-tab-body').click()
    await window.getByTestId('body-type-none').click()
    await expect(window.getByTestId('body-type-none')).toBeChecked()
  })

  uiTest('settings toggles and timeout', async ({ window }) => {
    await window.getByTestId('req-tab-settings').click()
    await window.getByTestId('settings-follow-redirects').locator('xpath=ancestor::label').click()
    await window.getByTestId('settings-timeout').fill('5000')
    await expect(window.getByTestId('settings-timeout')).toHaveValue('5000')
  })
})
