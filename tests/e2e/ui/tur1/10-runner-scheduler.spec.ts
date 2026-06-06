/**
 * MST-171 — Collection runner pass+fail summary
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { addVisualAssertion, fillUrl, saveRequestToTree } from '../../helpers/ui/request-flow'
import {
  closeCollectionRunner,
  openCollectionRunner,
  readCollectionRunSummary,
  startCollectionRun,
  waitCollectionRunComplete,
} from '../../helpers/ui/runner-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Runner [MST-171]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-171 runner reports pass and fail counts without hanging', async ({ window }) => {
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?pass=1`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveRequestToTree(window, `Pass ${uid()}`)

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/status/500`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveRequestToTree(window, `Fail ${uid()}`)

    await openCollectionRunner(window)
    await startCollectionRun(window)
    await waitCollectionRunComplete(window)
    const summary = await readCollectionRunSummary(window)
    expect(summary.passed).toBeGreaterThanOrEqual(1)
    expect(summary.failed).toBeGreaterThanOrEqual(1)
    await closeCollectionRunner(window)
  })
})
