import { describe, it, expect, beforeEach } from 'vitest'
import {
  useConsoleStore,
  selectFilteredEntries,
  type ConsoleLogEntry,
} from '../../src/renderer/stores/console.store'

function makeEntry(overrides: Partial<ConsoleLogEntry> = {}): ConsoleLogEntry {
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2)}`,
    timestamp: overrides.timestamp ?? Date.now(),
    protocol: overrides.protocol ?? 'http',
    level: overrides.level ?? 'info',
    category: overrides.category ?? 'response',
    method: overrides.method ?? 'GET',
    url: overrides.url ?? 'https://example.com',
    status: overrides.status,
    message: overrides.message,
    details: overrides.details,
    ...overrides,
  }
}

describe('console.store — addEntry', () => {
  beforeEach(() => {
    useConsoleStore.getState().clear()
    useConsoleStore.getState().setFilter('all')
    useConsoleStore.getState().setSearchTerm('')
  })

  it('adds an entry with default id and timestamp', () => {
    useConsoleStore.getState().addEntry({
      protocol: 'http',
      level: 'success',
      category: 'response',
      method: 'GET',
      url: 'https://example.com/foo',
      status: 200,
    })
    const entries = useConsoleStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].method).toBe('GET')
    expect(entries[0].id).toBeTruthy()
    expect(entries[0].timestamp).toBeGreaterThan(0)
  })

  it('caps the buffer at 1000 entries (FIFO eviction)', () => {
    const store = useConsoleStore.getState()
    for (let i = 0; i < 1050; i++) {
      store.addEntry({
        protocol: 'http',
        level: 'info',
        category: 'response',
        method: 'GET',
        url: `https://example.com/${i}`,
      })
    }
    const entries = useConsoleStore.getState().entries
    expect(entries.length).toBe(1000)
    // The oldest entries (0..49) must have been evicted
    expect(entries[0].url).toBe('https://example.com/50')
    expect(entries[entries.length - 1].url).toBe('https://example.com/1049')
  })

  it('clear() empties entries and expandedIds', () => {
    const s = useConsoleStore.getState()
    s.addEntry({ protocol: 'http', level: 'info', category: 'response' })
    s.toggleExpanded(useConsoleStore.getState().entries[0].id)
    expect(useConsoleStore.getState().expandedIds.size).toBe(1)
    s.clear()
    expect(useConsoleStore.getState().entries).toHaveLength(0)
    expect(useConsoleStore.getState().expandedIds.size).toBe(0)
  })

  it('toggleExpanded toggles ids in/out', () => {
    const s = useConsoleStore.getState()
    s.addEntry({ protocol: 'http', level: 'info', category: 'response' })
    const id = useConsoleStore.getState().entries[0].id
    s.toggleExpanded(id)
    expect(useConsoleStore.getState().expandedIds.has(id)).toBe(true)
    s.toggleExpanded(id)
    expect(useConsoleStore.getState().expandedIds.has(id)).toBe(false)
  })
})

describe('console.store — selectFilteredEntries', () => {
  const entries: ConsoleLogEntry[] = [
    makeEntry({ id: '1', protocol: 'http', status: 200, level: 'success', method: 'GET', url: 'https://api.example/users' }),
    makeEntry({ id: '2', protocol: 'http', status: 404, level: 'error', method: 'GET', url: 'https://api.example/missing' }),
    makeEntry({ id: '3', protocol: 'http', status: 301, level: 'warning', method: 'GET', url: 'https://api.example/redirect' }),
    makeEntry({ id: '4', protocol: 'websocket', level: 'info', category: 'event', message: 'WS message hello' }),
    makeEntry({ id: '5', protocol: 'grpc', level: 'success', category: 'response', message: 'gRPC unary OK' }),
    makeEntry({ id: '6', protocol: 'graphql', level: 'error', category: 'response', message: 'gql 500' }),
    makeEntry({ id: '7', protocol: 'soap', level: 'success', category: 'response', message: 'SOAP add OK', tabId: 'tab-A' }),
    makeEntry({ id: '8', protocol: 'sse', level: 'info', category: 'event', message: 'SSE evt' }),
  ]

  it('"all" returns everything', () => {
    const out = selectFilteredEntries(entries, { filter: 'all', searchTerm: '' })
    expect(out).toHaveLength(entries.length)
  })

  it('protocol-specific filter narrows to that protocol', () => {
    const http = selectFilteredEntries(entries, { filter: 'http', searchTerm: '' })
    expect(http.map((e) => e.id)).toEqual(['1', '2', '3'])
    const ws = selectFilteredEntries(entries, { filter: 'websocket', searchTerm: '' })
    expect(ws.map((e) => e.id)).toEqual(['4'])
  })

  it('"error" filter picks up level=error and status>=400', () => {
    const out = selectFilteredEntries(entries, { filter: 'error', searchTerm: '' })
    const ids = out.map((e) => e.id).sort()
    expect(ids).toEqual(['2', '6'])
  })

  it('"warn" filter picks up level=warning and 3xx', () => {
    const out = selectFilteredEntries(entries, { filter: 'warn', searchTerm: '' })
    expect(out.map((e) => e.id)).toContain('3')
  })

  it('search term filters across method/url/message', () => {
    const out = selectFilteredEntries(entries, { filter: 'all', searchTerm: 'missing' })
    expect(out.map((e) => e.id)).toEqual(['2'])
    const out2 = selectFilteredEntries(entries, { filter: 'all', searchTerm: 'hello' })
    expect(out2.map((e) => e.id)).toEqual(['4'])
  })

  it('activeTabIdFilter restricts to one tab', () => {
    const out = selectFilteredEntries(entries, {
      filter: 'all',
      searchTerm: '',
      activeTabIdFilter: 'tab-A',
    })
    expect(out.map((e) => e.id)).toEqual(['7'])
  })

  it('combined: protocol + search + tab filter', () => {
    const ext = [
      ...entries,
      makeEntry({ id: '9', protocol: 'http', status: 500, level: 'error', message: 'boom users', tabId: 'tab-A' }),
    ]
    const out = selectFilteredEntries(ext, {
      filter: 'http',
      searchTerm: 'boom',
      activeTabIdFilter: 'tab-A',
    })
    expect(out.map((e) => e.id)).toEqual(['9'])
  })
})

describe('console.store — addFromResponse only adds script-log entries', () => {
  beforeEach(() => useConsoleStore.getState().clear())

  it('does nothing when there are no consoleLogs (main process already broadcasted)', () => {
    useConsoleStore.getState().addFromResponse(
      { method: 'GET', url: 'https://x' },
      {
        requestId: 'r1',
        protocol: 'http',
        status: 200,
        timing: { total: 12 },
      },
    )
    expect(useConsoleStore.getState().entries).toHaveLength(0)
  })

  it('adds a single supplementary entry when scripts logged something', () => {
    useConsoleStore.getState().addFromResponse(
      { method: 'GET', url: 'https://x' },
      {
        requestId: 'r1',
        protocol: 'http',
        status: 200,
        timing: { total: 12 },
        consoleLogs: [
          { level: 'log', message: 'hello from script', timestamp: Date.now() },
        ],
      },
    )
    const e = useConsoleStore.getState().entries
    expect(e).toHaveLength(1)
    expect(e[0].category).toBe('system')
    expect(e[0].scriptLogs).toHaveLength(1)
  })
})
