/**
 * MST-051, MST-062 — Env var Send vs Runner parity (initial_value fallback)
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree, addVisualAssertion } from '../../helpers/ui/request-flow'
import {
  openCollectionRunner,
  selectOnlyRunnerEndpoint,
  startCollectionRun,
  waitCollectionRunComplete,
  readCollectionRunSummary,
  closeCollectionRunner,
} from '../../helpers/ui/runner-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { setupEnvironment } from '../../helpers/ui/env'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Env parity [MST-051, MST-062]', () => {
  uiTest.describe.configure({ mode: 'serial' })
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-051 initial_value-only var resolves on Send and Runner', async ({ window }) => {
    const envName = `InitOnly ${uid()}`
    const varKey = 'baseHost'
    const hostValue = http()
    await getActiveProjectId(window)
    await setupEnvironment(window, envName, [{ key: varKey, initialValue: hostValue }])

    await openHttpRequestTab(window)
    await fillUrl(window, `{{${varKey}}}/get?parity=send&runner=1`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    const reqName = `Parity ${uid()}`
    await saveRequestToTree(window, reqName)

    // Send path — no Invalid URL / connection error.
    await window.getByTestId('send-btn').click()
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 30_000 })

    // Runner path — same env, same resolution.
    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoint(window, reqName)
    await startCollectionRun(window)
    await waitCollectionRunComplete(window)
    const summary = await readCollectionRunSummary(window)
    expect(summary.failed).toBe(0)
    expect(summary.passed).toBeGreaterThanOrEqual(1)
    await closeCollectionRunner(window)

    await expect(window.getByTestId('footer-env')).toContainText(envName)
  })
})
