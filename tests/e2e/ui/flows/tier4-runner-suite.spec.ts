import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import {
  addPostScript,
  addVisualAssertion,
  fillUrl,
  saveRequestToTree,
} from '../../helpers/ui/request-flow'
import {
  openCollectionRunner,
  startCollectionRun,
  waitCollectionRunComplete,
  readCollectionRunSummary,
  closeCollectionRunner,
} from '../../helpers/ui/runner-flow'
import {
  createTestSuite,
  addSuiteItem,
  saveActiveSuiteItem,
  runSuiteAndAssert,
  runSuiteFromContextMenu,
} from '../../helpers/ui/suite-flow'
import {
  startRunnerTabRun,
  waitRunnerConfigReady,
  waitRunnerTabComplete,
  readRunnerTabSummary,
} from '../../helpers/ui/runner-flow'
import { findSuiteIdByName, getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 4 — Runner & Suite journeys', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
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

  uiTest('F12 runner variable chain: producer post-script feeds consumer', async ({ window }) => {
    // A genuine chain: item 1 extracts a value from its response into an env
    // var via post-script; item 2 consumes {{chainTok}} in its URL and asserts
    // it received exactly that value. If chaining breaks, the consumer's
    // assertion fails — caught by maxFailed: 0.
    const suiteName = `Chain Suite ${uid()}`
    const seed = `chain-${Math.random().toString(36).slice(2, 8)}`

    await createTestSuite(window, suiteName)

    // Producer
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?seed=${seed}`)
    await addPostScript(
      window,
      `pm.environment.set('chainTok', pm.response.json().args.seed)`,
    )
    await saveActiveSuiteItem(window)

    // Guard: the producer's post-script must actually persist into the suite
    // item snapshot, otherwise the "chain" silently degrades to two unrelated
    // requests (the failure mode this flow exists to catch).
    const projectId = await getActiveProjectId(window)
    const suiteId = await findSuiteIdByName(window, projectId, suiteName)
    const producerHasScript = await window.evaluate(async (sid) => {
      const w = window as unknown as Window & {
        api?: {
          testSuiteItem?: {
            list: (s: string) => Promise<{ data?: Array<{ id: string }> }>
            get: (id: string) => Promise<{ data?: { request_schema?: string } }>
          }
        }
      }
      const list = await w.api?.testSuiteItem?.list(sid)
      for (const it of list?.data ?? []) {
        const got = await w.api?.testSuiteItem?.get(it.id)
        if (String(got?.data?.request_schema ?? '').includes('chainTok')) return true
      }
      return false
    }, suiteId)
    expect(producerHasScript).toBe(true)

    // Consumer — depends on the value the producer wrote
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?got={{chainTok}}`)
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.args.got', expected: seed })
    await saveActiveSuiteItem(window)

    // Sequential run shares the mutated env across items → consumer assertion
    // only passes when the chain actually worked.
    await runSuiteFromContextMenu(window, suiteName)
    await waitRunnerConfigReady(window)
    await startRunnerTabRun(window)
    await waitRunnerTabComplete(window, 120_000)
    const summary = await readRunnerTabSummary(window)
    expect(summary.passed).toBeGreaterThanOrEqual(1)
    expect(summary.failed).toBe(0)
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
