/**
 * MST-266 P0 — Full app relaunch state restore
 *
 * Launches a dedicated Electron instance (NOT the shared worker fixture),
 * creates state, closes the process, relaunches with the same userDataDir,
 * and asserts the state was restored from the on-disk SQLite DB.
 *
 * Follows the same pattern as shell-relaunch.spec.ts (MST-221/246) but
 * focuses on DB-level content persistence: workspaces, projects, endpoints,
 * environments, branches.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { electronLaunchOptions } from '../../helpers/electron-env'
import { bootstrapWorkbench } from '../../helpers/ui/bootstrap'

const mainPath = path.resolve(__dirname, '../../../../out/main/index.js')
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function launchApp(
  userDataDir: string,
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

test.describe('Tur1 — DB relaunch state restore [MST-266]', () => {
  test('MST-266 project and endpoint data survive full close/relaunch', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-db-relaunch-'))
    let app: ElectronApplication | undefined

    try {
      // ── First launch: create project and endpoint ────────────────────
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      await bootstrapWorkbench(launch1.window)

      const wsId = await launch1.window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
        }
        const res = await w.api?.workspace?.list()
        const id = res?.data?.[0]?.id
        if (!id) throw new Error('no workspace')
        return id
      })

      // Create a fresh project with a unique name to avoid collision with the
      // canonical E2E project already seeded by bootstrapWorkbench.
      const projectName = `RelaunchProject-${uid()}`
      const projectId = await launch1.window.evaluate(
        async ({ wid, name }) => {
          const w = window as unknown as Window & {
            api?: {
              project?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }> }
            }
          }
          const res = await w.api?.project?.create({ workspace_id: wid, name, type: 'http' })
          if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'project create failed')
          return res.data.id
        },
        { wid: wsId, name: projectName },
      )

      // Create a saved request under that project
      const reqName = `RelaunchReq-${uid()}`
      const reqId = await launch1.window.evaluate(
        async ({ pid, name }) => {
          const w = window as unknown as Window & {
            api?: {
              savedRequest?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }> }
            }
          }
          const res = await w.api?.savedRequest?.create({
            project_id: pid,
            name,
            method: 'GET',
            url: 'http://127.0.0.1/relaunch-test',
          })
          if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'saved request create failed')
          return res.data.id
        },
        { pid: projectId, name: reqName },
      )

      expect(reqId.length).toBeGreaterThan(0)

      // Flush and close
      await launch1.window.waitForTimeout(500)
      await app.close()
      app = undefined
      await new Promise<void>((r) => setTimeout(r, 1_000))

      // ── Second launch: same userDataDir ──────────────────────────────
      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      await bootstrapWorkbench(launch2.window)

      // Workspace must still exist
      const wsRestored = await launch2.window.evaluate(async (wid) => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
        }
        const res = await w.api?.workspace?.list()
        return res?.data?.some((ws) => ws.id === wid) ?? false
      }, wsId)
      expect(wsRestored).toBe(true)

      // Project must still exist
      const projectRestored = await launch2.window.evaluate(
        async ({ wid, pid }) => {
          const w = window as unknown as Window & {
            api?: {
              project?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }> }
            }
          }
          const res = await w.api?.project?.list(wid)
          return res?.data?.some((p) => p.id === pid) ?? false
        },
        { wid: wsId, pid: projectId },
      )
      expect(projectRestored).toBe(true)

      // Saved request must still exist
      const reqRestored = await launch2.window.evaluate(
        async ({ pid, rid }) => {
          const w = window as unknown as Window & {
            api?: {
              savedRequest?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }> }
            }
          }
          const res = await w.api?.savedRequest?.list(pid)
          return res?.data?.some((r) => r.id === rid) ?? false
        },
        { pid: projectId, rid: reqId },
      )
      expect(reqRestored).toBe(true)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-266 environment and variables survive full relaunch', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-env-relaunch-'))
    let app: ElectronApplication | undefined

    try {
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      await bootstrapWorkbench(launch1.window)

      const wsId = await launch1.window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
        }
        const res = await w.api?.workspace?.list()
        const id = res?.data?.[0]?.id
        if (!id) throw new Error('no workspace')
        return id
      })

      const projectId = await launch1.window.evaluate(async (wid) => {
        const w = window as unknown as Window & {
          api?: {
            project?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }> }
          }
        }
        const res = await w.api?.project?.list(wid)
        const id = res?.data?.[0]?.id
        if (!id) throw new Error('no project')
        return id
      }, wsId)

      const envName = `EnvRelaunch-${uid()}`
      const envId = await launch1.window.evaluate(
        async ({ wid, pid, name }) => {
          const w = window as unknown as Window & {
            api?: {
              environment?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }> }
            }
          }
          const res = await w.api?.environment?.create({ workspace_id: wid, project_id: pid, name })
          if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'env create failed')
          return res.data.id
        },
        { wid: wsId, pid: projectId, name: envName },
      )

      // Add a variable to the environment
      const varKey = `VAR_${uid().replace(/-/g, '_').toUpperCase()}`
      await launch1.window.evaluate(
        async ({ eid, key }) => {
          const w = window as unknown as Window & {
            api?: {
              envVariable?: { create: (p: unknown) => Promise<{ success: boolean; error?: string }> }
            }
          }
          const res = await w.api?.envVariable?.create({
            environment_id: eid,
            key,
            value: 'hello',
            initial_value: 'hello',
          })
          if (!res?.success) throw new Error(res?.error ?? 'var create failed')
        },
        { eid: envId, key: varKey },
      )

      await launch1.window.waitForTimeout(500)
      await app.close()
      app = undefined
      await new Promise<void>((r) => setTimeout(r, 1_000))

      // ── Second launch ────────────────────────────────────────────────
      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      await bootstrapWorkbench(launch2.window)

      const envVars = await launch2.window.evaluate(async (eid) => {
        const w = window as unknown as Window & {
          api?: {
            envVariable?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ key: string; value: string }> }> }
          }
        }
        const res = await w.api?.envVariable?.list(eid)
        return res?.data ?? []
      }, envId)

      const found = (envVars as Array<{ key: string; value: string }>).find(
        (v) => v.key === varKey,
      )
      expect(found).toBeDefined()
      expect(found?.value).toBe('hello')
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-266 branch records survive full relaunch', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-branch-relaunch-'))
    let app: ElectronApplication | undefined

    try {
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      await bootstrapWorkbench(launch1.window)

      const wsId = await launch1.window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
        }
        const res = await w.api?.workspace?.list()
        return res?.data?.[0]?.id ?? ''
      })

      const projectId = await launch1.window.evaluate(async (wid) => {
        const w = window as unknown as Window & {
          api?: {
            project?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }> }
          }
        }
        const res = await w.api?.project?.list(wid)
        return res?.data?.[0]?.id ?? ''
      }, wsId)

      const branchName = `relaunch-branch-${uid()}`
      const branchId = await launch1.window.evaluate(
        async ({ pid, name }) => {
          const w = window as unknown as Window & {
            api?: {
              branch?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }> }
            }
          }
          const res = await w.api?.branch?.create({ project_id: pid, name })
          if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'branch create failed')
          return res.data.id
        },
        { pid: projectId, name: branchName },
      )

      await launch1.window.waitForTimeout(500)
      await app.close()
      app = undefined
      await new Promise<void>((r) => setTimeout(r, 1_000))

      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      await bootstrapWorkbench(launch2.window)

      const branches = await launch2.window.evaluate(async (pid) => {
        const w = window as unknown as Window & {
          api?: {
            branch?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string; name: string }> }> }
          }
        }
        const res = await w.api?.branch?.list(pid)
        return res?.data ?? []
      }, projectId)

      const found = (branches as Array<{ id: string; name: string }>).find(
        (b) => b.id === branchId,
      )
      expect(found).toBeDefined()
      expect(found?.name).toBe(branchName)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
