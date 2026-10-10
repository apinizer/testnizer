/**
 * Issue #152 — MCP tab on protocol 2026-07-28: the per-tab protocol choice
 * (sent on Connect), the negotiated era badge, the `subscriptions/listen`
 * state routed per connection, and the multi-round-trip (MRTR) input card —
 * `input_required` → generated form → `respondInput` with the SAME arguments,
 * the echoed `requestState` and bare `ElicitResult`s, looping until a complete
 * result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import McpConnectionBar from '../../src/renderer/components/protocols/mcp/McpConnectionBar'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'
import McpMessagesPane from '../../src/renderer/components/protocols/mcp/McpMessagesPane'
import {
  buildContent,
  buildInputResponses,
  initialValues,
  parseInputRequest,
  parseInputRequests,
} from '../../src/renderer/lib/mcp-elicitation'
import {
  MCP_LEGACY_VERSIONS,
  describeSubscriptionFilter,
  normalizeMcpProtocol,
} from '../../src/renderer/lib/mcp-protocol'
import { LEGACY_PROTOCOL_VERSIONS } from '../../src/main/mock-mcp/config'
import type { McpConnectRequest, McpSubscriptionStateEvent } from '../../src/renderer/types/mcp'

/** `ask_count`'s first answer, exactly as the e2e server emits it (wire capture). */
const ASK_COUNT = {
  resultType: 'input_required',
  inputRequests: {
    count: {
      method: 'elicitation/create',
      params: {
        message: 'How many apples?',
        requestedSchema: {
          type: 'object',
          properties: { count: { type: 'number' } },
          required: ['count'],
          $schema: 'https://json-schema.org/draft/2020-12/schema',
        },
        mode: 'form',
      },
    },
  },
  requestState: 'v1.state-1',
}

function withMarker(result: typeof ASK_COUNT): Record<string, unknown> {
  return {
    ...result,
    __mcp: {
      kind: 'input_required',
      inputRequests: result.inputRequests,
      requestState: result.requestState,
    },
  }
}

function installApi(opts: { era?: 'legacy' | 'modern' } = {}) {
  let subscriptionCb: ((e: McpSubscriptionStateEvent) => void) | undefined
  const connect = vi.fn(async (req: McpConnectRequest) => ({
    success: true,
    data: {
      connectionId: 'conn-152',
      transport: req.transport,
      url: req.url,
      serverName: 'e2e',
      serverVersion: '1.0.0',
      protocolVersion: opts.era === 'legacy' ? '2025-11-25' : '2026-07-28',
      capabilities: { tools: { listChanged: true } },
      era: opts.era ?? 'modern',
      ...(opts.era === 'legacy'
        ? {}
        : {
            discover: { supportedVersions: ['2026-07-28'], capabilities: {} },
            subscription: {
              requested: { toolsListChanged: true },
              honoredFilter: { toolsListChanged: true },
            },
          }),
    },
  }))
  const mcp = {
    connect,
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({
      success: true,
      data: [{ name: 'ask_count', inputSchema: { type: 'object', properties: {} } }],
    })),
    callTool: vi.fn(async () => ({ success: true, data: withMarker(ASK_COUNT) })),
    respondInput: vi.fn(async () => ({
      success: true,
      data: { content: [{ type: 'text', text: '3 apples' }] },
    })),
    onSubscriptionState: vi.fn((cb: (e: McpSubscriptionStateEvent) => void) => {
      subscriptionCb = cb
      return () => undefined
    }),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return { mcp, emitSubscription: (e: McpSubscriptionStateEvent) => subscriptionCb?.(e) }
}

async function connectTab(id: string): Promise<void> {
  useMcpStore.getState().switchToTab(id)
  useMcpStore.setState({ url: 'http://127.0.0.1:3100/mcp', transport: 'http' })
  await useMcpStore.getState().connect()
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-init')
})

afterEach(() => cleanup())

// ─── Pure helpers ───────────────────────────────────────────

describe('elicitation form helpers', () => {
  it('parses ask_count: one required number field; $schema is ignored', () => {
    const [view] = parseInputRequests(ASK_COUNT.inputRequests)
    expect(view).toMatchObject({ key: 'count', kind: 'form', message: 'How many apples?' })
    if (view.kind !== 'form') throw new Error('form expected')
    expect(view.fields).toEqual([{ name: 'count', kind: 'number', required: true }])
  })

  it('coerces by type: numbers / integers as numbers, booleans as booleans, empty optionals omitted', () => {
    const view = parseInputRequest('k', {
      method: 'elicitation/create',
      params: {
        message: 'm',
        requestedSchema: {
          type: 'object',
          properties: {
            n: { type: 'number' },
            i: { type: 'integer', minimum: 1 },
            b: { type: 'boolean', default: true },
            s: { type: 'string', title: 'Name', minLength: 1 },
            e: { type: 'string', enum: ['low', 'high'] },
            t: { type: 'string', oneOf: [{ const: 'a', title: 'Alpha' }] },
            opt: { type: 'string' },
          },
          required: ['n', 'i', 's', 'e'],
        },
      },
    })
    if (view.kind !== 'form') throw new Error('form expected')
    const values = { ...initialValues(view.fields), n: '2.5', i: '3', s: 'Ada', t: 'a' }
    expect(values.b).toBe(true)
    expect(values.e).toBe('low')
    expect(buildContent(view.fields, values)).toEqual({
      content: { n: 2.5, i: 3, b: true, s: 'Ada', e: 'low', t: 'a' },
    })
    expect(view.fields.find((f) => f.name === 't')?.options).toEqual([
      { value: 'a', label: 'Alpha' },
    ])
    expect(buildContent(view.fields, { ...values, i: '1.5' }).problem).toEqual({
      field: 'i',
      reason: 'integer',
    })
    expect(buildContent(view.fields, { ...values, n: 'x' }).problem?.reason).toBe('number')
    expect(buildContent(view.fields, { ...values, s: ' ' }).problem).toEqual({
      field: 's',
      reason: 'required',
    })
  })

  it('accept / decline / cancel build bare ElicitResults; deprecated requests are declined', () => {
    const views = parseInputRequests({
      ...ASK_COUNT.inputRequests,
      llm: { method: 'sampling/createMessage', params: { messages: [] } },
    })
    expect(views[1]).toMatchObject({
      kind: 'unsupported',
      method: 'sampling/createMessage',
      deprecated: true,
    })
    expect(buildInputResponses(views, 'accept', { count: { count: '3' } })).toEqual({
      responses: {
        count: { action: 'accept', content: { count: 3 } },
        llm: { action: 'decline' },
      },
    })
    expect(buildInputResponses(views, 'cancel', {}).responses).toEqual({
      count: { action: 'cancel' },
      llm: { action: 'cancel' },
    })
    expect(buildInputResponses(views, 'decline', {}).responses?.count).toEqual({
      action: 'decline',
    })
  })
})

describe('protocol helpers', () => {
  it('protocol normalisation and the subscription filter summary', () => {
    expect(normalizeMcpProtocol(' legacy ')).toBe('legacy')
    expect(normalizeMcpProtocol('2025-06-18')).toBe('2025-06-18')
    expect(normalizeMcpProtocol('bogus')).toBe('auto')
    expect(normalizeMcpProtocol(undefined)).toBe('auto')
    expect(describeSubscriptionFilter({ toolsListChanged: true, promptsListChanged: true })).toBe(
      'tools, prompts',
    )
  })

  it('the legacy pin list matches the SDK the engine bundles (drift guard)', () => {
    expect([...MCP_LEGACY_VERSIONS]).toEqual([...LEGACY_PROTOCOL_VERSIONS])
  })
})

// ─── Store ──────────────────────────────────────────────────

describe('store — protocol, era, subscription', () => {
  it('Connect sends the tab protocol; the result era / discover / subscription land on the tab', async () => {
    const { mcp } = installApi()
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.getState().setProtocol('legacy')
    await connectTab('tab-a')
    expect(mcp.connect.mock.calls[0][0].protocol).toBe('legacy')
    const s = useMcpStore.getState()
    expect(s.era).toBe('modern')
    expect(s.discover).toEqual({ supportedVersions: ['2026-07-28'], capabilities: {} })
    expect(s.subscription).toEqual({ state: 'open', honoredFilter: { toolsListChanged: true } })

    // Default is Auto, sent explicitly.
    useMcpStore.getState().switchToTab('tab-b')
    await connectTab('tab-b')
    expect(mcp.connect.mock.calls[1][0].protocol).toBe('auto')
  })

  it('subscription events are routed by connectionId; disconnect clears the era state', async () => {
    const { emitSubscription } = installApi()
    await connectTab('tab-a')
    useMcpStore.getState().switchToTab('tab-b')
    emitSubscription({ connectionId: 'conn-152', state: 'closed', reason: 'remote' })
    expect(useMcpStore.getState().subscription).toBeNull()
    expect(useMcpStore.getState()._tabStates.get('tab-a')?.subscription).toEqual({
      state: 'closed',
      reason: 'remote',
    })
    useMcpStore.getState().switchToTab('tab-a')
    await useMcpStore.getState().disconnect()
    const s = useMcpStore.getState()
    expect([s.era, s.discover, s.subscription, s.pendingInput]).toEqual([null, null, null, null])
    // The protocol choice is configuration — it survives.
    expect(s.protocol).toBe('auto')
  })
})

describe('store — multi-round-trip tools/call', () => {
  it('input_required → pending input; respondInput repeats the args and echoes requestState', async () => {
    const { mcp } = installApi()
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('ask_count')
    useMcpStore.getState().setToolArgs('{"label":"apples"}')
    await useMcpStore.getState().callTool()
    const pending = useMcpStore.getState().pendingInput
    expect(pending).toMatchObject({
      toolName: 'ask_count',
      args: { label: 'apples' },
      requestState: 'v1.state-1',
      round: 1,
    })
    expect(useMcpStore.getState().result).toBeNull()

    // Editing the textarea between rounds must not change the retry.
    useMcpStore.getState().setToolArgs('{"label":"pears"}')
    mcp.respondInput.mockResolvedValueOnce({
      success: true,
      data: withMarker({ ...ASK_COUNT, requestState: 'v1.state-2' }),
    })
    await useMcpStore
      .getState()
      .respondInput({ count: { action: 'accept', content: { count: 3 } } })
    expect(mcp.respondInput).toHaveBeenLastCalledWith(
      'conn-152',
      'ask_count',
      { label: 'apples' },
      'v1.state-1',
      { count: { action: 'accept', content: { count: 3 } } },
      expect.any(Object),
    )
    expect(useMcpStore.getState().pendingInput).toMatchObject({
      round: 2,
      requestState: 'v1.state-2',
    })

    await useMcpStore
      .getState()
      .respondInput({ count: { action: 'accept', content: { count: 3 } } })
    expect(mcp.respondInput.mock.calls[1][3]).toBe('v1.state-2')
    const s = useMcpStore.getState()
    expect(s.pendingInput).toBeNull()
    expect(s.result).toEqual({ content: [{ type: 'text', text: '3 apples' }] })
  })

  // Issue #154: a refused retry used to close the card and drop the typed
  // answers; it now stays open with the error inline so the user can retry.
  it('a refused retry (forged state) keeps the card and shows the error on it', async () => {
    const { mcp } = installApi()
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('ask_count')
    await useMcpStore.getState().callTool()
    mcp.respondInput.mockResolvedValueOnce({
      success: false,
      error: 'MCP error -32602: Invalid or expired requestState',
    } as never)
    await useMcpStore.getState().respondInput({ count: { action: 'decline' } })
    const s = useMcpStore.getState()
    expect(s.pendingInput).toMatchObject({ round: 1, requestState: 'v1.state-1' })
    expect(s.pendingInput?.error).toMatch(/-32602/)
    expect(s.isInvoking).toBe(false)
  })
})

// ─── Components ─────────────────────────────────────────────

describe('components', () => {
  it('the protocol select writes the tab choice; the badge names the era', async () => {
    installApi({ era: 'legacy' })
    useMcpStore.setState({ url: 'http://127.0.0.1:3100/mcp', transport: 'http' })
    render(<McpConnectionBar />)
    const select = screen.getByTestId('mcp-protocol') as HTMLSelectElement
    expect(select.value).toBe('auto')
    fireEvent.change(select, { target: { value: '2026-07-28' } })
    expect(useMcpStore.getState().protocol).toBe('2026-07-28')
    fireEvent.change(select, { target: { value: '2025-06-18' } })
    expect(useMcpStore.getState().protocol).toBe('2025-06-18')
    await act(async () => {
      await useMcpStore.getState().connect()
    })
    const badge = screen.getByTestId('mcp-protocol-version')
    // Issue #167: a 2025 server is "MCP 2025-11-25", never "(legacy)".
    expect(badge.textContent).toBe('MCP 2025-11-25')
    expect(badge).toHaveAttribute('data-era', 'legacy')
    expect(select).toBeDisabled()
  })

  it('the Messages header shows what the listen stream delivers', () => {
    useMcpStore.setState({
      subscription: {
        state: 'open',
        honoredFilter: { toolsListChanged: true, promptsListChanged: true },
      },
    })
    render(<McpMessagesPane />)
    expect(screen.getByTestId('mcp-subscription')).toHaveTextContent('Subscribed: tools, prompts')
  })

  it('the input card submits typed content, then shows the complete result', async () => {
    const { mcp } = installApi()
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('ask_count')
    render(<McpToolPane />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-invoke'))
    })
    expect(screen.getByTestId('mcp-input-required')).toHaveTextContent('How many apples?')
    // Submit without a value → a local problem, no IPC.
    fireEvent.click(screen.getByTestId('mcp-input-submit'))
    expect(screen.getByTestId('mcp-input-problem')).toHaveTextContent('"count" is required')
    expect(mcp.respondInput).not.toHaveBeenCalled()

    fireEvent.change(screen.getByTestId('mcp-input-field-count-count'), {
      target: { value: '3' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-input-submit'))
    })
    expect(mcp.respondInput.mock.calls[0][4]).toEqual({
      count: { action: 'accept', content: { count: 3 } },
    })
    expect(screen.queryByTestId('mcp-input-required')).toBeNull()
    expect(screen.getByTestId('mcp-result')).toHaveTextContent('3 apples')
  })

  it('two tabs paused at the same round never share typed answers', async () => {
    installApi()
    // Tab B pauses first (round 1, requestState v1.state-1) and goes to the cache.
    await connectTab('tab-b')
    useMcpStore.getState().setSelectedTool('ask_count')
    await useMcpStore.getState().callTool()
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('ask_count')
    render(<McpToolPane />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-invoke'))
    })
    fireEvent.change(screen.getByTestId('mcp-input-field-count-count'), {
      target: { value: '7' },
    })
    // Straight to B: same round, same requestState — the pane stays mounted.
    act(() => useMcpStore.getState().switchToTab('tab-b'))
    expect(useMcpStore.getState().pendingInput).toMatchObject({ round: 1 })
    const field = screen.getByTestId('mcp-input-field-count-count') as HTMLInputElement
    expect(field.value).toBe('')
  })

  it('Cancel sends a bare cancel for every request', async () => {
    const { mcp } = installApi()
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('ask_count')
    render(<McpToolPane />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-invoke'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-input-cancel'))
    })
    expect(mcp.respondInput.mock.calls[0][4]).toEqual({ count: { action: 'cancel' } })
  })
})
