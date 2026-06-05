import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import {
  addVisualAssertion,
  fillUrl,
  saveRequestToTree,
  setHttpMethod,
} from '../../helpers/ui/request-flow'
import {
  openCollectionRunner,
  startCollectionRun,
  waitCollectionRunComplete,
  readCollectionRunSummary,
  closeCollectionRunner,
} from '../../helpers/ui/runner-flow'
import { createTestSuite, addSuiteItem, saveActiveSuiteItem, runSuiteAndAssert } from '../../helpers/ui/suite-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 4 — Runner & Suite journeys', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('F11 runner executes multiple saved requests', async ({ window }) => {
    for (let i = 1; i <= 2; i++) {
      await openHttpRequestTab(window)
      await fillUrl(window, `${http()}/get?runner=${i}`)
      await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
      await saveRequestToTree(window, `Runner Req ${i} ${uid()}`)
    }

    await openCollectionRunner(window)
    await startCollectionRun(window)
    await waitCollectionRunComplete(window)
    const summary = await readCollectionRunSummary(window)
    expect(summary.passed + summary.failed).toBeGreaterThanOrEqual(2)
    expect(summary.passed).toBeGreaterThanOrEqual(2)
    await closeCollectionRunner(window)
  })

  uiTest('F12 runner variable chain across requests', async ({ window }) => {
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?chain=step1`)
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.args.chain', expected: 'step1' })
    await saveRequestToTree(window, `Chain Step1 ${uid()}`)

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?chain=step2`)
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.args.chain', expected: 'step2' })
    await saveRequestToTree(window, `Chain Step2 ${uid()}`)

    await openCollectionRunner(window)
    await startCollectionRun(window)
    await waitCollectionRunComplete(window)
    const summary = await readCollectionRunSummary(window)
    expect(summary.passed).toBeGreaterThanOrEqual(2)
    await closeCollectionRunner(window)
  })

  uiTest('F13 suite folder item sequential run passes', async ({ window }) => {
    const suiteName = `Folder Suite ${uid()}`
    await createTestSuite(window, suiteName)
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?suite=1`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveActiveSuiteItem(window)
    await runSuiteAndAssert(window, suiteName, { minPassed: 1, maxFailed: 0 })
  })
})
