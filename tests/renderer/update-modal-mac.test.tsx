/// <reference types="react" />
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

describe('UpdateModal — macOS routes to manual download (#34)', () => {
  beforeEach(() => {
    stubDom()
    useUIStore.setState({ showUpdateModal: true })
    // An update is available; releaseNotes null to skip the sanitize path.
    useUpdaterStore.setState({ status: 'available', version: '9.9.9', releaseNotes: null })
  })

  afterEach(() => {
    cleanup()
    useUIStore.setState({ showUpdateModal: false })
  })

  it('offers a manual-download link as the primary action on macOS', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    render(<UpdateModal />)

    const links = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === DOWNLOAD_PAGE)
    expect(links.length).toBeGreaterThan(0)
    // The explanatory note is shown so the user understands why.
    expect(screen.getByText(/Automatic install is not available/i)).toBeTruthy()
  })

  it('keeps the in-app Download button on non-macOS', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')
    render(<UpdateModal />)

    // No download-page link in the available state off macOS …
    const manualLinks = screen
      .queryAllByRole('link')
      .filter((a) => a.getAttribute('href') === DOWNLOAD_PAGE)
    expect(manualLinks).toHaveLength(0)
    // … the auto-update button drives the flow instead.
    expect(screen.getByRole('button', { name: /^Download$/i })).toBeTruthy()
  })
})
