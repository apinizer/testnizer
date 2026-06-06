/**
 * MST-036 — Form-data file upload
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, sendAndReadStatus } from '../../helpers/ui/request-flow'
import { setBodyType } from '../../helpers/ui/request-flow'
import { kvAddRow, kvFillLastRow } from '../../helpers/ui/keyvalue'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — Body upload [MST-036]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('MST-036 form-data fields are posted and echoed', async ({ window }) => {
    const title = `upload-${Math.random().toString(36).slice(2, 6)}`
    await setBodyType(window, 'formdata')
    await kvAddRow(window)
    await kvFillLastRow(window, { key: 'title', value: title })
    await kvAddRow(window)
    await kvFillLastRow(window, { key: 'note', value: 'e2e-form' })
    await fillUrl(window, `${http()}/post`)
    await window.getByTestId('url-method').click()
    await window.getByTestId('url-method-option-POST').click()
    expect(await sendAndReadStatus(window)).toBe(200)
    await window.getByTestId('res-tab-body').click()
    const body = window.getByTestId('res-body-content')
    await expect(body.getByText(new RegExp(title)).first()).toBeVisible({ timeout: 10_000 })
    await expect(body.getByText(/e2e-form/i).first()).toBeVisible({ timeout: 10_000 })
  })
})
