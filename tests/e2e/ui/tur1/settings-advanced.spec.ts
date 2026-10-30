/**
 * MST-193 P1 Collection-level auth inheritance
 * MST-194 P1 Collection pre-request + test scripts
 * MST-195 P1 Project variables scope
 * MST-197 P1 App proxy: persists + is the fallback the project dialog shows (issue #254)
 * MST-198 P2 Updater check IPC
 * MST-199 P2 Diagnostics export/reveal/licenses   (skipped — no such UI in src)
 * MST-200 P2 SSL verify global toggle
 *
 * Where the features live:
 *  - project-level auth / scripts: the Project Detail modal (nav-settings) →
 *    `project-detail-tab-{authorization,preRequest,tests}`, persisted by
 *    "Save Changes" under settings key `project.<id>.settings`.
 *  - global SSL verification + proxy: the App settings modal (Cmd+,), persisted
 *    by "Save" via `settings:setAll` (`sslVerification`, `proxy`). Since issue
 *    #254 the app proxy is a REAL fallback (Send + Run route through it when
 *    the project sets no proxy of its own), so MST-197's restore is load-bearing.
 *
 * The ui project shares ONE Electron instance and these values are worker-global
 * (a leftover bearer/proxy/SSL-off would poison later specs), so every test
 * restores what it changed in `finally`.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../../helpers/ui/bootstrap'
import { pressModShortcut } from '../../helpers/ui/keyboard'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { createProjectIpc } from '../../helpers/ui/db-extra'
import { getDefaultWorkspaceId } from '../../helpers/ui/db-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function getSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (k) => {
    const w = window as unknown as Window & {
      api: { settings: { get: (key: string) => Promise<{ success: boolean; data?: unknown }> } }
    }
    return (await w.api.settings.get(k)).data
  }, key)
}

async function setSetting(page: Page, key: string, value: unknown): Promise<void> {
  const res = await page.evaluate(
    async ({ k, v }) => {
      const w = window as unknown as Window & {
        api: {
          settings: { set: (key: string, value: unknown) => Promise<{ success: boolean; error?: string }> }
        }
      }
      return w.api.settings.set(k, v)
    },
    { k: key, v: value },
  )
  expect(res.success, res.error).toBe(true)
}

interface ProjectSettingsShape {
  auth?: { type?: string; bearerToken?: string }
  preScript?: string
  testScript?: string
}

async function openProjectDetail(window: Page, tab: string) {
  await window.getByTestId('nav-settings').click()
  const modal = window.getByTestId('project-detail-modal')
  await expect(modal).toBeVisible({ timeout: 8_000 })
  await modal.getByTestId(`project-detail-tab-${tab}`).click()
  return modal
}

async function saveProjectDetail(window: Page) {
  const modal = window.getByTestId('project-detail-modal')
  await modal.getByRole('button', { name: /Save Changes|Değişiklikleri Kaydet/i }).click()
  await expect(modal).toBeHidden({ timeout: 8_000 })
}

/** Replace the content of the (only) Monaco editor in the open Project Detail pane. */
async function typeIntoPaneMonaco(window: Page, text: string) {
  const modal = window.getByTestId('project-detail-modal')
  const editor = modal.locator('.monaco-editor').first()
  await expect(editor).toBeVisible({ timeout: 10_000 })
  await editor.click()
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await window.keyboard.press(`${mod}+KeyA`)
  await window.keyboard.press('Backspace')
  await window.keyboard.insertText(text)
}

uiTest.describe('Tur1 — Settings Advanced [MST-193..200]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // -------------------------------------------------------------------------
  // MST-193 — Collection-level auth inheritance
  // -------------------------------------------------------------------------
  uiTest('MST-193 project-level auth UI persists the selected type + token', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const key = `project.${projectId}.settings`
    const original = await getSetting(window, key)
    const token = `tok-${uid()}`
    try {
      const modal = await openProjectDetail(window, 'authorization')
      await modal.locator('select').first().selectOption('bearer')
      await modal.getByPlaceholder(/^eyJ/).fill(token)
      await saveProjectDetail(window)

      const saved = (await getSetting(window, key)) as ProjectSettingsShape
      expect(saved.auth?.type).toBe('bearer')
      expect(saved.auth?.bearerToken).toBe(token)

      // Reopen: the pane shows what was persisted.
      const reopened = await openProjectDetail(window, 'authorization')
      await expect(reopened.locator('select').first()).toHaveValue('bearer')
      await expect(reopened.getByPlaceholder(/^eyJ/)).toHaveValue(token)
      await window.keyboard.press('Escape')
      await expect(reopened).toBeHidden({ timeout: 5_000 })
    } finally {
      await dismissOverlays(window)
      await setSetting(window, key, original ?? {})
    }
  })

  // -------------------------------------------------------------------------
  // MST-194 — Collection pre-request + test scripts
  // -------------------------------------------------------------------------
  uiTest('MST-194 project-level pre-request and test scripts persist', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const key = `project.${projectId}.settings`
    const original = await getSetting(window, key)
    const preScript = `// pre-${uid()}`
    const testScript = `// test-${uid()}`
    try {
      await openProjectDetail(window, 'preRequest')
      await typeIntoPaneMonaco(window, preScript)
      await window
        .getByTestId('project-detail-modal')
        .getByTestId('project-detail-tab-tests')
        .click()
      await typeIntoPaneMonaco(window, testScript)
      await saveProjectDetail(window)

      const saved = (await getSetting(window, key)) as ProjectSettingsShape
      expect(saved.preScript).toContain(preScript)
      expect(saved.testScript).toContain(testScript)
    } finally {
      await dismissOverlays(window)
      await setSetting(window, key, original ?? {})
    }
  })

  // -------------------------------------------------------------------------
  // MST-195 — Project variables scope
  // -------------------------------------------------------------------------
  uiTest('MST-195 project variables are scoped and do not leak to other projects', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const workspaceId = await getDefaultWorkspaceId(window)
    const otherProjectId = await createProjectIpc(window, workspaceId, `Scope-${uid()}`)
    const varKey = `projVar_${uid().replace(/-/g, '_')}`
    const varVal = `proj-val-${uid()}`

    const created = await window.evaluate(
      async ({ wid, pid, k, v }) => {
        const w = window as unknown as Window & {
          api: {
            globalVariable: {
              create: (p: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }>
            }
          }
        }
        return w.api.globalVariable.create({
          workspace_id: wid,
          project_id: pid,
          key: k,
          value: v,
          initial_value: v,
        })
      },
      { wid: workspaceId, pid: projectId, k: varKey, v: varVal },
    )
    expect(created.success, created.error).toBe(true)
    const varId = created.data?.id ?? ''
    try {
      const list = (pid: string) =>
        window.evaluate(async (p) => {
          const w = window as unknown as Window & {
            api: {
              globalVariable: {
                listByProject: (id: string) => Promise<{
                  success: boolean
                  data?: Array<{ key: string; value: string }>
                }>
              }
            }
          }
          return (await w.api.globalVariable.listByProject(p)).data ?? []
        }, pid)

      const own = await list(projectId)
      expect(own.find((v) => v.key === varKey)?.value).toBe(varVal)
      const other = await list(otherProjectId)
      expect(other.find((v) => v.key === varKey)).toBeUndefined()
    } finally {
      await window.evaluate(async ({ id, other }) => {
        const w = window as unknown as Window & {
          api: {
            globalVariable: { delete: (id: string) => Promise<unknown> }
            project: { delete: (id: string) => Promise<unknown> }
          }
        }
        await w.api.globalVariable.delete(id)
        await w.api.project.delete(other)
      }, { id: varId, other: otherProjectId })
    }
  })

  // -------------------------------------------------------------------------
  // MST-197 — App proxy: persisted, and the fallback a project without its own
  // proxy follows (issue #254 — the app proxy used to be read by nothing)
  // -------------------------------------------------------------------------
  uiTest('MST-197 app proxy persists and the project Proxy pane follows it', async ({ window }) => {
    const original = await getSetting(window, 'proxy')
    const projectId = await getActiveProjectId(window)
    const projectKey = `project.${projectId}.settings`
    const originalProject = (await getSetting(window, projectKey)) as Record<string, unknown> | undefined
    try {
      // The project hands its proxy back to the app ("Use app setting" = null).
      await setSetting(window, projectKey, { ...(originalProject ?? {}), proxy: null })

      await pressModShortcut(window, ',')
      const modal = window.getByTestId('settings-modal')
      await expect(modal).toBeVisible({ timeout: 8_000 })
      await expect(modal.getByTestId('app-settings-title')).toHaveText(
        /App settings \(all projects\)|Uygulama ayarları \(tüm projeler\)/,
      )
      await expect(modal.getByTestId('app-setting-override-note-proxy')).toBeVisible()

      await modal.getByLabel(/Proxy Settings|Proxy Ayarları/i).selectOption('custom')
      await modal.getByLabel(/^Host$|^Sunucu$/i).fill('127.0.0.1')
      await modal.getByLabel(/^Port$/i).fill('8080')
      await modal.getByTestId('app-proxy-username').fill('mst197')
      await modal.getByTestId('app-proxy-password').fill('mst197-pw')
      await modal.getByRole('button', { name: /^Save$|^Kaydet$/i }).click()
      await expect(modal).toBeHidden({ timeout: 5_000 })

      const saved = (await getSetting(window, 'proxy')) as {
        mode?: string
        host?: string
        port?: number
        auth?: { username?: string; password?: string }
      }
      expect(saved.mode).toBe('custom')
      expect(saved.host).toBe('127.0.0.1')
      expect(saved.port).toBe(8080)
      // settings:get decrypts — the round trip proves the password was kept.
      expect(saved.auth).toEqual({ username: 'mst197', password: 'mst197-pw' })

      // Reopen: the form reflects the persisted value.
      await pressModShortcut(window, ',')
      await expect(modal).toBeVisible({ timeout: 8_000 })
      await expect(modal.getByLabel(/Proxy Settings|Proxy Ayarları/i)).toHaveValue('custom')
      await expect(modal.getByLabel(/^Host$|^Sunucu$/i)).toHaveValue('127.0.0.1')

      // Cross-link to the project dialog: its Proxy pane says it follows the
      // app proxy just saved.
      await modal.getByTestId('settings-open-project-settings').click()
      const project = window.getByTestId('project-detail-modal')
      await expect(project).toBeVisible({ timeout: 8_000 })
      await expect(modal).toBeHidden({ timeout: 5_000 })
      await project.getByTestId('project-detail-tab-proxy').click()
      const scope = project.getByTestId('project-setting-scope-proxy')
      await expect(scope).toHaveAttribute('data-scope', 'app')
      await expect(scope).toContainText('127.0.0.1:8080')
      await expect(project.getByTestId('project-setting-reset-proxy')).toHaveCount(0)
      await window.keyboard.press('Escape')
      await expect(project).toBeHidden({ timeout: 5_000 })
    } finally {
      await dismissOverlays(window)
      // A leftover custom proxy now REALLY routes every later spec's requests.
      await setSetting(window, 'proxy', original ?? { mode: 'system' })
      await setSetting(window, projectKey, originalProject ?? {})
    }
  })

  // -------------------------------------------------------------------------
  // MST-198 — Updater check IPC (the in-app update card has its own specs:
  // shell-updater-ready-card.spec.ts, shell-updater.spec.ts)
  // -------------------------------------------------------------------------
  uiTest('MST-198 updater check-for-update IPC returns a result', async ({ window }) => {
    const res = await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api: { updater: { check: () => Promise<{ success: boolean; data?: unknown; error?: string }> } }
      }
      return w.api.updater.check()
    })
    // success:false is fine here (no release server in the test env) — but the
    // IPC must answer with the {success} envelope instead of throwing.
    expect(typeof res.success).toBe('boolean')
  })

  // -------------------------------------------------------------------------
  // MST-199 — Diagnostics export/reveal/licenses
  // -------------------------------------------------------------------------
  // Feature does not exist: there is no diagnostics / export-logs / open-log-file /
  // licenses UI in src (the About pane/modal only shows version info; covered by
  // about-i18n.spec.ts). Visible skip instead of a soft pass; a src feature
  // request, not a missing testid.
  uiTest.skip('MST-199 diagnostics export/reveal/licenses — no diagnostics UI exists in src (feature request)', async () => {})

  // -------------------------------------------------------------------------
  // MST-200 — SSL verify global toggle
  // -------------------------------------------------------------------------
  uiTest('MST-200 SSL verify global toggle persists', async ({ window }) => {
    const original = await getSetting(window, 'sslVerification')
    try {
      await pressModShortcut(window, ',')
      const modal = window.getByTestId('settings-modal')
      await expect(modal).toBeVisible({ timeout: 8_000 })

      const sslToggle = modal.getByLabel(/SSL Certificate Verification|SSL Sertifika Doğrulaması/i)
      const wasChecked = await sslToggle.isChecked()
      await sslToggle.setChecked(!wasChecked)
      await expect(sslToggle).toBeChecked({ checked: !wasChecked })
      await modal.getByRole('button', { name: /^Save$|^Kaydet$/i }).click()
      await expect(modal).toBeHidden({ timeout: 5_000 })

      expect(await getSetting(window, 'sslVerification')).toBe(!wasChecked)

      // Reopen: toggle shows the persisted value.
      await pressModShortcut(window, ',')
      await expect(modal).toBeVisible({ timeout: 8_000 })
      await expect(
        modal.getByLabel(/SSL Certificate Verification|SSL Sertifika Doğrulaması/i),
      ).toBeChecked({ checked: !wasChecked })
    } finally {
      await dismissOverlays(window)
      // SSL verification OFF would leak into later specs (and is a security default).
      await setSetting(window, 'sslVerification', original ?? true)
    }
  })
})
