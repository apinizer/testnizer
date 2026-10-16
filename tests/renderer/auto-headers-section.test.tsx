/**
 * Issue #204 — the HTTP Headers tab shows the engine's auto-generated headers
 * in a read-only, collapsible section: rows with a source badge, a "N hidden"
 * count on the toggle, and credential values masked.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'
import HeadersTab from '../../src/renderer/components/request/HeadersTab'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { HISTORY_MASK } from '../../src/shared/credential-headers'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.super-secret-payload.sig'

type ApiStub = { app: { version: () => Promise<unknown> } }

beforeEach(() => {
  ;(window as unknown as { api: ApiStub }).api = {
    app: { version: async () => ({ success: true, data: { version: '7.7.7' } }) },
  }
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({
    method: 'POST',
    url: 'https://api.example.com/users',
    headers: [],
    body: { type: 'json', content: '{"a":1}' },
    auth: { type: 'bearer', bearer: { token: TOKEN } },
  })
})
afterEach(() => cleanup())

function openSection(): HTMLElement {
  const toggle = screen.getByTestId('auto-headers-toggle')
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
  return screen.getByTestId('auto-headers-rows')
}

function rowFor(container: HTMLElement, name: string): HTMLElement {
  const row = within(container)
    .getAllByTestId('auto-header-row')
    .find((r) => r.textContent?.startsWith(name))
  if (!row) throw new Error(`no auto header row ${name}`)
  return row
}

describe('AutoHeadersSection (issue #204)', () => {
  it('renders the rows with source badges and masks Authorization', async () => {
    render(<HeadersTab />)
    expect(screen.getByTestId('auto-headers')).toBeInTheDocument()
    const rows = openSection()

    const auth = rowFor(rows, 'Authorization')
    expect(auth).toHaveAttribute('data-source', 'auth')
    expect(within(auth).getByTestId('auto-header-value')).toHaveTextContent(
      `Bearer ${HISTORY_MASK}`,
    )
    expect(within(auth).getByTestId('auto-header-source')).toHaveTextContent('Auth')

    const ct = rowFor(rows, 'Content-Type')
    expect(ct).toHaveAttribute('data-source', 'engine')
    expect(within(ct).getByTestId('auto-header-value')).toHaveTextContent('application/json')
    expect(rowFor(rows, 'Host')).toHaveTextContent('api.example.com')
    await waitFor(() => expect(rowFor(rows, 'User-Agent')).toHaveTextContent('Testnizer/7.7.7'))
    expect(rowFor(rows, 'Content-Length')).toHaveTextContent('calculated at send')

    // The literal token never reaches the DOM.
    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it('the toggle shows the count of headers that will be sent', () => {
    render(<HeadersTab />)
    // Accept, Content-Type, Content-Length, Authorization, User-Agent,
    // Accept-Encoding, Host, Connection (Cookie is conditional → not counted)
    expect(screen.getByTestId('auto-headers-count')).toHaveTextContent('8 hidden')
  })

  it('updates live: a user Authorization header overrides the auth row', () => {
    render(<HeadersTab />)
    const rows = openSection()
    expect(rowFor(rows, 'Authorization')).toHaveAttribute('data-overridden', 'false')
    act(() => {
      useRequestStore.setState({
        headers: [{ id: 'h1', key: 'Authorization', value: 'Basic abc', enabled: true }],
      })
    })
    expect(rowFor(screen.getByTestId('auto-headers-rows'), 'Authorization')).toHaveAttribute(
      'data-overridden',
      'true',
    )
    expect(screen.getByTestId('auto-headers-count')).toHaveTextContent('7 hidden')
  })

  it('remembers the expanded state across remounts (session memory)', () => {
    const first = render(<HeadersTab />)
    openSection()
    first.unmount()
    render(<HeadersTab />)
    expect(screen.getByTestId('auto-headers-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('auto-headers-rows')).toBeInTheDocument()
  })

  it('is not shown on a SOAP tab (SoapEditor reuses HeadersTab, its engine differs)', () => {
    useTabsStore.setState({
      tabs: [{ id: 't1', name: 'soap', protocol: 'soap', isDirty: false }] as never,
      activeTabId: 't1',
    })
    render(<HeadersTab />)
    expect(screen.queryByTestId('auto-headers')).not.toBeInTheDocument()
  })
})
