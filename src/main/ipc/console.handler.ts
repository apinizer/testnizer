import { ipcMain } from 'electron'
import { getDb } from '../db/database'
import {
  getConsoleShowSecrets,
  maskRendererConsoleEntry,
  setConsoleSecretSource,
  setConsoleShowSecrets,
} from '../lib/console-logger'
import type { ConsoleEntryLike } from '../lib/sensitive-scrub'
import { cachedSecretInventory } from '../lib/secret-inventory-cache'

/**
 * Console masking (issue #196).
 *
 * Every Console entry is masked in main before it is sent (`emitConsoleEntry`):
 * credential header / param / field names plus the values of variables marked
 * secret. The per-session "Show secrets" toggle lives in main's memory only —
 * never persisted — and affects entries emitted AFTER it is turned on; earlier
 * entries were masked when they left main and stay that way.
 */
export function registerConsoleHandlers(): void {
  // Cached (invalidated on variable writes + short TTL) — a stream emits an
  // entry per frame and must not run the inventory query each time.
  setConsoleSecretSource(() => {
    try {
      return cachedSecretInventory(getDb()).values
    } catch {
      return []
    }
  })

  ipcMain.handle('console:setShowSecrets', async (_event, on: unknown) => {
    try {
      setConsoleShowSecrets(on === true)
      return { success: true, data: getConsoleShowSecrets() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // Entries the renderer builds itself (Send-path script `console.*` output)
  // are masked through main too — same helper, same toggle as main's own.
  ipcMain.handle('console:maskEntry', async (_event, entry: unknown) => {
    try {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { success: false, error: 'Invalid console entry' }
      }
      return { success: true, data: maskRendererConsoleEntry(entry as ConsoleEntryLike) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('console:getShowSecrets', async () => {
    try {
      return { success: true, data: getConsoleShowSecrets() }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
