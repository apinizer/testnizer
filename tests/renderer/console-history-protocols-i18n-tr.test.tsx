/**
 * issue #248 follow-up — Console, History, protocol editor bodies, the Epoch
 * tool and generic accessible names in Turkish.
 *
 * The product review (1.6.0) found these English in the Turkish UI although
 * several keys already existed (`console.online`, `console.find`,
 * `console.autoScroll`, `console.filter.all` were never wired):
 *   - Console header/filters, the expanded entry (Network/Method/Status …),
 *   - History header, Clear, Today/Yesterday, filter placeholder,
 *     Requests/Commits and the commit list ("2h ago"),
 *   - WebSocket composer + log, GraphQL query/response/schema/subscription,
 *     gRPC response, Socket.IO emit/subscribe/timeline,
 *   - the Epoch tool ("Wednesday 21 October 2026 …", "0 seconds ago", Yr/Mon/…),
 *   - the dialog close button and the code editor ("Close", "Editor content").
 * Each case renders in TR and scans visible text plus title / aria-label /
 * placeholder for English. The last block keeps English byte-identical.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

// MonacoWrapperImpl is tested on its own below: capture the options it hands
// to the editor instead of booting Monaco in jsdom.
const editorOptions: Array<Record<string, unknown>> = []
vi.mock('@monaco-editor/react', () => ({
  default: (props: { options?: Record<string, unknown> }) => {
    editorOptions.push(props.options ?? {})
    return <div data-testid="monaco-impl" />
  },
  loader: { config: () => {} },
}))
vi.mock('monaco-editor', () => ({}))

import { mockWindowApi } from './screens/_mount'
import ConsoleTab from '../../src/renderer/components/response/ConsoleTab'
import HistorySidebar from '../../src/renderer/components/sidebar/HistorySidebar'
import WsComposer from '../../src/renderer/components/protocols/WsComposer'
import WsMessageLog from '../../src/renderer/components/protocols/WsMessageLog'
import GraphQLQueryPane from '../../src/renderer/components/protocols/GraphQLQueryPane'
import GraphQLResponsePane from '../../src/renderer/components/protocols/GraphQLResponsePane'
import GraphQLSchemaExplorer from '../../src/renderer/components/protocols/GraphQLSchemaExplorer'
import GraphQLSubscriptionLog from '../../src/renderer/components/protocols/GraphQLSubscriptionLog'
import GrpcResponsePane from '../../src/renderer/components/protocols/GrpcResponsePane'
import SocketIOEditor from '../../src/renderer/components/protocols/SocketIOEditor'
import EpochTool from '../../src/renderer/components/tools/EpochTool'
import LegalDocModal from '../../src/renderer/components/eula/LegalDocModal'
import MonacoWrapperImpl from '../../src/renderer/components/shared/MonacoWrapperImpl'
import { useConsoleStore } from '../../src/renderer/stores/console.store'
import { useHistoryStore } from '../../src/renderer/stores/history.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import { formatUtc, relative } from '../../src/renderer/lib/tools/epoch'
import type { HistoryEntry } from '../../src/renderer/types'
;(globalThis as unknown as { React: typeof React }).React = React

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

function stubDom(): void {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = () => {}
  HTMLElement.prototype.scrollTo = (() => {}) as unknown as typeof window.scrollTo
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600,
  })
}

const MONTHS_AND_DAYS =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/

/** English that must not survive in TR, per screen (whole words, case-sensitive). */
const ENGLISH = {
  console: [
    /\bOnline\b/,
    /\bOffline\b/,
    /\bFind\b/,
    /\bConsole\b/,
    /\bAuto\b/,
    /\bAll Logs\b/,
    /\bMaximize\b/,
    /\bRestore\b/,
    /\bOpen in bottom panel\b/,
    /\bClear\b/,
    /\bNo console entries\b/,
    /\bSend a request\b/,
    /\bNetwork\b/,
    /\bMethod\b/,
    /\bProtocol\b/,
    /\bCategory\b/,
    /\bStatus( Text)?\b/,
    /\bDuration\b/,
    /\bSize\b/,
    /\bDirection\b/,
    /\bEvent\b/,
    /\b(Request|Response) (Headers|Body)\b/,
    /\bScript Logs\b/,
    /\bError\b/,
    /\bAuto-scroll\b/,
  ],
  history: [
    /\bHistory\b/,
    /\bRequests\b/,
    /\bCommits\b/,
    /\bCommit History\b/,
    /\bClear\b/,
    /\bFilter history\b/,
    /\bToday\b/,
    /\bYesterday\b/,
    /\bNo history\b/,
    /\bRefresh\b/,
    /\bjust now\b/,
    /\b\d+[mhd] ago\b/,
    /\bOpen a project\b/,
    MONTHS_AND_DAYS,
  ],
  ws: [
    /\bMessage\b/,
    /\bText\b/,
    /\bSend Message\b/,
    /\bNo messages\b/,
    /\bConnect and send\b/,
    /\bmessages?\b/,
    /\bsent\b/,
    /\breceived\b/,
    /\bAuto-scroll\b/,
    /\bClear\b/,
  ],
  graphql: [
    /\bResponse\b/,
    /\bSchema Explorer\b/,
    /\bRun a query\b/,
    /\bRunning query\b/,
    /\b(Un)?[Ss]ubscri(be|bed|ption)\b/,
    /\bRun\b/,
    /\bIntrospect\b/,
    /\bVariables\b/,
    /\bHeaders\b/,
    /\bFilter types\b/,
    /\bRoot Types\b/,
    /\bObjects\b/,
    /\bInput Objects\b/,
    /\bEnums\b/,
    /\bScalars\b/,
    /\bSelect a type\b/,
    /\bValues\b/,
    /\bFields\b/,
    /\bArguments\b/,
    /\bLive\b/,
    /\bWaiting for\b/,
    /\bevents?\b/,
    /\bAuto-scroll\b/,
    /\bClear\b/,
  ],
  grpc: [
    /\bCalling gRPC\b/,
    /\bExecute a gRPC\b/,
    /\bStream Events\b/,
    /\bStreaming\b/,
    /\bWaiting for\b/,
    /\bevents?\b/,
    /\bAuto-scroll\b/,
  ],
  socketio: [
    /\bEmit( Event)?\b/,
    /\bSubscribe\b/,
    /\bNo subscriptions\b/,
    /\bEvent Timeline\b/,
    /\bConnect to see\b/,
    /\bWaiting for\b/,
    /\bevent name\b/,
    /\bClear\b/,
    // Issue #283 additions.
    /\bSaved messages\b/,
    /\bAdd (message|argument|event)\b/,
    /\bListen to all\b/,
    /\bSearch messages\b/,
    /\bArgument \d\b/,
    /\bReceived\b/,
  ],
  epoch: [
    /\bago\b/,
    /\bin \d+ (second|minute|hour|day|month|year)s?\b/,
    MONTHS_AND_DAYS,
    /\b(Yr|Mon|Day|Hr|Min|Sec)\b/,
    /\b(seconds|milliseconds)\b/,
    /\bauto-detected\b/,
  ],
}

function englishLeftovers(patterns: RegExp[], root: HTMLElement = document.body): string[] {
  const parts: string[] = [root.textContent ?? '']
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(attr)
      if (v) parts.push(v)
    }
  }
  const text = parts.join('\n')
  return patterns
    .filter((re) => re.test(text))
    .map((re) => {
      const line = text.split('\n').find((l) => re.test(l)) ?? ''
      return `${re} → "${line.trim().slice(0, 100)}"`
    })
}

const DAY = 24 * 60 * 60 * 1000

function historyEntry(id: string, executedAt: number): HistoryEntry {
  return {
    id,
    protocol: 'http',
    method: 'GET',
    url: `https://ornek.test/${id}`,
    status_code: 200,
    duration_ms: 12,
    request_snapshot: {},
    executed_at: executedAt,
  }
}

function seedConsole(): void {
  useConsoleStore.getState().clear()
  useConsoleStore.getState().setAutoScroll(false)
  useConsoleStore.getState().addEntry({
    protocol: 'http',
    level: 'error',
    category: 'response',
    method: 'GET',
    url: 'https://ornek.test/kullanicilar',
    status: 500,
    statusText: 'Sunucu Hatası',
    message: 'GET https://ornek.test/kullanicilar → 500',
    durationMs: 12,
    sizeBytes: 34,
    details: {
      direction: 'in',
      eventName: 'mesaj',
      requestHeaders: { accept: 'application/json' },
      requestBody: '{"sayfa":1}',
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"hata":"sunucu"}',
      error: { message: 'sunucu çöktü' },
    },
    scriptLogs: [{ level: 'log', message: 'merhaba' }],
  } as Parameters<ReturnType<typeof useConsoleStore.getState>['addEntry']>[0])
  const id = useConsoleStore.getState().entries[0].id
  useConsoleStore.getState().toggleExpanded(id)
}

beforeEach(() => {
  stubDom()
  editorOptions.length = 0
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useLocale('tr')
})

afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('issue #248 follow-up — Console in Turkish', () => {
  it('header, filter, empty state and an expanded entry are Turkish', () => {
    seedConsole()
    render(<ConsoleTab />)
    // Every collapsible section of the entry, opened.
    for (const title of ['Ağ', 'İstek Gövdesi', 'Yanıt Başlıkları', 'Yanıt Gövdesi']) {
      act(() => {
        fireEvent.click(screen.getByText(title))
      })
    }
    expect(englishLeftovers(ENGLISH.console)).toEqual([])
    expect(screen.getByText('Çevrimiçi')).toBeTruthy()
    expect(screen.getByText('Tüm Kayıtlar')).toBeTruthy()
    expect(screen.getByTitle('Otomatik kaydır')).toBeTruthy()
    expect(screen.getByText('Durum Metni:')).toBeTruthy()
    expect(screen.getByText('Konsol').closest('[lang]')?.getAttribute('lang')).toBe('tr')

    cleanup()
    useConsoleStore.getState().clear()
    render(<ConsoleTab />)
    expect(screen.getByText('Henüz konsol kaydı yok')).toBeTruthy()
    expect(englishLeftovers(ENGLISH.console)).toEqual([])
  })
})

describe('issue #248 follow-up — History sidebar in Turkish', () => {
  it('requests list: header, Clear, filter, date groups are Turkish', () => {
    const now = Date.now()
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    useHistoryStore.setState({
      entries: [
        historyEntry('bugun', now),
        historyEntry('dun', startOfToday.getTime() - 60 * 60 * 1000),
        historyEntry('eski', now - 10 * DAY),
      ],
      searchTerm: '',
      fetch: vi.fn(async () => {}),
    } as Partial<ReturnType<typeof useHistoryStore.getState>>)
    render(<HistorySidebar />)
    expect(englishLeftovers(ENGLISH.history)).toEqual([])
    expect(screen.getAllByText('Geçmiş').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /İstekler/ })).toBeTruthy()
    expect(screen.getByText('Temizle')).toBeTruthy()
    expect(screen.getByPlaceholderText('Geçmişte ara...')).toBeTruthy()
    expect(screen.getByText('Bugün')).toBeTruthy()
    expect(screen.getByText('Dün')).toBeTruthy()
  })

  it('commits list: title, refresh and relative dates are Turkish', async () => {
    useHistoryStore.setState({
      entries: [],
      fetch: vi.fn(async () => {}),
    } as Partial<ReturnType<typeof useHistoryStore.getState>>)
    mockWindowApi({
      git: {
        listCommits: vi.fn(async () => ({
          success: true,
          data: {
            total: 1,
            commits: [
              {
                hash: 'abc123',
                shortHash: 'abc123',
                message: 'Uç nokta kaydedildi',
                date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
                author: 'Ayşe',
                email: 'a@ornek.test',
              },
            ],
          },
        })),
      },
    })
    render(<HistorySidebar />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Commit’ler/ }))
    })
    expect(await screen.findByText('2 sa önce')).toBeTruthy()
    expect(screen.getByText('Commit Geçmişi')).toBeTruthy()
    expect(screen.getByLabelText('Commit geçmişini yenile')).toBeTruthy()
    expect(englishLeftovers(ENGLISH.history)).toEqual([])
  })
})

describe('issue #248 follow-up — protocol editor bodies in Turkish', () => {
  it('WebSocket composer and message log', () => {
    useWebSocketStore.setState({ connectionState: 'connected', messages: [] })
    const { unmount } = render(
      <>
        <WsComposer />
        <WsMessageLog />
      </>,
    )
    expect(screen.getByText('Henüz mesaj yok')).toBeTruthy()
    expect(englishLeftovers(ENGLISH.ws)).toEqual([])
    unmount()

    useWebSocketStore.setState({
      messages: [
        { id: 'm1', direction: 'sent', content: 'selam', contentType: 'text', timestamp: 1 },
        { id: 'm2', direction: 'received', content: 'selam', contentType: 'text', timestamp: 2 },
      ],
    })
    render(<WsMessageLog />)
    expect(screen.getByTestId('ws-message-counts').textContent).toBe(
      '2 mesaj (1 gönderilen, 1 alınan)',
    )
    expect(englishLeftovers(ENGLISH.ws)).toEqual([])
  })

  it('GraphQL query, response, schema explorer and subscription log', () => {
    useResponseStore.setState({ response: null, isLoading: false })
    useGraphQLStore.setState({
      url: 'https://ornek.test/graphql',
      query: 'query { kullanici { id } }',
      variables: '{}',
      headers: [],
      subscriptionState: 'disconnected',
      isLoading: false,
      isIntrospecting: false,
      schemaData: null,
      introspectError: null,
      subscriptionEvents: [],
    })
    const { unmount } = render(
      <>
        <GraphQLQueryPane />
        <GraphQLResponsePane />
      </>,
    )
    expect(screen.getByTestId('graphql-introspect').textContent).toBe('Şemayı Al')
    expect(screen.getByText('Yanıtı görmek için bir sorgu çalıştırın')).toBeTruthy()
    expect(englishLeftovers(ENGLISH.graphql)).toEqual([])
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Şema Gezgini' }))
    })
    expect(screen.getByText('Şemayı yüklemek için "Şemayı Al" düğmesine tıklayın')).toBeTruthy()
    expect(englishLeftovers(ENGLISH.graphql)).toEqual([])
    unmount()

    render(
      <GraphQLSchemaExplorer
        error={null}
        schemaData={{
          queryType: 'Sorgu',
          mutationType: null,
          subscriptionType: null,
          types: [
            {
              name: 'Sorgu',
              kind: 'OBJECT',
              fields: [
                { name: 'kullanici', type: 'Kullanici', args: [{ name: 'id', type: 'ID' }] },
              ],
            },
            { name: 'Renk', kind: 'ENUM', fields: [], enumValues: ['KIRMIZI'] },
            { name: 'Girdi', kind: 'INPUT_OBJECT', fields: [] },
            { name: 'Tarih', kind: 'SCALAR', fields: [] },
            { name: 'Kullanici', kind: 'OBJECT', fields: [] },
          ],
        }}
      />,
    )
    expect(screen.getByText('Ayrıntılarını görmek için bir tip seçin')).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Sorgu' }))
    })
    expect(screen.getByText('Alanlar (1)')).toBeTruthy()
    expect(screen.getByText('Argümanlar:')).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Renk' }))
    })
    expect(screen.getByText('Değerler')).toBeTruthy()
    expect(englishLeftovers(ENGLISH.graphql)).toEqual([])
    cleanup()

    useGraphQLStore.setState({
      subscriptionState: 'connected',
      subscriptionEvents: [{ id: 'e1', data: '{"a":1}', timestamp: 1 }],
    })
    render(<GraphQLSubscriptionLog />)
    expect(screen.getByText('Abonelik Olayları')).toBeTruthy()
    expect(screen.getByText('1 olay')).toBeTruthy()
    expect(englishLeftovers(ENGLISH.graphql)).toEqual([])
  })

  it('gRPC response pane: empty, and the stream view', () => {
    useResponseStore.setState({ response: null, isLoading: false })
    useGrpcStore.setState({
      streamEvents: [],
      isStreaming: false,
      errorMessage: null,
      getSelectedMethod: () => undefined,
    } as Partial<ReturnType<typeof useGrpcStore.getState>>)
    const { unmount } = render(<GrpcResponsePane />)
    expect(screen.getByText('Yanıtı görmek için bir gRPC çağrısı çalıştırın')).toBeTruthy()
    expect(englishLeftovers(ENGLISH.grpc)).toEqual([])
    unmount()

    useGrpcStore.setState({
      streamEvents: [
        { id: 's1', data: '{"a":1}', timestamp: 1, index: 0 },
        { id: 's2', data: '{"a":2}', timestamp: 2, index: 1 },
      ],
      isStreaming: true,
      getSelectedMethod: () => ({
        name: 'Akis',
        type: 'server_streaming',
        requestType: 'A',
        responseType: 'B',
      }),
    } as Partial<ReturnType<typeof useGrpcStore.getState>>)
    render(<GrpcResponsePane />)
    expect(screen.getByText('Akış Olayları')).toBeTruthy()
    expect(screen.getByText('2 olay')).toBeTruthy()
    expect(englishLeftovers(ENGLISH.grpc)).toEqual([])
  })

  it('Socket.IO message / events / timeline (the body, not the connection bar)', () => {
    useSocketIOStore.setState({
      connectionState: 'disconnected',
      listeners: [],
      events: [],
    } as Partial<ReturnType<typeof useSocketIOStore.getState>>)
    render(<SocketIOEditor />)
    const body = screen.getByTestId('socketio-panel-message').closest('[lang]') as HTMLElement
    expect(body.getAttribute('lang')).toBe('tr')
    expect(within(body).getByText('Kayıtlı mesajlar')).toBeTruthy()
    expect(within(body).getByText('Olayları görmek için bağlanın')).toBeTruthy()
    expect(within(body).getAllByPlaceholderText('olay adı')).toHaveLength(1)
    expect(englishLeftovers(ENGLISH.socketio, body)).toEqual([])
    // Issue #283: the Events tab (listeners) replaced the subscribe box.
    fireEvent.click(within(body).getByRole('tab', { name: 'Olaylar' }))
    expect(within(body).getByText('Henüz olay yok')).toBeTruthy()
    // The Events tab's toggle and the timeline's "not listening" notice button.
    expect(within(body).getAllByText('Tüm olayları dinle')).toHaveLength(2)
    expect(within(body).getByTestId('socketio-listen-notice').textContent).toContain(
      'Hiçbir olay dinlenmiyor',
    )
    expect(englishLeftovers(ENGLISH.socketio, body)).toEqual([])
  })
})

describe('issue #248 follow-up — Epoch tool in Turkish', () => {
  it('dates, relative time, unit name and date-part labels are Turkish', () => {
    render(<EpochTool />)
    act(() => {
      fireEvent.change(screen.getByLabelText('Timestamp'), { target: { value: '1792620031' } })
    })
    expect(englishLeftovers(ENGLISH.epoch)).toEqual([])
    expect(screen.getByText(/saniye \(otomatik tespit\)/)).toBeTruthy()
    expect(screen.getByLabelText('Yıl')).toBeTruthy()
    // 1792620031 = Wednesday 21 October 2026 21:20:31 UTC.
    expect(screen.getAllByText(/21 Ekim 2026 Çarşamba/).length).toBeGreaterThan(0)
  })

  it('relative() and formatUtc() speak Turkish only when asked', () => {
    const now = new Date('2026-10-22T00:00:00Z')
    expect(relative(new Date('2026-10-21T22:00:00Z'), now, 'tr')).toBe('2 saat önce')
    expect(relative(new Date('2026-10-22T00:00:30Z'), now, 'tr')).toBe('30 saniye sonra')
    expect(relative(new Date('2026-10-21T22:00:00Z'), now)).toBe('2 hours ago')
    expect(formatUtc(now)).toMatch(/^Thursday/)
  })
})

describe('issue #248 follow-up — generic accessible names in Turkish', () => {
  it('dialog close button and the code editor', () => {
    render(<LegalDocModal open doc="eula" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Kapat' })).toBeTruthy()
    cleanup()

    render(<MonacoWrapperImpl value="" language="javascript" />)
    expect(editorOptions.at(-1)?.ariaLabel).toBe('Düzenleyici içeriği')
    render(<MonacoWrapperImpl value="" ariaLabel="Ön istek betiği" />)
    expect(editorOptions.at(-1)?.ariaLabel).toBe('Ön istek betiği')
  })
})

describe('issue #248 follow-up — English stays byte-identical', () => {
  it('Console, History, WS, GraphQL, Epoch and the accessible names keep their English text', () => {
    useLocale('en')
    seedConsole()
    const c = render(<ConsoleTab />)
    act(() => {
      fireEvent.click(screen.getByText('Network'))
    })
    for (const s of ['Online', 'Find', 'Auto', 'All Logs', 'Clear', 'Status Text:']) {
      expect(screen.getByText(s)).toBeTruthy()
    }
    expect(screen.getByTitle('Auto-scroll')).toBeTruthy()
    c.unmount()

    useHistoryStore.setState({
      entries: [historyEntry('bugun', Date.now())],
      fetch: vi.fn(async () => {}),
    } as Partial<ReturnType<typeof useHistoryStore.getState>>)
    const h = render(<HistorySidebar />)
    expect(screen.getAllByText('History').length).toBe(2)
    expect(screen.getByPlaceholderText('Filter history...')).toBeTruthy()
    expect(screen.getByTitle('Clear all history')).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Commits/ })).toBeTruthy()
    h.unmount()

    useWebSocketStore.setState({
      connectionState: 'connected',
      messages: [
        { id: 'm1', direction: 'sent', content: 'a', contentType: 'text', timestamp: 1 },
        { id: 'm2', direction: 'received', content: 'b', contentType: 'text', timestamp: 2 },
      ],
    })
    const w = render(
      <>
        <WsComposer />
        <WsMessageLog />
      </>,
    )
    expect(screen.getByTestId('ws-message-counts').textContent).toBe(
      '2 messages (1 sent, 1 received)',
    )
    expect(screen.getByRole('button', { name: /Send Message/ })).toBeTruthy()
    w.unmount()

    useGraphQLStore.setState({ schemaData: null, isIntrospecting: false })
    const g = render(<GraphQLQueryPane />)
    expect(screen.getByTestId('graphql-introspect').textContent).toBe('Introspect')
    g.unmount()

    const e = render(<EpochTool />)
    for (const s of ['Yr', 'Mon', 'Day', 'Hr', 'Min', 'Sec']) {
      expect(screen.getByLabelText(s)).toBeTruthy()
    }
    e.unmount()

    render(<LegalDocModal open doc="eula" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    cleanup()
    render(<MonacoWrapperImpl value="" />)
    expect(editorOptions.at(-1)?.ariaLabel).toBe('Editor content')
  })
})
