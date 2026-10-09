/**
 * Issue #174 — Copy as JSON-RPC / cURL. Next to Invoke / Read / Get a small
 * menu copies the exact `tools/call` / `resources/read` / `prompts/get`
 * request with `{{var}}` resolved; on the Streamable HTTP transport also a
 * cURL command with the tab's headers — credential headers (and the
 * Authorization tab) masked as `<redacted>`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { buildCurl, buildJsonRpc, isCredentialHeader } from '../../src/renderer/lib/mcp-copy-as'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'
import McpResourcePane from '../../src/renderer/components/protocols/mcp/McpResourcePane'

describe('builders', () => {
  it('JSON-RPC requests per capability', () => {
    expect(buildJsonRpc({ kind: 'tool', name: 'echo', args: { a: 1 } })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'echo', arguments: { a: 1 } },
    })
    expect(buildJsonRpc({ kind: 'resource', uri: 'test://a' })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'test://a' },
    })
    expect(buildJsonRpc({ kind: 'prompt', name: 'greet', args: { who: 'Ada' } }).method).toBe(
      'prompts/get',
    )
  })

  it.each(['Authorization', 'cookie', 'X-API-Key', 'Proxy-Authorization', 'X-Auth-Token'])(
    '%s is a credential header',
    (h) => expect(isCredentialHeader(h)).toBe(true),
  )
  it('X-Request-Id is not', () => expect(isCredentialHeader('X-Request-Id')).toBe(false))

  it('cURL masks credentials, keeps the rest, quotes for the shell', () => {
    const cmd = buildCurl({
      url: "http://h/mcp?x='y'",
      headers: { 'X-Tenant': 'acme', Authorization: 'Bearer s3cret' },
      auth: { type: 'api-key', apiKey: { key: 'api_key', value: 'k3y', in: 'query' } },
      protocolVersion: '2025-06-18',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo' } },
    })
    expect(cmd).not.toContain('s3cret')
    expect(cmd).not.toContain('k3y')
    expect(cmd).toContain("-H 'Authorization: <redacted>'")
    expect(cmd).toContain("-H 'X-Tenant: acme'")
    expect(cmd).toContain("-H 'MCP-Protocol-Version: 2025-06-18'")
    expect(cmd).toContain("-H 'Accept: application/json, text/event-stream'")
    expect(cmd).toContain(`curl -X POST 'http://h/mcp?x='\\''y'\\''&api_key=<redacted>'`)
    expect(cmd).toContain(`--data-raw '{"jsonrpc":"2.0","id":1,"method":"tools/call"`)
  })

  it('bearer / basic auth become a masked Authorization header', () => {
    const bearer = buildCurl({
      url: 'http://h/mcp',
      headers: {},
      auth: { type: 'bearer', bearer: { token: 'tok' } },
      body: {},
    })
    expect(bearer).toContain("-H 'Authorization: <redacted>'")
    expect(bearer).not.toContain('tok')
  })
})

// ─── Menu ───────────────────────────────────────────────────────────────────

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
        {
          name: 'echo',
          inputSchema: {
            type: 'object',
            properties: { n: { type: 'integer' }, s: { type: 'string' } },
          },
        },
      ],
    })),
    listResources: vi.fn(async () => ({
      success: true,
      data: { resources: [{ uri: 'test://{{doc}}', name: 'a' }], templates: [] },
    })),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
}

let writeText: ReturnType<typeof vi.fn>

async function connected(transport: 'http' | 'stdio' = 'http'): Promise<void> {
  useTabsStore.setState({
    tabs: [{ id: 'tab-c', name: 'c', protocol: 'mcp', isDirty: false } as never],
    activeTabId: 'tab-c',
  })
  useMcpStore.getState().switchToTab('tab-c')
  useMcpStore.setState({
    url: transport === 'http' ? 'http://{{host}}/mcp' : 'npx server',
    transport,
    customHeaders: [{ id: 'h', key: 'X-Api-Key', value: '{{secret}}', enabled: true }],
  })
  await useMcpStore.getState().connect()
}

async function pick(item: string): Promise<string> {
  fireEvent.click(screen.getByTestId('mcp-copy-as'))
  await act(async () => {
    fireEvent.click(screen.getByTestId(item))
  })
  return writeText.mock.calls.at(-1)?.[0] as string
}

beforeEach(() => {
  installApi()
  writeText = vi.fn(async () => undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  useEnvironmentStore.setState({
    getActiveVariables: () => ({ host: 'api.test', n: '7', secret: 'SECRET', doc: 'readme' }),
  } as never)
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})
afterEach(cleanup)

describe('Copy as… menu (issue #174)', () => {
  it('copies the tools/call request with resolved, schema-typed args', async () => {
    await connected()
    useMcpStore.getState().setSelectedTool('echo')
    useMcpStore.setState({ toolArgs: '{"n":"{{n}}","s":"{{host}}"}' })
    render(<McpToolPane />)
    const text = await pick('mcp-copy-jsonrpc')
    expect(JSON.parse(text)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'echo', arguments: { n: 7, s: 'api.test' } },
    })
  })

  it('copies a cURL for Streamable HTTP with the custom header masked', async () => {
    await connected()
    useMcpStore.getState().setSelectedTool('echo')
    render(<McpToolPane />)
    const text = await pick('mcp-copy-curl')
    expect(text).toContain("curl -X POST 'http://api.test/mcp'")
    expect(text).toContain("-H 'X-Api-Key: <redacted>'")
    expect(text).not.toContain('SECRET')
    expect(text).toContain("-H 'MCP-Protocol-Version: 2025-06-18'")
  })

  it('cURL is disabled off Streamable HTTP', async () => {
    await connected('stdio')
    useMcpStore.getState().setSelectedTool('echo')
    render(<McpToolPane />)
    fireEvent.click(screen.getByTestId('mcp-copy-as'))
    expect((screen.getByTestId('mcp-copy-curl') as HTMLButtonElement).disabled).toBe(true)
  })

  it('the resource pane copies resources/read with the URI resolved', async () => {
    await connected()
    useMcpStore.getState().setCapabilityTab('resources')
    useMcpStore.getState().selectResource('test://{{doc}}')
    render(<McpResourcePane />)
    const text = await pick('mcp-copy-jsonrpc')
    expect(JSON.parse(text).params).toEqual({ uri: 'test://readme' })
  })

  it('invalid JSON args copy nothing', async () => {
    await connected()
    useMcpStore.getState().setSelectedTool('echo')
    useMcpStore.setState({ toolArgs: '{oops' })
    render(<McpToolPane />)
    await pick('mcp-copy-jsonrpc')
    expect(writeText).not.toHaveBeenCalled()
  })
})
