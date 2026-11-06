/**
 * The GraphQL store's subscription path against a stand-in `graphqlWs` bridge. The
 * real socket is `tests/main/graphql-ws-engine.test.ts`; tab ownership is
 * `async-work-stays-on-its-tab.test.ts`. Here: what is sent, what is refused before
 * anything is sent, and what the tab says afterwards.
 *
 * Fail-before: `subscribe` sent an HTTP request with the made-up method
 * GQL_SUBSCRIBE and, if that threw, a timer invented "Event at ..." rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  gqlMetaOf,
  GQL_CREDENTIALS,
  useGraphQLStore,
} from '../../src/renderer/stores/graphql.store'
import {
  snapshotProtocol,
  restoreProtocolFromMetadata,
} from '../../src/renderer/lib/save-active-request'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import { withholdCredentials } from '../../src/renderer/lib/credential-withhold'
import { protocolHistoryRestore } from '../../src/renderer/lib/history-restore'
import { GQL_MAX_SUBSCRIPTION_EVENTS, type GqlWsEvent } from '../../src/shared/graphql-ws'
import { HISTORY_MASK } from '../../src/shared/credential-headers'
import type { Tab } from '../../src/renderer/types'

const ok = <T>(data: T) => ({ success: true, data })

type ConnectPayload = Record<string, unknown> & { connectionId: string }

let listeners: Set<(e: GqlWsEvent) => void>
let settings: Record<string, unknown>
const connect = vi.fn(async (p: ConnectPayload) => ok({ connectionId: p.connectionId }))
const disconnect = vi.fn(async (_id: string) => ok(true))
const cancelConnect = vi.fn(async (_id: string) => ok({ canceled: true }))
const send = vi.fn()

const sent = (): ConnectPayload => connect.mock.calls[0][0]
const emit = (e: Record<string, unknown>): void => {
  const event = { connectionId: sent().connectionId, timestamp: 1, ...e } as GqlWsEvent
  for (const cb of [...listeners]) cb(event)
}
const state = () => useGraphQLStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  setLocale('en')
  listeners = new Set()
  settings = {}
  ;(window as unknown as { api: unknown }).api = {
    request: { send, cancel: vi.fn() },
    graphqlWs: {
      connect,
      disconnect,
      cancelConnect,
      onEvent: (cb: (e: GqlWsEvent) => void) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    },
    settings: { get: vi.fn(async (key: string) => ok(settings[key])) },
  }
  useTabsStore.setState({
    tabs: [{ id: 't', name: 'T', protocol: 'graphql', isDirty: false } as Tab],
    activeTabId: 't',
  })
  useWorkspaceStore.setState({ activeProjectId: 'p', activeWorkspaceId: 'w' } as never)
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [
      {
        id: 'e',
        name: 'E',
        variables: [
          { id: 'v', key: 'tok', value: 'abc', initialValue: '', enabled: true, secret: false },
        ],
      },
    ] as never,
    globalVariables: [],
    activeEnvironmentId: 'e',
  })
  useRequestStore.setState({ sslVerification: null, followRedirects: null })
  state().reset()
  useGraphQLStore.setState({
    _currentTabId: 't',
    url: 'http://a.test/{{tok}}',
    query: 'subscription { tick }',
    variables: '{"id":"{{tok}}"}',
    headers: [
      { id: '1', key: 'Authorization', value: 'Bearer {{tok}}', enabled: true },
      { id: '2', key: 'X-Off', value: 'no', enabled: false },
    ],
    connectionInit: '{"token":"{{tok}}"}',
  })
})

afterEach(() => {
  state().reset()
})

describe('subscribe', () => {
  it('opens the socket through main with everything resolved, and never POSTs', async () => {
    await state().subscribe()
    expect(send).not.toHaveBeenCalled()
    expect(sent()).toMatchObject({
      url: 'http://a.test/abc',
      query: 'subscription { tick }',
      variables: '{"id":"abc"}',
      headers: { Authorization: 'Bearer abc' },
      connectionInit: '{"token":"abc"}',
      sslVerification: true,
      _tabId: 't',
      _projectId: 'p',
      _workspaceId: 'w',
    })
    // History's reopen template keeps the {{var}}.
    expect(sent()._configured).toMatchObject({
      url: 'http://a.test/{{tok}}',
      meta: { graphql: { connectionInit: '{"token":"{{tok}}"}' } },
    })
    expect(state().subscriptionState).toBe('connected')
    expect(state().connectionId).toBe(sent().connectionId)
  })

  it('invents nothing: no event arrives unless the server sends one', async () => {
    vi.useFakeTimers()
    try {
      const done = state().subscribe()
      await vi.advanceTimersByTimeAsync(10_000)
      await done
      await vi.advanceTimersByTimeAsync(60_000)
      expect(state().subscriptionEvents).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a project set to skip SSL verification reaches the socket', async () => {
    settings['project.p.settings'] = { sslVerification: false }
    await state().subscribe()
    expect(sent().sslVerification).toBe(false)
  })

  it('a failure stays in the tab as text and nothing is left listening', async () => {
    connect.mockResolvedValueOnce({
      success: false,
      error: 'x',
      errorInfo: { kind: 'closed', message: 'Connection closed' },
      failure: { reason: 'closed', closeCode: 4403 },
    } as never)
    await state().subscribe()
    expect(state().subscriptionState).toBe('error')
    expect(state().subscriptionError).toContain('4403: Forbidden')
    expect(state().subscriptionEvents).toEqual([])
    expect(listeners.size).toBe(0)
  })

  it('a connection_init that is not a JSON object is refused before anything opens', async () => {
    useGraphQLStore.setState({ connectionInit: '["a"]' })
    await state().subscribe()
    expect(connect).not.toHaveBeenCalled()
    expect(state().subscriptionError).toMatch(/must be a JSON object/)
  })

  it('a History mask left in connection_init is never sent', async () => {
    useGraphQLStore.setState({ connectionInit: `{"token":"${HISTORY_MASK}"}` })
    await state().subscribe()
    expect(connect).not.toHaveBeenCalled()
    expect(state().subscriptionState).toBe('error')
    expect(state().subscriptionError).toContain('connectionInit.token')
  })

  it('a query that is not a subscription does nothing', async () => {
    useGraphQLStore.setState({ query: '{ tick }' })
    await state().subscribe()
    expect(connect).not.toHaveBeenCalled()
    expect(state().subscriptionState).toBe('disconnected')
  })

  describe('the proxy, by the chain HTTP Send uses', () => {
    const custom = (host: string) => ({
      mode: 'custom' as const,
      host,
      port: 8080,
      auth: { username: 'u', password: 'p' },
    })

    it('the project proxy wins over the app proxy', async () => {
      settings['project.p.settings'] = { proxy: custom('project.test') }
      settings.proxy = custom('app.test')
      await state().subscribe()
      expect(sent().proxy).toEqual(custom('project.test'))
    })

    it('the app proxy applies when the project configures none', async () => {
      // `system`: what every project saved before issue #254 holds.
      settings['project.p.settings'] = { proxy: { mode: 'system' } }
      settings.proxy = custom('app.test')
      await state().subscribe()
      expect(sent().proxy).toEqual(custom('app.test'))
    })

    it('"No proxy" on the project reaches main', async () => {
      settings['project.p.settings'] = { proxy: { mode: 'none' } }
      settings.proxy = custom('app.test')
      await state().subscribe()
      expect(sent().proxy).toEqual({ mode: 'none' })
    })

    it('nothing configured sends no proxy, and no row says otherwise', async () => {
      await state().subscribe()
      expect(sent()).not.toHaveProperty('proxy')
      expect(state().subscriptionEvents).toEqual([])
    })

    it('a custom proxy adds no row to the log', async () => {
      settings['project.p.settings'] = { proxy: custom('project.test') }
      await state().subscribe()
      expect(state().subscriptionEvents).toEqual([])
    })
  })
})

describe('events', () => {
  it('data and server errors are rows; a frame of another connection is ignored', async () => {
    await state().subscribe()
    emit({ type: 'data', data: '{"n":1}' })
    emit({ type: 'error', message: 'bad', data: '[{"message":"bad"}]', fatal: false })
    for (const cb of listeners) {
      cb({ connectionId: 'other', timestamp: 1, type: 'data', data: 'not mine' })
    }
    expect(state().subscriptionEvents.map((e) => [e.kind, e.data])).toEqual([
      ['data', '{"n":1}'],
      ['error', 'bad\n[{"message":"bad"}]'],
    ])
  })

  it('a frame that overtakes the connect reply is kept', async () => {
    connect.mockImplementationOnce(async (p: ConnectPayload) => {
      for (const cb of listeners) {
        cb({ connectionId: p.connectionId, timestamp: 1, type: 'data', data: 'first' })
      }
      return ok({ connectionId: p.connectionId })
    })
    await state().subscribe()
    expect(state().subscriptionEvents.map((e) => e.data)).toEqual(['first'])
  })

  it.each([
    [{ type: 'ended', reason: 'complete' }, { kind: 'completed' }],
    [{ type: 'ended', reason: 'error' }, { kind: 'error' }],
    [
      { type: 'ended', reason: 'close', code: 4401, closeReason: 'no' },
      { kind: 'closed', code: 4401, reason: 'no' },
    ],
  ])('the server ending it (%j) says so and stops listening', async (event, end) => {
    await state().subscribe()
    emit(event)
    expect(state().subscriptionState).toBe('disconnected')
    expect(state().subscriptionEnd).toEqual(end)
    expect(state().connectionId).toBeNull()
    expect(listeners.size).toBe(0)
  })

  it('a dropped connection keeps the events it delivered', async () => {
    await state().subscribe()
    emit({ type: 'data', data: 'kept' })
    emit({ type: 'ended', reason: 'close', code: 1006 })
    expect(state().subscriptionEvents.map((e) => e.data)).toEqual(['kept'])
    expect(state().subscriptionEnd).toEqual({ kind: 'closed', code: 1006 })
  })

  it('keeps the newest events up to the cap and counts the dropped ones', async () => {
    await state().subscribe()
    const over = 5
    for (let i = 0; i < GQL_MAX_SUBSCRIPTION_EVENTS + over; i++) {
      emit({ type: 'data', data: String(i) })
    }
    const rows = state().subscriptionEvents
    expect(rows).toHaveLength(GQL_MAX_SUBSCRIPTION_EVENTS)
    expect(rows[0].data).toBe(String(over))
    expect(state().subscriptionDropped).toBe(over)
  })
})

describe('unsubscribe', () => {
  it('closes through main and says so; later frames are not shown', async () => {
    await state().subscribe()
    const id = sent().connectionId
    await state().unsubscribe()
    expect(disconnect).toHaveBeenCalledWith(id)
    expect(state().subscriptionState).toBe('disconnected')
    expect(state().subscriptionEnd).toEqual({ kind: 'unsubscribed' })
    expect(listeners.size).toBe(0)
  })

  it('during the handshake cancels it; a connect that still succeeds is closed', async () => {
    let answer: (v: unknown) => void = () => {}
    connect.mockImplementationOnce(
      () => new Promise((r) => (answer = r as (v: unknown) => void)) as never,
    )
    const done = state().subscribe()
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    const id = sent().connectionId
    expect(state().subscriptionState).toBe('connecting')

    await state().unsubscribe()
    expect(cancelConnect).toHaveBeenCalledWith(id)

    answer(ok({ connectionId: id }))
    await done
    expect(disconnect).toHaveBeenCalledWith(id)
    expect(state().subscriptionState).toBe('disconnected')
  })
})

describe('connection_init is saved like the other fields', () => {
  it('Ctrl+S writes it and reopening restores it; a row without one stays as it was', () => {
    const tab = { id: 't', protocol: 'graphql' } as Tab
    const meta = snapshotProtocol(tab).protocolMeta as { graphql: Record<string, unknown> }
    expect(meta.graphql.connectionInit).toBe('{"token":"{{tok}}"}')

    useGraphQLStore.setState({ connectionInit: 'typed in another request' })
    restoreProtocolFromMetadata('graphql', meta)
    expect(state().connectionInit).toBe('{"token":"{{tok}}"}')

    restoreProtocolFromMetadata('graphql', { graphql: { url: 'x', query: '{a}' } })
    expect(state().connectionInit).toBe('')
    expect(gqlMetaOf(state())).not.toHaveProperty('connectionInit')
  })

  it('a History row reopens it, emptied where main masked it, and names the field', () => {
    const entry = {
      url: 'ws://a.test',
      request_snapshot: JSON.stringify({
        configured: {
          url: 'ws://a.test',
          meta: {
            graphql: {
              url: 'ws://a.test',
              query: 'subscription { tick }',
              connectionInit: `{"token":"${HISTORY_MASK}","tenant":"t1"}`,
              headers: [],
            },
          },
        },
      }),
    }
    const reopened = protocolHistoryRestore(entry as never, 'graphql')
    expect(reopened.hidden).toContain('connectionInit.token')
    restoreProtocolFromMetadata('graphql', reopened.meta)
    expect(state().connectionInit).not.toContain(HISTORY_MASK)
    expect(state().connectionInit).toContain('t1')
  })

  it('a literal credential is withheld from the local snapshot, a {{var}} is kept', () => {
    const literal = withholdCredentials(
      { ...state(), connectionInit: '{"token":"s3cret-literal"}', withheldCredentials: [] },
      GQL_CREDENTIALS,
    )
    expect(literal.connectionInit).not.toContain('s3cret-literal')
    expect(literal.withheldCredentials).toContain('connectionInit')

    const template = withholdCredentials(
      { ...state(), connectionInit: '{"token":"{{tok}}"}', withheldCredentials: [] },
      GQL_CREDENTIALS,
    )
    expect(template.connectionInit).toBe('{"token":"{{tok}}"}')
  })

  it('the running subscription never reaches the local snapshot', async () => {
    await state().subscribe()
    emit({ type: 'data', data: 'frame-not-stored' })
    state().switchToTab('other')
    expect(localStorage.getItem('testnizer-graphql')).not.toContain('frame-not-stored')
    expect(localStorage.getItem('testnizer-graphql')).not.toContain(sent().connectionId)
  })
})
