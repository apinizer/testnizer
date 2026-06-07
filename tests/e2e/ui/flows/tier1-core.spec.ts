import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { setupEnvironment } from '../../helpers/ui/env'
import {
  addHeader,
  addPostScript,
  addPreScript,
  addVisualAssertion,
  expectTestResults,
  fillUrl,
  saveRequestToTree,
  seedPostScriptExample,
  sendAndWaitResponse,
} from '../../helpers/ui/request-flow'
import {
  assertJsonField,
  findSuiteIdByName,
  getActiveProjectId,
  getEndpoint,
  listEndpointsByProject,
  listSuiteItems,
  sendViaIpc,
} from '../../helpers/ui/assert-ipc'
import {
  createTestSuite,
  addSuiteItem,
  saveActiveSuiteItem,
  runSuiteAndAssert,
} from '../../helpers/ui/suite-flow'
import { localHttpBin } from '../../helpers/test-servers'
import { treeClickNode } from '../../helpers/ui/tree'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 1 — Core HTTP journeys', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('F1 flagship: env vars → post-script → send → suite run', async ({ window }) => {
    const envName = `Flow Env ${uid()}`
    const suiteName = `F1 Suite ${uid()}`
    await setupEnvironment(window, envName, [
      { key: 'baseUrl', initialValue: http(), currentValue: http() },
      { key: 'path', initialValue: 'flow-path', currentValue: 'flow-path' },
    ])

    await openHttpRequestTab(window)
    await fillUrl(window, '{{baseUrl}}/get?p={{path}}')
    await addVisualAssertion(window, /Body JSON path/i, {
      jsonPath: '$.args.p',
      expected: 'flow-path',
    })
    await seedPostScriptExample(window)
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 2, total: 2 })

    const ipcRes = await sendViaIpc(window, { method: 'GET', url: `${http()}/get?p=flow-path` })
    assertJsonField(ipcRes, 'args.p', 'flow-path')

    await createTestSuite(window, suiteName)
    await addSuiteItem(window, suiteName)
    const suiteUrl = `${http()}/get?p=flow-path`
    await fillUrl(window, suiteUrl)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveActiveSuiteItem(window)

    const projectId = await getActiveProjectId(window)
    const suiteId = await findSuiteIdByName(window, projectId, suiteName)
    const items = await listSuiteItems(window, suiteId)
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items[0]?.url).toContain('/get?p=flow-path')

    await dismissOverlays(window)
    await runSuiteAndAssert(window, suiteName, { minPassed: 1, maxFailed: 0 })
  })

  uiTest('F2 persistence: save request retains script and assertions', async ({ window }) => {
    const name = `Persist ${uid()}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?persist=1`)
    await seedPostScriptExample(window)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveRequestToTree(window, name)

    const projectId = await getActiveProjectId(window)
    const endpoints = (await listEndpointsByProject(window, projectId)) as Array<{ id: string; name: string }>
    const saved = endpoints.find((e) => e.name === name)
    expect(saved?.id).toBeTruthy()

    const detail = (await getEndpoint(window, saved!.id)) as {
      post_script?: string
      assertions?: string
    }
    expect(detail.post_script).toContain('Status is 200')
    expect(detail.assertions).toContain('status_equals')

    await treeClickNode(window, name)
    await expect(window.getByTestId('url-input')).toHaveValue(`${http()}/get?persist=1`, { timeout: 8_000 })
    await window.getByTestId('req-tab-tests').click()
    await expect(window.getByTestId('assertion-enable').first()).toBeVisible()
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 2, total: 2 })
  })

  uiTest('F3 visual assertions: pass and fail matrix', async ({ window }) => {
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?marker=e2e`)

    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await addVisualAssertion(window, /Body contains/i, { expected: 'marker' })
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.args.marker', expected: 'e2e' })
    await addVisualAssertion(window, /Header equals/i, { headerName: 'content-type', expected: 'application/json' })
    await addVisualAssertion(window, /Response time under/i, { expected: 5000 })

    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 5, total: 5 })

    await addVisualAssertion(window, /Status code equals/i, { expected: 500 })
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 5, total: 6 })
  })

  uiTest('F4 pre-request script sets env var and dynamic value', async ({ window }) => {
    const envName = `Pre Script ${uid()}`
    await setupEnvironment(window, envName, [
      { key: 'baseUrl', initialValue: http(), currentValue: http() },
      { key: 'dynHeader', initialValue: '', currentValue: '' },
    ])

    await openHttpRequestTab(window)
    await addHeader(window, 'X-E2E-Dyn', 'hdr-{{$randomInt}}')
    await fillUrl(window, '{{baseUrl}}/headers')
    await sendAndWaitResponse(window)
    await window.getByTestId('res-tab-body').click()
    await expect(window.getByText(/hdr-\d+/i).first()).toBeVisible({ timeout: 10_000 })
  })
})
