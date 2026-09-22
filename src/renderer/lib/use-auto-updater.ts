import { useEffect } from 'react'
import { useUpdaterStore } from '../stores/updater.store'
import { useUIStore } from '../stores/ui.store'

/**
 * Drives the "Automatically check / download updates" toggles, which were
 * previously inert — saved in project settings but read by nothing, so the app
 * only ever updated when the user opened Settings and clicked "Check for
 * updates" (user-reported: "both options checked but auto-update doesn't
 * happen").
 *
 * Wiring lives in the renderer to mirror the existing manual flow (which already
 * drives `check()` / `download()` over IPC); the main process leaves
 * autoDownload off and does no polling of its own.
 *
 * Scope: update prefs live in per-project settings (`project.<id>.settings`), so
 * we read the ACTIVE project's toggles and re-read them whenever the active
 * project changes. Offline-first is preserved — a check is skipped while the OS
 * reports no connection.
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // re-check every 6h while the app runs
const INITIAL_CHECK_DELAY_MS = 4000 // let the project finish loading before hitting the network

interface UpdatePrefs {
  autoCheckUpdates?: boolean
  autoDownloadUpdates?: boolean
}

function runCheck(): void {
  // Offline-first: never reach out when the OS reports no connection.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  const s = useUpdaterStore.getState()
  // Once an update has been found (available/downloading/ready) there's nothing
  // to gain from re-checking until the app restarts — except when the found
  // version is one the user skipped: a NEWER release later the same day must
  // still be noticed, so a skipped 'available' keeps polling.
  if (s.status === 'downloading' || s.status === 'ready') return
  if (s.status === 'available' && !(s.version && s.skippedVersion === s.version)) return
  s.check()
}

export function useAutoUpdater(activeProjectId: string | null): void {
  useEffect(() => {
    if (!activeProjectId) return
    let cancelled = false
    let initial: ReturnType<typeof setTimeout> | undefined
    let interval: ReturnType<typeof setInterval> | undefined

    void (async () => {
      let prefs: UpdatePrefs = {}
      try {
        const res = (await window.api?.settings?.get(`project.${activeProjectId}.settings`)) as
          | { success: boolean; data?: UpdatePrefs }
          | undefined
        if (res?.success && res.data) prefs = res.data
      } catch {
        // Settings unreadable → fall through to defaults below.
      }
      if (cancelled) return

      // Defaults match DEFAULT_SETTINGS in ProjectDetailModal: check on,
      // download on — the update fetches in the background and the user is
      // only asked once it is ready (Cursor / Postman behaviour).
      const autoCheck = prefs.autoCheckUpdates ?? true
      const autoDownload = prefs.autoDownloadUpdates ?? true
      useUpdaterStore.getState().setAutoDownload(autoDownload)

      // "Skip this version" is global, not per project.
      try {
        const skipped = (await window.api?.settings?.get('updater.skippedVersion')) as
          | { success: boolean; data?: unknown }
          | undefined
        if (skipped?.success && typeof skipped.data === 'string' && skipped.data) {
          useUpdaterStore.getState().setSkippedVersion(skipped.data)
        }
      } catch {
        /* no skipped version recorded */
      }
      if (cancelled) return

      if (!autoCheck) return
      initial = setTimeout(runCheck, INITIAL_CHECK_DELAY_MS)
      interval = setInterval(runCheck, CHECK_INTERVAL_MS)
    })()

    return () => {
      cancelled = true
      if (initial) clearTimeout(initial)
      if (interval) clearInterval(interval)
    }
  }, [activeProjectId])

  // A background check/download stays invisible until the update is READY.
  // Then the non-blocking "ready" card opens (UpdateReadyPrompt) — never the
  // modal, which used to pop up the moment a version was merely *available*
  // and got in the way of whatever the user was doing. When the user has
  // the Update dialog open they are driving the flow themselves, so the
  // dialog's own Restart / Later buttons apply instead. Registered once.
  useEffect(() => {
    return useUpdaterStore.subscribe((state, prev) => {
      if (state.status === prev.status) return
      const ui = useUIStore.getState()
      // "Restart & install" from the card failed: the card is gone and the
      // dialog is the only surface with the error text + manual-download
      // link, so open it rather than fail silently.
      if (prev.status === 'ready' && state.status === 'error' && !ui.showUpdateModal) {
        ui.setShowUpdateModal(true)
        return
      }
      if (state.status !== 'ready') return
      if (ui.showUpdateModal) return
      if (state.version && state.skippedVersion === state.version) return
      state.setReadyPromptOpen(true)
    })
  }, [])
}
