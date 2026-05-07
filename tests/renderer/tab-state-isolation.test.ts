/**
 * Tab-keyed cache isolation tests.
 *
 * Each protocol store (websocket / sse / grpc / graphql / ai-chat) keeps a
 * `_tabStates` Map keyed on `tabId`. Two tabs of the same protocol must not
 * share state. These tests verify:
 *   1. Setting state on tab A and switching to tab B doesn't leak A's values.
 *   2. Switching back to tab A restores its values.
 *   3. Removing tab A's state leaves tab B intact.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useAiChatStore } from '../../src/renderer/stores/ai-chat.store'

// ─── WebSocket ──────────────────────────────────────────────

describe('websocket.store — per-tab isolation', () => {
  beforeEach(() => {
    useWebSocketStore.setState({
      ...useWebSocketStore.getState(),
      _tabStates: new Map(),
      _currentTabId: null,
      url: 'wss://echo.websocket.org',
      messages: [],
      composerContent: '',
      _unsubscribe: undefined,
    })
  })

  it('keeps tab A and tab B URLs / composer content separate', () => {
    const s = useWebSocketStore.getState()
    s.switchToTab('tab-A')
    useWebSocketStore.getState().setUrl('wss://example.com/socketA')
    useWebSocketStore.getState().setComposerContent('hello A')

    useWebSocketStore.getState().switchToTab('tab-B')
    expect(useWebSocketStore.getState().url).not.toBe('wss://example.com/socketA')
    expect(useWebSocketStore.getState().composerContent).not.toBe('hello A')

    useWebSocketStore.getState().setUrl('wss://example.com/socketB')
    useWebSocketStore.getState().setComposerContent('hello B')

    useWebSocketStore.getState().switchToTab('tab-A')
    expect(useWebSocketStore.getState().url).toBe('wss://example.com/socketA')
    expect(useWebSocketStore.getState().composerContent).toBe('hello A')

    useWebSocketStore.getState().switchToTab('tab-B')
    expect(useWebSocketStore.getState().url).toBe('wss://example.com/socketB')
    expect(useWebSocketStore.getState().composerContent).toBe('hello B')
  })

  it('removeTabState(A) leaves tab B state intact', () => {
    const s = useWebSocketStore.getState()
    s.switchToTab('tab-A')
    useWebSocketStore.getState().setUrl('wss://A')
    useWebSocketStore.getState().switchToTab('tab-B')
    useWebSocketStore.getState().setUrl('wss://B')

    // Currently live = tab-B; remove tab-A's cached state
    useWebSocketStore.getState().removeTabState('tab-A')

    expect(useWebSocketStore.getState().url).toBe('wss://B')
    expect(useWebSocketStore.getState()._tabStates.has('tab-A')).toBe(false)
  })
})

// ─── SSE ────────────────────────────────────────────────────

describe('sse.store — per-tab isolation', () => {
  beforeEach(() => {
    useSseStore.setState({
      ...useSseStore.getState(),
      _tabStates: new Map(),
      _currentTabId: null,
      url: 'https://stream.example/default',
      events: [],
      lastEventId: '',
      _unsubscribe: undefined,
    })
  })

  it('keeps url / lastEventId / events isolated between tabs', () => {
    const s = useSseStore.getState()
    s.switchToTab('tab-A')
    useSseStore.getState().setUrl('https://a.example/sse')
    useSseStore.getState().setLastEventId('A-42')
    useSseStore.getState().addEvent({
      id: 'evt1',
      type: 'message',
      data: 'from-A',
      timestamp: 1,
    })

    useSseStore.getState().switchToTab('tab-B')
    expect(useSseStore.getState().url).not.toBe('https://a.example/sse')
    expect(useSseStore.getState().lastEventId).not.toBe('A-42')
    expect(useSseStore.getState().events).toHaveLength(0)

    useSseStore.getState().switchToTab('tab-A')
    expect(useSseStore.getState().url).toBe('https://a.example/sse')
    expect(useSseStore.getState().lastEventId).toBe('A-42')
    expect(useSseStore.getState().events).toHaveLength(1)
    expect(useSseStore.getState().events[0].data).toBe('from-A')
  })

  it('removeTabState(A) leaves tab B intact', () => {
    const s = useSseStore.getState()
    s.switchToTab('tab-A')
    useSseStore.getState().setUrl('https://a/sse')
    useSseStore.getState().switchToTab('tab-B')
    useSseStore.getState().setUrl('https://b/sse')

    useSseStore.getState().removeTabState('tab-A')

    expect(useSseStore.getState().url).toBe('https://b/sse')
    expect(useSseStore.getState()._tabStates.has('tab-A')).toBe(false)
  })
})

// ─── gRPC ───────────────────────────────────────────────────

describe('grpc.store — per-tab isolation', () => {
  beforeEach(() => {
    useGrpcStore.setState({
      ...useGrpcStore.getState(),
      _tabStates: new Map(),
      _currentTabId: null,
      address: 'localhost:50051',
      services: [],
      selectedService: null,
      selectedMethod: null,
      requestBody: '{}',
      streamEvents: [],
      activeStreamId: null,
      streamUnsubscribe: null,
    })
  })

  it('keeps address / selectedService / requestBody isolated', () => {
    const s = useGrpcStore.getState()
    s.switchToTab('tab-A')
    useGrpcStore.getState().setAddress('greeter.local:50051')
    useGrpcStore.getState().setRequestBody('{"name":"alice"}')
    // Inject services so we can also exercise selectedService isolation.
    useGrpcStore.setState({
      services: [
        {
          name: 'svc.A',
          methods: [{ name: 'Hello', type: 'unary', requestType: 'Q', responseType: 'R' }],
        },
      ],
      selectedService: 'svc.A',
      selectedMethod: 'Hello',
    })

    useGrpcStore.getState().switchToTab('tab-B')
    expect(useGrpcStore.getState().address).not.toBe('greeter.local:50051')
    expect(useGrpcStore.getState().requestBody).not.toBe('{"name":"alice"}')
    expect(useGrpcStore.getState().selectedService).toBeNull()
    expect(useGrpcStore.getState().services).toHaveLength(0)

    useGrpcStore.getState().switchToTab('tab-A')
    expect(useGrpcStore.getState().address).toBe('greeter.local:50051')
    expect(useGrpcStore.getState().requestBody).toBe('{"name":"alice"}')
    expect(useGrpcStore.getState().selectedService).toBe('svc.A')
    expect(useGrpcStore.getState().services).toHaveLength(1)
  })

  it('removeTabState(A) leaves tab B intact', () => {
    const s = useGrpcStore.getState()
    s.switchToTab('tab-A')
    useGrpcStore.getState().setAddress('a:1234')
    useGrpcStore.getState().switchToTab('tab-B')
    useGrpcStore.getState().setAddress('b:5678')

    useGrpcStore.getState().removeTabState('tab-A')

    expect(useGrpcStore.getState().address).toBe('b:5678')
    expect(useGrpcStore.getState()._tabStates.has('tab-A')).toBe(false)
  })
})

// ─── GraphQL ────────────────────────────────────────────────

describe('graphql.store — per-tab isolation', () => {
  beforeEach(() => {
    useGraphQLStore.setState({
      ...useGraphQLStore.getState(),
      _tabStates: new Map(),
      _currentTabId: null,
      url: 'https://countries.trevorblades.com/graphql',
      query: '',
      variables: '{}',
      response: null,
      subscriptionEvents: [],
    })
  })

  it('keeps url / query / variables isolated between tabs', () => {
    const s = useGraphQLStore.getState()
    s.switchToTab('tab-A')
    useGraphQLStore.getState().setUrl('https://api.A/graphql')
    useGraphQLStore.getState().setQuery('query { userA { id } }')
    useGraphQLStore.getState().setVariables('{"a":1}')

    useGraphQLStore.getState().switchToTab('tab-B')
    expect(useGraphQLStore.getState().url).not.toBe('https://api.A/graphql')
    expect(useGraphQLStore.getState().query).not.toBe('query { userA { id } }')
    expect(useGraphQLStore.getState().variables).not.toBe('{"a":1}')

    useGraphQLStore.getState().setUrl('https://api.B/graphql')
    useGraphQLStore.getState().setQuery('query { userB { id } }')

    useGraphQLStore.getState().switchToTab('tab-A')
    expect(useGraphQLStore.getState().url).toBe('https://api.A/graphql')
    expect(useGraphQLStore.getState().query).toBe('query { userA { id } }')
    expect(useGraphQLStore.getState().variables).toBe('{"a":1}')
  })

  it('removeTabState(A) leaves tab B intact', () => {
    const s = useGraphQLStore.getState()
    s.switchToTab('tab-A')
    useGraphQLStore.getState().setUrl('https://A/graphql')
    useGraphQLStore.getState().switchToTab('tab-B')
    useGraphQLStore.getState().setUrl('https://B/graphql')

    useGraphQLStore.getState().removeTabState('tab-A')

    expect(useGraphQLStore.getState().url).toBe('https://B/graphql')
    expect(useGraphQLStore.getState()._tabStates.has('tab-A')).toBe(false)
  })
})

// ─── AI Chat ────────────────────────────────────────────────

describe('ai-chat.store — per-tab isolation', () => {
  beforeEach(() => {
    useAiChatStore.setState({
      ...useAiChatStore.getState(),
      _tabStates: new Map(),
      _currentTabId: null,
      provider: 'openai',
      apiKey: '',
      systemPrompt: '',
      messages: [],
      streaming: false,
      pendingMessageId: null,
      pendingResponseId: null,
      errorMessage: null,
    })
  })

  it('keeps provider / apiKey / systemPrompt / messages isolated', () => {
    const s = useAiChatStore.getState()
    s.switchToTab('tab-A')
    useAiChatStore.getState().setProvider('anthropic')
    useAiChatStore.getState().setApiKey('sk-A-secret')
    useAiChatStore.getState().setSystemPrompt('You are agent A')
    useAiChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'hello A', timestamp: 1 }],
    })

    useAiChatStore.getState().switchToTab('tab-B')
    expect(useAiChatStore.getState().provider).not.toBe('anthropic')
    expect(useAiChatStore.getState().apiKey).not.toBe('sk-A-secret')
    expect(useAiChatStore.getState().systemPrompt).not.toBe('You are agent A')
    expect(useAiChatStore.getState().messages).toHaveLength(0)

    useAiChatStore.getState().setProvider('google')
    useAiChatStore.getState().setApiKey('sk-B')

    useAiChatStore.getState().switchToTab('tab-A')
    expect(useAiChatStore.getState().provider).toBe('anthropic')
    expect(useAiChatStore.getState().apiKey).toBe('sk-A-secret')
    expect(useAiChatStore.getState().systemPrompt).toBe('You are agent A')
    expect(useAiChatStore.getState().messages).toHaveLength(1)
    expect(useAiChatStore.getState().messages[0].content).toBe('hello A')
  })

  it('removeTabState(A) leaves tab B intact', () => {
    const s = useAiChatStore.getState()
    s.switchToTab('tab-A')
    useAiChatStore.getState().setApiKey('sk-A')
    useAiChatStore.getState().switchToTab('tab-B')
    useAiChatStore.getState().setApiKey('sk-B')

    useAiChatStore.getState().removeTabState('tab-A')

    expect(useAiChatStore.getState().apiKey).toBe('sk-B')
    expect(useAiChatStore.getState()._tabStates.has('tab-A')).toBe(false)
  })
})
