/**
 * MST-171 — Collection runner pass+fail summary
 * MST-171b — a 4xx the request's own test allows counts as passed (issue #16)
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import {
  addPostScript,
  addVisualAssertion,
  fillUrl,
  saveRequestToTree,
} from '../../helpers/ui/request-flow'
import {
  closeCollectionRunner,
  openCollectionRunner,
  readCollectionRunSummary,
  selectOnlyRunnerEndpoints,
  startCollectionRun,
  waitCollectionRunComplete,
} from '../../helpers/ui/runner-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Runner [MST-171]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
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

  // MST-171 only has failing assertions, so a verdict that ignored them and read the status
  // alone (every 4xx = failed) passed it too. This one needs a real 4xx that a test accepts,
  // next to a real 4xx nothing accepts, and counts exactly: the shared app holds other specs'
  // requests, so the run is limited to the two made here.
  uiTest('MST-171b a 404 the test allows is Passed, a bare 404 is Failed', async ({ window }) => {
    const tag = uid()
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/status/404`)
    await addPostScript(
      window,
      "pm.test('delete is idempotent', () => pm.expect(pm.response.code).to.be.oneOf([200, 204, 404]))",
    )
    await saveRequestToTree(window, `Allowed404 ${tag}`)

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/status/404`)
    await saveRequestToTree(window, `Bare404 ${tag}`)

    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoints(window, tag)
    await startCollectionRun(window)
    await waitCollectionRunComplete(window)
    expect(await readCollectionRunSummary(window)).toEqual({ passed: 1, failed: 1 })
    await closeCollectionRunner(window)
  })
})
