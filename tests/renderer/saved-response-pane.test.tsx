/**
 * Issue #125 — ResponsePane on a freshly opened saved request with NO
 * response yet must list the request's saved examples (the "saved-only"
 * panel) instead of the generic "Click Send" empty state. Reproduces the
 * e2e flow: open preview tab for the saved request → pane mounts → list
 * resolves → panel renders.
 */
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

const api = vi.hoisted(() => ({
  list: vi.fn(),
}))
vi.hoisted(() => {
  const g = globalThis as unknown as { window: { api?: unknown } }
  g.window.api = {
    savedResponse: { list: api.list, create: vi.fn(), delete: vi.fn(), rename: vi.fn() },
    settings: { get: vi.fn(async () => ({ success: true, data: null })) },
  }
})

import ResponsePane from '../../src/renderer/components/response/ResponsePane'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useSavedResponseStore } from '../../src/renderer/stores/saved-response.store'

const row = {
  id: 'x1',
  project_id: 'p',
  owner_type: 'saved_request',
  owner_id: 'sr-1',
  name: '200 sample',
  protocol: 'http',
  method: 'GET',
  url: 'http://x',
  status_code: 200,
  response_json: JSON.stringify({ status: 200, statusText: 'OK', body: '{}', headers: {} }),
  created_at: 1,
}

beforeEach(() => {
  api.list.mockReset().mockResolvedValue({ success: true, data: [row] })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useSavedResponseStore.setState({ ownerKey: null, items: [], loading: false })
})
afterEach(cleanup)

describe('ResponsePane saved-only panel (issue #125)', () => {
  it('shows the saved examples for a reopened saved request before any Send', async () => {
    // Exactly what TreeView does on click.
    useTabsStore.getState().openPreviewTab({
      id: 'tab-sr-1',
      name: 'My req',
      protocol: 'http',
      method: 'GET',
      url: 'http://x',
      savedRequestId: 'sr-1',
    })
    useResponseStore.getState().clearResponse()

    render(<ResponsePane key="tab-sr-1" />)

    await waitFor(() => expect(api.list).toHaveBeenCalledWith('saved_request', 'sr-1'))
    await waitFor(() => expect(screen.getByTestId('response-saved-only')).toBeTruthy(), {
      timeout: 3000,
    })
    expect(screen.getAllByTestId('saved-response-row')).toHaveLength(1)
  })
})
