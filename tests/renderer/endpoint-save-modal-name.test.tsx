/**
 * Issue #201 — Save As (EndpointSaveModal) prefilled the name field with the
 * tab's placeholder ('New Endpoint'), so most saved requests kept it. A
 * placeholder on an HTTP request is now replaced with a name derived from the
 * URL; a name the user chose is kept, and the field stays editable.
 */
// vitest compiles JSX with the classic runtime (React must be in scope), while
// tsc flags a JSX-only React import as unused (TS6133) — so no JSX here.
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import EndpointSaveModal from '../../src/renderer/components/modals/EndpointSaveModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import type { Tab } from '../../src/renderer/types'

function open(tab: Partial<Tab>, url: string): void {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    folder: { list: vi.fn(async () => ({ success: true, data: [] })), create: vi.fn() },
    savedRequest: { get: vi.fn(async () => ({ success: true, data: {} })) },
  }
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', method: 'GET', url: '', protocol: 'http', ...tab } as Tab],
    activeTabId: 'tab-1',
  })
  useRequestStore.setState({ ...useRequestStore.getState(), url })
  useWorkspaceStore.setState({ activeProjectId: 'p1', projects: [] } as never)
  useUIStore.setState({ showEndpointSaveModal: true })
}

beforeEach(() => {
  useUIStore.setState({ showEndpointSaveModal: false })
})
afterEach(cleanup)

describe('EndpointSaveModal name prefill (issue #201)', () => {
  it('prefills a URL-derived name for an HTTP tab with a placeholder name', async () => {
    open({ name: 'New Endpoint' }, '{{baseUrl}}/api/customers?x=1')
    render(React.createElement(EndpointSaveModal))
    expect(await screen.findByDisplayValue('customers')).toBeInTheDocument()
  })

  it('also replaces the Turkish placeholder and the blank-tab name', async () => {
    open({ name: 'Yeni Uç Nokta' }, 'https://api.test/v1/orders/{{id}}')
    const { unmount } = render(React.createElement(EndpointSaveModal))
    expect(await screen.findByDisplayValue('orders')).toBeInTheDocument()
    unmount()

    open({ name: 'New Request' }, 'https://api.test/pets')
    render(React.createElement(EndpointSaveModal))
    expect(await screen.findByDisplayValue('pets')).toBeInTheDocument()
  })

  it('keeps a name the user chose', async () => {
    open({ name: 'My call' }, '{{baseUrl}}/api/customers')
    render(React.createElement(EndpointSaveModal))
    expect(await screen.findByDisplayValue('My call')).toBeInTheDocument()
  })

  it('keeps the placeholder when the URL yields nothing, and for non-HTTP tabs', async () => {
    open({ name: 'New Endpoint' }, '{{baseUrl}}')
    const { unmount } = render(React.createElement(EndpointSaveModal))
    expect(await screen.findByDisplayValue('New Endpoint')).toBeInTheDocument()
    unmount()

    open({ name: 'New SOAP Method', protocol: 'soap' }, 'https://svc.test/ws/CustomerService')
    render(React.createElement(EndpointSaveModal))
    expect(await screen.findByDisplayValue('New SOAP Method')).toBeInTheDocument()
  })
})
