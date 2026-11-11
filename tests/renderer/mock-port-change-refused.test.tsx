/**
 * Tester finding 11 (critical), renderer half — the editor's Settings tab when
 * `mock:server:update` refuses a running server's new port.
 *
 * Before: `mock.store.updateServer` dropped the failure and the port box kept
 * the refused value (the header showed the stored one only because the old
 * handler also lied with success). Now the store returns the reason, the port
 * box goes back to the stored port and a toast says the server keeps running
 * where it was.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { httpBridge, httpServer, resetHttpBridge } from './mock-http-bridge-stub'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { toast } from '../../src/renderer/lib/toast'

const SERVER = httpServer({ id: 'srv-a', name: 'A', port: 3001 })
const REFUSAL = 'Port 3002 is already in use by mock server "B" in this project'

async function mountSettings(status: 'running' | 'stopped'): Promise<HTMLInputElement> {
  resetHttpBridge([SERVER])
  useMockStore.setState({
    servers: [SERVER],
    endpointsByServer: {},
    responsesByEndpoint: {},
    statusByServer: { [SERVER.id]: status },
    errorByServer: {},
    logsByServer: {},
  })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  render(React.createElement(MockServerEditor, { serverId: SERVER.id }))
  fireEvent.click(await screen.findByTestId('mock-tab-settings'))
  return (await screen.findByTestId('mock-settings-port')) as HTMLInputElement
}

function typePort(input: HTMLInputElement, value: string): void {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

beforeEach(() => {
  useUIStore.getState().setLocale('en')
  vi.mocked(toast.error).mockClear()
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('Mock Settings: a refused port change (tester finding 11)', () => {
  it('store returns the reason and keeps the stored server', async () => {
    resetHttpBridge([SERVER])
    useMockStore.setState({ servers: [SERVER] })
    httpBridge.server.update.mockImplementationOnce(() =>
      Promise.resolve({ success: false as const, error: REFUSAL }),
    )

    const err = await useMockStore.getState().updateServer(SERVER.id, { port: 3002 })

    expect(err).toBe(REFUSAL)
    expect(useMockStore.getState().servers[0].port).toBe(3001)
  })

  it('running server: port box returns to the stored port, toast names the kept address', async () => {
    const input = await mountSettings('running')
    httpBridge.server.update.mockImplementationOnce(() =>
      Promise.resolve({ success: false as const, error: REFUSAL }),
    )

    typePort(input, '3002')

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    const message = vi.mocked(toast.error).mock.calls[0][0] as string
    expect(message).toContain('127.0.0.1:3001')
    expect(message).toContain(REFUSAL)
    await waitFor(() => expect(input.value).toBe('3001'))
    expect(screen.getByTestId('mock-base-url')).toHaveTextContent(':3001')
  })

  it('Turkish toast', async () => {
    useUIStore.getState().setLocale('tr')
    const input = await mountSettings('running')
    httpBridge.server.update.mockImplementationOnce(() =>
      Promise.resolve({ success: false as const, error: REFUSAL }),
    )

    typePort(input, '3002')

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain(
      'Port değiştirilmedi — sunucu 127.0.0.1:3001 adresinde çalışmaya devam ediyor.',
    )
  })

  it('an accepted change keeps the new port and shows no error', async () => {
    const input = await mountSettings('running')

    typePort(input, '3005')

    await waitFor(() => expect(useMockStore.getState().servers[0].port).toBe(3005))
    expect(input.value).toBe('3005')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
