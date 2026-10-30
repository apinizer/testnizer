/**
 * Issue #257 (item: external default URLs) — a NEW WebSocket / SSE / GraphQL
 * tab used to start prefilled with a real external host
 * (wss://echo.websocket.org, https://stream.wikimedia.org/...,
 * https://countries.trevorblades.com/graphql). Socket.IO and MCP start empty;
 * the three now match them: EMPTY url + a placeholder example in the field.
 *
 * CONTRACT:
 *   websocket.store / sse.store / graphql.store `emptyTabState().url === ''`
 *   (so `switchToTab(<new id>)`, `reset()` and the "no cached slice" fallbacks
 *   all give ''). Saved requests keep their URL: `restoreProtocolFromMetadata`
 *   with a saved url must produce that url, and a saved EMPTY url must stay
 *   empty (not be refilled with an example).
 *   The URL inputs (`ws-url`, `sse-url`, `graphql-url`) carry a non-empty
 *   placeholder that is NOT a real third-party host the user did not type
 *   (placeholders may use example.com); Connect/Run stay disabled while empty
 *   (already so — guard).
 *
 * Existing fixtures that set the url explicitly (tab-state-isolation,
 * protocol-screens) are unaffected.
 *
 * Red now: three stores default to the external hosts.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => null,
}))
vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))
;(window as unknown as { api: unknown }).api = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)

import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { restoreProtocolFromMetadata } from '../../src/renderer/lib/save-active-request'
import WsConnectionBar from '../../src/renderer/components/protocols/WsConnectionBar'
import SseConnectionBar from '../../src/renderer/components/protocols/SseConnectionBar'
import GraphQLQueryPane from '../../src/renderer/components/protocols/GraphQLQueryPane'
import type { Tab } from '../../src/renderer/types'

const EXTERNAL = /echo\.websocket\.org|wikimedia|trevorblades/

beforeEach(() => {
  useWebSocketStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useSseStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useGraphQLStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useTabsStore.setState({ tabs: [], activeTabId: null })
})
afterEach(() => cleanup())

describe('a new tab starts with an empty URL', () => {
  it('WebSocket', () => {
    useWebSocketStore.getState().switchToTab('ws-new')
    expect(useWebSocketStore.getState().url).toBe('')
  })
  it('SSE', () => {
    useSseStore.getState().switchToTab('sse-new')
    expect(useSseStore.getState().url).toBe('')
  })
  it('GraphQL', () => {
    useGraphQLStore.getState().switchToTab('gql-new')
    expect(useGraphQLStore.getState().url).toBe('')
  })
  it('reset() gives the same empty state', () => {
    useWebSocketStore.getState().setUrl('wss://x.test')
    useSseStore.getState().setUrl('https://x.test/s')
    useGraphQLStore.getState().setUrl('https://x.test/g')
    useWebSocketStore.getState().reset()
    useSseStore.getState().reset()
    useGraphQLStore.getState().reset()
    expect(useWebSocketStore.getState().url).toBe('')
    expect(useSseStore.getState().url).toBe('')
    expect(useGraphQLStore.getState().url).toBe('')
  })
  it('a brand-new second tab is empty even after another tab got a URL', () => {
    useWebSocketStore.getState().switchToTab('a')
    useWebSocketStore.getState().setUrl('wss://mine.test/live')
    useWebSocketStore.getState().switchToTab('b')
    expect(useWebSocketStore.getState().url).toBe('')
    useWebSocketStore.getState().switchToTab('a')
    expect(useWebSocketStore.getState().url).toBe('wss://mine.test/live')
  })
})

describe('the field shows an example placeholder, never a real host as a value', () => {
  it('ws-url', () => {
    useWebSocketStore.getState().switchToTab('ws-new')
    render(<WsConnectionBar />)
    const input = screen.getByTestId('ws-url') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).not.toBe('')
    expect(screen.getByTestId('ws-connect')).toBeDisabled()
  })
  it('sse-url', () => {
    useSseStore.getState().switchToTab('sse-new')
    render(<SseConnectionBar />)
    const input = screen.getByTestId('sse-url') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).not.toBe('')
    expect(screen.getByTestId('sse-connect')).toBeDisabled()
  })
  it('graphql-url', () => {
    useGraphQLStore.getState().switchToTab('gql-new')
    render(<GraphQLQueryPane />)
    const input = screen.getByTestId('graphql-url') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).not.toBe('')
    expect(screen.getByTestId('graphql-run')).toBeDisabled()
  })
  it('no input value anywhere is one of the old external hosts', () => {
    useWebSocketStore.getState().switchToTab('ws-new')
    render(<WsConnectionBar />)
    expect((screen.getByTestId('ws-url') as HTMLInputElement).value).not.toMatch(EXTERNAL)
  })
})

describe('saved requests keep their URL', () => {
  const tab = (id: string, protocol: string): Tab => ({ id, protocol }) as unknown as Tab

  it('WebSocket', () => {
    useTabsStore.setState({ tabs: [tab('w1', 'websocket')], activeTabId: 'w1' })
    restoreProtocolFromMetadata('websocket', {
      websocket: { url: 'wss://saved.test/live', customHeaders: [], composerContent: '' },
    })
    expect(useWebSocketStore.getState().url).toBe('wss://saved.test/live')
  })
  it('SSE', () => {
    useTabsStore.setState({ tabs: [tab('s1', 'sse')], activeTabId: 's1' })
    restoreProtocolFromMetadata('sse', {
      sse: { url: 'https://saved.test/events', method: 'GET', customHeaders: [] },
    })
    expect(useSseStore.getState().url).toBe('https://saved.test/events')
  })
  it('GraphQL', () => {
    useTabsStore.setState({ tabs: [tab('g1', 'graphql')], activeTabId: 'g1' })
    restoreProtocolFromMetadata('graphql', {
      graphql: { url: 'https://saved.test/graphql', query: 'query { a }', variables: '{}' },
    })
    expect(useGraphQLStore.getState().url).toBe('https://saved.test/graphql')
  })
  it('a saved EMPTY url is not refilled with an example', () => {
    useTabsStore.setState({ tabs: [tab('w2', 'websocket')], activeTabId: 'w2' })
    restoreProtocolFromMetadata('websocket', {
      websocket: { url: '', customHeaders: [], composerContent: '' },
    })
    expect(useWebSocketStore.getState().url).toBe('')
  })
})
