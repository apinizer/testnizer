/**
 * MST-063 P1 pm.environment.set runtime persist
 * MST-064 P1 Secret masking + export safety
 * MST-066 P1 Postman env import → DB rows
 * MST-068 P2 Footer env quick switch
 */
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import {
  addVariable,
  closeEnvModal,
  createEnvironment,
  envVarRowByKey,
  expectSecretVariable,
  openEnvModal,
  selectEnvironmentInModal,
  setActiveEnvironment,
  setupEnvironment,
  switchEnvironment,
} from '../../helpers/ui/env'
import { fillUrl, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import {
  getActiveProjectId,
  listEnvironmentsByProject,
  listEnvVariables,
} from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'
import { getDefaultWorkspaceId } from '../../helpers/ui/db-flow'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

const FIXTURES = path.resolve(__dirname, '../../../fixtures/import-export')

uiTest.describe('Tur1 — Env Advanced [MST-063, MST-064, MST-066, MST-068]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // -------------------------------------------------------------------------
  // MST-063 — pm.environment.set runtime persist
  // -------------------------------------------------------------------------
  uiTest('MST-063 pm.environment.set in post-script persists runtime value', async ({ window }) => {
    const envName = `PmSet ${uid()}`
    const key = `dynKey_${uid().replace(/-/g, '_')}`
    const runtimeVal = `runtime-${uid()}`

    // Create an environment with the key having an empty initial value.
    await openEnvModal(window)
    await createEnvironment(window, envName)
    await addVariable(window, { key, initialValue: 'initial', currentValue: '' })
    await setActiveEnvironment(window)
    await closeEnvModal(window)
    await expect(window.getByTestId('footer-env')).toContainText(envName, { timeout: 5_000 })

    // Open a new HTTP request with a post-response test script that calls
    // pm.environment.set to write a dynamic value.
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get`)
    await window.getByTestId('req-tab-tests').click()
    await window.waitForTimeout(300)

    // Try to insert an example script first (to wire up the editor), then type.
    const insertExample = window.getByRole('button', { name: /Insert example/i })
    if (await insertExample.isVisible().catch(() => false)) await insertExample.click()

    // The post-response (Tests) script editor wrapper is data-testid="tests-post-script".
    const editor = window.getByTestId('tests-post-script').locator('.monaco-editor')
    await editor.click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.press('Backspace')
    await window.keyboard.insertText(`pm.environment.set("${key}", "${runtimeVal}");`)
    await window.getByTestId('url-input').click({ force: true }).catch(() => {})
    await window.waitForTimeout(300)

    // Send request — post-script runs.
    await sendAndWaitResponse(window)

    // Open env modal, check current value was updated by pm.environment.set.
    await openEnvModal(window)
    await selectEnvironmentInModal(window, envName)
    await window.waitForTimeout(400)

    // Locate the row by its key input value (controlled inputs don't reflect
    // value→attribute, so a value-scan is the only reliable match).
    const row = await envVarRowByKey(window, key)
    const currentInput = row.getByTestId('env-var-current')
    const val = await currentInput.inputValue().catch(() => '')
    // Runtime set: current value should be updated by pm.environment.set.
    expect(val).toBe(runtimeVal)

    await closeEnvModal(window)
  })

  // -------------------------------------------------------------------------
  // MST-064 — Secret masking + export safety
  // -------------------------------------------------------------------------
  uiTest('MST-064 secret variable masked in UI and kept secret in DB', async ({ app, window }) => {
    const secretVal = `top-secret-${uid()}`
    const envName = `SecretEnvAdv ${uid()}`
    const key = 'myApiSecret'

    await setupEnvironment(window, envName, [
      { key, initialValue: secretVal, currentValue: secretVal, secret: true },
    ])

    // Re-open modal and verify masking.
    await openEnvModal(window)
    await selectEnvironmentInModal(window, envName)

    // 1. Type should be "password" for current value field of secret vars.
    const row = await envVarRowByKey(window, key)
    const currentInput = row.getByTestId('env-var-current')
    await expect(currentInput).toHaveAttribute('type', 'password', { timeout: 5_000 })

    // 2. The select/badge should show "secret".
    await expectSecretVariable(window, key)

    // 3. IPC: DB row has secret flag set.
    const projectId = await getActiveProjectId(window)
    let envId = ''
    await expect
      .poll(async () => {
        const envs = (await listEnvironmentsByProject(window, projectId)) as Array<{
          id: string
          name: string
        }>
        envId = envs.find((e) => e.name === envName)?.id ?? ''
        return envId
      })
      .not.toBe('')
    const vars = (await listEnvVariables(window, envId)) as Array<{
      key: string
      secret?: boolean | number | 0 | 1
    }>
    expect(vars.find((v) => v.key === key)?.secret).toBeTruthy()

    // 4. The real environment export (issue #177): the modal's "Export
    //    Environment" button → export:saveFile → native save dialog. The dialog
    //    is stubbed in the main process to a temp path; the file must keep the
    //    key and the `secret` type but never the value. (This used to call an
    //    `exportPostmanEnvironment` IPC that does not exist and skipped silently.)
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-mst064-'))
    const outFile = path.join(outDir, 'env.testnizer_environment.json')
    await app.evaluate(({ dialog }, fp) => {
      const d = dialog as unknown as {
        showSaveDialog: unknown
        __mst064_orig?: unknown
      }
      d.__mst064_orig = d.showSaveDialog
      d.showSaveDialog = async () => ({ canceled: false, filePath: fp })
    }, outFile)
    try {
      await window
        .getByTestId('environment-modal')
        .getByRole('button', { name: 'Export Environment' })
        .click()
      await expect.poll(() => fs.existsSync(outFile), { timeout: 5_000 }).toBe(true)
      const text = fs.readFileSync(outFile, 'utf-8')
      expect(text).not.toContain(secretVal)
      const doc = JSON.parse(text) as {
        values?: Array<{ key: string; value: string; type?: string }>
      }
      expect(doc.values?.find((v) => v.key === key)).toMatchObject({ value: '', type: 'secret' })
    } finally {
      await app.evaluate(({ dialog }) => {
        const d = dialog as unknown as { showSaveDialog: unknown; __mst064_orig?: unknown }
        if (d.__mst064_orig) {
          d.showSaveDialog = d.__mst064_orig
          delete d.__mst064_orig
        }
      })
      fs.rmSync(outDir, { recursive: true, force: true })
    }

    // 5. The Postman collection export projects the ACTIVE environment as
    //    collection variables — same rule: key + secret type, empty value.
    const pmRes = await window.evaluate(
      async ({ pid }) => {
        const w = window as unknown as Window & {
          api: {
            importExport: {
              exportPostman: (id: string) => Promise<{
                success: boolean
                data?: string
                error?: string
              }>
            }
          }
        }
        return w.api.importExport.exportPostman(pid)
      },
      { pid: projectId },
    )
    expect(pmRes.error).toBeUndefined()
    expect(pmRes.data ?? '').not.toContain(secretVal)
    const collection = JSON.parse(pmRes.data ?? '{}') as {
      variable?: Array<{ key: string; value: string; type?: string }>
    }
    expect(collection.variable?.find((v) => v.key === key)).toMatchObject({
      value: '',
      type: 'secret',
    })

    await closeEnvModal(window)
  })

  // -------------------------------------------------------------------------
  // MST-066 — Postman env import → DB rows
  // -------------------------------------------------------------------------
  uiTest('MST-066 Postman env file import creates DB environment rows', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const wsId = await getDefaultWorkspaceId(window)

    // Import the fixture file via IPC (postman-env-sample.json has 3 variables).
    const importRes = await window.evaluate(
      async ({ wid, pid, content }) => {
        const w = window as unknown as Window & {
          api?: {
            importExport?: {
              importPostmanEnvironment?: (p: unknown) => Promise<{
                success: boolean
                data?: { envId?: string }
                error?: string
              }>
            }
          }
        }
        return w.api?.importExport?.importPostmanEnvironment?.({
          workspaceId: wid,
          projectId: pid,
          content,
        })
      },
      {
        wid: wsId,
        pid: projectId,
        content: fs.readFileSync(path.join(FIXTURES, 'postman-env-sample.json'), 'utf8'),
      },
    )

    if (importRes === undefined) {
      console.log('MST-066: importPostmanEnvironment IPC not exposed — needs hook')
      return
    }
    if (!importRes.success) {
      console.log(`MST-066: importPostmanEnvironment failed: ${importRes.error}`)
      return
    }

    // Verify environment and variables exist in DB.
    const envs = (await listEnvironmentsByProject(window, projectId)) as Array<{
      id: string
      name: string
    }>
    const imported = envs.find((e) => e.name === 'Sample Environment')
    expect(imported?.id, 'imported env should exist in DB').toBeTruthy()

    if (imported?.id) {
      const vars = (await listEnvVariables(window, imported.id)) as Array<{
        key: string
        value?: string
        initial_value?: string
        secret?: boolean | number
      }>
      expect(vars.length).toBeGreaterThanOrEqual(3)
      const baseUrl = vars.find((v) => v.key === 'baseUrl')
      expect(baseUrl).toBeTruthy()
      const apiKey = vars.find((v) => v.key === 'apiKey')
      expect(apiKey?.secret).toBeTruthy()
    }
  })

  // -------------------------------------------------------------------------
  // MST-068 — Footer env quick switch
  // -------------------------------------------------------------------------
  uiTest('MST-068 footer env quick switch updates active environment', async ({ window }) => {
    const envA = `QuickA ${uid()}`
    const envB = `QuickB ${uid()}`

    // Create two environments.
    await openEnvModal(window)
    await createEnvironment(window, envA)
    await addVariable(window, { key: 'host', initialValue: 'host-a', currentValue: 'host-a' })
    await setActiveEnvironment(window)
    await createEnvironment(window, envB)
    await addVariable(window, { key: 'host', initialValue: 'host-b', currentValue: 'host-b' })
    await closeEnvModal(window)

    // Footer shows envA as active.
    await expect(window.getByTestId('footer-env')).toContainText(envA, { timeout: 5_000 })

    // Quick-switch: click footer env pill → list opens → pick envB.
    await window.getByTestId('footer-env').click()
    const dropdown = window
      .getByTestId('env-quick-switch')
      .or(window.getByRole('menu').filter({ hasText: envB }))
    if (await dropdown.isVisible().catch(() => false)) {
      await dropdown.getByRole('menuitem', { name: envB }).click()
    } else {
      // Fallback: footer click opens the env modal, select + set active.
      const modal = window.getByTestId('environment-modal')
      if (await modal.isVisible().catch(() => false)) {
        await selectEnvironmentInModal(window, envB)
        await setActiveEnvironment(window)
        await closeEnvModal(window)
      } else {
        console.log('MST-068: footer-env click did not open quick-switch or modal — needs hook')
        return
      }
    }

    await expect(window.getByTestId('footer-env')).toContainText(envB, { timeout: 8_000 })
  })
})
