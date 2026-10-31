/**
 * New mock server dialog — the delayed "select the suggested name" step must
 * not steal focus from another text field. `select()` also focuses, so a Port
 * edit that started inside the 50 ms window after opening landed in the Name
 * field (name "31986", port left at the default 3001): the root cause of the
 * flaky e2e mock creations.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { resetHttpBridge } from './mock-http-bridge-stub'
import { installBridge } from './mock-mcp-bridge-stub'
import NewMockServerModal from '../../src/renderer/components/mock/NewMockServerModal'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

void React

beforeEach(() => {
  vi.useFakeTimers()
  resetHttpBridge([])
  installBridge([])
  useMockStore.setState({ servers: [], statusByServer: {}, errorByServer: {} })
  useMockMcpStore.setState({ servers: [], projectId: 'p-1' })
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('NewMockServerModal name preselect', () => {
  it('keeps focus in the Port field when the user is already editing it', () => {
    render(<NewMockServerModal initialKind="http" onClose={() => {}} />)
    const port = screen.getByTestId('mock-new-port')
    // jsdom's select() does not move focus the way Chromium's does, so assert
    // on the call itself: it must not happen while another field has focus.
    const select = vi.spyOn(screen.getByTestId('mock-new-name') as HTMLInputElement, 'select')
    port.focus()
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(select).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(port)
  })

  it('still selects the suggested name when nothing else is being edited', () => {
    render(<NewMockServerModal initialKind="http" onClose={() => {}} />)
    const name = screen.getByTestId('mock-new-name') as HTMLInputElement
    const select = vi.spyOn(name, 'select')
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(select).toHaveBeenCalledTimes(1)
  })
})
