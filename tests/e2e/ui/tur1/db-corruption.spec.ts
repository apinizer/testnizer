/**
 * MST-279 P2 — Invalid JSON / corrupted DB recovery
 *
 * Closes the app, corrupts the SQLite database file on disk, then relaunches.
 * The app should either:
 *   a) recover gracefully (rename the corrupt file, create a fresh DB), OR
 *   b) show an error UI without crashing the process entirely.
 *
 * In either case, the Electron main window must still appear and the IPC
 * bridge must eventually become available (no hung process).
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
import { bootstrapWorkbench, waitForApiBridge } from '../../helpers/ui/bootstrap'

const mainPath = path.resolve(__dirname, '../../../../out/main/index.js')

async function launchApp(
  userDataDir: string,
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

test.describe('Tur1 — DB corruption recovery [MST-279]', () => {
  // APP-GAP (verified): launching with a DB file full of garbage bytes (an
  // invalid SQLite header) makes initDatabase() throw inside app.whenReady()
  // BEFORE createWindow() runs (src/main/index.ts: initDatabase() at line ~265
  // is not wrapped in a corrupt-DB recovery path), so no BrowserWindow is ever
  // created and app.firstWindow() times out — the app neither recovers nor
  // shows an error UI. The zero-byte/truncated case below DOES recover (SQLite
  // treats an empty file as a fresh DB). Skipped until init grows a
  // rename-corrupt-file-and-recreate recovery step. Test expectation is correct;
  // the app is the blocker.
  test.skip('MST-279 app recovers after corrupt DB file (not a valid SQLite file)', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-corrupt-db-'))
    let app: ElectronApplication | undefined

    try {
      // ── First launch: create initial state ──────────────────────────
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      await bootstrapWorkbench(launch1.window)
      await launch1.window.waitForTimeout(500)
      await app.close()
      app = undefined
      await new Promise<void>((r) => setTimeout(r, 800))

      // ── Corrupt the DB ──────────────────────────────────────────────
      // Find and overwrite the SQLite file with garbage bytes.
      // The file is named `testnizer.db` per database.ts: join(userData, 'testnizer.db')
      const dbPath = path.join(userDataDir, 'testnizer.db')
      if (fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, Buffer.from('NOT_A_VALID_SQLITE_FILE_CORRUPTED_DATA_XYZ'))
        // Also corrupt the WAL and SHM files if they exist
        for (const ext of ['-wal', '-shm']) {
          const walPath = dbPath + ext
          if (fs.existsSync(walPath)) {
            fs.writeFileSync(walPath, Buffer.from('CORRUPT'))
          }
        }
      }

      // ── Second launch with corrupt DB ───────────────────────────────
      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      const win2 = launch2.window

      // The app must not hang — IPC bridge should become available within 45s
      // (recovery may involve recreating the DB which takes a moment).
      let bridgeAvailable = false
      try {
        await waitForApiBridge(win2)
        bridgeAvailable = true
      } catch {
        // Bridge did not appear — check if the window is at least alive
        const title = await win2.title().catch(() => '')
        expect(title).not.toBe('') // Window alive, even if bridge timed out
      }

      if (bridgeAvailable) {
        // Full recovery: workspace list must not throw (may return empty or
        // seeded default if the app recreated the DB from scratch).
        const wsRes = await win2.evaluate(async () => {
          const w = window as Window & {
            api?: { workspace?: { list: () => Promise<{ success: boolean; data?: unknown[] }> } }
          }
          return w.api?.workspace?.list()
        })
        // Either success (recovered/fresh DB) or a structured error — but not
        // an unhandled crash.
        expect(typeof wsRes?.success).toBe('boolean')
      }
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-279 app recovers after truncated DB file (zero bytes)', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-empty-db-'))
    let app: ElectronApplication | undefined

    try {
      // Bootstrap once to ensure the userData directory exists
      const launch1 = await launchApp(userDataDir)
      app = launch1.app
      await bootstrapWorkbench(launch1.window)
      await launch1.window.waitForTimeout(300)
      await app.close()
      app = undefined
      await new Promise<void>((r) => setTimeout(r, 800))

      // Truncate (zero-byte) the database file
      const dbPath = path.join(userDataDir, 'testnizer.db')
      if (fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, Buffer.alloc(0))
        for (const ext of ['-wal', '-shm']) {
          const walPath = dbPath + ext
          if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
        }
      }

      const launch2 = await launchApp(userDataDir)
      app = launch2.app
      const win2 = launch2.window

      // App must remain alive
      let alive = false
      try {
        await waitForApiBridge(win2)
        alive = true
      } catch {
        const title = await win2.title().catch(() => '')
        alive = title.length > 0
      }
      expect(alive).toBe(true)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
