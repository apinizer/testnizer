/// <reference types="react" />
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
;(globalThis as unknown as { React: typeof React }).React = React

import UpdateModal from '../../src/renderer/components/modals/UpdateModal'
import { useUpdaterStore } from '../../src/renderer/stores/updater.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

const DOWNLOAD_PAGE = 'https://www.testnizer.com/download/'

function setUserAgent(ua: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

// Radix Dialog touches a few DOM APIs jsdom doesn't implement.
function stubDom(): void {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = () => {}
}

function resetStores(): void {
  cleanup()
  useUIStore.setState({ showUpdateModal: false })
  useUpdaterStore.setState({ status: 'idle', version: null, releaseNotes: null, errorMessage: null })
}

// macOS builds are signed + notarized since v1.4.13, so electron-updater can
// self-install on macOS too — the old "route macOS to a manual download" block
// (#34 workaround) is obsolete and was removed.
describe('UpdateModal — macOS auto-update enabled (#34, signed builds)', () => {
  beforeEach(() => {
    stubDom()
    useUIStore.setState({ showUpdateModal: true })
    // An update is available; releaseNotes null to skip the sanitize path.
    useUpdaterStore.setState({ status: 'available', version: '9.9.9', releaseNotes: null })
  })
  afterEach(resetStores)

  it('shows the in-app Download button on macOS, not a manual-only link or the obsolete note', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    render(<UpdateModal />)

    expect(screen.getByRole('button', { name: /^Download$/i })).toBeTruthy()
    // No manual-download link as the primary action…
    const manualLinks = screen
      .queryAllByRole('link')
      .filter((a) => a.getAttribute('href') === DOWNLOAD_PAGE)
    expect(manualLinks).toHaveLength(0)
    // …and the "Automatic install is not available" note is gone.
    expect(screen.queryByText(/Automatic install is not available/i)).toBeNull()
  })

  it('keeps the in-app Download button on non-macOS', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')
    render(<UpdateModal />)
    expect(screen.getByRole('button', { name: /^Download$/i })).toBeTruthy()
  })
})

// `idle` (never checked) must NOT render the green "you're up to date" badge —
// that lie is what made a fresh open look up-to-date before any check ran.
describe('UpdateModal — idle vs up-to-date (user-reported)', () => {
  let savedApi: unknown
  beforeEach(() => {
    stubDom()
    savedApi = (window as unknown as { api?: unknown }).api
    useUIStore.setState({ showUpdateModal: true })
  })
  afterEach(() => {
    ;(window as unknown as { api?: unknown }).api = savedApi
    resetStores()
  })

  it('auto-runs a check on open from idle instead of claiming "up to date"', () => {
    const check = vi.fn().mockResolvedValue({ success: true })
    ;(window as unknown as { api?: unknown }).api = { updater: { check } }
    useUpdaterStore.setState({ status: 'idle' })
    render(<UpdateModal />)

    // Opening from a never-checked state kicks off a real check…
    expect(check).toHaveBeenCalledTimes(1)
    // …and never shows the green up-to-date badge prematurely.
    expect(screen.queryByText(/You're up to date/i)).toBeNull()
  })

  it('shows "You\'re up to date" only after a check returns no update', () => {
    ;(window as unknown as { api?: unknown }).api = { updater: { check: vi.fn() } }
    useUpdaterStore.setState({ status: 'up-to-date' })
    render(<UpdateModal />)
    expect(screen.getByText(/You're up to date/i)).toBeTruthy()
  })
})
