/**
 * MCP "Copy as JSON-RPC / cURL" follows the Generate Code rule for secret
 * variables (canary scan, release 1.6.0): a `secret` env / global variable
 * stays a `{{name}}` placeholder in the copied text — in the URL, a
 * non-credential header and the tool arguments — unless "Include secret
 * values" is ticked in the menu for that copy. Plain variables resolve as
 * before; credential headers stay `<redacted>` either way (issue #174).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'
import type { Environment } from '../../src/renderer/types'

const SECRET = 'CANARY-MCP-SECRET-3d1e'

function installApi() {
  const mcp = {
    connect: vi.fn(async () => ({
      success: true,
      data: {
        connectionId: 'conn-1',
        transport: 'http',
        url: 'http://x/mcp',
        protocolVersion: '2025-06-18',
      },
    })),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({
      success: true,
      data: [
        { name: 'echo', inputSchema: { type: 'object', properties: { s: { type: 'string' } } } },
      ],
    })),
    listResources: vi.fn(async () => ({ success: true, data: { resources: [], templates: [] } })),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
}

let writeText: ReturnType<typeof vi.fn>

function seedEnv(): void {
  const v = (key: string, value: string, secret: boolean) => ({
    id: key,
    key,
    value,
    initialValue: value,
    enabled: true,
    secret,
  })
  useEnvironmentStore.setState({
    environments: [
      {
        id: 'env-1',
        name: 'Dev',
        workspace_id: 'w',
        variables: [v('host', 'api.test', false), v('trace', SECRET, true)],
      } as unknown as Environment,
    ],
    globalVariables: [],
    activeEnvironmentId: 'env-1',
  })
}

async function connected(): Promise<void> {
  useTabsStore.setState({
    tabs: [{ id: 'tab-s', name: 's', protocol: 'mcp', isDirty: false } as never],
    activeTabId: 'tab-s',
  })
  useMcpStore.getState().switchToTab('tab-s')
  useMcpStore.setState({
    url: 'http://{{host}}/mcp?t={{trace}}',
    transport: 'http',
    customHeaders: [{ id: 'h', key: 'X-Trace', value: '{{trace}}', enabled: true }],
  })
  await useMcpStore.getState().connect()
  useMcpStore.getState().setSelectedTool('echo')
  useMcpStore.setState({ toolArgs: '{"s":"{{trace}}"}' })
}

async function pick(item: string, includeSecrets = false): Promise<string> {
  fireEvent.click(screen.getByTestId('mcp-copy-as'))
  if (includeSecrets) fireEvent.click(screen.getByTestId('mcp-copy-include-secrets'))
  await act(async () => {
    fireEvent.click(screen.getByTestId(item))
  })
  return writeText.mock.calls.at(-1)?.[0] as string
}

beforeEach(() => {
  window.localStorage.clear()
  installApi()
  writeText = vi.fn(async () => undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  seedEnv()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})
afterEach(cleanup)

describe('MCP Copy as… keeps secret variables as placeholders', () => {
  it('JSON-RPC: a secret argument stays {{name}}', async () => {
    await connected()
    render(<McpToolPane />)
    const text = await pick('mcp-copy-jsonrpc')
    expect(text).not.toContain(SECRET)
    expect(JSON.parse(text).params.arguments).toEqual({ s: '{{trace}}' })
  })

  it('cURL: secret stays {{name}} in URL, header and body; plain variables resolve', async () => {
    await connected()
    render(<McpToolPane />)
    const text = await pick('mcp-copy-curl')
    expect(text).not.toContain(SECRET)
    expect(text).toContain('http://api.test/mcp')
    expect(text).toContain("-H 'X-Trace: {{trace}}'")
    expect(text).toContain('"s":"{{trace}}"')
  })

  it('"Include secret values" resolves them for that copy only', async () => {
    await connected()
    render(<McpToolPane />)
    const withSecrets = await pick('mcp-copy-curl', true)
    expect(withSecrets).toContain(`-H 'X-Trace: ${SECRET}'`)
    // The opt-in does not stick: the next copy hides the secret again.
    const next = await pick('mcp-copy-curl')
    expect(next).not.toContain(SECRET)
  })
})
