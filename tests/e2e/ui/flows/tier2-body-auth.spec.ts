import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import {
  addVisualAssertion,
  expectTestResults,
  fillUrl,
  sendAndWaitResponse,
  setAuthBasic,
  setAuthBearer,
  setBodyType,
  setHttpMethod,
} from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'
import { kvAddRow, kvFillLastRow } from '../../helpers/ui/keyvalue'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 2 — Body, Auth, Response journeys', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('F5 body types echo back correctly', async ({ window }) => {
    await fillUrl(window, `${http()}/post`)
    await setHttpMethod(window, 'POST')
    await setBodyType(window, 'urlencoded')
    await kvAddRow(window)
    await kvFillLastRow(window, { key: 'alpha', value: 'beta' })
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.form.alpha', expected: 'beta' })
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 1, total: 1 })

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/xml`)
    await setHttpMethod(window, 'POST')
    await setBodyType(window, 'xml', '<note><id>42</id></note>')
    await window.getByTestId('send-btn').click()
    await expect(window.getByText(/<echo>/i).first()).toBeVisible({ timeout: 30_000 })
  })

  uiTest('F6 auth: basic and bearer success and 401', async ({ window }) => {
    await fillUrl(window, `${http()}/basic-auth/alice/secret`)
    await setAuthBasic(window, 'alice', 'secret')
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.authenticated', expected: 'true' })
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 1, total: 1 })

    await setAuthBasic(window, 'alice', 'wrong')
    await sendAndWaitResponse(window, 30_000)
    await expect(window.getByText(/401|Unauthorized/i).first()).toBeVisible()

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/bearer`)
    await setAuthBearer(window, 'tok-123')
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.token', expected: 'tok-123' })
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 1, total: 1 })

    await setAuthBearer(window, '')
    await sendAndWaitResponse(window)
    await expect(window.getByText(/401|Unauthorized/i).first()).toBeVisible()
  })

  uiTest('F7 response handling: cookies, encoding, redirect, status', async ({ window }) => {
    await fillUrl(window, `${http()}/cookies/set/session/e2e-token`)
    await sendAndWaitResponse(window)
    await window.getByTestId('res-tab-cookies').click()
    await expect(window.getByText(/session/i).first()).toBeVisible({ timeout: 8_000 })

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/gzip`)
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.gzipped', expected: 'true' })
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 1, total: 1 })

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/redirect/1`)
    await window.getByTestId('req-tab-settings').click()
    const follow = window.getByTestId('settings-follow-redirects')
    if (!(await follow.isChecked())) await follow.click()
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.redirected', expected: 'true' })
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 1, total: 1 })

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/status/418`)
    await window.getByTestId('send-btn').click()
    await expect(window.getByText(/418|I'm a teapot/i).first()).toBeVisible({ timeout: 30_000 })

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/image/png`)
    await window.getByTestId('send-btn').click()
    await expect(window.getByText(/200|OK|image/i).first()).toBeVisible({ timeout: 30_000 })
  })
})
