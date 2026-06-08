import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useUpdaterStore, initUpdaterListeners } from '../../src/renderer/stores/updater.store'

// initUpdaterListeners wires the main-process updater events to the store. We
// capture the registered callback and drive events through it directly.
type UpdaterEvent = {
  type: string
  version?: string
  percent?: number
  error?: string
  message?: string
  releaseNotes?: unknown
}

function installFakeUpdaterApi(): { emit: (e: UpdaterEvent) => void } {
  let cb: ((e: UpdaterEvent) => void) | null = null
  ;(window as unknown as { api?: unknown }).api = {
    updater: {
      onEvent: (callback: (e: UpdaterEvent) => void) => {
        cb = callback
        return () => {
          cb = null
        }
      },
    },
  }
  return {
    emit: (e: UpdaterEvent) => {
      if (!cb) throw new Error('no updater callback registered')
      cb(e)
    },
  }
}

describe('updater store — event → status mapping', () => {
  let savedApi: unknown
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    savedApi = (window as unknown as { api?: unknown }).api
    useUpdaterStore.setState({
      status: 'idle',
      version: null,
      releaseNotes: null,
      downloadPercent: 0,
      errorMessage: null,
    })
  })
  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    ;(window as unknown as { api?: unknown }).api = savedApi
  })

  it("maps a 'not-available' event to 'up-to-date', NOT back to idle", () => {
    const bus = installFakeUpdaterApi()
    cleanup = initUpdaterListeners()
    bus.emit({ type: 'not-available' })
    // The whole point: idle (never checked) and up-to-date (checked, current)
    // are distinct so the modal can't claim "up to date" before a check ran.
    expect(useUpdaterStore.getState().status).toBe('up-to-date')
  })

  it("maps an 'available' event to 'available' and records the version", () => {
    const bus = installFakeUpdaterApi()
    cleanup = initUpdaterListeners()
    bus.emit({ type: 'available', version: '9.9.9' })
    const s = useUpdaterStore.getState()
    expect(s.status).toBe('available')
    expect(s.version).toBe('9.9.9')
  })

  it("maps 'checking' / 'downloading' / 'downloaded' through the expected statuses", () => {
    const bus = installFakeUpdaterApi()
    cleanup = initUpdaterListeners()

    bus.emit({ type: 'checking' })
    expect(useUpdaterStore.getState().status).toBe('checking')

    bus.emit({ type: 'downloading', percent: 42 })
    expect(useUpdaterStore.getState().status).toBe('downloading')
    expect(useUpdaterStore.getState().downloadPercent).toBe(42)

    bus.emit({ type: 'downloaded' })
    expect(useUpdaterStore.getState().status).toBe('ready')
    expect(useUpdaterStore.getState().downloadPercent).toBe(100)
  })

  it("surfaces an 'error' event with its message", () => {
    const bus = installFakeUpdaterApi()
    cleanup = initUpdaterListeners()
    bus.emit({ type: 'error', error: 'boom' })
    const s = useUpdaterStore.getState()
    expect(s.status).toBe('error')
    expect(s.errorMessage).toBe('boom')
  })

  it('check() with no IPC bridge falls back to the dev simulation (no throw)', () => {
    vi.useFakeTimers()
    ;(window as unknown as { api?: unknown }).api = undefined
    useUpdaterStore.getState().check()
    expect(useUpdaterStore.getState().status).toBe('checking')
    vi.advanceTimersByTime(1600)
    expect(useUpdaterStore.getState().status).toBe('available')
    vi.useRealTimers()
  })
})
