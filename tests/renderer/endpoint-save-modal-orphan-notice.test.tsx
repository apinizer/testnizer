/**
 * Issue #269 follow-up — when Save As opens because the tab's saved row was
 * deleted (`tab.orphaned`), the dialog says so in a persistent note at the top
 * of its body. The toast that announced it fades, and the dialog title ("Save
 * Endpoint") alone does not explain why a tab that was saved asks for a folder.
 */
// vitest compiles JSX with the classic runtime (React must be in scope), while
// tsc flags a JSX-only React import as unused (TS6133) — so no JSX here.
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import EndpointSaveModal from '../../src/renderer/components/modals/EndpointSaveModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { Tab } from '../../src/renderer/types'

function open(tab: Partial<Tab>): void {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    folder: { list: vi.fn(async () => ({ success: true, data: [] })), create: vi.fn() },
    savedRequest: { get: vi.fn(async () => ({ success: true, data: {} })) },
  }
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', name: 'Pay', method: 'GET', url: '', protocol: 'http', ...tab } as Tab],
    activeTabId: 'tab-1',
  })
  useWorkspaceStore.setState({ activeProjectId: 'p1', projects: [] } as never)
  useUIStore.setState({ showEndpointSaveModal: true })
}

beforeEach(() => {
  useUIStore.setState({ showEndpointSaveModal: false })
})
afterEach(() => {
  cleanup()
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
})

describe('EndpointSaveModal orphan notice (issue #269)', () => {
  it('shows a persistent note inside the dialog for an orphaned tab', async () => {
    open({ orphaned: true, isDirty: true })
    render(React.createElement(EndpointSaveModal))

    const notice = await screen.findByTestId('save-modal-orphan-notice')
    expect(screen.getByTestId('endpoint-save-modal')).toContainElement(notice)
    expect(notice).toHaveTextContent(
      'The saved request was deleted. Choose where to save your changes.',
    )
    expect(notice).toHaveAttribute('role', 'note')
  })

  it('is absent for an ordinary unsaved tab and for a saved one', async () => {
    open({ isDirty: true })
    const { unmount } = render(React.createElement(EndpointSaveModal))
    await screen.findByTestId('endpoint-save-modal')
    expect(screen.queryByTestId('save-modal-orphan-notice')).toBeNull()
    unmount()

    open({ savedRequestId: 'sr-1' })
    render(React.createElement(EndpointSaveModal))
    await screen.findByTestId('endpoint-save-modal')
    expect(screen.queryByTestId('save-modal-orphan-notice')).toBeNull()
  })

  it('appears when the tab is orphaned while the dialog is open', async () => {
    open({ savedRequestId: 'sr-1' })
    render(React.createElement(EndpointSaveModal))
    await screen.findByTestId('endpoint-save-modal')
    expect(screen.queryByTestId('save-modal-orphan-notice')).toBeNull()

    act(() =>
      useTabsStore
        .getState()
        .updateTab('tab-1', { savedRequestId: undefined, orphaned: true, isDirty: true }),
    )
    expect(await screen.findByTestId('save-modal-orphan-notice')).toBeInTheDocument()
  })

  it('is translated to Turkish', async () => {
    useUIStore.setState({ locale: 'tr' })
    open({ orphaned: true, isDirty: true })
    render(React.createElement(EndpointSaveModal))
    expect(await screen.findByTestId('save-modal-orphan-notice')).toHaveTextContent(
      'Kayıtlı istek silinmiş. Değişikliklerinizi nereye kaydedeceğinizi seçin.',
    )
  })
})
