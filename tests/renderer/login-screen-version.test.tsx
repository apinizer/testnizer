/// <reference types="react" />
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
;(globalThis as unknown as { React: typeof React }).React = React

import LoginScreen from '../../src/renderer/components/auth/LoginScreen'
import { useAuthStore } from '../../src/renderer/stores/auth.store'

// The first-run welcome screen must show the build version (user-reported it was
// missing). It reads the version from the app:version IPC bridge.
describe('LoginScreen — app version on the welcome screen', () => {
  let savedApi: unknown

  beforeEach(() => {
    savedApi = (window as unknown as { api?: unknown }).api
    // First run: no password set → WelcomeOptions render.
    useAuthStore.setState({ hasPasswordSet: false, isAuthenticated: false, error: null })
  })
  afterEach(() => {
    cleanup()
    ;(window as unknown as { api?: unknown }).api = savedApi
  })

  it('renders v<version> from window.api.app.version()', async () => {
    ;(window as unknown as { api?: unknown }).api = {
      app: { version: async () => ({ success: true, data: { version: '1.4.14' } }) },
      auth: { hasPassword: async () => ({ success: true, data: { hasPassword: false } }) },
    }

    render(<LoginScreen />)

    const versionEl = await screen.findByTestId('login-app-version')
    await waitFor(() => expect(versionEl.textContent).toBe('v1.4.14'))
  })

  it('omits the version line when the IPC bridge is unavailable (no crash)', async () => {
    ;(window as unknown as { api?: unknown }).api = {
      auth: { hasPassword: async () => ({ success: true, data: { hasPassword: false } }) },
    }

    render(<LoginScreen />)

    // Screen still renders its branding…
    expect(await screen.findByText('Testnizer')).toBeTruthy()
    // …but no version badge when there's nothing to show.
    expect(screen.queryByTestId('login-app-version')).toBeNull()
  })
})
