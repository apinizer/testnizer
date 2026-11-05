/**
 * The Operation select: shown only when a document has several operations, what its
 * choice sends and which button it leaves, and that a document with one operation is
 * exactly what it was. The real sockets and the real Run are
 * `tests/main/handlers/graphql-operation-server.test.ts`.
 *
 * Fail-before: nothing set `operationName`, so a two-operation document got the
 * server's "must provide operation name" on Send and Subscribe, with no way to choose.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) =>
    React.createElement('textarea', {
      'data-testid': 'monaco',
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
    }),
}))
vi.mock('react-resizable-panels', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => children,
  PanelGroup: ({ children }: { children: React.ReactNode }) => children,
  PanelResizeHandle: () => null,
}))

import GraphQLEditor from '../../src/renderer/components/protocols/GraphQLEditor'
import { gqlMetaOf, useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import {
  CODEGEN_GRAPHQL_SUBSCRIPTION,
  useCodegenSource,
} from '../../src/renderer/components/shared/use-codegen-source'
import {
  restoreProtocolFromMetadata,
  snapshotProtocol,
} from '../../src/renderer/lib/save-active-request'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { Tab } from '../../src/renderer/types'

const TWO_QUERIES = 'query GetUser { user { id } }\nmutation Rename { rename }'
const MIXED = 'query Now { now }\nsubscription Feed { tick }'

const ok = <T,>(data: T) => ({ success: true, data })
const send = vi.fn(async () => ok({ requestId: 'r', status: 200, body: '{}' }))
const connect = vi.fn(async (p: { connectionId: string }) => ok({ connectionId: p.connectionId }))
const state = () => useGraphQLStore.getState()
const select = () => screen.queryByTestId('graphql-operation-select') as HTMLSelectElement | null
const sentBody = (): string =>
  (send.mock.calls[0] as unknown as [{ body: { content: string } }])[0].body.content

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
  ;(window as unknown as { api: unknown }).api = {
    request: { send, cancel: vi.fn() },
    graphqlWs: {
      connect,
      disconnect: vi.fn(async () => ok(true)),
      cancelConnect: vi.fn(async () => ok({ canceled: true })),
      onEvent: () => () => {},
    },
    settings: { get: vi.fn(async () => ok(undefined)) },
  }
  useTabsStore.setState({
    tabs: [{ id: 't', name: 'T', protocol: 'graphql', isDirty: false } as Tab],
    activeTabId: 't',
  })
  useWorkspaceStore.setState({ activeProjectId: 'p', activeWorkspaceId: 'w' } as never)
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [],
    globalVariables: [],
    activeEnvironmentId: null,
  } as never)
  useRequestStore.setState({ sslVerification: null, followRedirects: null })
  state().reset()
  useGraphQLStore.setState({
    _currentTabId: 't',
    url: 'http://a.test/graphql',
    variables: '{"a":1}',
    headers: [],
    operationName: '',
    connectionInit: '',
    withheldCredentials: [],
  })
})

afterEach(() => {
  cleanup()
  state().reset()
})

function show(query: string, operationName = ''): void {
  useGraphQLStore.setState({ query, operationName })
  render(<GraphQLEditor />)
}

describe('the select', () => {
  it.each([
    ['one named operation', 'query A { a }'],
    ['one anonymous operation', '{ a }'],
    ['a document that does not parse', 'query A { a } query B {'],
    ['anonymous beside a named one', 'query A { a } { b }'],
  ])('is not there for %s', (_label, query) => {
    show(query)
    expect(select()).toBeNull()
    expect(screen.queryByTestId('graphql-operation')).toBeNull()
  })

  it('lists every operation with its type, on the first when nothing is selected', () => {
    show(MIXED)
    expect(select()?.value).toBe('Now')
    expect([...select()!.options].map((o) => o.textContent)).toEqual([
      'Now (query)',
      'Feed (subscription)',
    ])
    expect(screen.getByLabelText('Operation')).toBe(select())
  })

  it('appears and goes as the document is edited', () => {
    show('query A { a }')
    expect(select()).toBeNull()
    act(() => state().setQuery(TWO_QUERIES))
    expect(select()).not.toBeNull()
    act(() => state().setQuery('query A { a }'))
    expect(select()).toBeNull()
  })

  it('choosing marks the tab dirty and is what the store keeps', () => {
    show(TWO_QUERIES)
    fireEvent.change(select()!, { target: { value: 'Rename' } })
    expect(state().operationName).toBe('Rename')
    expect(useTabsStore.getState().tabs[0].isDirty).toBe(true)
  })

  it('the button follows the selected operation', () => {
    show(MIXED)
    expect(screen.getByTestId('graphql-run')).toBeTruthy()
    expect(screen.queryByTestId('graphql-subscribe')).toBeNull()

    fireEvent.change(select()!, { target: { value: 'Feed' } })
    expect(screen.getByTestId('graphql-subscribe')).toBeTruthy()
    expect(screen.queryByTestId('graphql-run')).toBeNull()

    fireEvent.change(select()!, { target: { value: 'Now' } })
    expect(screen.getByTestId('graphql-run')).toBeTruthy()
  })

  it('a selection the document lost shows the first operation and says so', () => {
    show(TWO_QUERIES, 'Gone')
    expect(select()?.value).toBe('GetUser')
    expect(screen.getByTestId('graphql-operation-stale').textContent).toBe(
      '"Gone" is no longer in the document. Using "GetUser".',
    )
    fireEvent.change(select()!, { target: { value: 'Rename' } })
    expect(screen.queryByTestId('graphql-operation-stale')).toBeNull()
  })

  it('Turkish', () => {
    useUIStore.setState({ locale: 'tr' })
    setLocale('tr')
    show(TWO_QUERIES, 'Gone')
    expect(screen.getByLabelText('İşlem')).toBe(select())
    expect(screen.getByTestId('graphql-operation-stale').textContent).toBe(
      '"Gone" artık belgede yok. "GetUser" kullanılıyor.',
    )
  })

  it('locks while a subscription runs: it keeps the operation it started with', () => {
    useGraphQLStore.setState({ subscriptionState: 'connected', connectionId: 'c' })
    show(MIXED, 'Feed')
    expect(select()?.disabled).toBe(true)
    // Unsubscribe stays reachable even if the document changes under it.
    act(() => state().setQuery(TWO_QUERIES))
    expect(screen.getByTestId('graphql-subscribe')).toBeTruthy()
  })
})

describe('what is sent', () => {
  it('one operation: the POST body is pinned, byte for byte', async () => {
    useGraphQLStore.setState({ query: 'query Only { only }' })
    await state().executeQuery()
    expect(sentBody()).toBe('{"query":"query Only { only }","variables":{"a":1}}')
  })

  it('variables that do not parse still go out empty', async () => {
    useGraphQLStore.setState({ query: '{ a }', variables: '{not json' })
    await state().executeQuery()
    expect(sentBody()).toBe('{"query":"{ a }","variables":{}}')
  })

  it('the selected operation goes in the POST', async () => {
    useGraphQLStore.setState({ query: TWO_QUERIES, operationName: 'Rename' })
    await state().executeQuery()
    expect(JSON.parse(sentBody())).toEqual({
      query: TWO_QUERIES,
      operationName: 'Rename',
      variables: { a: 1 },
    })
  })

  it('a stale selection never goes out; the first operation does', async () => {
    useGraphQLStore.setState({ query: TWO_QUERIES, operationName: 'Gone' })
    await state().executeQuery()
    expect(JSON.parse(sentBody()).operationName).toBe('GetUser')
    expect(sentBody()).not.toContain('Gone')
  })

  it('Subscribe sends the selected subscription', async () => {
    useGraphQLStore.setState({ query: MIXED, operationName: 'Feed' })
    await state().subscribe()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect.mock.calls[0][0]).toMatchObject({ query: MIXED, operationName: 'Feed' })
  })

  it('with nothing selected, a document that starts with a query does not subscribe', async () => {
    useGraphQLStore.setState({ query: MIXED, operationName: '' })
    await state().subscribe()
    expect(connect).not.toHaveBeenCalled()
  })

  it('Subscribe does nothing when the selection is a query', async () => {
    useGraphQLStore.setState({
      query: 'subscription Feed { tick }\nquery Now { now }',
      operationName: 'Now',
    })
    await state().subscribe()
    expect(connect).not.toHaveBeenCalled()
  })

  it('one subscription: the connect payload has no name', async () => {
    useGraphQLStore.setState({ query: 'subscription Feed { tick }', operationName: 'Feed' })
    await state().subscribe()
    expect(connect.mock.calls[0][0]).not.toHaveProperty('operationName')
  })
})

describe('saved state', () => {
  it('the row holds it only when set, and only while the document has it', () => {
    const base = { url: 'u', query: TWO_QUERIES, variables: '', headers: [], connectionInit: '' }
    expect(gqlMetaOf({ ...base, operationName: 'Rename' }).operationName).toBe('Rename')
    expect(gqlMetaOf({ ...base, operationName: '' })).not.toHaveProperty('operationName')
    expect(gqlMetaOf({ ...base, operationName: 'Gone' })).not.toHaveProperty('operationName')
    expect(gqlMetaOf({ ...base, query: 'query A { a }', operationName: 'A' })).not.toHaveProperty(
      'operationName',
    )
  })

  it('a row without one is the same object as before', () => {
    expect(
      Object.keys(
        gqlMetaOf({
          url: 'u',
          query: '{ a }',
          variables: '',
          headers: [],
          connectionInit: '',
          operationName: '',
        }),
      ),
    ).toEqual(['url', 'query', 'variables', 'headers'])
  })

  it('save and reopen keep it; the next row does not inherit it', () => {
    useGraphQLStore.setState({ query: TWO_QUERIES, operationName: 'Rename' })
    const meta = snapshotProtocol(useTabsStore.getState().tabs[0]).protocolMeta as {
      graphql: Record<string, unknown>
    }
    expect(meta.graphql.operationName).toBe('Rename')

    useGraphQLStore.setState({ operationName: 'typed in another request' })
    restoreProtocolFromMetadata('graphql', meta)
    expect(state().operationName).toBe('Rename')

    restoreProtocolFromMetadata('graphql', { graphql: { query: TWO_QUERIES } })
    expect(state().operationName).toBe('')
  })

  it('stays with its tab, and Duplicate Tab copies it', () => {
    useGraphQLStore.setState({ query: TWO_QUERIES, operationName: 'Rename' })
    state().cloneTabState('t', 't2')
    state().switchToTab('other')
    expect(state().operationName).toBe('')
    state().switchToTab('t')
    expect(state().operationName).toBe('Rename')
    state().switchToTab('t2')
    expect(state().operationName).toBe('Rename')
  })

  it('History keeps it in `configured`', async () => {
    useGraphQLStore.setState({ query: TWO_QUERIES, operationName: 'Rename' })
    await state().executeQuery()
    const payload = (
      send.mock.calls[0] as unknown as [{ _configured: { meta: { graphql: unknown } } }]
    )[0]
    expect(payload._configured.meta.graphql).toMatchObject({ operationName: 'Rename' })
  })
})

describe('Generate Code', () => {
  const source = () => renderHook(() => useCodegenSource()).result.current

  it('a selected query is a POST with its name', () => {
    useGraphQLStore.setState({
      query: 'subscription Feed { tick }\nquery Now { now }',
      operationName: 'Now',
    })
    const s = source()
    expect(s.kind).toBe('request')
    expect(s.kind === 'request' && s.req.body).toMatchObject({
      graphql: { operationName: 'Now' },
    })
  })

  it('a selected subscription is the "unavailable" state, whatever comes first', () => {
    useGraphQLStore.setState({ query: MIXED, operationName: 'Feed' })
    expect(source()).toEqual({ kind: 'unavailable', protocol: CODEGEN_GRAPHQL_SUBSCRIPTION })
  })

  it('one operation: no name in the body', () => {
    useGraphQLStore.setState({ query: 'query Only { only }', operationName: 'Only' })
    const s = source()
    expect(s.kind === 'request' && s.req.body).toEqual({
      type: 'graphql',
      graphql: { query: 'query Only { only }', variables: '{"a":1}' },
    })
  })
})
