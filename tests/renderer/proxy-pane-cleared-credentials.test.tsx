/**
 * Tester report 2026-11-11, finding 3 — the project Proxy pane kept an empty
 * `auth: {username:'', password:''}` after a username + password were typed
 * and cleared; the engine handed it to axios ("Invalid proxy authorization")
 * and every Send failed. The form now saves no login when both are empty
 * (the engine ignores one too — `proxyCredentials` — this is the form half).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

import { mockWindowApi } from './screens/_mount'
import {
  ProxyPane,
  type ProjectSettings,
} from '../../src/renderer/components/modals/project-settings-panes'
import { installEnUsDefault, uninstallEnUsDefault } from './helpers/default-locale-shim'

beforeEach(() => {
  mockWindowApi()
  installEnUsDefault()
})
afterEach(() => {
  cleanup()
  uninstallEnUsDefault()
})

function Harness({ onSettings }: { onSettings: (s: ProjectSettings) => void }): React.ReactElement {
  const [settings, setSettings] = React.useState<ProjectSettings>({
    proxy: { mode: 'custom', host: '127.0.0.1', port: 59120 },
  } as ProjectSettings)
  return (
    <ProxyPane
      settings={settings}
      onChange={(patch) => {
        const next = { ...settings, ...patch } as ProjectSettings
        setSettings(next)
        onSettings(next)
      }}
    />
  )
}

describe('Proxy pane — cleared credentials', () => {
  it('typing a username + password and clearing both saves no auth object', () => {
    let last: ProjectSettings | undefined
    render(<Harness onSettings={(s) => (last = s)} />)
    const user = screen.getByTestId('project-proxy-username')
    const pass = screen.getByTestId('project-proxy-password')
    fireEvent.change(user, { target: { value: 'alice' } })
    fireEvent.change(pass, { target: { value: 's3cret' } })
    expect(last?.proxy?.auth).toEqual({ username: 'alice', password: 's3cret' })

    fireEvent.change(user, { target: { value: '' } })
    expect(last?.proxy?.auth).toEqual({ username: '', password: 's3cret' })
    fireEvent.change(pass, { target: { value: '' } })
    expect(last?.proxy).toEqual({ mode: 'custom', host: '127.0.0.1', port: 59120 })
    expect(last?.proxy).not.toHaveProperty('auth')
  })

  it('a password-only login is kept', () => {
    let last: ProjectSettings | undefined
    render(<Harness onSettings={(s) => (last = s)} />)
    fireEvent.change(screen.getByTestId('project-proxy-password'), { target: { value: 'pw' } })
    expect(last?.proxy?.auth).toEqual({ username: '', password: 'pw' })
  })
})
