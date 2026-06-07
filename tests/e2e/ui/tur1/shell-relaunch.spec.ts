/**
 * MST-221 — App relaunch full state restore
 * MST-246 — Settings persist across relaunch
 *
 * Launches a fresh Electron instance, performs setup actions, closes the app,
 * then relaunches with the SAME userDataDir and asserts state is restored.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { electronLaunchOptions } from '../../helpers/electron-env'
import { bootstrapWorkbench } from '../../helpers/ui/bootstrap'

const mainPath = path.resolve(__dirname, '../../../../out/main/index.js')

/** Launch Electron and return app + first window, ready after bootstrapWorkbench. */
async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

test.describe('Tur1 — App relaunch state restore [MST-221, MST-246]', () => {
  test('MST-221 workspace data persists across full close/relaunch', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-relaunch-e2e-'))
    let app: ElectronApplication | undefined

    try {
      // ── First launch: bootstrap and create a workspace ──────────────
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      await bootstrapWorkbench(launch1.window)

      // List workspaces — should have at least one after bootstrap
      const workspacesAfterSetup = await launch1.window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string; name: string }> }> } }
        }
        return w.api?.workspace?.list()
      })
      expect(workspacesAfterSetup?.success).toBe(true)
      const wsCount = workspacesAfterSetup?.data?.length ?? 0
      expect(wsCount).toBeGreaterThan(0)

      const wsId = workspacesAfterSetup!.data![0].id

      // ── Close (full process exit) ────────────────────────────────────
      await app.close()
      app = undefined
      // Small pause to ensure OS file handles are released
      await new Promise((r) => setTimeout(r, 800))

      // ── Second launch: same userDataDir ─────────────────────────────
      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      const win2 = launch2.window
      await bootstrapWorkbench(win2)

      const workspacesRestored = await win2.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string; name: string }> }> } }
        }
        return w.api?.workspace?.list()
      })
      expect(workspacesRestored?.success).toBe(true)
      const restoredCount = workspacesRestored?.data?.length ?? 0
      expect(restoredCount).toBeGreaterThanOrEqual(wsCount)
      // The workspace ID should still exist
      const found = workspacesRestored!.data!.find((ws) => ws.id === wsId)
      expect(found).toBeDefined()
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-246 settings (theme, language) persist across full close/relaunch', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-settings-relaunch-e2e-'))
    let app: ElectronApplication | undefined

    try {
      // ── First launch ────────────────────────────────────────────────
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      const win1 = launch1.window
      await bootstrapWorkbench(win1)

      // Write settings
      const setRes = await win1.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            settings?: {
              set: (k: string, v: unknown) => Promise<{ success: boolean }>
              setAll: (s: unknown) => Promise<{ success: boolean }>
            }
          }
        }
        await w.api?.settings?.set('theme', 'dark')
        await w.api?.settings?.set('language', 'tr')
        await w.api?.settings?.set('historyLimit', 250)
        return { done: true }
      })
      expect(setRes.done).toBe(true)

      await win1.waitForTimeout(400)
      await app.close()
      app = undefined
      await new Promise((r) => setTimeout(r, 800))

      // ── Second launch ───────────────────────────────────────────────
      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      const win2 = launch2.window
      await bootstrapWorkbench(win2)

      const restored = await win2.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            settings?: {
              get: (k: string) => Promise<{ success: boolean; data?: unknown }>
            }
          }
        }
        const [theme, language, historyLimit] = await Promise.all([
          w.api?.settings?.get('theme'),
          w.api?.settings?.get('language'),
          w.api?.settings?.get('historyLimit'),
        ])
        return { theme: theme?.data, language: language?.data, historyLimit: historyLimit?.data }
      })

      expect(restored.theme).toBe('dark')
      expect(restored.language).toBe('tr')
      expect(restored.historyLimit).toBe(250)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-246 EULA consent persists across relaunch (no re-prompt)', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-eula-persist-e2e-'))
    let app: ElectronApplication | undefined

    try {
      // ── First launch: accept EULA ────────────────────────────────────
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      const win1 = launch1.window
      await bootstrapWorkbench(win1)

      // eula:state returns data: { state: { accepted, ... }, consentValid, ... }
      // — the accepted flag is nested under data.state, not data directly.
      const eulaState1 = await win1.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            eula?: {
              state: () => Promise<{
                success: boolean
                data?: { state?: { accepted: boolean }; consentValid?: boolean }
              }>
            }
          }
        }
        return w.api?.eula?.state()
      })
      expect(eulaState1?.data?.state?.accepted).toBe(true)

      await app.close()
      app = undefined
      await new Promise((r) => setTimeout(r, 800))

      // ── Second launch: EULA gate should NOT appear ──────────────────
      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      const win2 = launch2.window
      await win2.waitForLoadState('domcontentloaded')
      // Wait for IPC bridge
      await win2.waitForFunction(() => !!(window as unknown as Window & { api?: { eula?: unknown } }).api?.eula, {
        timeout: 30_000,
      })
      await win2.waitForTimeout(1000)

      // EULA gate should not be visible
      const eulaGateVisible = await win2.getByTestId('eula-gate').isVisible().catch(() => false)
      expect(eulaGateVisible).toBe(false)

      // EULA state via IPC: still accepted (nested under data.state — see above)
      const eulaState2 = await win2.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: {
            eula?: {
              state: () => Promise<{
                success: boolean
                data?: { state?: { accepted: boolean }; consentValid?: boolean }
              }>
            }
          }
        }
        return w.api?.eula?.state()
      })
      expect(eulaState2?.data?.state?.accepted).toBe(true)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-221 projects created in first launch visible in second launch', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-project-persist-e2e-'))
    let app: ElectronApplication | undefined

    try {
      // ── First launch ────────────────────────────────────────────────
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      await bootstrapWorkbench(launch1.window)

      // Get workspace and projects
      const wsRes = await launch1.window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
        }
        return w.api?.workspace?.list()
      })
      const wsId = wsRes?.data?.[0]?.id
      expect(wsId).toBeTruthy()

      const projectsFirst = await launch1.window.evaluate(async (wid) => {
        const w = window as unknown as Window & {
          api?: { project?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string; name: string }> }> } }
        }
        return w.api?.project?.list(wid)
      }, wsId as string)
      expect(projectsFirst?.success).toBe(true)
      const projectCountFirst = projectsFirst?.data?.length ?? 0
      expect(projectCountFirst).toBeGreaterThan(0)

      await app.close()
      app = undefined
      await new Promise((r) => setTimeout(r, 800))

      // ── Second launch ───────────────────────────────────────────────
      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      await bootstrapWorkbench(launch2.window)

      const projectsSecond = await launch2.window.evaluate(async (wid) => {
        const w = window as unknown as Window & {
          api?: { project?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string; name: string }> }> } }
        }
        return w.api?.project?.list(wid)
      }, wsId as string)
      expect(projectsSecond?.success).toBe(true)
      expect(projectsSecond?.data?.length).toBeGreaterThanOrEqual(projectCountFirst)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
