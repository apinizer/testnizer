/**
 * MST-280 P2 — WAL crash simulation / recovery
 *
 * Simulates a partial WAL (Write-Ahead Log) scenario by:
 * 1. Bootstrapping a fresh app instance and writing data.
 * 2. Killing the process mid-run (simulated by close() before WAL checkpoint).
 * 3. Manipulating the WAL/SHM files to force a recovery path.
 * 4. Relaunching and verifying the DB is consistent.
 *
 * SQLite's WAL mode is self-healing on a fresh open — the database will replay
 * or discard the partial WAL.  This test confirms no data is silently lost
 * from rows that were fully committed before the simulated crash.
 *
 * Requires: `npm run build` first (uses the compiled Electron app).
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

test.describe('Tur1 — DB WAL recovery [MST-280]', () => {
  test('MST-280 committed rows survive app.close() without explicit WAL checkpoint', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-wal-'))
    let app: ElectronApplication | undefined

    try {
      // ── First launch: write data ─────────────────────────────────────
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      await bootstrapWorkbench(launch1.window)

      const wsId = await launch1.window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
        }
        return (await w.api?.workspace?.list())?.data?.[0]?.id ?? ''
      })

      const projectId = await launch1.window.evaluate(async (wid) => {
        const w = window as unknown as Window & {
          api?: {
            project?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }> }
          }
        }
        return (await w.api?.project?.list(wid))?.data?.[0]?.id ?? ''
      }, wsId)

      // Write a batch of saved requests — these go through IPC → SQLite WAL
      const reqName = `WAL-req-${uid()}`
      const reqId = await launch1.window.evaluate(
        async ({ pid, name }) => {
          const w = window as unknown as Window & {
            api?: {
              savedRequest?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string } }> }
            }
          }
          const res = await w.api?.savedRequest?.create({
            project_id: pid,
            name,
            method: 'GET',
            url: 'http://127.0.0.1/wal-test',
          })
          return res?.data?.id ?? ''
        },
        { pid: projectId, name: reqName },
      )

      // Close the app without giving it time to checkpoint (simulate crash by
      // closing quickly).  app.close() sends SIGTERM so the process ends, but
      // SQLite WAL is not explicitly checkpointed by the app code.
      await launch1.window.waitForTimeout(200) // minimal pause
      await app.close()
      app = undefined

      // Check WAL file existence (informational — may or may not exist)
      const dbPath = path.join(userDataDir, 'testnizer.db')
      const walPath = dbPath + '-wal'
      const walExisted = fs.existsSync(walPath)
      // Log for diagnostic purposes; don't assert — some OS/SQLite combos
      // checkpoint automatically before close.
      console.log(`WAL file existed after close: ${walExisted}`)

      await new Promise<void>((r) => setTimeout(r, 1_000))

      // ── Second launch: verify recovery ──────────────────────────────
      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      await bootstrapWorkbench(launch2.window)

      // The committed row must be readable after WAL recovery
      const list = await launch2.window.evaluate(async (pid) => {
        const w = window as unknown as Window & {
          api?: {
            savedRequest?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string; name: string }> }> }
          }
        }
        return (await w.api?.savedRequest?.list(pid))?.data ?? []
      }, projectId)

      const found = (list as Array<{ id: string; name: string }>).find((r) => r.id === reqId)
      expect(found).toBeDefined()
      expect(found?.name).toBe(reqName)

      // NOTE: the original assertion "WAL file is gone after reopen" is wrong —
      // in WAL mode SQLite keeps the -wal sidecar for the lifetime of an open
      // connection, and the app is still running here (launch2). The real
      // guarantee MST-280 verifies is that the committed row survived the
      // close-without-explicit-checkpoint (asserted above). We only sanity-check
      // that the main DB file is intact.
      void walPath
      expect(fs.existsSync(dbPath)).toBe(true)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-280 corrupt WAL file does not prevent app startup', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-wal-corrupt-'))
    let app: ElectronApplication | undefined

    try {
      // First launch: generate a real DB file
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      await bootstrapWorkbench(launch1.window)
      await launch1.window.waitForTimeout(300)
      await app.close()
      app = undefined
      await new Promise<void>((r) => setTimeout(r, 800))

      // Inject a corrupt WAL file — SQLite will notice the invalid header and
      // discard it, keeping the main DB file intact.
      const dbPath = path.join(userDataDir, 'testnizer.db')
      const walPath = dbPath + '-wal'
      const shmPath = dbPath + '-shm'
      // Write an invalid WAL header (valid DB page size but bad magic number)
      fs.writeFileSync(walPath, Buffer.from('INVALID_WAL_MAGIC_NUMBER_FAKE_HEADER_DATA_XYZABC'))
      // SHM is the shared memory file — also overwrite to force re-creation
      if (fs.existsSync(shmPath)) {
        fs.writeFileSync(shmPath, Buffer.alloc(32768)) // zeroed 32k block
      }

      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      const win2 = launch2.window

      // App must start and IPC bridge must become available
      await win2.waitForFunction(
        () => !!(window as unknown as Window & { api?: { eula?: unknown } }).api?.eula,
        { timeout: 45_000 },
      )

      // DB must be queryable
      const wsRes = await win2.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: unknown[] }> } }
        }
        return w.api?.workspace?.list()
      })
      expect(wsRes?.success).toBe(true)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
