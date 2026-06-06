/**
 * MST-059..065 — Environment CRUD + globals
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import {
  addVariable,
  closeEnvModal,
  createEnvironment,
  openEnvModal,
  openGlobalsPane,
  setActiveEnvironment,
  switchEnvironment,
} from '../../helpers/ui/env'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Environment vars [MST-059..065]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('MST-059 environment create + set active persists in footer', async ({ window }) => {
    const name = `Env ${uid()}`
    await openEnvModal(window)
    await createEnvironment(window, name)
    await addVariable(window, { key: 'baseHost', initialValue: '127.0.0.1', currentValue: '127.0.0.1' })
    await setActiveEnvironment(window)
    await closeEnvModal(window)
    await expect(window.getByTestId('footer-env')).toContainText(name, { timeout: 8_000 })
  })

  uiTest('MST-060 two environments coexist in modal list', async ({ window }) => {
    const a = `DupA ${uid()}`
    const b = `DupB ${uid()}`
    await openEnvModal(window)
    await createEnvironment(window, a)
    await createEnvironment(window, b)
    const modal = window.getByTestId('environment-modal')
    await expect(modal.getByRole('button', { name: a, exact: true })).toBeVisible()
    await expect(modal.getByRole('button', { name: b, exact: true })).toBeVisible()
    await closeEnvModal(window)
  })

  uiTest('MST-061 global variable CRUD in globals pane', async ({ window }) => {
    await openEnvModal(window)
    await openGlobalsPane(window)
    const key = `g_${uid()}`
    await addVariable(window, { key, initialValue: 'global-init', currentValue: 'global-cur' })
    await expect(window.getByTestId('env-var-key').filter({ hasValue: key })).toBeVisible()
    await closeEnvModal(window)
  })

  uiTest('MST-065 footer env selector sync after switch', async ({ window }) => {
    const a = `A ${uid()}`
    const b = `B ${uid()}`
    await openEnvModal(window)
    await createEnvironment(window, a)
    await createEnvironment(window, b)
    await closeEnvModal(window)
    await switchEnvironment(window, b)
    await expect(window.getByTestId('footer-env')).toContainText(b)
  })
})
