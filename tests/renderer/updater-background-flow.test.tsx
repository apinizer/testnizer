/// <reference types="react" />
/**
 * Background update flow (Cursor / Postman style): the update downloads
 * quietly, and only once it is READY the non-blocking card asks
 *   Restart & install · Install on quit · Skip this version.
 *
 * Guards: a skipped version is never auto-downloaded again; "skip" turns
 * install-on-quit OFF in main and persists the version; "install on quit" /
 * ✕ keep it ON; the card never appears while the manual dialog is open.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, renderHook, act } from '@testing-library/react'
;(globalThis as unknown as { React: typeof React }).React = React

import UpdateReadyPrompt from '../../src/renderer/components/layout/UpdateReadyPrompt'
import { useUpdaterStore, initUpdaterListeners } from '../../src/renderer/stores/updater.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useAutoUpdater } from '../../src/renderer/lib/use-auto-updater'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

type UpdaterEvent = { type: string; version?: string; percent?: number }

function fakeApi(settings: Record<string, unknown> = {}): {
  emit: (e: UpdaterEvent) => void
  download: ReturnType<typeof vi.fn>
  install: ReturnType<typeof vi.fn>
  setInstallOnQuit: ReturnType<typeof vi.fn>
  settingsSet: ReturnType<typeof vi.fn>
} {
  let cb: ((e: UpdaterEvent) => void) | null = null
  const download = vi.fn(() => Promise.resolve({ success: true }))
  const install = vi.fn(() => Promise.resolve({ success: true }))
  const setInstallOnQuit = vi.fn(() => Promise.resolve({ success: true }))
  const settingsSet = vi.fn(() => Promise.resolve({ success: true }))
  ;(window as unknown as { api?: unknown }).api = {
    updater: {
      onEvent: (callback: (e: UpdaterEvent) => void) => {
        cb = callback
        return () => {
          cb = null
        }
      },
      check: vi.fn(() => Promise.resolve({ success: true })),
      download,
      install,
      setInstallOnQuit,
    },
    settings: {
      get: vi.fn((key: string) => Promise.resolve({ success: true, data: settings[key] })),
      set: settingsSet,
    },
  }
  return {
    emit: (e) => {
      if (!cb) throw new Error('no updater callback registered')
      cb(e)
    },
    download,
    install,
    setInstallOnQuit,
    settingsSet,
  }
}

let savedApi: unknown
let stop: (() => void) | undefined

beforeEach(() => {
  savedApi = (window as unknown as { api?: unknown }).api
  useUIStore.setState({ showUpdateModal: false })
  useUpdaterStore.setState({
    status: 'idle',
    version: null,
    releaseNotes: null,
    downloadPercent: 0,
    errorMessage: null,
    autoDownload: false,
    skippedVersion: null,
    readyPromptOpen: false,
  })
})
afterEach(() => {
  cleanup()
  stop?.()
  stop = undefined
  ;(window as unknown as { api?: unknown }).api = savedApi
})

describe('store — skipped version', () => {
  it('does NOT auto-download the version the user skipped', () => {
    const bus = fakeApi()
    stop = initUpdaterListeners()
    useUpdaterStore.setState({ autoDownload: true, skippedVersion: '9.9.9' })
    bus.emit({ type: 'available', version: '9.9.9' })
    expect(bus.download).not.toHaveBeenCalled()
    expect(useUpdaterStore.getState().status).toBe('available')
  })

  it('still auto-downloads a DIFFERENT, newer version', () => {
    const bus = fakeApi()
    stop = initUpdaterListeners()
    useUpdaterStore.setState({ autoDownload: true, skippedVersion: '9.9.9' })
    bus.emit({ type: 'available', version: '9.9.10' })
    expect(bus.download).toHaveBeenCalledTimes(1)
  })

  it('skipVersion() persists the version, turns install-on-quit OFF and closes the card', () => {
    const bus = fakeApi()
    useUpdaterStore.setState({ status: 'ready', version: '9.9.9', readyPromptOpen: true })
    useUpdaterStore.getState().skipVersion()
    const s = useUpdaterStore.getState()
    expect(s.skippedVersion).toBe('9.9.9')
    expect(s.readyPromptOpen).toBe(false)
    expect(bus.setInstallOnQuit).toHaveBeenCalledWith(false)
    expect(bus.settingsSet).toHaveBeenCalledWith('updater.skippedVersion', '9.9.9')
  })

  it('installOnQuit() keeps install-on-quit ON and closes the card', () => {
    const bus = fakeApi()
    useUpdaterStore.setState({ status: 'ready', version: '9.9.9', readyPromptOpen: true })
    useUpdaterStore.getState().installOnQuit()
    expect(useUpdaterStore.getState().readyPromptOpen).toBe(false)
    expect(bus.setInstallOnQuit).toHaveBeenCalledWith(true)
  })
})

describe('store — re-arming after a skip', () => {
  it('a manual Download of the skipped version lifts the skip and turns install-on-quit back ON', () => {
    const bus = fakeApi()
    useUpdaterStore.setState({ status: 'available', version: '9.9.9', skippedVersion: '9.9.9' })
    useUpdaterStore.getState().download()
    expect(bus.setInstallOnQuit).toHaveBeenLastCalledWith(true)
    expect(useUpdaterStore.getState().skippedVersion).toBeNull()
    expect(bus.settingsSet).toHaveBeenCalledWith('updater.skippedVersion', null)
    expect(bus.download).toHaveBeenCalledTimes(1)
  })

  it('a NEWER version auto-downloading after a skip turns install-on-quit back ON and keeps the old skip', () => {
    const bus = fakeApi()
    stop = initUpdaterListeners()
    useUpdaterStore.setState({ autoDownload: true, skippedVersion: '9.9.9' })
    bus.emit({ type: 'available', version: '9.9.10' })
    expect(bus.setInstallOnQuit).toHaveBeenLastCalledWith(true)
    expect(useUpdaterStore.getState().skippedVersion).toBe('9.9.9')
  })
})

describe('hook — when the card opens', () => {
  it('opens the card when a background download becomes ready, not when a version is merely available', async () => {
    const bus = fakeApi({ 'project.p1.settings': { autoCheckUpdates: false } })
    stop = initUpdaterListeners()
    renderHook(() => useAutoUpdater('p1'))
    await Promise.resolve()
    bus.emit({ type: 'available', version: '9.9.9' })
    expect(useUpdaterStore.getState().readyPromptOpen).toBe(false)
    expect(useUIStore.getState().showUpdateModal).toBe(false) // no modal interruption any more
    bus.emit({ type: 'downloaded' })
    expect(useUpdaterStore.getState().readyPromptOpen).toBe(true)
  })

  it('a failed "Restart & install" from the card opens the dialog so the error is not silent', () => {
    const bus = fakeApi()
    stop = initUpdaterListeners()
    renderHook(() => useAutoUpdater('p1'))
    bus.emit({ type: 'available', version: '9.9.9' })
    bus.emit({ type: 'downloaded' })
    expect(useUpdaterStore.getState().readyPromptOpen).toBe(true)
    useUpdaterStore.getState().install()
    bus.emit({ type: 'error', error: 'quitAndInstall failed' })
    expect(useUIStore.getState().showUpdateModal).toBe(true)
    expect(useUpdaterStore.getState().readyPromptOpen).toBe(false)
  })

  it('leaves the manual dialog in charge when it is open', () => {
    const bus = fakeApi()
    stop = initUpdaterListeners()
    renderHook(() => useAutoUpdater('p1'))
    useUIStore.setState({ showUpdateModal: true })
    bus.emit({ type: 'available', version: '9.9.9' })
    bus.emit({ type: 'downloaded' })
    expect(useUpdaterStore.getState().readyPromptOpen).toBe(false)
  })

  it('loads the skipped version from settings and defaults background download to ON', async () => {
    fakeApi({
      'updater.skippedVersion': '9.9.9',
      'project.p1.settings': { autoCheckUpdates: false },
    })
    renderHook(() => useAutoUpdater('p1'))
    await new Promise((r) => setTimeout(r, 0))
    expect(useUpdaterStore.getState().skippedVersion).toBe('9.9.9')
    expect(useUpdaterStore.getState().autoDownload).toBe(true)
  })
})

describe('UpdateReadyPrompt — the card', () => {
  it('renders nothing until readyPromptOpen', () => {
    fakeApi()
    render(<UpdateReadyPrompt />)
    expect(screen.queryByTestId('updater-notification')).toBeNull()
  })

  it('shows the version and wires the three choices', () => {
    const bus = fakeApi()
    useUpdaterStore.setState({ status: 'ready', version: '9.9.9', readyPromptOpen: true })
    render(<UpdateReadyPrompt />)
    const card = screen.getByTestId('updater-notification')
    expect(card.getAttribute('role')).toBe('status') // non-modal, never traps focus
    expect(card.textContent).toContain('v9.9.9')

    fireEvent.click(screen.getByTestId('updater-install-on-quit'))
    expect(bus.setInstallOnQuit).toHaveBeenLastCalledWith(true)
    expect(screen.queryByTestId('updater-notification')).toBeNull()

    act(() => useUpdaterStore.setState({ readyPromptOpen: true }))
    fireEvent.click(screen.getByTestId('updater-skip-version'))
    expect(bus.setInstallOnQuit).toHaveBeenLastCalledWith(false)
    expect(useUpdaterStore.getState().skippedVersion).toBe('9.9.9')

    act(() => useUpdaterStore.setState({ readyPromptOpen: true }))
    fireEvent.click(screen.getByTestId('updater-install-now'))
    expect(bus.install).toHaveBeenCalledTimes(1)
  })
})
