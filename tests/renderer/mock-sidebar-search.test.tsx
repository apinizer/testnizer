/**
 * Mocks sidebar search (issue #226): besides the name, a query matches the
 * kind label (HTTP / MCP / SSE / AI — as a prefix, so one letter does not
 * pull in every kind) and the port, so "sse", "ai" and "3200" work. Words
 * are ANDed ("ai 3300"). The displayed address is NOT matched: an MCP row
 * shows `http://…`, so "http" would list the MCP servers.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { httpServer, resetHttpBridge } from './mock-http-bridge-stub'
import { installBridge, sampleServer } from './mock-mcp-bridge-stub'
import MockServersPanel from '../../src/renderer/components/mock/MockServersPanel'
import { matchesMockQuery } from '../../src/renderer/components/mock/mock-kind-ui'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale } from '../../src/renderer/lib/i18n'

void React

const HTTP = [
  httpServer({ id: 'h1', name: 'Orders API', kind: 'http', port: 3001 }),
  httpServer({ id: 's1', name: 'Live ticker', kind: 'sse', port: 3200 }),
  httpServer({ id: 'a1', name: 'Chat API', kind: 'ai', port: 3300 }),
]
const MCP = [sampleServer({ id: 'm1', name: 'Echo tools', port: 3100 })]

beforeEach(async () => {
  setLocale('en')
  resetHttpBridge(HTTP)
  installBridge(MCP)
  useMockStore.setState({ servers: [], statusByServer: {}, errorByServer: {} })
  useMockMcpStore.setState({ servers: [], projectId: null })
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
  render(<MockServersPanel />)
  await act(async () => {
    await useMockStore.getState().loadServers('p-1')
    await useMockMcpStore.getState().loadServers('p-1')
  })
})
afterEach(() => cleanup())

function search(q: string): void {
  fireEvent.change(screen.getByTestId('mock-search'), { target: { value: q } })
}
/** Names listed in the panel, every group. */
function shown(): string[] {
  const names: string[] = []
  for (const id of [
    'mock-http-section',
    'mock-mcp-section',
    'mock-sse-section',
    'mock-ai-section',
  ]) {
    const section = screen.getByTestId(id)
    for (const s of [...HTTP, ...MCP]) {
      if (within(section).queryByText(s.name)) names.push(s.name)
    }
  }
  return names
}

describe('matchesMockQuery', () => {
  const ticker = { name: 'Live ticker', kind: 'sse' as const, port: 3200 }
  it('name, kind prefix, port; words ANDed; case-insensitive', () => {
    expect(matchesMockQuery('', ticker)).toBe(true)
    expect(matchesMockQuery('tick', ticker)).toBe(true)
    expect(matchesMockQuery('SSE', ticker)).toBe(true)
    expect(matchesMockQuery('ss', ticker)).toBe(true)
    expect(matchesMockQuery('3200', ticker)).toBe(true)
    expect(matchesMockQuery('320', ticker)).toBe(true)
    expect(matchesMockQuery('sse 3200', ticker)).toBe(true)
    expect(matchesMockQuery('sse 3300', ticker)).toBe(false)
    expect(matchesMockQuery('se', ticker)).toBe(false) // kind is a prefix match
    expect(matchesMockQuery('http', ticker)).toBe(false)
  })
})

describe('Mocks sidebar search (issue #226)', () => {
  it('"sse" lists the SSE server (its name has no "sse")', () => {
    search('sse')
    expect(shown()).toEqual(['Live ticker'])
  })

  it('"ai" lists the AI server; "mcp" the Mock MCP server', () => {
    search('ai')
    expect(shown()).toEqual(['Chat API'])
    search('mcp')
    expect(shown()).toEqual(['Echo tools'])
  })

  it('a port finds its server, in any group', () => {
    search('3200')
    expect(shown()).toEqual(['Live ticker'])
    search('3100')
    expect(shown()).toEqual(['Echo tools'])
  })

  it('"http" lists only HTTP servers (the MCP row\'s http:// address does not count)', () => {
    search('http')
    expect(shown()).toEqual(['Orders API'])
  })

  it('names still match', () => {
    search('chat')
    expect(shown()).toEqual(['Chat API'])
  })
})
