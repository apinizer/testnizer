/**
 * The subscription UI: the action button, what Enter does, and the log's account
 * of a subscription that is running, failed or ended.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

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
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'

const SUBSCRIPTION = '# feed\nsubscription { tick }'
const subscribe = vi.fn(async () => {})
const unsubscribe = vi.fn(async () => {})
const executeQuery = vi.fn(async () => {})
const original = useGraphQLStore.getState()

function show(patch: Record<string, unknown>): void {
  useGraphQLStore.setState({
    url: 'ws://a.test/graphql',
    query: SUBSCRIPTION,
    subscribe,
    unsubscribe,
    executeQuery,
    ...patch,
  })
  render(<GraphQLEditor />)
}

const event = (id: string, kind: string, data: string) => ({ id, kind, data, timestamp: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
  useGraphQLStore.setState({
    subscriptionState: 'disconnected',
    subscriptionEvents: [],
    subscriptionDropped: 0,
    subscriptionError: null,
    subscriptionEnd: null,
    connectionId: null,
    connectionInit: '',
    headers: [],
    variables: '',
  })
})

afterEach(() => {
  cleanup()
  useGraphQLStore.setState({
    subscribe: original.subscribe,
    unsubscribe: original.unsubscribe,
    executeQuery: original.executeQuery,
    query: '',
    url: '',
  })
})

describe('the action button', () => {
  it('a subscription offers Subscribe; Enter subscribes rather than POSTing', () => {
    show({})
    expect(screen.getByTestId('graphql-subscribe').textContent).toBe('Subscribe')
    expect(screen.queryByTestId('graphql-run')).toBeNull()
    fireEvent.keyDown(screen.getByTestId('graphql-url'), { key: 'Enter' })
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(executeQuery).not.toHaveBeenCalled()
  })

  it('while connecting it cancels, once running it unsubscribes; Enter does not end it', () => {
    show({ subscriptionState: 'connecting' })
    expect(screen.getByTestId('graphql-subscribe').textContent).toBe('Cancel')
    cleanup()
    show({ subscriptionState: 'connected', connectionId: 'c' })
    const button = screen.getByTestId('graphql-subscribe')
    expect(button.textContent).toBe('Unsubscribe')
    fireEvent.keyDown(screen.getByTestId('graphql-url'), { key: 'Enter' })
    expect(unsubscribe).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('a running subscription keeps its control and log while the query is edited', () => {
    show({ subscriptionState: 'connected', connectionId: 'c', query: '{ hello }' })
    expect(screen.getByTestId('graphql-subscribe').textContent).toBe('Unsubscribe')
    expect(screen.getByTestId('graphql-subscription-log')).toBeTruthy()
  })

  it('a query has the Run button and no connection_init field', () => {
    show({ query: '{ hello }' })
    expect(screen.getByTestId('graphql-run')).toBeTruthy()
    expect(screen.queryByTestId('graphql-connection-init-toggle')).toBeNull()
  })
})

describe('connection_init field', () => {
  it('opens beside Variables and writes to the store', () => {
    show({})
    fireEvent.click(screen.getByTestId('graphql-connection-init-toggle'))
    const editor = screen.getByTestId('graphql-connection-init-editor').querySelector('textarea')
    fireEvent.change(editor as HTMLTextAreaElement, { target: { value: '{"a":1}' } })
    expect(useGraphQLStore.getState().connectionInit).toBe('{"a":1}')
  })
})

describe('the log', () => {
  it('shows nothing of a subscription that never started', () => {
    show({})
    expect(screen.queryByTestId('graphql-subscription-log')).toBeNull()
  })

  it('a live subscription shows its events by kind, and how many the cap dropped', () => {
    show({
      subscriptionState: 'connected',
      connectionId: 'c',
      subscriptionDropped: 2,
      subscriptionEvents: [event('1', 'data', '{"n":1}'), event('2', 'error', 'bad')],
    })
    const rows = screen.getAllByTestId('graphql-subscription-event')
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['data', 'error'])
    expect(screen.getByTestId('graphql-subscription-status').textContent).toBe('Live')
    expect(screen.getByTestId('graphql-subscription-count').textContent).toContain(
      '2 older events dropped',
    )
    fireEvent.click(screen.getByTestId('graphql-unsubscribe'))
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('a failure is an alert, with no invented row and nothing to unsubscribe', () => {
    show({ subscriptionState: 'error', subscriptionError: 'Connection refused' })
    expect(screen.getByRole('alert').textContent).toBe('Connection refused')
    expect(screen.getByTestId('graphql-subscription-status').textContent).toBe('Failed')
    expect(screen.queryByTestId('graphql-subscription-event')).toBeNull()
    expect(screen.queryByTestId('graphql-unsubscribe')).toBeNull()
  })

  it('an end says why, and keeps the events it delivered', () => {
    show({
      subscriptionEnd: { kind: 'closed', code: 4401 },
      subscriptionEvents: [event('1', 'data', 'kept')],
    })
    expect(screen.getByTestId('graphql-subscription-end').textContent).toContain(
      '4401: Unauthorized',
    )
    expect(screen.getByTestId('graphql-subscription-status').textContent).toBe('Ended')
    expect(screen.getAllByTestId('graphql-subscription-event')).toHaveLength(1)
  })
})
