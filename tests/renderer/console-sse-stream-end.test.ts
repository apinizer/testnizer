/**
 * Issue #226 P2 — a normal end of an SSE stream is not an error.
 *
 * A finite stream ends like this on the wire: the server ends the response,
 * `eventsource@3` reconnects (main: a message-less error marked
 * `streamEnded`), the reconnect gets HTTP 204 "stop reconnecting" (main:
 * `closed: 'ended'`). The Console logged both as "SSE error" and the footer
 * showed a red error badge on a clean run.
 *
 * Now: the end of the response and the server's close are info entries; a
 * terminal failure (`closed: 'failed'`) and a transient network error that
 * carries a message stay errors.
 * Fail-before: every SSE `error` payload became a level 'error' "SSE error".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initConsoleListeners, useConsoleStore } from '../../src/renderer/stores/console.store'

type Listener = (ev: unknown) => void
let sse: Listener = () => {}

beforeEach(() => {
  useConsoleStore.setState({ entries: [] })
  ;(window as unknown as { api: unknown }).api = {
    console: { onLog: () => () => undefined },
    sse: {
      onEvent: (cb: Listener) => {
        sse = cb
        return () => undefined
      },
    },
  }
})

const entries = () => useConsoleStore.getState().entries
const errors = () => entries().filter((e) => e.level === 'error')

describe('Console — SSE end of stream (issue #226)', () => {
  it('end of the response → reconnect → 204: no error entry, the close is logged as info', async () => {
    const stop = initConsoleListeners()
    sse({ connectionId: 'c1', type: 'event', eventType: 'message', data: 'last', id: '3' })
    sse({
      connectionId: 'c1',
      type: 'error',
      data: 'The server ended the response; reconnecting',
      streamEnded: true,
    })
    sse({
      connectionId: 'c1',
      type: 'error',
      data: 'HTTP 204 Server sent HTTP 204, not reconnecting',
      httpStatus: 204,
      closed: 'ended',
    })
    await vi.waitFor(() => expect(entries()).toHaveLength(3))
    expect(errors()).toEqual([])
    const [, ended, closed] = entries()
    expect(ended).toMatchObject({ level: 'info', message: 'SSE response ended — reconnecting' })
    expect(closed).toMatchObject({
      level: 'info',
      message: 'SSE stream closed by the server (HTTP 204)',
    })
    stop()
  })

  it('the fetch path’s clean end is an info "closed by the server" too', async () => {
    initConsoleListeners()
    sse({ connectionId: 'c1', type: 'error', data: 'SSE stream closed', closed: 'ended' })
    await vi.waitFor(() => expect(entries()).toHaveLength(1))
    expect(entries()[0]).toMatchObject({
      level: 'info',
      message: 'SSE stream closed by the server',
    })
  })

  it('a terminal failure and a transient network error stay errors', async () => {
    initConsoleListeners()
    sse({
      connectionId: 'c1',
      type: 'error',
      data: 'HTTP 503 Service Unavailable',
      httpStatus: 503,
      closed: 'failed',
    })
    sse({ connectionId: 'c1', type: 'error', data: 'Connection refused — ECONNREFUSED' })
    await vi.waitFor(() => expect(entries()).toHaveLength(2))
    expect(errors()).toHaveLength(2)
    expect(errors().map((e) => e.details?.error?.message)).toEqual([
      'HTTP 503 Service Unavailable',
      'Connection refused — ECONNREFUSED',
    ])
  })
})
