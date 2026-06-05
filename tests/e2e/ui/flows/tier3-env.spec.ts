import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import {
  addVariable,
  closeEnvModal,
  createEnvironment,
  openEnvModal,
  selectEnvironmentInModal,
  setupEnvironment,
  switchEnvironment,
  setActiveEnvironment,
  expectSecretVariable,
} from '../../helpers/ui/env'
import {
  addHeader,
  addVisualAssertion,
  expectTestResults,
  fillUrl,
  sendAndWaitResponse,
  setAuthBearer,
} from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 3 — Environment journeys', () => {
  uiTest.describe.configure({ mode: 'serial' })

  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('F8 multi-env switch changes resolved URL', async ({ window }) => {
    const staging = `Staging ${uid()}`
    const prod = `Prod ${uid()}`
    await setupEnvironment(window, staging, [
      { key: 'host', initialValue: `${http()}/get?env=staging`, currentValue: `${http()}/get?env=staging` },
    ])
    await openEnvModal(window)
    await createEnvironment(window, prod)
    await addVariable(window, {
      key: 'host',
      initialValue: `${http()}/get?env=prod`,
      currentValue: `${http()}/get?env=prod`,
    })
    await setActiveEnvironment(window)
    await closeEnvModal(window)

    await openHttpRequestTab(window)
    await fillUrl(window, '{{host}}')
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.args.env', expected: 'prod' })
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 1, total: 1 })

    await switchEnvironment(window, staging)
    await openHttpRequestTab(window)
    await fillUrl(window, '{{host}}')
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.args.env', expected: 'staging' })
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 1, total: 1 })
  })

  uiTest('F9 current vs initial fallback and globals precedence', async ({ window }) => {
    const envName = `Fallback ${uid()}`
    const varKey = `token-${uid()}`
    await setupEnvironment(window, envName, [
      { key: varKey, initialValue: 'from-initial', currentValue: '' },
    ])

    await openEnvModal(window)
    await selectEnvironmentInModal(window, envName)
    await window.getByText('Globals', { exact: true }).click()
    await addVariable(window, {
      key: varKey,
      initialValue: 'from-global',
      currentValue: 'from-global',
    })
    await closeEnvModal(window)

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/headers`)
    await addHeader(window, 'X-Token', `{{${varKey}}}`)
    await addVisualAssertion(window, /Body contains/i, { expected: 'from-initial' })
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 1, total: 1 })
  })

  uiTest('F10 secret masking and Postman env import', async ({ window }) => {
    const secretEnv = `Secret ${uid()}`
    await setupEnvironment(window, secretEnv, [
      { key: 'apiKey', initialValue: 'super-secret', currentValue: 'super-secret', secret: true },
    ])

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/bearer`)
    await setAuthBearer(window, '{{apiKey}}')
    await addVisualAssertion(window, /Body JSON path/i, { jsonPath: '$.token', expected: 'super-secret' })
    await sendAndWaitResponse(window)
    await expectTestResults(window, { passed: 1, total: 1 })

    await openEnvModal(window)
    await selectEnvironmentInModal(window, secretEnv)
    await expectSecretVariable(window, 'apiKey')
  })
})
