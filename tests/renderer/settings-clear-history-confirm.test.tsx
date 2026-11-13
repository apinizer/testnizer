/**
 * Project Settings → Data → "Clear history" deleted the project's history on
 * the first click. It now goes through the SAME confirmation as the History
 * sidebar's Clear (one hook, one scope rule: the project), and says so when
 * there is nothing to clear instead of opening an empty dialog.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))

import { DataPane } from '../../src/renderer/components/modals/project-settings-panes'
import { useHistoryStore } from '../../src/renderer/stores/history.store'

let stored = 3
const clear = vi.fn((_scope: unknown) => Promise.resolve({ success: true, data: stored }))
const count = vi.fn((_scope: unknown) => Promise.resolve({ success: true, data: stored }))

beforeEach(() => {
  stored = 3
  clear.mockClear()
  count.mockClear()
  toastMock.success.mockClear()
  toastMock.error.mockClear()
  toastMock.info.mockClear()
  ;(window as unknown as { api: unknown }).api = { history: { clear, count } }
  useHistoryStore.setState({ entries: [] })
})

afterEach(() => cleanup())

function clickClear(): void {
  fireEvent.click(screen.getByTestId('data-clear-history-btn'))
}

describe('Settings → Data → Clear history asks first', () => {
  it('opens the shared confirmation with the project count; nothing deleted yet', async () => {
    render(<DataPane projectId="p1" onOpenImport={() => {}} />)
    clickClear()
    expect(await screen.findByText('Delete project history')).toBeTruthy()
    expect(screen.getByText("this project's 3 history entries")).toBeTruthy()
    expect(count).toHaveBeenCalledWith({ project_id: 'p1' })
    expect(clear).not.toHaveBeenCalled()
  })

  it('Cancel deletes nothing', async () => {
    render(<DataPane projectId="p1" onOpenImport={() => {}} />)
    clickClear()
    fireEvent.click(await screen.findByTestId('delete-cancel-btn'))
    expect(clear).not.toHaveBeenCalled()
  })

  it('Confirm clears the project and reports it', async () => {
    render(<DataPane projectId="p1" onOpenImport={() => {}} />)
    clickClear()
    fireEvent.click(await screen.findByTestId('delete-confirm-btn'))
    await waitFor(() => expect(clear).toHaveBeenCalledWith({ project_id: 'p1' }))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('History cleared'))
  })

  it('a refused clear shows the error', async () => {
    clear.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: 'SQLITE_BUSY' } as never),
    )
    render(<DataPane projectId="p1" onOpenImport={() => {}} />)
    clickClear()
    fireEvent.click(await screen.findByTestId('delete-confirm-btn'))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('SQLITE_BUSY'))
  })

  it('switching to another project closes the open confirmation; nothing deleted', async () => {
    const view = render(<DataPane projectId="p1" onOpenImport={() => {}} />)
    clickClear()
    await screen.findByTestId('delete-confirm-btn')
    view.rerender(<DataPane projectId="p2" onOpenImport={() => {}} />)
    await waitFor(() => expect(screen.queryByTestId('delete-confirm-btn')).toBeNull())
    expect(clear).not.toHaveBeenCalled()
  })

  it('no history → says so, opens no dialog', async () => {
    stored = 0
    render(<DataPane projectId="p1" onOpenImport={() => {}} />)
    clickClear()
    await waitFor(() =>
      expect(toastMock.info).toHaveBeenCalledWith('This project has no request history'),
    )
    expect(screen.queryByTestId('delete-confirm-btn')).toBeNull()
    expect(clear).not.toHaveBeenCalled()
  })
})
