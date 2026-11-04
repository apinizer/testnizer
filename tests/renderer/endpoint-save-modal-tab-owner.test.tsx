/**
 * Save As binds the row to the tab it was started from. The tree refresh that
 * follows the save takes a moment, and the user can move to another tab during
 * it: that other tab must not get the row, the name or the clean dot.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import EndpointSaveModal from '../../src/renderer/components/modals/EndpointSaveModal'
import { switchActiveTab } from '../../src/renderer/lib/activate-tab'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Tab } from '../../src/renderer/types'

const tab = (id: string): Tab =>
  ({ id, name: id, protocol: 'http', isDirty: true, isLoading: false }) as Tab

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    folder: { list: vi.fn(async () => ({ success: true, data: [] })) },
    savedRequest: {
      create: vi.fn(async () => ({ success: true, data: { id: 'row-1' } })),
    },
  }
  useTabsStore.setState({ tabs: [tab('tab-a'), tab('tab-b')], activeTabId: 'tab-a' })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: 'tab-a' })
})

afterEach(() => {
  cleanup()
  useUIStore.getState().setShowEndpointSaveModal(false)
})

describe('Save As with a slow tree refresh', () => {
  it('binds the row to the tab it started from, not the tab on screen when it ends', async () => {
    let finishRefresh: () => void = () => {}
    const refreshTree = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )
    useWorkspaceStore.setState({ activeProjectId: 'p', refreshTree })
    useUIStore.getState().setShowEndpointSaveModal(true)

    render(<EndpointSaveModal />)
    fireEvent.click(await screen.findByTestId('endpoint-save-submit'))
    await waitFor(() => expect(refreshTree).toHaveBeenCalled())

    await act(async () => {
      switchActiveTab('tab-b')
    })
    await act(async () => {
      finishRefresh()
    })

    const tabs = useTabsStore.getState().tabs
    const a = tabs.find((t) => t.id === 'tab-a')
    const b = tabs.find((t) => t.id === 'tab-b')
    expect(a?.savedRequestId).toBe('row-1')
    expect(a?.isDirty).toBe(false)
    expect(b?.savedRequestId).toBeUndefined()
    expect(b?.isDirty).toBe(true)
    expect(b?.name).toBe('tab-b')
  })
})
