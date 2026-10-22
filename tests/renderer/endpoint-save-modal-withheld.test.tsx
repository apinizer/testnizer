/**
 * Issue #244 — the data-loss trap through the Save dialog's in-place UPDATE.
 *
 * `EndpointSaveModal` updates the tab's own saved request when it already has
 * one (`isUpdate`). After a restart the tab's literal credentials are blank
 * and marked withheld (`credentials-no-persist.test.tsx` covers the hydrate);
 * the dialog must reload them from the row before it builds the payload — and
 * build the payload from the store AFTER that reload, not from render-time
 * values — or the update writes empty fields over the stored ones. A row that
 * cannot be read refuses the update.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import EndpointSaveModal from '../../src/renderer/components/modals/EndpointSaveModal'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import type { AuthConfig, KeyValuePair, Tab } from '../../src/renderer/types'

const PASS = 'LITERAL-pass-244-modal'
const HDR = 'Bearer LITERAL-hdr-244-modal'

const savedAuth: AuthConfig = { type: 'basic', basic: { username: 'alice', password: PASS } }
const savedHeaders: KeyValuePair[] = [
  { id: 'h-auth', key: 'Authorization', value: HDR, enabled: true },
  { id: 'h-acc', key: 'Accept', value: 'application/json', enabled: true },
]

function installApi(readable = true) {
  const update = vi.fn(async () => ({ success: true, data: { id: 'sr-1' } }))
  const row = {
    id: 'sr-1',
    folder_id: null,
    headers: JSON.stringify(savedHeaders),
    auth: JSON.stringify(savedAuth),
    metadata: null,
  }
  const get = vi.fn(async () => (readable ? { success: true, data: row } : { success: false }))
  ;(window as unknown as { api: unknown }).api = {
    folder: { list: vi.fn(async () => ({ success: true, data: [] })) },
    savedRequest: { get, update, create: vi.fn() },
  }
  return { update, get }
}

/** The state a saved request's tab comes back with after a restart. */
function restoredTab(): void {
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-1',
        name: 'Req',
        protocol: 'http',
        method: 'GET',
        url: 'https://api.test/a',
        savedRequestId: 'sr-1',
        isDirty: false,
      } as Tab,
    ],
    activeTabId: 'tab-1',
  })
  useRequestStore.getState().switchToTab('tab-1')
  useRequestStore.setState({
    url: 'https://api.test/a',
    auth: { type: 'basic', basic: { username: 'alice', password: '' } },
    headers: savedHeaders.map((h) => (h.id === 'h-auth' ? { ...h, value: '' } : h)),
    withheldCredentials: ['auth.basic.password', 'headers#h-auth'],
  })
}

beforeEach(() => {
  window.localStorage.clear()
  useWorkspaceStore.setState({ activeProjectId: 'p-1', refreshTree: async () => {} } as never)
  useUIStore.setState({ showEndpointSaveModal: true })
})
afterEach(() => cleanup())

type Payload = { auth: string; headers: string }

describe('Save dialog update after a restart (issue #244)', () => {
  it('reloads the withheld credentials before writing the row', async () => {
    const { update } = installApi()
    restoredTab()
    render(React.createElement(EndpointSaveModal))
    fireEvent.click(await screen.findByTestId('endpoint-save-submit'))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const payload = (update.mock.calls[0] as unknown as [string, Payload])[1]
    expect(JSON.parse(payload.auth)).toEqual(savedAuth)
    const headers = JSON.parse(payload.headers) as KeyValuePair[]
    expect(headers.find((h) => h.key === 'Authorization')?.value).toBe(HDR)
  })

  it('a row that cannot be read refuses the update and says why', async () => {
    const { update, get } = installApi(false)
    restoredTab()
    render(React.createElement(EndpointSaveModal))
    await waitFor(() => expect(get).toHaveBeenCalled())
    fireEvent.click(await screen.findByTestId('endpoint-save-submit'))
    expect(await screen.findByText(/could not reload the saved request credentials/i)).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })
})
