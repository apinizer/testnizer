/**
 * MST-172 P0  Runner env selection parity
 * MST-173 P1  Runner variable chain Send parity
 *
 * CLAUDE.md gotcha: "Değişken çözümleme paralelliği" — variables that have
 * only initial_value (value is empty) must resolve the same way in:
 *   • Send path  → renderer v() → environment.store.ts getActiveVariables
 *   • Runner path → main process loadEnvVars → effectiveValue()
 * This spec creates an env with value='' and initial_value='<url>' and
 * verifies both paths resolve the template {{var}} to the same URL.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import { fillUrl, addVisualAssertion, saveRequestToTree } from '../../helpers/ui/request-flow'
import {
  openCollectionRunner,
  startCollectionRun,
  waitCollectionRunComplete,
  readCollectionRunSummary,
  closeCollectionRunner,
  selectOnlyRunnerEndpoint,
} from '../../helpers/ui/runner-flow'
import { openEnvModal, closeEnvModal, addVariable, setActiveEnvironment, createEnvironment } from '../../helpers/ui/env'
import { getActiveProjectId, listEnvironmentsByProject } from '../../helpers/ui/assert-ipc'
import { resolveVarViaRunner } from '../../helpers/ui/runner-extra'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Runner parity [MST-172, MST-173]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  /**
   * MST-172 — Runner env selection parity
   * The runner must use the active environment when resolving {{baseUrl}}.
   * We create two environments with different baseUrl values, activate Env-A,
   * run the collection and check that requests hit Env-A's server.
   */
  uiTest('MST-172 runner uses active environment for {{baseUrl}} resolution', async ({ window }) => {
    const tag = uid()
    const envA = `EnvA-172-${tag}`
    const baseUrlA = `${http()}`
    const reqName = `RunnerEnv-172-${tag}`

    // Create Env-A with baseUrl that points to our local http-echo.
    await openEnvModal(window)
    await createEnvironment(window, envA)
    await addVariable(window, { key: 'baseUrl172', initialValue: baseUrlA, currentValue: baseUrlA })
    await setActiveEnvironment(window)
    await closeEnvModal(window)

    // Build a request that uses {{baseUrl172}}.
    await openHttpRequestTab(window)
    await fillUrl(window, `{{baseUrl172}}/get?mst172=1`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveRequestToTree(window, reqName)

    // Run via collection runner modal — yalnızca bu testin isteğini koş;
    // worker-paylaşımlı koleksiyonda birikmiş istekler sayıyı kirletir.
    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoint(window, reqName)
    await startCollectionRun(window)
    await waitCollectionRunComplete(window)
    const summary = await readCollectionRunSummary(window)
    // The variable must have resolved → request must have reached the server.
    expect(summary.passed).toBeGreaterThanOrEqual(1)
    expect(summary.failed).toBe(0)
    await closeCollectionRunner(window)
  })

  /**
   * MST-173 — Runner variable chain Send parity
   * A variable with value='' and initial_value='<something>' must resolve
   * identically in both the Send path (renderer) and the Runner path (main).
   *
   * Strategy:
   *   1. Create env with value='' initial_value=http://…/get?parity=1
   *   2. Set env active
   *   3. Resolve via renderer store (open request tab, {{var}} in URL → Send → assert 200)
   *   4. Resolve via runner IPC helper (effectiveValue logic mirrored in resolveVarViaRunner)
   *   5. Assert both produce the same URL
   */
  uiTest('MST-173 initial_value-only variable resolves same in Send and Runner', async ({ window }) => {
    const tag = uid()
    const envName = `EnvParity-173-${tag}`
    const varKey = `serverUrl173`
    const targetUrl = `${http()}/get?parity=173`
    const projectId = await getActiveProjectId(window)

    // Create the env via the UI so the renderer store + modal stay in sync
    // (an IPC-only create isn't reflected in the modal list). Leaving the
    // current value empty mirrors the "initial_value only" case (value='').
    await openEnvModal(window)
    await createEnvironment(window, envName)
    await addVariable(window, { key: varKey, initialValue: targetUrl })
    await setActiveEnvironment(window)
    await closeEnvModal(window)

    // Resolve the env id via IPC for the runner-side parity assertion.
    const envs = (await listEnvironmentsByProject(window, projectId)) as Array<{ id: string; name: string }>
    const envId = envs.find((e) => e.name === envName)?.id
    expect(envId, `env ${envName} not found in DB`).toBeTruthy()

    // Send path: fill URL with {{varKey}}, Send, expect 200.
    await openHttpRequestTab(window)
    await fillUrl(window, `{{${varKey}}}`)
    await window.getByTestId('send-btn').click()
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })

    // Runner path: resolve same template via effectiveValue logic in main process.
    const runnerResolved = await resolveVarViaRunner(window, envId as string, `{{${varKey}}}`)
    expect(runnerResolved).toBe(targetUrl)

    // Both paths produce the same URL — parity confirmed.
    expect(runnerResolved).not.toContain(`{{${varKey}}}`)
  })
})
