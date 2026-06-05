import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../helpers/ui/bootstrap'
import { kvAddRow, kvFillBulk, kvRemoveRow, kvToggleBulkEdit, kvToggleRowEnabled } from '../helpers/ui/keyvalue'

uiTest.describe('Request Params & Headers (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('params: add row and fill key/value', async ({ window }) => {
    await window.getByTestId('req-tab-params').click()
    await kvAddRow(window, /Add Parameter/i)
    const row = window.getByTestId('kv-row-0')
    await row.getByTestId('kv-key').fill('foo')
    await row.getByTestId('kv-value').locator('input').fill('bar')
    await expect(row.getByTestId('kv-key')).toHaveValue('foo')
    await expect(row.getByTestId('kv-value').locator('input')).toHaveValue('bar')
  })

  uiTest('params: bulk edit commits rows', async ({ window }) => {
    await window.getByTestId('req-tab-params').click()
    await kvToggleBulkEdit(window)
    await kvFillBulk(window, 'alpha:one\nbeta:two')
    await kvToggleBulkEdit(window)
    await expect(window.getByTestId('kv-row-0').getByTestId('kv-key')).toHaveValue('alpha')
    await expect(window.getByTestId('kv-row-1').getByTestId('kv-key')).toHaveValue('beta')
  })

  uiTest('params: disable row', async ({ window }) => {
    await window.getByTestId('req-tab-params').click()
    await kvAddRow(window, /Add Parameter/i)
    await kvToggleRowEnabled(window, 0)
    await expect(window.getByTestId('kv-row-0')).toHaveCSS('opacity', '0.45')
  })

  uiTest('headers: add and remove row', async ({ window }) => {
    await window.getByTestId('req-tab-headers').click()
    await kvAddRow(window, /Add Header/i)
    const row = window.getByTestId('kv-row-0')
    await row.getByTestId('kv-key').fill('X-E2E')
    await row.getByTestId('kv-value').locator('input').fill('test')
    await row.hover()
    const before = await window.locator('[data-testid^="kv-row-"]').count()
    await kvRemoveRow(window, 0)
    await expect(window.locator('[data-testid^="kv-row-"]')).toHaveCount(before - 1)
  })
})
