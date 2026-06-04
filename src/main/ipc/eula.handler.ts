// src/main/ipc/eula.handler.ts
//
// IPC for the EULA / Privacy consent gate.
//
//   eula:state    →  current persisted state + current docs hash + version
//   eula:accept   →  mark accepted, persist {version, hash, timestamp}
//   eula:decline  →  app.quit()
//
// Defensive: `eula:state` never throws — read failures return the empty
// (not-accepted) state so the renderer renders the consent gate, which is
// the safe fallback.

import { app, ipcMain } from 'electron'
import {
  getConsentState,
  hashDocs,
  setAccepted,
  clearConsent,
  isConsentValid,
} from '../lib/eula-consent'

export function registerEulaHandlers(): void {
  ipcMain.handle('eula:state', async () => {
    try {
      const state = await getConsentState()
      const currentDocsHash = hashDocs()
      const version = (() => {
        try {
          return app.getVersion()
        } catch {
          return ''
        }
      })()
      return {
        success: true,
        data: {
          state,
          currentDocsHash,
          currentVersion: version,
          consentValid: isConsentValid(state, currentDocsHash),
        },
      }
    } catch (e) {
      // Return a safe default so the renderer still shows the gate.
      return {
        success: true,
        data: {
          state: {
            accepted: false,
            acceptedAt: 0,
            acceptedVersion: '',
            acceptedDocsHash: '',
          },
          currentDocsHash: '',
          currentVersion: '',
          consentValid: false,
          warning: (e as Error).message,
        },
      }
    }
  })

  ipcMain.handle('eula:accept', async () => {
    try {
      const hash = hashDocs()
      const version = (() => {
        try {
          return app.getVersion()
        } catch {
          return ''
        }
      })()
      const next = await setAccepted(version, hash)
      return { success: true, data: next }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('eula:decline', async () => {
    // Persisting nothing — declining never records consent.
    try {
      // Schedule the quit on the next tick so this IPC call has a chance
      // to return cleanly to the renderer before the window tears down.
      setImmediate(() => {
        try {
          app.quit()
        } catch {
          // Quitting from a not-yet-ready app: force exit as a fallback.
          process.exit(0)
        }
      })
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // Diagnostic / test helper — clears persisted consent so the gate
  // reappears on next launch. Not wired to any UI by default; useful for
  // QA scripts and troubleshooting.
  ipcMain.handle('eula:reset', async () => {
    try {
      await clearConsent()
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
