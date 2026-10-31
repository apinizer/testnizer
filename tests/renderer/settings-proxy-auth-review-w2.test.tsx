/**
 * Review finding on commit 606f580 (issue #254 + review fixes), orchestrator
 * review round W2.
 *
 *  P1-4  App settings proxy: `SettingsModal.handleSave` writes `proxy.auth`
 *        only `...(settings.proxyUser ? { auth: … } : {})`. A custom proxy that
 *        authenticates with a PASSWORD ONLY (empty username - allowed by the
 *        project dialog, the engine and `proxySecretValues`) therefore loses
 *        its password on Save: the typed password is dropped, and a stored
 *        `{username:'', password}` is silently deleted when the dialog is saved
 *        for an unrelated change. Send then goes out without proxy auth.
 *        The Send leg (`networkPayload` / `effectiveProxy`) forwards the
 *        stored object as is - that part already holds (guard below).
 *
 * Red tests are the regression tests for the fix.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import SettingsModal from '../../src/renderer/components/modals/SettingsModal'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { networkPayload } from '../../src/renderer/lib/network-settings'

type Obj = Record<string, unknown>
const ok = (data: unknown) => ({ success: true, data })

const PASSWORD = 'secret123'

function mount(appProxy: Obj) {
  const app: Obj = {
    defaultTimeout: 45000,
    sslVerification: true,
    followRedirects: true,
    proxy: appProxy,
  }
  const setAll = vi.fn(async () => ok(app))
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    settings: {
      get: vi.fn(async (key: string) => (key in app ? ok(app[key]) : ok(undefined))),
      getAll: vi.fn(async () => ok(app)),
      set: vi.fn(async () => ok(true)),
      setAll,
    },
    certificate: { list: vi.fn(async () => ok([])) },
    folder: { list: vi.fn(async () => ok([])) },
  }
  useWorkspaceStore.setState({ projects: [], activeProjectId: null } as never)
  useUIStore.setState({ showProjectDetailModal: false, showSettingsModal: true })
  render(React.createElement(SettingsModal))
  return { setAll }
}

const savedProxy = (setAll: ReturnType<typeof vi.fn>): Obj =>
  ((setAll.mock.calls[0] as unknown[])[0] as { proxy: Obj }).proxy

async function clickSave(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /^(Save|Kaydet)/i }))
}

beforeEach(() => {
  useUIStore.getState().setLocale('en')
})
afterEach(() => {
  cleanup()
  useUIStore.setState({ showSettingsModal: false })
})

describe('P1-4: App settings proxy keeps a password-only credential', () => {
  it('control: username + password are saved (the path that already works)', async () => {
    const { setAll } = mount({ mode: 'system' })
    await screen.findByTestId('app-settings-title')
    fireEvent.change(screen.getByTestId('app-proxy-mode'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByTestId('app-proxy-host'), { target: { value: 'proxy.test' } })
    fireEvent.change(screen.getByTestId('app-proxy-port'), { target: { value: '3128' } })
    fireEvent.change(screen.getByTestId('app-proxy-username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByTestId('app-proxy-password'), { target: { value: PASSWORD } })
    await clickSave()
    await waitFor(() => expect(setAll).toHaveBeenCalledTimes(1))
    expect(savedProxy(setAll)).toMatchObject({
      mode: 'custom',
      host: 'proxy.test',
      port: 3128,
      auth: { username: 'alice', password: PASSWORD },
    })
  })

  it('empty username + typed password: the Save payload still carries auth with the password', async () => {
    const { setAll } = mount({ mode: 'system' })
    await screen.findByTestId('app-settings-title')
    fireEvent.change(screen.getByTestId('app-proxy-mode'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByTestId('app-proxy-host'), { target: { value: 'proxy.test' } })
    fireEvent.change(screen.getByTestId('app-proxy-port'), { target: { value: '3128' } })
    fireEvent.change(screen.getByTestId('app-proxy-password'), { target: { value: PASSWORD } })
    await clickSave()
    await waitFor(() => expect(setAll).toHaveBeenCalledTimes(1))
    const proxy = savedProxy(setAll)
    expect(proxy.auth, 'the password-only credential was dropped on Save').toBeDefined()
    expect((proxy.auth as Obj).password).toBe(PASSWORD)
  })

  it('a stored {username:"", password} survives re-saving the dialog for an unrelated change', async () => {
    const { setAll } = mount({
      mode: 'custom',
      host: 'proxy.test',
      port: 3128,
      auth: { username: '', password: PASSWORD },
    })
    await screen.findByTestId('app-settings-title')
    await waitFor(() =>
      expect((screen.getByTestId('app-proxy-password') as HTMLInputElement).value).toBe(PASSWORD),
    )
    fireEvent.change(screen.getByTestId('app-proxy-port'), { target: { value: '3129' } })
    await clickSave()
    await waitFor(() => expect(setAll).toHaveBeenCalledTimes(1))
    const proxy = savedProxy(setAll)
    expect(proxy.port).toBe(3129)
    expect((proxy.auth as Obj | undefined)?.password).toBe(PASSWORD)
  })
})

describe('P1-4 Send leg: the stored password-only proxy reaches the request:send payload', () => {
  it('networkPayload forwards app proxy auth with an empty username as is (already holds)', () => {
    const appProxy = {
      mode: 'custom' as const,
      host: 'proxy.test',
      port: 3128,
      auth: { username: '', password: PASSWORD },
    }
    expect(networkPayload({}, { project: {}, appProxy }).proxy).toEqual(appProxy)
  })

  it('the project proxy with an empty username wins and keeps its password', () => {
    const projectProxy = {
      mode: 'custom' as const,
      host: 'p.test',
      port: 8080,
      auth: { username: '', password: PASSWORD },
    }
    expect(
      networkPayload({}, { project: { proxy: projectProxy }, appProxy: { mode: 'system' } }).proxy,
    ).toEqual(projectProxy)
  })
})
