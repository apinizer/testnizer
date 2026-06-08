import { create } from 'zustand'

// `idle` = never checked this session (neutral — DON'T claim "up to date").
// `up-to-date` = a check ran and returned no newer version. Keeping these
// distinct stops the modal from greeting a fresh open with a green "you're up
// to date" before any check has actually happened (user-reported).
type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
  | 'error'

interface UpdaterStore {
  status: UpdateStatus
  version: string | null
  releaseNotes: string | null
  downloadPercent: number
  errorMessage: string | null

  check: () => void
  download: () => void
  install: () => void
  reset: () => void
  setStatus: (status: UpdateStatus) => void
  setVersion: (version: string) => void
  setReleaseNotes: (notes: string) => void
  setDownloadPercent: (percent: number) => void
  setError: (message: string) => void
}

export const useUpdaterStore = create<UpdaterStore>((set) => ({
  status: 'idle',
  version: null,
  releaseNotes: null,
  downloadPercent: 0,
  errorMessage: null,

  check: () => {
    set({ status: 'checking', errorMessage: null })
    // Delegate to main process via IPC. The IPC handler doesn't reject the
    // Promise on failure — it resolves with `{ success: false, error }` —
    // so we also have to inspect the success flag and surface the real
    // error message. Previously only the Promise-reject path was handled,
    // so a stub or "Auto-updater not configured" reply left the modal
    // stuck on "checking" with no feedback (v1.4.3 user-reported bug).
    if (window.api?.updater?.check) {
      void window.api.updater
        .check()
        .then((result: { success: boolean; error?: string } | undefined) => {
          if (result && result.success === false) {
            set({ status: 'error', errorMessage: result.error || 'Update check failed' })
          }
        })
        .catch((err: Error) => {
          set({ status: 'error', errorMessage: err.message })
        })
    } else {
      // Simulate for development
      setTimeout(() => {
        set({ status: 'available', version: '1.1.0', releaseNotes: 'Bug fixes and improvements.' })
      }, 1500)
    }
  },

  download: () => {
    set({ status: 'downloading', downloadPercent: 0 })
    if (window.api?.updater?.download) {
      void window.api.updater
        .download()
        .then((result: { success: boolean; error?: string } | undefined) => {
          if (result && result.success === false) {
            set({ status: 'error', errorMessage: result.error || 'Download failed' })
          }
        })
        .catch((err: Error) => {
          set({ status: 'error', errorMessage: err.message })
        })
    } else {
      // Simulate download progress for development
      let percent = 0
      const interval = setInterval(() => {
        percent += 15
        if (percent >= 100) {
          clearInterval(interval)
          set({ status: 'ready', downloadPercent: 100 })
        } else {
          set({ downloadPercent: percent })
        }
      }, 400)
    }
  },

  install: () => {
    if (window.api?.updater?.install) {
      window.api.updater.install()
    }
  },

  reset: () =>
    set({
      status: 'idle',
      version: null,
      releaseNotes: null,
      downloadPercent: 0,
      errorMessage: null,
    }),

  setStatus: (status) => set({ status }),
  setVersion: (version) => set({ version }),
  setReleaseNotes: (notes) => set({ releaseNotes: notes }),
  setDownloadPercent: (percent) => set({ downloadPercent: percent }),
  setError: (message) => set({ status: 'error', errorMessage: message }),
}))

/**
 * Subscribe to updater events from main process.
 * Call once at app startup.
 */
export function initUpdaterListeners(): (() => void) | undefined {
  if (!window.api?.updater?.onEvent) return undefined

  const cleanup = window.api.updater.onEvent((event) => {
    const store = useUpdaterStore.getState()

    switch (event.type) {
      case 'checking':
        store.setStatus('checking')
        break
      case 'available':
        store.setStatus('available')
        if (event.version) store.setVersion(event.version)
        if (event.releaseNotes) {
          // releaseNotes is either a string (HTML from a single release) or
          // ReleaseNoteInfo[] when skipping multiple versions. Join the array
          // form so users hopping v1.4.1 → v1.4.3 see all intermediate notes.
          if (typeof event.releaseNotes === 'string') {
            store.setReleaseNotes(event.releaseNotes)
          } else if (Array.isArray(event.releaseNotes)) {
            const joined = (event.releaseNotes as Array<{ version?: string; note?: string | null }>)
              .map((r) => {
                if (!r.note) return ''
                return r.version ? `<h3>v${r.version}</h3>${r.note}` : r.note
              })
              .filter(Boolean)
              .join('<hr/>')
            if (joined) store.setReleaseNotes(joined)
          }
        }
        break
      case 'not-available':
        store.setStatus('up-to-date')
        break
      case 'downloading':
        store.setStatus('downloading')
        if (typeof event.percent === 'number') store.setDownloadPercent(event.percent)
        break
      case 'downloaded':
        store.setStatus('ready')
        store.setDownloadPercent(100)
        break
      case 'error':
        store.setError(event.error || event.message || 'Unknown error')
        break
    }
  })

  return cleanup
}
