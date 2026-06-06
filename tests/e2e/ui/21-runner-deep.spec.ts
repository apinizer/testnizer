import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../helpers/ui/bootstrap'
import { localHttpBin } from '../helpers/test-servers'
import { fillUrl, saveRequestToTree } from '../helpers/ui/request-flow'
import {
  closeCollectionRunner,
  openCollectionRunner,
  startCollectionRun,
  waitCollectionRunComplete,
} from '../helpers/ui/runner-flow'
import { createTestSuite } from '../helpers/ui/suite-flow'

uiTest.describe('Runner & suites (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('tests panel overview and scheduled nav', async ({ window }) => {
    await navigateSidebar(window, 'tests')
    await window.getByRole('button', { name: /Overview/i }).click()
    await window.getByRole('button', { name: /Scheduled Tasks/i }).click()
    await expect(window.getByText(/Scheduled|Tasks|Run/i).first()).toBeVisible()
  })

  uiTest('create test suite', async ({ window }) => {
    const name = `E2E Suite ${Date.now()}`
    await createTestSuite(window, name)
  })

  uiTest('collection runner modal start run against local stub', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?runner-deep=1`)
    await saveRequestToTree(window, `Runner Deep ${Date.now()}`)
    await openCollectionRunner(window)
    await startCollectionRun(window)
    await waitCollectionRunComplete(window)
    await closeCollectionRunner(window)
  })
})
