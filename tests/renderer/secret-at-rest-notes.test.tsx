/**
 * Issue #239 — the two states of secrets encrypted at rest the user must see:
 *
 *  - the OS keychain cannot encrypt (`secureStorage.status()` → encrypted
 *    false): a one-line note in the Environment / Globals editor and next to
 *    Settings → App password;
 *  - a stored secret this computer cannot decrypt (main hands it out as ''
 *    with a flag): "re-enter the value" on the env variable, the HTTP mock
 *    auth config / endpoint override and the Mock MCP bearer token.
 *
 * Fail-before: none of these rendered anything — the user saw an empty field
 * and a mock that rejected every request.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { httpEndpoint, httpServer, resetHttpBridge, seedHttpBridge } from './mock-http-bridge-stub'
import { installBridge, sampleServer } from './mock-mcp-bridge-stub'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import EnvironmentModal from '../../src/renderer/components/modals/EnvironmentModal'
import SettingsAppPasswordSection from '../../src/renderer/components/modals/SettingsAppPasswordSection'
import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import MockMcpServerEditor from '../../src/renderer/components/mock-mcp/MockMcpServerEditor'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { Environment, EnvironmentVariable } from '../../src/renderer/types'

const LOCKED_EN =
  "Can't decrypt this secret on this computer (OS keychain changed). Enter the value again."
const LOCKED_TR =
  'Bu gizli değer bu bilgisayarda çözülemiyor (işletim sistemi anahtarlığı değişti). Değeri yeniden girin.'
const UNENCRYPTED_EN = 'Secrets are stored unencrypted: OS keychain unavailable.'
const UNENCRYPTED_TR =
  'Gizli değerler şifrelenmeden saklanıyor: işletim sistemi anahtarlığı kullanılamıyor.'

const w = window as unknown as { api: Record<string, unknown> }
function secureStorage(encrypted: boolean): void {
  w.api = {
    ...w.api,
    secureStorage: { status: vi.fn(async () => ({ success: true, data: { encrypted } })) },
  }
}

/** The UI store drives `useTranslation`; `setLocale` alone does not. */
function lang(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

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

function envWith(variables: EnvironmentVariable[]): Environment {
  return {
    id: 'e-1',
    workspace_id: 'ws-1',
    name: 'Production',
    is_active: true,
    variables,
    created_at: 0,
    updated_at: 0,
  }
}

function mountEnvModal(variables: EnvironmentVariable[]): void {
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useUIStore.setState({ showEnvironmentModal: true })
  useEnvironmentStore.setState({
    environments: [envWith(variables)],
    activeEnvironmentId: 'e-1',
    globalVariables: [],
  })
  render(<EnvironmentModal />)
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /Production/ }))
  })
}

beforeEach(() => {
  stubDom()
  lang('en')
})
afterEach(() => cleanup())

describe('keychain unavailable: "stored unencrypted" note', () => {
  it('Environment editor shows it when status says encrypted:false', async () => {
    secureStorage(false)
    mountEnvModal([])
    expect(await screen.findByTestId('secret-storage-unencrypted')).toHaveTextContent(
      UNENCRYPTED_EN,
    )
  })

  it('Environment editor shows nothing when secrets are encrypted', async () => {
    secureStorage(true)
    mountEnvModal([])
    await waitFor(() => expect(w.api.secureStorage).toBeDefined())
    // Let the status promise settle, then assert the absence.
    await act(async () => {})
    expect(screen.queryByTestId('secret-storage-unencrypted')).toBeNull()
  })

  it('Settings → App password shows it (TR wording)', async () => {
    lang('tr')
    secureStorage(false)
    render(<SettingsAppPasswordSection onLeaveSettings={() => {}} />)
    expect(await screen.findByTestId('secret-storage-unencrypted')).toHaveTextContent(
      UNENCRYPTED_TR,
    )
  })
})

describe('a secret this computer cannot decrypt: "re-enter the value"', () => {
  it('env variable: the Current Value cell says so (EN and TR), and stops once a value is typed', () => {
    secureStorage(true)
    mountEnvModal([
      {
        id: 'v1',
        key: 'token',
        value: '',
        initialValue: '',
        enabled: true,
        secret: true,
        decryptFailed: true,
      },
    ])
    const current = screen.getByTestId('env-var-current') as HTMLInputElement
    expect(current.getAttribute('data-decrypt-failed')).toBe('true')
    expect(current.placeholder).toBe(LOCKED_EN)
    fireEvent.change(current, { target: { value: 'new-token' } })
    expect(
      (screen.getByTestId('env-var-current') as HTMLInputElement).getAttribute(
        'data-decrypt-failed',
      ),
    ).toBeNull()
    cleanup()
    lang('tr')
    mountEnvModal([
      {
        id: 'v1',
        key: 'token',
        value: '',
        initialValue: '',
        enabled: true,
        secret: true,
        decryptFailed: true,
      },
    ])
    expect((screen.getByTestId('env-var-current') as HTMLInputElement).placeholder).toBe(LOCKED_TR)
  })

  it('HTTP mock: server auth config and endpoint auth override', async () => {
    const server = httpServer({ id: 'srv-1', authDecryptFailed: true })
    const endpoint = httpEndpoint({ serverId: 'srv-1', authDecryptFailed: true })
    resetHttpBridge([server])
    seedHttpBridge({ endpoints: [endpoint] })
    useMockStore.setState({
      servers: [server],
      endpointsByServer: {},
      responsesByEndpoint: {},
      statusByServer: {},
      errorByServer: {},
      logsByServer: {},
    })
    useTabsStore.setState({ tabs: [], activeTabId: null })
    render(<MockServerEditor serverId="srv-1" />)
    expect(await screen.findByTestId('mock-endpoint-auth-decrypt-failed')).toHaveTextContent(
      LOCKED_EN,
    )
    fireEvent.click(screen.getByTestId('mock-tab-settings'))
    expect(screen.getByTestId('mock-auth-decrypt-failed')).toHaveTextContent(LOCKED_EN)
  })

  it('HTTP mock: nothing when the credentials decrypt', async () => {
    const server = httpServer({ id: 'srv-1' })
    resetHttpBridge([server])
    seedHttpBridge({ endpoints: [httpEndpoint({ serverId: 'srv-1' })] })
    useMockStore.setState({
      servers: [server],
      endpointsByServer: {},
      responsesByEndpoint: {},
      statusByServer: {},
      errorByServer: {},
      logsByServer: {},
    })
    render(<MockServerEditor serverId="srv-1" />)
    await screen.findByTestId('mock-endpoint-path')
    expect(screen.queryByTestId('mock-endpoint-auth-decrypt-failed')).toBeNull()
    fireEvent.click(screen.getByTestId('mock-tab-settings'))
    expect(screen.queryByTestId('mock-auth-decrypt-failed')).toBeNull()
  })

  it('Mock MCP: the bearer token field says so until a token is entered', () => {
    const server = sampleServer({
      id: 'a',
      authMode: 'bearer',
      bearerToken: '',
      bearerTokenDecryptFailed: true,
    })
    installBridge([server])
    useMockMcpStore.setState({
      servers: [server],
      projectId: 'p-1',
      stateByServer: {},
      logsByServer: {},
      drafts: {},
    })
    useWorkspaceStore.setState({ activeProjectId: 'p-1' })
    useTabsStore.setState({ tabs: [], activeTabId: null })
    render(<MockMcpServerEditor serverId="a" />)
    fireEvent.click(screen.getByTestId('mock-mcp-tab-scenarios'))
    expect(screen.getByTestId('mock-mcp-token-decrypt-failed')).toHaveTextContent(LOCKED_EN)
    fireEvent.change(screen.getByTestId('mock-mcp-bearer-token'), {
      target: { value: 'fresh-token' },
    })
    expect(screen.queryByTestId('mock-mcp-token-decrypt-failed')).toBeNull()
  })
})
