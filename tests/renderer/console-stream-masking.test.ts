/**
 * Issue #196 — Console entries the renderer MIRRORS from inbound streams
 * (`initConsoleListeners`: WebSocket, SSE, gRPC, GraphQL, Socket.IO) never
 * passed through main's Console logger, so a secret pushed by the server (or
 * echoed back) showed raw. They now go through main's mask (`console:maskEntry`,
 * same helper + same session toggle); a failed mask call hides, never shows raw.
 *
 * Fail-before: the listeners called `addEntry` directly — `maskEntry` was never
 * invoked and the raw secret landed in the store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addMaskedEntry,
  initConsoleListeners,
  useConsoleStore,
} from '../../src/renderer/stores/console.store'
import { createScrubber, maskConsoleEntry } from '../../src/main/lib/sensitive-scrub'
import { HISTORY_MASK } from '../../src/shared/credential-headers'

const SECRET = 'stream-S3CRET-token-55'

type Listener = (ev: unknown) => void
const listeners: Record<string, Listener> = {}
const on = (name: string) => (cb: Listener) => {
  listeners[name] = cb
  return () => undefined
}

let showSecrets = false
let failMask = false

function installApi(): ReturnType<typeof vi.fn> {
  const maskEntry = vi.fn(async (entry: unknown) => {
    if (failMask) return { success: false, error: 'boom' }
    // Stand-in for main: the same helper, honouring the session toggle.
    return {
      success: true,
      data: showSecrets ? entry : maskConsoleEntry(entry as never, createScrubber([SECRET])),
    }
  })
  ;(window as unknown as { api: unknown }).api = {
    console: { onLog: on('log'), maskEntry },
    ws: { onEvent: on('ws') },
    sse: { onEvent: on('sse') },
    grpc: { onStreamEvent: on('grpc') },
    graphql: { onSubscriptionEvent: on('graphql') },
    socketio: { onEvent: on('socketio') },
  }
  return maskEntry
}

const entriesText = (): string => JSON.stringify(useConsoleStore.getState().entries)

async function settle(n: number): Promise<void> {
  await vi.waitFor(() => expect(useConsoleStore.getState().entries.length).toBe(n))
}

beforeEach(() => {
  showSecrets = false
  failMask = false
  useConsoleStore.setState({ entries: [] })
})

describe('mirrored stream entries are masked (issue #196)', () => {
  it('WS, SSE, gRPC, GraphQL and Socket.IO data carrying a secret reach the Console masked', async () => {
    const maskEntry = installApi()
    const stop = initConsoleListeners()
    listeners.ws({ type: 'message', data: `{"token":"${SECRET}"}` })
    listeners.sse({ type: 'event', eventType: 'msg', data: `auth ${SECRET}` })
    listeners.grpc({ type: 'data', data: `{"t":"${SECRET}"}` })
    listeners.graphql({ type: 'data', data: `{"t":"${SECRET}"}` })
    listeners.socketio({ direction: 'in', event: 'hello', data: { t: SECRET } })
    await settle(5)
    expect(maskEntry).toHaveBeenCalledTimes(5)
    expect(entriesText()).not.toContain(SECRET)
    expect(entriesText()).toContain(HISTORY_MASK)
    stop()
  })

  it('with "Show secrets" on, NEW stream entries arrive raw', async () => {
    installApi()
    initConsoleListeners()
    listeners.ws({ type: 'message', data: `masked ${SECRET}` })
    await settle(1)
    showSecrets = true
    listeners.ws({ type: 'message', data: `raw ${SECRET}` })
    await settle(2)
    const [first, second] = useConsoleStore.getState().entries
    expect(JSON.stringify(first)).not.toContain(SECRET)
    expect(second.details?.responseBody).toBe(`raw ${SECRET}`)
  })

  it('a failed mask call hides the data rather than showing it raw', async () => {
    installApi()
    failMask = true
    initConsoleListeners()
    listeners.sse({ type: 'error', data: `failed with ${SECRET}` })
    listeners.ws({ type: 'message', data: SECRET })
    await settle(2)
    expect(entriesText()).not.toContain(SECRET)
  })
})

describe('preview truncation happens on the MASKED text (issue #196 review)', () => {
  it('a secret straddling the 80-char preview cut leaves no fragment in the message', async () => {
    installApi()
    initConsoleListeners()
    // `{"p":"` (6) + 60 chars + `","x":"` (7) starts SECRET at 73 — across the 80-char cut.
    const data = `{"p":"${'a'.repeat(60)}","x":"${SECRET}"}`
    listeners.ws({ type: 'message', data })
    listeners.grpc({ type: 'data', data })
    listeners.graphql({ type: 'data', data })
    await settle(3)
    for (const e of useConsoleStore.getState().entries) {
      expect(e.message).not.toContain(SECRET.slice(0, 6))
      expect(e.message?.length).toBeLessThanOrEqual(100)
    }
  })

  it('a credential-named field in a stream frame is masked in the preview and the body', async () => {
    installApi()
    initConsoleListeners()
    listeners.ws({ type: 'message', data: '{"token":"name-rule-tok-123"}' })
    await settle(1)
    expect(entriesText()).not.toContain('name-rule-tok-123')
  })

  it('a failed mask hides url, statusText, eventName and header values too', async () => {
    installApi()
    failMask = true
    addMaskedEntry({
      protocol: 'http',
      level: 'info',
      category: 'system',
      url: `https://x.test/?k=${SECRET}`,
      statusText: `err ${SECRET}`,
      message: 'm',
      details: {
        eventName: `ev-${SECRET}`,
        requestHeaders: { 'X-Custom': SECRET },
        responseHeaders: { 'X-Echo': SECRET },
      },
    })
    await settle(1)
    expect(entriesText()).not.toContain(SECRET)
    const e = useConsoleStore.getState().entries[0]
    expect(e.details?.requestHeaders).toEqual({ 'X-Custom': HISTORY_MASK })
  })
})
