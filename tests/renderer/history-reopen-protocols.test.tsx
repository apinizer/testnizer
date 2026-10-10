/**
 * Issue #182 — WebSocket, gRPC and GraphQL rows opened BLANK from History:
 * `HistoryListPanel` special-cased SOAP and MCP only, so every other row fell
 * into the HTTP loader and the protocol editor never saw the snapshot.
 *
 * Issue #195 — History rows are masked in main; rows written from #195 on
 * carry the `{{var}}` template (`configured`). Reopening uses it, so a re-send
 * from a masked row still sends the real credential; a literal credential
 * comes back EMPTY (never as the dots). Rows written before (no template)
 * still open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import HistoryListPanel from '../../src/renderer/components/sidebar/HistoryListPanel'
import NewRequestWelcome from '../../src/renderer/components/layout/NewRequestWelcome'
import { useHistoryStore } from '../../src/renderer/stores/history.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useHistoryHiddenStore } from '../../src/renderer/stores/history-hidden.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import HistoryHiddenNote from '../../src/renderer/components/shared/HistoryHiddenNote'
import { useConsoleStore } from '../../src/renderer/stores/console.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import {
  createScrubber,
  maskConsoleEntry,
  maskHistoryRow,
} from '../../src/main/lib/sensitive-scrub'
import { HISTORY_MASK } from '../../src/shared/credential-headers'
import type { HistoryEntry } from '../../src/renderer/types'

const SECRET = 'reopen-S3CRET-value-9'
const LITERAL = 'literal-key-abc123'

const row = (over: Partial<HistoryEntry>): HistoryEntry =>
  ({
    id: `h-${Math.random().toString(36).slice(2)}`,
    protocol: 'http',
    method: 'GET',
    url: 'https://api.test/x',
    status_code: 200,
    duration_ms: 5,
    executed_at: Date.now(),
    request_snapshot: {},
    ...over,
  }) as HistoryEntry

/**
 * A row exactly as main stores it: the writer's snapshot through main's own
 * mask (`maskHistoryRow`), then parsed the way `history.store` parses it.
 */
function storedRow(protocol: string, url: string, snapshot: Record<string, unknown>): HistoryEntry {
  const masked = maskHistoryRow(
    { url, request_snapshot: JSON.stringify(snapshot) },
    createScrubber([SECRET]),
  )
  return row({
    protocol: protocol as HistoryEntry['protocol'],
    url: masked.url,
    method: 'POST',
    request_snapshot: JSON.parse(masked.request_snapshot),
  })
}

const HTTP_TEMPLATE_ROW = storedRow('http', `https://api.test/items?api_key=${SECRET}`, {
  method: 'POST',
  url: `https://api.test/items?api_key=${SECRET}`,
  params: [{ key: 'api_key', value: SECRET, enabled: true }],
  headers: [
    { key: 'Authorization', value: `Bearer ${SECRET}`, enabled: true },
    { key: 'X-API-Key', value: LITERAL, enabled: true },
  ],
  body: { type: 'json', content: `{"note":"${SECRET}"}` },
  auth: { type: 'bearer', bearer: { token: SECRET } },
  configured: {
    method: 'POST',
    url: 'https://api.test/items?api_key={{secret}}',
    params: [],
    headers: [
      { id: 'a', key: 'Authorization', value: 'Bearer {{secret}}', enabled: true },
      { id: 'b', key: 'X-API-Key', value: LITERAL, enabled: true },
    ],
    body: { type: 'json', content: '{"note":"{{secret}}"}' },
    auth: { type: 'bearer', bearer: { token: '{{secret}}' } },
  },
})

let send: ReturnType<typeof vi.fn>

function installApi(): void {
  send = vi.fn(async () => ({
    success: true,
    data: { requestId: 'r', protocol: 'http', status: 200, timing: { total: 1 } },
  }))
  ;(window as unknown as { api: unknown }).api = {
    request: { send, cancel: vi.fn() },
    settings: { get: vi.fn(async () => ({ success: true, data: undefined })) },
    grpc: {},
    ws: {},
  }
}

function openRow(entry: HistoryEntry): void {
  useHistoryStore.setState({
    entries: [entry],
    searchTerm: '',
    fetch: vi.fn(async () => undefined),
  } as never)
  render(<HistoryListPanel />)
  fireEvent.click(screen.getByTestId('history-entry'))
}

beforeEach(() => {
  installApi()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useWebSocketStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useGrpcStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useGraphQLStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useResponseStore.setState({ response: null, isLoading: false })
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getState(),
    activeProjectId: 'p1',
    activeWorkspaceId: 'w1',
  })
})
afterEach(cleanup)

describe('HTTP row with the {{var}} template (issue #195)', () => {
  it('main stored no secret and no literal credential', () => {
    const text = JSON.stringify(HTTP_TEMPLATE_ROW)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(LITERAL)
  })

  it('reopens from the template: {{var}} kept, the literal credential EMPTY (never the mask)', () => {
    openRow(HTTP_TEMPLATE_ROW)
    const s = useRequestStore.getState()
    expect(s.url).toBe('https://api.test/items?api_key={{secret}}')
    expect(s.headers.find((h) => h.key === 'Authorization')?.value).toBe('Bearer {{secret}}')
    expect(s.headers.find((h) => h.key === 'X-API-Key')?.value).toBe('')
    expect(s.auth).toEqual({ type: 'bearer', bearer: { token: '{{secret}}' } })
    expect(JSON.stringify(s.headers)).not.toContain(HISTORY_MASK)
    const tabs = useTabsStore.getState()
    expect(tabs.tabs.find((t) => t.id === tabs.activeTabId)?.url).not.toContain(HISTORY_MASK)
  })

  it('re-sending the reopened row sends the REAL credential (resolved from the template)', async () => {
    openRow(HTTP_TEMPLATE_ROW)
    useEnvironmentStore.setState({
      getActiveVariables: () => ({ secret: SECRET }),
      globalVariables: [],
    } as never)
    await useRequestStore.getState().sendRequest()
    expect(send).toHaveBeenCalledTimes(1)
    const opts = send.mock.calls[0][0] as {
      url: string
      headers: Array<{ key: string; value: string }>
      auth: { bearer: { token: string } }
      body: { content: string }
      _configured: { url: string }
    }
    expect(opts.url).toBe(`https://api.test/items?api_key=${SECRET}`)
    expect(opts.headers.find((h) => h.key === 'Authorization')?.value).toBe(`Bearer ${SECRET}`)
    expect(opts.auth.bearer.token).toBe(SECRET)
    expect(opts.body.content).toBe(`{"note":"${SECRET}"}`)
    // …and the next History row again carries the template.
    expect(opts._configured.url).toBe('https://api.test/items?api_key={{secret}}')
  })
})

describe('rows written before issue #195 (no template) still open', () => {
  it('an old-format HTTP row restores its flat fields', () => {
    openRow(
      row({
        method: 'PUT',
        url: 'https://old.test/a?x=1',
        request_snapshot: {
          method: 'PUT',
          url: 'https://old.test/a?x=1',
          params: [{ key: 'x', value: '1', enabled: true }],
          headers: [{ key: 'Accept', value: 'text/plain', enabled: true }],
          body: { type: 'text', content: 'hello' },
          auth: { type: 'none' },
        } as never,
      }),
    )
    const s = useRequestStore.getState()
    expect(s.method).toBe('PUT')
    expect(s.url).toBe('https://old.test/a?x=1')
    expect(s.headers.find((h) => h.key === 'Accept')?.value).toBe('text/plain')
    expect(s.body).toEqual({ type: 'text', content: 'hello' })
  })
})

describe('WebSocket / gRPC / GraphQL reopen (issue #182)', () => {
  it('WebSocket, old row: URL + headers restored (was blank)', () => {
    openRow(
      row({
        protocol: 'websocket',
        method: 'CONNECT',
        url: 'wss://ws.test/feed',
        request_snapshot: {
          url: 'wss://ws.test/feed',
          headers: { 'X-Trace': 'trace-1' },
          protocols: [],
        } as never,
      }),
    )
    const ws = useWebSocketStore.getState()
    expect(ws._currentTabId).toBe(useTabsStore.getState().activeTabId)
    expect(ws.url).toBe('wss://ws.test/feed')
    expect(ws.customHeaders.find((h) => h.key === 'X-Trace')?.value).toBe('trace-1')
  })

  it('WebSocket, template row: {{var}} URL, headers and the composer message restored', () => {
    openRow(
      storedRow('websocket', `wss://ws.test/feed?token=${SECRET}`, {
        url: `wss://ws.test/feed?token=${SECRET}`,
        headers: { Authorization: `Bearer ${SECRET}` },
        configured: {
          url: 'wss://ws.test/feed?token={{secret}}',
          meta: {
            websocket: {
              url: 'wss://ws.test/feed?token={{secret}}',
              customHeaders: [
                { id: 'h', key: 'Authorization', value: 'Bearer {{secret}}', enabled: true },
              ],
              composerContent: '{"op":"subscribe"}',
              composerMode: 'json',
            },
          },
        },
      }),
    )
    const ws = useWebSocketStore.getState()
    expect(ws.url).toBe('wss://ws.test/feed?token={{secret}}')
    expect(ws.customHeaders[0].value).toBe('Bearer {{secret}}')
    expect(ws.composerContent).toBe('{"op":"subscribe"}')
  })

  it('gRPC, old row: address, service + method, message and metadata restored; Send-ready', () => {
    openRow(
      row({
        protocol: 'grpc',
        method: 'unary',
        url: 'localhost:50051/greeter.Greeter/SayHello',
        request_snapshot: {
          serverAddress: 'localhost:50051',
          protoPath: '/protos/greeter.proto',
          serviceName: 'greeter.Greeter',
          methodName: 'SayHello',
          metadata: { 'x-tenant': 'acme' },
          requestBody: '{"name":"Ada"}',
          useTls: false,
        } as never,
      }),
    )
    const g = useGrpcStore.getState()
    expect(g._currentTabId).toBe(useTabsStore.getState().activeTabId)
    expect(g.address).toBe('localhost:50051')
    expect(g.selectedService).toBe('greeter.Greeter')
    expect(g.selectedMethod).toBe('SayHello')
    expect(g.protoPath).toBe('/protos/greeter.proto')
    expect(g.protoLoaded).toBe(true)
    expect(g.getSelectedMethod()?.type).toBe('unary')
    expect(g.requestBody).toBe('{"name":"Ada"}')
    expect(g.metadata.find((m) => m.key === 'x-tenant')?.value).toBe('acme')
  })

  it('GraphQL sent through request:send (HTTP-shaped row): URL, query and variables restored', () => {
    openRow(
      row({
        protocol: 'graphql',
        method: 'POST',
        url: 'https://gql.test/graphql',
        request_snapshot: {
          method: 'POST',
          url: 'https://gql.test/graphql',
          headers: [{ key: 'X-Client', value: 'web', enabled: true }],
          body: {
            type: 'json',
            content: JSON.stringify({ query: 'query { me { id } }', variables: { a: 1 } }),
          },
        } as never,
      }),
    )
    const q = useGraphQLStore.getState()
    expect(q._currentTabId).toBe(useTabsStore.getState().activeTabId)
    expect(q.url).toBe('https://gql.test/graphql')
    expect(q.query).toBe('query { me { id } }')
    expect(JSON.parse(q.variables)).toEqual({ a: 1 })
    expect(q.headers.find((h) => h.key === 'X-Client')?.value).toBe('web')
  })

  it('GraphQL, template row: the {{var}} header and the operation come back', () => {
    openRow(
      storedRow('graphql', 'https://gql.test/graphql', {
        method: 'POST',
        url: 'https://gql.test/graphql',
        headers: [{ key: 'Authorization', value: `Bearer ${SECRET}`, enabled: true }],
        configured: {
          url: '{{gqlUrl}}',
          meta: {
            graphql: {
              url: '{{gqlUrl}}',
              query: 'query Me { me { id } }',
              variables: '{"id":"{{userId}}"}',
              headers: [
                { id: 'h', key: 'Authorization', value: 'Bearer {{secret}}', enabled: true },
              ],
            },
          },
        },
      }),
    )
    const q = useGraphQLStore.getState()
    expect(q.url).toBe('{{gqlUrl}}')
    expect(q.query).toBe('query Me { me { id } }')
    expect(q.variables).toBe('{"id":"{{userId}}"}')
    expect(q.headers[0].value).toBe('Bearer {{secret}}')
  })

  it('the welcome page recent list restores the same way (one shared helper)', () => {
    useHistoryStore.setState({
      entries: [
        row({
          protocol: 'websocket',
          method: 'CONNECT',
          url: 'wss://recent.test/ws',
          request_snapshot: { url: 'wss://recent.test/ws', headers: { 'X-A': 'one' } } as never,
        }),
      ],
      searchTerm: '',
      fetch: vi.fn(async () => undefined),
    } as never)
    render(<NewRequestWelcome />)
    fireEvent.click(screen.getByText(/recent\.test/))
    const ws = useWebSocketStore.getState()
    expect(ws.url).toBe('wss://recent.test/ws')
    expect(ws.customHeaders.find((h) => h.key === 'X-A')?.value).toBe('one')
  })
})

describe('SOAP reopen never re-sends the mask (issue #195)', () => {
  it('a masked WS-Security password comes back empty, not as dots', () => {
    useSoapStore.setState({ _tabStates: new Map(), _currentTabId: null } as never)
    openRow(
      storedRow('soap', 'https://soap.test/svc', {
        method: 'POST',
        url: 'https://soap.test/svc',
        headers: [
          { key: 'Content-Type', value: 'text/xml', enabled: true },
          { key: 'SOAPAction', value: '"urn:Get"', enabled: true },
        ],
        body: {
          type: 'xml',
          content:
            '<Envelope><wsse:Username>bob</wsse:Username><wsse:Password>pw-literal</wsse:Password></Envelope>',
        },
      }),
    )
    const soap = useSoapStore.getState()
    expect(soap.rawXml).toContain('<wsse:Username>bob</wsse:Username>')
    expect(soap.rawXml).not.toContain(HISTORY_MASK)
    expect(soap.rawXml).not.toContain('pw-literal')
  })
})

describe('Send-path script logs reach the Console masked (issue #196)', () => {
  it("routes the renderer-built entry through main's mask", async () => {
    const maskEntry = vi.fn(async (entry: unknown) => ({
      success: true,
      data: maskConsoleEntry(entry as never, createScrubber([SECRET])),
    }))
    ;(window as unknown as { api: { console: unknown } }).api.console = { maskEntry }
    useConsoleStore.setState({ entries: [] })
    useConsoleStore.getState().addFromResponse(
      { method: 'GET', url: 'https://api.test/x' },
      {
        requestId: 'r',
        protocol: 'http',
        timing: { total: 1 },
        consoleLogs: [{ level: 'log', message: `token=${SECRET}`, timestamp: 1 }],
      },
    )
    await vi.waitFor(() => expect(useConsoleStore.getState().entries).toHaveLength(1))
    expect(maskEntry).toHaveBeenCalledTimes(1)
    const e = useConsoleStore.getState().entries[0]
    expect(e.scriptLogs?.[0].message).toBe(`token=${HISTORY_MASK}`)
  })

  it('a failed mask call hides the script lines instead of showing them raw', async () => {
    ;(window as unknown as { api: { console: unknown } }).api.console = {
      maskEntry: vi.fn(async () => ({ success: false, error: 'boom' })),
    }
    useConsoleStore.setState({ entries: [] })
    useConsoleStore.getState().addFromResponse(
      { method: 'GET', url: 'https://api.test/x' },
      {
        requestId: 'r',
        protocol: 'http',
        timing: { total: 1 },
        consoleLogs: [{ level: 'log', message: `token=${SECRET}`, timestamp: 1 }],
      },
    )
    await vi.waitFor(() => expect(useConsoleStore.getState().entries).toHaveLength(1))
    expect(JSON.stringify(useConsoleStore.getState().entries)).not.toContain(SECRET)
  })
})

describe('SSE / Socket.IO reopen in their own editors (issue #182)', () => {
  beforeEach(() => {
    useSseStore.setState({ _tabStates: new Map(), _currentTabId: null } as never)
    useSocketIOStore.setState({ _tabStates: new Map(), _currentTabId: null } as never)
    useHistoryHiddenStore.setState({ byTab: {} })
  })

  it('SSE, old row: URL, method, headers, body and Last-Event-ID restored', () => {
    openRow(
      row({
        protocol: 'sse',
        method: 'POST',
        url: 'https://sse.test/stream',
        request_snapshot: {
          url: 'https://sse.test/stream',
          method: 'POST',
          headers: { 'X-Feed': 'news' },
          lastEventId: '42',
          body: '{"q":1}',
        } as never,
      }),
    )
    const e = useSseStore.getState()
    expect(e._currentTabId).toBe(useTabsStore.getState().activeTabId)
    expect(e.url).toBe('https://sse.test/stream')
    expect(e.method).toBe('POST')
    expect(e.customHeaders.find((h) => h.key === 'X-Feed')?.value).toBe('news')
    expect(e.lastEventId).toBe('42')
    expect(e.body).toBe('{"q":1}')
  })

  it('SSE, template row: {{var}} URL + header and the event filter restored', () => {
    openRow(
      storedRow('sse', 'https://sse.test/s', {
        url: 'https://sse.test/s',
        headers: { Authorization: `Bearer ${SECRET}` },
        configured: {
          url: '{{sseBase}}/s',
          meta: {
            sse: {
              url: '{{sseBase}}/s',
              method: 'GET',
              customHeaders: [
                { id: 'a', key: 'Authorization', value: 'Bearer {{secret}}', enabled: true },
              ],
              eventTypeFilter: 'tick',
            },
          },
        },
      }),
    )
    const e = useSseStore.getState()
    expect(e.url).toBe('{{sseBase}}/s')
    expect(e.customHeaders[0].value).toBe('Bearer {{secret}}')
    expect(e.eventTypeFilter).toBe('tick')
  })

  it('Socket.IO, template row: URL, namespace, {{var}} token, events restored', () => {
    openRow(
      storedRow('socketio', 'http://sio.test/chat', {
        url: 'http://sio.test',
        namespace: '/chat',
        hasAuth: true,
        configured: {
          url: 'http://sio.test',
          meta: {
            socketio: {
              url: 'http://sio.test',
              namespace: '/chat',
              bearerToken: '{{secret}}',
              subscriptions: ['message', 'typing'],
              emitEvent: 'join',
              emitPayload: '{"room":1}',
            },
          },
        },
      }),
    )
    const sio = useSocketIOStore.getState()
    expect(sio._currentTabId).toBe(useTabsStore.getState().activeTabId)
    expect(sio.url).toBe('http://sio.test')
    expect(sio.namespace).toBe('/chat')
    expect(sio.bearerToken).toBe('{{secret}}')
    expect(sio.subscriptions).toEqual(['message', 'typing'])
    expect(sio.emitEvent).toBe('join')
    expect(sio.emitPayload).toBe('{"room":1}')
  })

  it('Socket.IO, old row that sent a token: token empty, and the note names it', () => {
    openRow(
      row({
        protocol: 'socketio',
        method: 'CONNECT',
        url: 'http://sio.test/admin',
        request_snapshot: { url: 'http://sio.test', namespace: '/admin', hasAuth: true } as never,
      }),
    )
    const sio = useSocketIOStore.getState()
    expect(sio.namespace).toBe('/admin')
    expect(sio.bearerToken).toBe('')
    const tabId = useTabsStore.getState().activeTabId!
    expect(useHistoryHiddenStore.getState().byTab[tabId]).toEqual(['bearerToken'])
  })
})

describe('"enter it again" note for credentials History did not store (issue #195)', () => {
  beforeEach(() => {
    useHistoryHiddenStore.setState({ byTab: {} })
    useUIStore.setState({ locale: 'en' })
  })
  afterEach(() => useUIStore.setState({ locale: 'en' }))

  it('HTTP: the blanked literal credential is named; dismiss hides it', () => {
    openRow(HTTP_TEMPLATE_ROW)
    render(<HistoryHiddenNote />)
    const note = screen.getByTestId('history-hidden-credentials')
    expect(note.textContent).toContain('Credentials were not stored in History — enter them again')
    expect(note.textContent).toContain('headers.X-API-Key')
    // {{var}} values were kept — they are not "hidden".
    expect(note.textContent).not.toContain('Authorization')
    fireEvent.click(screen.getByTestId('history-hidden-credentials-dismiss'))
    expect(screen.queryByTestId('history-hidden-credentials')).toBeNull()
  })

  it('WebSocket / gRPC / GraphQL use the same note', () => {
    openRow(
      storedRow('websocket', 'wss://ws.test/f', {
        url: 'wss://ws.test/f',
        configured: {
          url: 'wss://ws.test/f',
          meta: {
            websocket: {
              url: 'wss://ws.test/f',
              customHeaders: [{ id: 'x', key: 'X-API-Key', value: LITERAL, enabled: true }],
            },
          },
        },
      }),
    )
    render(<HistoryHiddenNote />)
    expect(screen.getByTestId('history-hidden-credentials').textContent).toContain(
      'customHeaders.X-API-Key',
    )
  })

  it('SOAP too, and nothing is shown when nothing was hidden', () => {
    useSoapStore.setState({ _tabStates: new Map(), _currentTabId: null } as never)
    openRow(
      storedRow('soap', 'https://soap.test/svc', {
        url: 'https://soap.test/svc',
        body: { type: 'xml', content: '<wsse:Password>pw-literal-1</wsse:Password>' },
      }),
    )
    render(<HistoryHiddenNote />)
    // The note names the field inside the envelope, not the editor slot (issue #195).
    expect(screen.getByTestId('history-hidden-credentials').textContent).toContain('body.Password')
    cleanup()
    openRow(
      row({
        url: 'https://plain.test/',
        request_snapshot: { url: 'https://plain.test/' } as never,
      }),
    )
    render(<HistoryHiddenNote />)
    expect(screen.queryByTestId('history-hidden-credentials')).toBeNull()
  })

  it('Turkish', () => {
    useUIStore.setState({ locale: 'tr' })
    openRow(HTTP_TEMPLATE_ROW)
    render(<HistoryHiddenNote />)
    expect(screen.getByTestId('history-hidden-credentials').textContent).toContain(
      'Kimlik bilgileri Geçmiş’te saklanmadı — yeniden girin',
    )
  })
})
