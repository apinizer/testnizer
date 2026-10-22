/**
 * Issue #222 item 2 — "Server type" in the HTTP mock editor's Settings tab.
 *
 * The type is presentation only (sidebar section, templates, body types
 * offered), so a change rewrites nothing: endpoints and responses are kept
 * as they are. When responses use a body type the new type does not offer, a
 * confirm says so first; Cancel changes nothing. The switch shows the STORED
 * kind, so a rejected update leaves it where it was. The Mocks sidebar moves
 * the server to the new section.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import {
  httpBridge,
  httpEndpoint,
  httpResponse,
  httpServer,
  resetHttpBridge,
  seedHttpBridge,
} from './mock-http-bridge-stub'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { toast } from '../../src/renderer/lib/toast'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import MockServerTypeField from '../../src/renderer/components/mock/MockServerTypeField'
import MockKindServersSection from '../../src/renderer/components/mock/MockKindServersSection'
import { bodyTypesNotOffered } from '../../src/renderer/components/mock/mock-kind-ui'
import type { MockServer } from '../../src/renderer/types'

function Harness(): React.ReactElement {
  const server = useMockStore((s) => s.servers.find((x) => x.id === 'h-1'))
  return server ? <MockServerTypeField server={server} /> : <></>
}

function seed(server: MockServer, bodyType: 'sse' | 'json' | 'llm'): void {
  resetHttpBridge([server])
  seedHttpBridge({
    endpoints: [httpEndpoint({ id: 'ep-1', serverId: 'h-1' })],
    responses: [httpResponse({ id: 'r-1', endpointId: 'ep-1', bodyType })],
  })
  useMockStore.setState({ servers: [server], endpointsByServer: {}, responsesByEndpoint: {} })
}

const checked = (kind: string): string | null =>
  screen.getByTestId(`mock-settings-type-${kind}`).getAttribute('aria-checked')

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.success).mockClear()
})
afterEach(() => cleanup())

describe('bodyTypesNotOffered', () => {
  it('lists what the target kind does not offer, once, sorted', () => {
    expect(bodyTypesNotOffered('http', ['sse', 'json', 'sse', 'llm'])).toEqual(['llm', 'sse'])
    expect(bodyTypesNotOffered('sse', ['json', 'text'])).toEqual([])
    expect(bodyTypesNotOffered('ai', ['llm', 'json'])).toEqual([])
  })
})

describe('issue #222 (2) — Settings "Server type"', () => {
  it('offers HTTP / SSE / AI (no MCP — its own table) with the stored kind checked', () => {
    seed(httpServer({ id: 'h-1', kind: 'sse' }), 'sse')
    render(<Harness />)
    expect(checked('sse')).toBe('true')
    expect(checked('http')).toBe('false')
    expect(screen.queryByTestId('mock-settings-type-mcp')).toBeNull()
    expect(screen.getByTestId('mock-settings-type-hint')).toHaveTextContent(
      /Endpoints and responses are kept/,
    )
  })

  it('SSE → HTTP with an sse response: confirm first, then update kind only — nothing rewritten', async () => {
    seed(httpServer({ id: 'h-1', kind: 'sse' }), 'sse')
    render(<Harness />)
    fireEvent.click(screen.getByTestId('mock-settings-type-http'))
    const dialog = await screen.findByTestId('mock-settings-type-confirm')
    // PM review #21: a real singular and the body type's label, not "(s)" / raw `sse`.
    expect(dialog).toHaveTextContent(/1 response uses a body type/)
    expect(dialog).not.toHaveTextContent(/\(s\)/)
    expect(dialog).toHaveTextContent(/\(SSE stream\)/)
    expect(dialog).toHaveTextContent(/Nothing is deleted/)
    expect(httpBridge.server.update).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('mock-settings-type-confirm-ok'))
    await waitFor(() => expect(checked('http')).toBe('true'))
    expect(httpBridge.server.update).toHaveBeenCalledWith('h-1', { kind: 'http' })
    expect(httpBridge.response.update).not.toHaveBeenCalled()
    expect(httpBridge.response.delete).not.toHaveBeenCalled()
    expect(httpBridge.endpoint.delete).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalled()
  })

  it('Cancel in the confirm changes nothing', async () => {
    seed(httpServer({ id: 'h-1', kind: 'ai' }), 'llm')
    render(<Harness />)
    fireEvent.click(screen.getByTestId('mock-settings-type-sse'))
    await screen.findByTestId('mock-settings-type-confirm')
    fireEvent.click(screen.getByTestId('mock-settings-type-cancel'))
    await waitFor(() => expect(screen.queryByTestId('mock-settings-type-confirm')).toBeNull())
    expect(httpBridge.server.update).not.toHaveBeenCalled()
    expect(checked('ai')).toBe('true')
  })

  it('no response the new kind lacks → changes at once, no confirm', async () => {
    seed(httpServer({ id: 'h-1', kind: 'http' }), 'json')
    render(<Harness />)
    fireEvent.click(screen.getByTestId('mock-settings-type-sse'))
    await waitFor(() => expect(checked('sse')).toBe('true'))
    expect(screen.queryByTestId('mock-settings-type-confirm')).toBeNull()
    expect(httpBridge.server.update).toHaveBeenCalledWith('h-1', { kind: 'sse' })
  })

  it('a rejected update keeps the stored kind and shows an error', async () => {
    seed(httpServer({ id: 'h-1', kind: 'http' }), 'json')
    httpBridge.server.update.mockImplementationOnce(
      () => Promise.resolve({ success: false as const, error: 'nope' }) as never,
    )
    render(<Harness />)
    fireEvent.click(screen.getByTestId('mock-settings-type-ai'))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(checked('http')).toBe('true')
  })

  it('the sidebar moves the server to the new section', async () => {
    seed(httpServer({ id: 'h-1', kind: 'http', name: 'Mover' }), 'json')
    render(
      <>
        <MockKindServersSection kind="http" query="" />
        <MockKindServersSection kind="sse" query="" />
        <Harness />
      </>,
    )
    expect(screen.getByTestId('mock-http-section')).toHaveTextContent('Mover')
    expect(screen.getByTestId('mock-sse-section')).not.toHaveTextContent('Mover')
    fireEvent.click(screen.getByTestId('mock-settings-type-sse'))
    await waitFor(() => expect(screen.getByTestId('mock-sse-section')).toHaveTextContent('Mover'))
    expect(screen.getByTestId('mock-http-section')).not.toHaveTextContent('Mover')
  })
})
