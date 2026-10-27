/**
 * Issue #284 audit (P3) — "Create test suite / mock server from this request"
 * on a request the Runner / HTTP mock cannot take.
 *
 * The request menu offered both for every protocol: an MQTT row became a mock
 * route built from `new URL('mqtt://…').pathname`, and a WebSocket row a suite
 * item the Runner only ever reports as 'unsupported'. Now both follow the one
 * rule in `shared/request-protocols.ts` (the Runner uses it too): the item is
 * shown greyed out with the reason as its tooltip and does nothing on click.
 * A folder → mock server skips such requests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TreeNode as TreeNodeType } from '../../src/renderer/types'
import { isHttpMockableProtocol, isRunnableProtocol } from '../../src/shared/request-protocols'

vi.mock('../../src/renderer/lib/activate-tab', () => ({
  activateTabStores: vi.fn(),
  switchActiveTab: vi.fn(),
}))
vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

const { default: TreeNode } = await import('../../src/renderer/components/sidebar/TreeNode')
const { setLocale } = await import('../../src/renderer/lib/i18n')
const { useUIStore } = await import('../../src/renderer/stores/ui.store')
const { collectRequestIds } = await import('../../src/renderer/lib/folder-request-selection')

afterEach(() => {
  cleanup()
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
})

function openMenu(protocol: string) {
  const onCreateTestSuite = vi.fn()
  const onCreateMockServer = vi.fn()
  render(
    <TreeNode
      node={{ id: 'r1', type: 'request', label: 'Req', method: 'GET', protocol }}
      depth={0}
      activeId={null}
      openIds={new Set()}
      onToggle={() => {}}
      onSelect={() => {}}
      onCreateTestSuite={onCreateTestSuite}
      onCreateMockServer={onCreateMockServer}
    />,
  )
  fireEvent.contextMenu(screen.getByTestId('tree-node'), { clientX: 10, clientY: 10 })
  return {
    suite: screen.getByTestId('tree-create-suite-from-request'),
    mock: screen.getByTestId('tree-create-mock-from-request'),
    onCreateTestSuite,
    onCreateMockServer,
  }
}

describe('request menu: create from request follows what the Runner / HTTP mock can take', () => {
  it.each(['http', 'soap', 'graphql'])('%s: both enabled', (protocol) => {
    const m = openMenu(protocol)
    expect(m.suite).not.toHaveAttribute('aria-disabled')
    expect(m.mock).not.toHaveAttribute('aria-disabled')
    fireEvent.click(m.mock)
    expect(m.onCreateMockServer).toHaveBeenCalledTimes(1)
  })

  it('mcp: test suite enabled (the Runner has an MCP step), mock disabled', () => {
    const m = openMenu('mcp')
    expect(m.suite).not.toHaveAttribute('aria-disabled')
    expect(m.mock).toHaveAttribute('aria-disabled', 'true')
    expect(m.mock.getAttribute('title')).toMatch(/serves HTTP.*MCP request/)
  })

  it('sse: mock enabled (SSE response mode), test suite disabled', () => {
    const m = openMenu('sse')
    expect(m.mock).not.toHaveAttribute('aria-disabled')
    expect(m.suite).toHaveAttribute('aria-disabled', 'true')
  })

  it.each(['mqtt', 'websocket', 'socketio', 'grpc'])(
    '%s: both disabled with the reason; clicking does nothing',
    (protocol) => {
      const m = openMenu(protocol)
      expect(m.suite).toHaveAttribute('aria-disabled', 'true')
      expect(m.mock).toHaveAttribute('aria-disabled', 'true')
      expect(m.suite.getAttribute('title')).toMatch(/Runner can't run/)
      fireEvent.click(m.suite)
      fireEvent.click(m.mock)
      expect(m.onCreateTestSuite).not.toHaveBeenCalled()
      expect(m.onCreateMockServer).not.toHaveBeenCalled()
    },
  )

  it('the reason is translated (TR)', () => {
    useUIStore.setState({ locale: 'tr' })
    setLocale('tr')
    const m = openMenu('mqtt')
    expect(m.suite.getAttribute('title')).toBe(
      'Çalıştırıcı henüz MQTT isteklerini çalıştıramıyor; bu istekten test paketi oluşturulamaz.',
    )
    expect(m.mock.getAttribute('title')).toBe(
      'Mock sunucu HTTP sunar; bir MQTT isteğinin yerini tutamaz.',
    )
  })
})

describe('shared rule', () => {
  it('matches the Runner: HTTP family + MCP run; the rest is unsupported', () => {
    for (const p of ['http', 'soap', 'graphql', '', null, undefined, 'mcp'])
      expect(isRunnableProtocol(p)).toBe(true)
    for (const p of ['websocket', 'socketio', 'grpc', 'sse', 'mqtt', 'ai'])
      expect(isRunnableProtocol(p)).toBe(false)
  })

  it('a folder → mock server keeps only HTTP-mockable requests', () => {
    const folder: TreeNodeType = {
      id: 'f1',
      type: 'folder',
      label: 'F',
      children: [
        { id: 'h', type: 'request', label: 'h', protocol: 'http' },
        { id: 'q', type: 'request', label: 'q', protocol: 'mqtt' },
        { id: 's', type: 'endpoint', label: 's', protocol: 'sse' },
        { id: 'w', type: 'request', label: 'w', protocol: 'websocket' },
      ],
    }
    expect(collectRequestIds(folder, (n) => isHttpMockableProtocol(n.protocol))).toEqual(['h', 's'])
  })
})
