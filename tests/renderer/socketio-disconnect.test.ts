/**
 * #21 — Socket.io disconnect must NOT wipe the request configuration. Before
 * the fix, disconnect() reset to emptyState() keeping only url/namespace/
 * bearerToken, so the configured emit event/payload + subscriptions were lost
 * on every connect→disconnect cycle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'

beforeEach(() => {
  ;(globalThis as unknown as { window: { api: unknown } }).window = {
    api: {
      socketio: {
        disconnect: vi.fn(async () => ({ success: true })),
        cancelConnect: vi.fn(async () => ({ success: true })),
      },
    },
  }
})

describe('socketio.store.disconnect (#21)', () => {
  it('preserves emit event/payload + subscriptions across disconnect', async () => {
    useSocketIOStore.setState({
      ...useSocketIOStore.getState(),
      url: 'wss://example.test',
      namespace: '/ns',
      bearerToken: 'tok',
      emitEvent: 'chat',
      emitPayload: '{"a":1}',
      subscriptions: ['evtA', 'evtB'],
      newSubscription: 'draft',
      connectionId: 'c1',
      connectionState: 'connected',
    })

    await useSocketIOStore.getState().disconnect()

    const s = useSocketIOStore.getState()
    expect(s.connectionState).toBe('disconnected')
    // request-model config survives
    expect(s.emitEvent).toBe('chat')
    expect(s.emitPayload).toBe('{"a":1}')
    expect(s.subscriptions).toEqual(['evtA', 'evtB'])
    expect(s.newSubscription).toBe('draft')
    expect(s.url).toBe('wss://example.test')
    expect(s.namespace).toBe('/ns')
  })
})
