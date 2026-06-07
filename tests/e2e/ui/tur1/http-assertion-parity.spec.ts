/**
 * MST-050 — Header assertion Send vs Runner parity
 *
 * Regression test for the "Header assertion paralelliği" gotcha documented
 * in CLAUDE.md: the renderer test-runner (used by Send button) and the
 * main-process runAssertionsMainProcess (used by Collection Runner) must
 * produce identical results for header assertions.
 *
 * Strategy:
 *  1. Save an endpoint with a header_equals assertion via IPC.
 *  2. Send via UI Send button → check test results panel → expect PASSED.
 *  3. Run via Collection Runner → check summary → expect passed >= 1, failed = 0.
 *
 * The /response-headers?X-Custom-Header=parity-value endpoint echoes the
 * header back so both paths see the same header.
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
  addVisualAssertion,
  clickSend,
  fillUrl,
  saveRequestToTree,
  waitForResponseStatus,
  expectTestResults,
} from '../../helpers/ui/request-flow'
import {
  closeCollectionRunner,
  openCollectionRunner,
  readCollectionRunSummary,
  selectOnlyRunnerEndpoint,
  startCollectionRun,
  waitCollectionRunComplete,
} from '../../helpers/ui/runner-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Header assertion parity [MST-050]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest(
    'MST-050a header_equals passes on both Send and Runner paths',
    async ({ window }) => {
      const reqName = `HdrParity ${uid()}`
      const headerValue = 'parity-value'
      const targetUrl = `${http()}/response-headers?X-Parity=${encodeURIComponent(headerValue)}`

      await openHttpRequestTab(window)
      await fillUrl(window, targetUrl)

      // Add a header_equals assertion for X-Parity: parity-value
      await addVisualAssertion(window, /Header equals/i, {
        headerName: 'x-parity',
        expected: headerValue,
      })

      // 1) Send path: click Send, wait for test results
      await clickSend(window)
      await waitForResponseStatus(window, 20_000)
      await expectTestResults(window, { passed: 1, total: 1 })

      // Save to tree for runner
      await saveRequestToTree(window, reqName)

      // 2) Runner path: open collection runner, run only this request
      await openCollectionRunner(window)
      await selectOnlyRunnerEndpoint(window, reqName)
      await startCollectionRun(window)
      await waitCollectionRunComplete(window, 60_000)
      const summary = await readCollectionRunSummary(window)
      expect(summary.failed).toBe(0)
      expect(summary.passed).toBeGreaterThanOrEqual(1)
      await closeCollectionRunner(window)
    },
  )

  uiTest(
    'MST-050b header_contains passes on both Send and Runner paths',
    async ({ window }) => {
      const reqName = `HdrContainsParity ${uid()}`
      const targetUrl = `${http()}/response-headers?X-Info=hello-world`

      await openHttpRequestTab(window)
      await fillUrl(window, targetUrl)

      // Assert header contains 'hello'
      await addVisualAssertion(window, /Header contains/i, {
        headerName: 'x-info',
        expected: 'hello',
      })

      await clickSend(window)
      await waitForResponseStatus(window, 20_000)
      await expectTestResults(window, { passed: 1, total: 1 })

      await saveRequestToTree(window, reqName)

      await openCollectionRunner(window)
      await selectOnlyRunnerEndpoint(window, reqName)
      await startCollectionRun(window)
      await waitCollectionRunComplete(window, 60_000)
      const summary = await readCollectionRunSummary(window)
      expect(summary.failed).toBe(0)
      expect(summary.passed).toBeGreaterThanOrEqual(1)
      await closeCollectionRunner(window)
    },
  )

  uiTest(
    'MST-050c header_exists passes on both Send and Runner paths',
    async ({ window }) => {
      const reqName = `HdrExistsParity ${uid()}`
      const targetUrl = `${http()}/response-headers?X-Exists=1`

      await openHttpRequestTab(window)
      await fillUrl(window, targetUrl)

      await addVisualAssertion(window, /Header exists/i, {
        headerName: 'x-exists',
      })

      await clickSend(window)
      await waitForResponseStatus(window, 20_000)
      await expectTestResults(window, { passed: 1, total: 1 })

      await saveRequestToTree(window, reqName)

      await openCollectionRunner(window)
      await selectOnlyRunnerEndpoint(window, reqName)
      await startCollectionRun(window)
      await waitCollectionRunComplete(window, 60_000)
      const summary = await readCollectionRunSummary(window)
      expect(summary.failed).toBe(0)
      expect(summary.passed).toBeGreaterThanOrEqual(1)
      await closeCollectionRunner(window)
    },
  )
})
