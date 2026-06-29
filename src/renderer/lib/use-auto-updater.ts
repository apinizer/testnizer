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
  // to gain from re-checking until the app restarts — and skipping it stops the
  // periodic timer from re-opening a modal the user already dismissed.
  if (s.status === 'available' || s.status === 'downloading' || s.status === 'ready') return
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

      // Defaults match DEFAULT_SETTINGS in ProjectDetailModal: check on, download off.
      const autoCheck = prefs.autoCheckUpdates ?? true
      const autoDownload = prefs.autoDownloadUpdates ?? false
      useUpdaterStore.getState().setAutoDownload(autoDownload)

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

  // A background check/download is otherwise invisible — the UpdateModal only
  // opens when the user opens it. Surface a background-found update by opening
  // that same modal (reusing its download / restart actions) the first time the
  // status reaches 'available' or 'ready', unless the user already has it open
  // (the manual flow drives those states itself). Registered once.
  useEffect(() => {
    return useUpdaterStore.subscribe((state, prev) => {
      if (state.status === prev.status) return
      if (state.status !== 'available' && state.status !== 'ready') return
      const ui = useUIStore.getState()
      if (!ui.showUpdateModal) ui.setShowUpdateModal(true)
    })
  }, [])
}
