import { create } from 'zustand'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

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
    // Delegate to main process via IPC
    if (window.api?.updater?.check) {
      window.api.updater.check().catch((err: Error) => {
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
      window.api.updater.download().catch((err: Error) => {
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

  reset: () => set({
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

  const cleanup = window.api.updater.onEvent((event: Record<string, unknown>) => {
    const store = useUpdaterStore.getState()
    const type = event.type as string

    switch (type) {
      case 'checking':
        store.setStatus('checking')
        break
      case 'available':
        store.setStatus('available')
        if (event.version) store.setVersion(event.version as string)
        if (event.releaseNotes) store.setReleaseNotes(event.releaseNotes as string)
        break
      case 'not-available':
        store.setStatus('idle')
        break
      case 'download-progress':
        store.setStatus('downloading')
        if (typeof event.percent === 'number') store.setDownloadPercent(event.percent)
        break
      case 'downloaded':
        store.setStatus('ready')
        store.setDownloadPercent(100)
        break
      case 'error':
        store.setError((event.message as string) || 'Unknown error')
        break
    }
  })

  return cleanup
}
