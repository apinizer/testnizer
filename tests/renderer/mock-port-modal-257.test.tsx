/**
 * Issue #257 (item: Mock port field validates as you type) — the dialog.
 *
 * CONTRACT — `NewMockServerModal.tsx` (rule: `checkMockPort`, see
 * mock-port-check-257.test.ts):
 *   - `mock-new-port-error`   inline message directly under the field, present
 *                             WHILE TYPING as soon as the value is not a valid
 *                             port; text = t('mock.invalidPort') (existing key,
 *                             "Port must be 1–65535."); the input gets
 *                             aria-invalid="true" and describedby pointing at it.
 *   - `mock-new-port-hint`    privileged-port hint, shown for a VALID port
 *                             < 1024 only; EN text contains
 *                             "may need elevated permissions" (new key
 *                             `mockNew.portPrivileged`, EN + TR; the TR text
 *                             mentions 1024 and is not the EN sentence) and must NOT
 *                             promise failure (no "will fail", "cannot",
 *                             "not allowed", "requires").
 *   - `mock-new-port-warning` a port conflict stays a WARNING: unchanged
 *                             testid/text; can show together with the hint.
 *   - Create stays ENABLED in every case (an invalid port still shows the
 *     submit-time `mock-new-error` and creates nothing — existing behaviour in
 *     new-mock-server-modal.test.tsx stays green).
 *   - the suggested default port shows neither error nor hint.
 * Red now: no inline error, no hint.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { httpBridge, httpServer, resetHttpBridge } from './mock-http-bridge-stub'
import { installBridge, sampleServer } from './mock-mcp-bridge-stub'
import NewMockServerModal from '../../src/renderer/components/mock/NewMockServerModal'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

beforeEach(async () => {
  resetHttpBridge([httpServer({ id: 'h1', name: 'Users API', port: 3001 })])
  installBridge([sampleServer({ id: 'a', name: 'Echo MCP', port: 3100 })])
  useMockStore.setState({ servers: [], statusByServer: {}, errorByServer: {} })
  useMockMcpStore.setState({
    servers: [],
    projectId: null,
    stateByServer: {},
    logsByServer: {},
    drafts: {},
  })
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useUIStore.getState().setLocale('en')
  await act(async () => {
    await useMockStore.getState().loadServers('p-1')
    await useMockMcpStore.getState().loadServers('p-1')
  })
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

function typePort(value: string): void {
  fireEvent.change(screen.getByTestId('mock-new-port'), { target: { value } })
}
const open = (): void => {
  render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
}

describe('inline port validation', () => {
  it('the suggested port shows no error and no hint', () => {
    open()
    expect(screen.queryByTestId('mock-new-port-error')).toBeNull()
    expect(screen.queryByTestId('mock-new-port-hint')).toBeNull()
    expect(screen.getByTestId('mock-new-port')).not.toHaveAttribute('aria-invalid', 'true')
  })

  for (const bad of ['abc', '70000', '0', '', '3000.5', '-1']) {
    it(`"${bad}" is flagged while typing, before Create`, () => {
      open()
      typePort(bad)
      const err = screen.getByTestId('mock-new-port-error')
      expect(err).toHaveTextContent('Port must be 1–65535.')
      const input = screen.getByTestId('mock-new-port')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(err.id).not.toBe('')
      expect(input.getAttribute('aria-describedby')).toContain(err.id)
      expect(screen.queryByTestId('mock-new-error')).toBeNull() // nothing submitted yet
    })
  }

  it('the error disappears as soon as the value is valid', () => {
    open()
    typePort('abc')
    expect(screen.getByTestId('mock-new-port-error')).toBeInTheDocument()
    typePort('4100')
    expect(screen.queryByTestId('mock-new-port-error')).toBeNull()
  })

  it('Create is not disabled; an invalid port still creates nothing', async () => {
    open()
    typePort('abc')
    const create = screen.getByTestId('mock-new-create')
    expect(create).toBeEnabled()
    fireEvent.click(create)
    expect(await screen.findByTestId('mock-new-error')).toHaveTextContent('Port must be 1–65535.')
    expect(httpBridge.server.create).not.toHaveBeenCalled()
  })
})

describe('privileged ports (< 1024)', () => {
  it('hint says "may need elevated permissions" and promises nothing', () => {
    open()
    typePort('80')
    const hint = screen.getByTestId('mock-new-port-hint')
    expect(hint.textContent).toMatch(/may need elevated permissions/i)
    expect(hint.textContent).not.toMatch(/will fail|cannot|not allowed|requires/i)
    expect(screen.queryByTestId('mock-new-port-error')).toBeNull()
    expect(screen.getByTestId('mock-new-create')).toBeEnabled()
  })

  it('1024 and above: no hint', () => {
    open()
    typePort('1024')
    expect(screen.queryByTestId('mock-new-port-hint')).toBeNull()
  })

  it('an invalid port shows the error, not the hint', () => {
    open()
    typePort('0')
    expect(screen.queryByTestId('mock-new-port-hint')).toBeNull()
  })

  it('the hint is translated', () => {
    useUIStore.getState().setLocale('tr')
    open()
    typePort('443')
    expect(screen.getByTestId('mock-new-port-hint').textContent).toMatch(/1024/)
    expect(screen.getByTestId('mock-new-port-hint').textContent).not.toMatch(/may need/)
  })
})

describe('a port conflict stays a warning', () => {
  it('3001 is taken: warning shown, no error, Create enabled', () => {
    open()
    typePort('3001')
    expect(screen.getByTestId('mock-new-port-warning')).toHaveTextContent('3001')
    expect(screen.queryByTestId('mock-new-port-error')).toBeNull()
    expect(screen.getByTestId('mock-new-create')).toBeEnabled()
  })

  it('a taken privileged port shows the warning AND the hint', async () => {
    resetHttpBridge([httpServer({ id: 'h9', name: 'Low', port: 80 })])
    await act(async () => {
      await useMockStore.getState().loadServers('p-1')
    })
    open()
    typePort('80')
    expect(screen.getByTestId('mock-new-port-warning')).toHaveTextContent('80')
    expect(screen.getByTestId('mock-new-port-hint')).toBeInTheDocument()
  })
})
