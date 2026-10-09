/**
 * Issue #154 (deferred review of #152) — the 2026-07-28 `input_required` card:
 *   (a) enums with non-string values render options and submit the typed value;
 *   (b) minimum / maximum and minLength / maxLength are enforced client-side;
 *   (c) number parsing accepts plain decimals only (no `0x10`, `1e3`, …);
 *   (d) a failed `respondInput` keeps the card, the typed answers and shows
 *       the error inside the card;
 *   (e) `connectWithOAuth` never connects the tab the user switched to while
 *       the old connection was being torn down (issue #76 class).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'
import {
  buildContent,
  initialValues,
  parseInputRequest,
  type ElicitField,
} from '../../src/renderer/lib/mcp-elicitation'
import type { McpConnectRequest, McpOAuthSummary } from '../../src/renderer/types/mcp'

function form(properties: Record<string, unknown>, required: string[] = []): ElicitField[] {
  const view = parseInputRequest('k', {
    method: 'elicitation/create',
    params: { message: 'm', requestedSchema: { type: 'object', properties, required } },
  })
  if (view.kind !== 'form') throw new Error('form expected')
  return view.fields
}

afterEach(() => cleanup())

// ─── (a) non-string enums ───────────────────────────────────

describe('(a) enum with non-string values', () => {
  it('number / boolean enums become options; the typed original value is submitted', () => {
    const fields = form(
      {
        level: { type: 'integer', enum: [1, 2, 3] },
        ratio: { type: 'number', enum: [0.5, 1.5], enumNames: ['Half', 'One and a half'] },
        flag: { enum: [true, false] },
        tier: { type: 'number', oneOf: [{ const: 10, title: 'Ten' }] },
      },
      ['level', 'ratio', 'flag', 'tier'],
    )
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
    expect(byName.level.kind).toBe('enum')
    expect(byName.level.options?.map((o) => o.label)).toEqual(['1', '2', '3'])
    expect(byName.ratio.options?.map((o) => o.label)).toEqual(['Half', 'One and a half'])
    expect(byName.flag.options?.map((o) => o.label)).toEqual(['true', 'false'])
    expect(byName.tier.options?.map((o) => o.label)).toEqual(['Ten'])

    const values = initialValues(fields)
    // Required enums start on their first option.
    const pick = (name: string, i: number): string => byName[name].options?.[i]?.value ?? ''
    const built = buildContent(fields, {
      ...values,
      level: pick('level', 2),
      ratio: pick('ratio', 1),
      flag: pick('flag', 1),
    })
    expect(built).toEqual({ content: { level: 3, ratio: 1.5, flag: false, tier: 10 } })
  })

  it('a non-string default selects its option', () => {
    const fields = form({ level: { type: 'integer', enum: [1, 2, 3], default: 2 } })
    expect(buildContent(fields, initialValues(fields))).toEqual({ content: { level: 2 } })
  })

  it('the card renders the options and submits the number', async () => {
    const { mcp } = installApi({ level: { type: 'integer', enum: [1, 2, 3] } }, ['level'])
    await openCard()
    const select = screen.getByTestId('mcp-input-field-k-level') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['1', '2', '3'])
    fireEvent.change(select, { target: { value: select.options[1].value } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-input-submit'))
    })
    expect(mcp.respondInput.mock.calls[0][4]).toEqual({
      k: { action: 'accept', content: { level: 2 } },
    })
  })
})

// ─── (b) bounds ─────────────────────────────────────────────

describe('(b) minimum / maximum / minLength / maxLength', () => {
  const fields = form(
    {
      qty: { type: 'integer', minimum: 1, maximum: 10 },
      price: { type: 'number', minimum: 0.5 },
      code: { type: 'string', minLength: 2, maxLength: 4 },
    },
    ['qty'],
  )
  const ok = { qty: '5', price: '1', code: 'ab' }

  it('in range builds; each bound violation names the field and the limit', () => {
    expect(buildContent(fields, ok)).toEqual({ content: { qty: 5, price: 1, code: 'ab' } })
    expect(buildContent(fields, { ...ok, qty: '0' }).problem).toEqual({
      field: 'qty',
      reason: 'minimum',
      limit: 1,
    })
    expect(buildContent(fields, { ...ok, qty: '11' }).problem).toEqual({
      field: 'qty',
      reason: 'maximum',
      limit: 10,
    })
    expect(buildContent(fields, { ...ok, price: '0.25' }).problem).toEqual({
      field: 'price',
      reason: 'minimum',
      limit: 0.5,
    })
    expect(buildContent(fields, { ...ok, code: 'a' }).problem).toEqual({
      field: 'code',
      reason: 'minLength',
      limit: 2,
    })
    expect(buildContent(fields, { ...ok, code: 'abcde' }).problem).toEqual({
      field: 'code',
      reason: 'maxLength',
      limit: 4,
    })
    // Length is counted in characters, not UTF-16 units.
    expect(buildContent(fields, { ...ok, code: '😀😀' }).problem).toBeUndefined()
  })

  it('the card shows the bound problem on the same problem line and sends nothing', async () => {
    const { mcp } = installApi({ qty: { type: 'integer', minimum: 1, maximum: 10 } }, ['qty'])
    await openCard()
    fireEvent.change(screen.getByTestId('mcp-input-field-k-qty'), { target: { value: '42' } })
    fireEvent.click(screen.getByTestId('mcp-input-submit'))
    expect(screen.getByTestId('mcp-input-problem')).toHaveTextContent('"qty" must be at most 10')
    expect(mcp.respondInput).not.toHaveBeenCalled()
  })
})

// ─── (c) number parsing ─────────────────────────────────────

describe('(c) plain decimal numbers only', () => {
  const fields = form({ n: { type: 'number' }, i: { type: 'integer' } })

  it.each(['0x10', '1e3', '0b11', 'Infinity', '.5', '5.', '+5', '1_000', '--1'])(
    'rejects %s as a number',
    (text) => {
      expect(buildContent(fields, { n: text, i: '' }).problem).toEqual({
        field: 'n',
        reason: 'number',
      })
    },
  )

  it('accepts plain decimals; integers take no fraction', () => {
    expect(buildContent(fields, { n: '-12.75', i: '-3' })).toEqual({
      content: { n: -12.75, i: -3 },
    })
    expect(buildContent(fields, { n: '', i: '0x10' }).problem).toEqual({
      field: 'i',
      reason: 'number',
    })
    expect(buildContent(fields, { n: '', i: '1.0' }).problem).toEqual({
      field: 'i',
      reason: 'integer',
    })
  })
})

// ─── (d) failed respondInput ────────────────────────────────

describe('(d) a failed respondInput keeps the card', () => {
  it('IPC success:false → card, typed answer and inline error stay', async () => {
    const { mcp } = installApi({ name: { type: 'string' } }, ['name'])
    mcp.respondInput.mockResolvedValueOnce({ success: false, error: 'boom: server said no' })
    await openCard()
    fireEvent.change(screen.getByTestId('mcp-input-field-k-name'), { target: { value: 'Ada' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-input-submit'))
    })
    expect(screen.getByTestId('mcp-input-required')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-input-error')).toHaveTextContent('boom: server said no')
    expect((screen.getByTestId('mcp-input-field-k-name') as HTMLInputElement).value).toBe('Ada')
    expect(useMcpStore.getState().isInvoking).toBe(false)

    // A retry clears the error and can succeed.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-input-submit'))
    })
    expect(mcp.respondInput).toHaveBeenCalledTimes(2)
    expect(mcp.respondInput.mock.calls[1][4]).toEqual({
      k: { action: 'accept', content: { name: 'Ada' } },
    })
    expect(screen.queryByTestId('mcp-input-required')).toBeNull()
  })

  it('a thrown IPC error is shown in the card too', async () => {
    const { mcp } = installApi({ name: { type: 'string' } })
    mcp.respondInput.mockRejectedValueOnce(new Error('bridge gone'))
    await openCard()
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-input-decline'))
    })
    expect(screen.getByTestId('mcp-input-required')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-input-error')).toHaveTextContent('bridge gone')
  })
})

// ─── (e) connectWithOAuth across a tab switch ──────────────

describe('(e) connectWithOAuth routes to the tab it started on', () => {
  it('switching tabs during the disconnect never connects the other tab', async () => {
    let releaseDisconnect: () => void = () => undefined
    const connect = vi.fn(async (_req: McpConnectRequest) => ({
      success: true,
      data: { connectionId: 'new', transport: 'http' as const, url: 'x' },
    }))
    const mcp = {
      connect,
      cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
      disconnect: vi.fn(
        () =>
          new Promise<{ success: boolean; data: boolean }>((resolve) => {
            releaseDisconnect = () => resolve({ success: true, data: true })
          }),
      ),
      oauthForget: vi.fn(async () => ({ success: true, data: true })),
    }
    ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }

    // Tab B: a configured, disconnected server.
    useMcpStore.getState().switchToTab('tab-b')
    useMcpStore.setState({ url: 'http://127.0.0.1:9999/b', transport: 'http' })
    // Tab A: connected, with a finished OAuth flow.
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({
      url: 'http://127.0.0.1:9999/a',
      transport: 'http',
      connectionId: 'conn-a',
      connectionState: 'connected',
      oauthFlowId: 'flow-a',
      oauthSummary: { accessTokenPreview: 'x' } as unknown as McpOAuthSummary,
    })

    const pending = useMcpStore.getState().connectWithOAuth()
    await Promise.resolve()
    expect(mcp.disconnect).toHaveBeenCalledWith('conn-a')
    // The user moves to tab B while A's connection is being closed.
    useMcpStore.getState().switchToTab('tab-b')
    releaseDisconnect()
    await pending

    expect(connect).not.toHaveBeenCalled()
    const s = useMcpStore.getState()
    expect(s._currentTabId).toBe('tab-b')
    expect(s.connectionState).not.toBe('connecting')
    expect(s.oauthSessionId).toBeNull()
    // Tab A keeps the token session for its next Connect.
    expect(s._tabStates.get('tab-a')?.oauthSessionId).toBe('flow-a')
  })

  it('without a tab switch it reconnects the same tab with the token session', async () => {
    const connect = vi.fn(async (_req: McpConnectRequest) => ({
      success: false,
      error: 'nope',
    }))
    const mcp = {
      connect,
      cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
      disconnect: vi.fn(async () => ({ success: true, data: true })),
      oauthForget: vi.fn(async () => ({ success: true, data: true })),
    }
    ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({
      url: 'http://127.0.0.1:9999/a',
      transport: 'http',
      connectionId: 'conn-a',
      connectionState: 'connected',
      oauthFlowId: 'flow-a',
      oauthSummary: { accessTokenPreview: 'x' } as unknown as McpOAuthSummary,
    })
    await useMcpStore.getState().connectWithOAuth()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect.mock.calls[0][0]).toMatchObject({
      url: 'http://127.0.0.1:9999/a',
      oauthSessionId: 'flow-a',
    })
  })
})

// ─── Harness ────────────────────────────────────────────────

function installApi(properties: Record<string, unknown>, required: string[] = []) {
  const inputRequired = {
    resultType: 'input_required',
    __mcp: {
      kind: 'input_required',
      inputRequests: {
        k: {
          method: 'elicitation/create',
          params: {
            message: 'Answer please',
            mode: 'form',
            requestedSchema: { type: 'object', properties, required },
          },
        },
      },
      requestState: 's-1',
    },
  }
  const mcp = {
    connect: vi.fn(async (req: McpConnectRequest) => ({
      success: true,
      data: {
        connectionId: 'conn-154',
        transport: req.transport,
        url: req.url,
        protocolVersion: '2026-07-28',
        capabilities: { tools: {} },
        era: 'modern',
      },
    })),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({
      success: true,
      data: [{ name: 'ask', inputSchema: { type: 'object', properties: {} } }],
    })),
    callTool: vi.fn(async () => ({ success: true, data: inputRequired })),
    respondInput: vi.fn(
      async (): Promise<{ success: boolean; data?: unknown; error?: string }> => ({
        success: true,
        data: { content: [{ type: 'text', text: 'done' }] },
      }),
    ),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return { mcp }
}

async function openCard(): Promise<void> {
  useMcpStore.getState().switchToTab('tab-a')
  useMcpStore.setState({ url: 'http://127.0.0.1:3100/mcp', transport: 'http' })
  await useMcpStore.getState().connect()
  useMcpStore.getState().setSelectedTool('ask')
  render(<McpToolPane />)
  await act(async () => {
    fireEvent.click(screen.getByTestId('mcp-invoke'))
  })
  expect(screen.getByTestId('mcp-input-required')).toBeInTheDocument()
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-init')
})
