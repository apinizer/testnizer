/**
 * Issue #269 — every save entry point routes a request whose row is gone to
 * the Save dialog with a short notice, instead of claiming a save:
 *   - Ctrl+S: Save dialog + "This request no longer exists in the collection…"
 *   - UrlBar Save button: used to `throw` on `notApplicable` (red ✗ chip, no
 *     dialog); now opens the Save dialog like Ctrl+S.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/renderer/lib/platform', () => ({ isMac: () => false }))
vi.mock('../../src/renderer/lib/save-active-request', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/lib/save-active-request')>()
  return { ...real, saveActiveRequestInPlace: vi.fn() }
})

import { toast } from '../../src/renderer/lib/toast'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import { useKeyboardShortcuts } from '../../src/renderer/lib/keyboard-shortcuts'
import UrlBar from '../../src/renderer/components/layout/UrlBar'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { Tab } from '../../src/renderer/types'

const EN = 'This request no longer exists in the collection. Choose where to save it.'
const TR = 'Bu istek artık koleksiyonda yok. Nereye kaydedileceğini seçin.'

function Shortcuts(): null {
  useKeyboardShortcuts()
  return null
}

function activate(tab: Partial<Tab>): void {
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', name: 'Req', method: 'GET', url: '', protocol: 'http', ...tab } as Tab],
    activeTabId: 'tab-1',
  })
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.info).mockClear()
  vi.mocked(saveActiveRequestInPlace).mockReset()
  useUIStore.setState({ showSaveModal: false, showEndpointSaveModal: false })
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('Ctrl+S on a request whose row is gone (issue #269)', () => {
  it('opens the Save dialog with the "no longer exists" notice', async () => {
    vi.mocked(saveActiveRequestInPlace).mockResolvedValue({
      success: false,
      notApplicable: true,
      orphaned: true,
    })
    activate({ endpointId: 'gone' })
    render(<Shortcuts />)
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(useUIStore.getState().showEndpointSaveModal).toBe(true))
    expect(toast.info).toHaveBeenCalledWith(EN)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('the notice is translated', async () => {
    vi.mocked(saveActiveRequestInPlace).mockResolvedValue({
      success: false,
      notApplicable: true,
      orphaned: true,
    })
    useUIStore.getState().setLocale('tr')
    activate({ savedRequestId: 'gone' })
    render(<Shortcuts />)
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(TR))
  })
})

describe('UrlBar Save button (issue #269)', () => {
  it('notApplicable opens the Save dialog instead of failing', async () => {
    vi.mocked(saveActiveRequestInPlace).mockResolvedValue({
      success: false,
      notApplicable: true,
      orphaned: true,
    })
    activate({ endpointId: 'gone' })
    render(<UrlBar />)
    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() => expect(useUIStore.getState().showEndpointSaveModal).toBe(true))
    expect(toast.info).toHaveBeenCalledWith(EN)
    expect(screen.getByTestId('save-btn')).not.toHaveTextContent('✗')
  })

  it('a real failure still shows the error chip and no dialog', async () => {
    vi.mocked(saveActiveRequestInPlace).mockResolvedValue({ success: false, error: 'disk full' })
    activate({ endpointId: 'e-1' })
    render(<UrlBar />)
    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() => expect(screen.getByTestId('save-btn')).toHaveTextContent('✗'))
    expect(useUIStore.getState().showEndpointSaveModal).toBe(false)
  })
})

// The sidebar delete unbinds the tab first (orphan-tab.ts), so Ctrl+S / Save
// see an unbound tab and open the dialog without calling the save helper. The
// tab's `orphaned` flag still makes them say why — this is the tester's exact
// flow, which the first fix missed (caught by the e2e spec).
describe('save after the row was deleted from the sidebar (tab already unbound)', () => {
  it('Ctrl+S shows the notice and opens the dialog', async () => {
    activate({ orphaned: true, isDirty: true })
    render(<Shortcuts />)
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(useUIStore.getState().showEndpointSaveModal).toBe(true))
    expect(toast.info).toHaveBeenCalledWith(EN)
  })

  it('the UrlBar Save button shows the notice and opens the dialog', async () => {
    activate({ orphaned: true, isDirty: true })
    render(<UrlBar />)
    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() => expect(useUIStore.getState().showEndpointSaveModal).toBe(true))
    expect(toast.info).toHaveBeenCalledWith(EN)
  })

  it('a plain unsaved draft opens the dialog without the notice', async () => {
    activate({ isDirty: true })
    render(<UrlBar />)
    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() => expect(useUIStore.getState().showEndpointSaveModal).toBe(true))
    expect(toast.info).not.toHaveBeenCalled()
  })
})

