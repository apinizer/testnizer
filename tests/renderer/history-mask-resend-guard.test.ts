/**
 * Issue #195 follow-up — a History mask (`••••••`) must never be re-sent
 * unknowingly.
 *
 *  1. Reopening a row names the field INSIDE a text in the "enter them again"
 *     note: `body.password`, `variables.password`, `composerContent.token`,
 *     `emitPayload.auth.apiKey`, `envelope.Password` — not the slot
 *     (`body.content`, `variables`).
 *  2. Send refuses — inline error naming the field — while the mask is still
 *     in a credential-named field of the outgoing request: HTTP, GraphQL,
 *     WebSocket (connect + message), Socket.IO (connect + emit), SOAP.
 *
 * Fail-before: `hidden` held only the slot path, and every Send path put the
 * dots on the wire (`request:send` / `ws.send` / `socketio.emit` called).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HISTORY_MASK } from '../../src/shared/credential-headers'
import { findMaskedCredentials, maskedPathsInText } from '../../src/shared/masked-credentials'
import {
  httpHistoryRestore,
  protocolHistoryRestore,
  unmaskHistoryValue,
} from '../../src/renderer/lib/history-restore'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'

const M = HISTORY_MASK

function row(protocol: string, snapshot: unknown) {
  return { url: 'https://x.test', method: 'POST', protocol, request_snapshot: snapshot } as never
}

describe('History reopen names the masked field inside a text (issue #195)', () => {
  it('HTTP JSON body → body.password (and the mask is emptied)', () => {
    const r = httpHistoryRestore(
      row('http', {
        configured: {
          method: 'POST',
          url: 'https://x.test/login',
          body: { type: 'json', content: `{\n  "user": "a",\n  "password": "${M}"\n}` },
        },
      }),
    )
    expect(r.hidden).toEqual(['body.password'])
    expect(r.body?.content).toBe('{\n  "user": "a",\n  "password": ""\n}')
  })

  it('GraphQL variables → variables.password', () => {
    const r = protocolHistoryRestore(
      row('graphql', {
        configured: {
          meta: { graphql: { url: 'u', query: 'q', variables: `{"input":{"password":"${M}"}}` } },
        },
      }),
      'graphql',
    )
    expect(r.hidden).toEqual(['variables.input.password'])
  })

  it('WebSocket composer → composerContent.token; Socket.IO → emitPayload.auth.apiKey', () => {
    const ws = protocolHistoryRestore(
      row('websocket', {
        configured: {
          meta: { websocket: { url: 'wss://x', composerContent: `{"token":"${M}"}` } },
        },
      }),
      'websocket',
    )
    expect(ws.hidden).toEqual(['composerContent.token'])
    const sio = protocolHistoryRestore(
      row('socketio', {
        configured: {
          meta: { socketio: { url: 'https://x', emitPayload: `{"auth":{"apiKey":"${M}"}}` } },
        },
      }),
      'socketio',
    )
    expect(sio.hidden).toEqual(['emitPayload.auth.apiKey'])
  })

  it('SOAP params (nested) and the envelope', () => {
    const hidden: string[] = []
    unmaskHistoryValue(
      {
        params: { Login: { Credentials: { Username: 'bob', Password: M } } },
        envelope: `<s:Envelope><s:Body><wsse:Password Type="x">${M}</wsse:Password></s:Body></s:Envelope>`,
      },
      '',
      hidden,
    )
    expect(hidden).toEqual(['params.Login.Credentials.Password', 'envelope.Password'])
  })

  it('a query param in a URL → url.api_key', () => {
    expect(maskedPathsInText(`https://x/?a=1&api_key=${M}`, 'url')).toEqual(['url.api_key'])
  })
})

describe('findMaskedCredentials', () => {
  it('only credential-named fields count; disabled rows are ignored', () => {
    expect(findMaskedCredentials({ body: { content: `{"note":"${M}"}` } })).toEqual([])
    expect(
      findMaskedCredentials({
        headers: [{ key: 'Authorization', value: `Bearer ${M}`, enabled: false }],
      }),
    ).toEqual([])
    expect(
      findMaskedCredentials({
        url: `https://${M}@h.test/?token=${M}`,
        headers: [{ key: 'X-API-Key', value: M, enabled: true }],
        auth: { bearer: { token: M } },
      }),
    ).toEqual(['url.token', 'url (user:password@)', 'headers.X-API-Key', 'auth.bearer.token'])
  })

  it('a templated (non-JSON) body still names the field', () => {
    expect(findMaskedCredentials({ body: { content: `{"password":"${M}","n":{{n}}}` } })).toEqual([
      'body.password',
    ])
  })
})

// ─── Send refuses ───────────────────────────────────────────────

const requestSend = vi.fn(async () => ({ success: true, data: {} }))
const wsSend = vi.fn(async () => ({ success: true }))
const wsConnect = vi.fn(async () => ({ success: true, data: { connectionId: 'c' } }))
const sioEmit = vi.fn(async () => ({ success: true }))
const sioConnect = vi.fn(async () => ({ success: true, data: { connectionId: 'c' } }))

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = {
    request: { send: requestSend, cancel: vi.fn() },
    ws: { send: wsSend, connect: wsConnect, onEvent: () => () => undefined },
    socketio: { emit: sioEmit, connect: sioConnect, onEvent: () => () => undefined },
    settings: { get: vi.fn(async () => ({ success: false })) },
  }
})

const responseError = (): string | undefined => useResponseStore.getState().response?.error

describe('Send refuses while a History mask is in a credential field (issue #195)', () => {
  it('HTTP: JSON body password', async () => {
    useRequestStore.setState({
      method: 'POST',
      url: 'https://x.test/login',
      params: [],
      headers: [],
      body: { type: 'json', content: `{"user":"a","password":"${M}"}` },
      auth: { type: 'none' },
    })
    await useRequestStore.getState().sendRequest()
    expect(requestSend).not.toHaveBeenCalled()
    expect(responseError()).toContain('body.password')
  })

  it('GraphQL: variables.password', async () => {
    useGraphQLStore.setState({
      url: 'https://x.test/graphql',
      query: 'mutation { login }',
      variables: `{"password":"${M}"}`,
      headers: [],
    })
    await useGraphQLStore.getState().executeQuery()
    expect(requestSend).not.toHaveBeenCalled()
    expect(responseError()).toContain('variables.password')
  })

  it('WebSocket: connect with a masked header, then a masked composer message', async () => {
    useWebSocketStore.setState({
      url: 'wss://x.test',
      customHeaders: [{ id: 'h', key: 'Authorization', value: `Bearer ${M}`, enabled: true }],
      connectionState: 'disconnected',
    })
    await useWebSocketStore.getState().connect()
    expect(wsConnect).not.toHaveBeenCalled()
    expect(useWebSocketStore.getState().errorMessage).toContain('customHeaders.Authorization')

    useWebSocketStore.setState({
      connectionState: 'connected',
      connectionId: 'c',
      composerContent: `{"type":"auth","token":"${M}"}`,
      errorMessage: null,
    })
    await useWebSocketStore.getState().sendMessage()
    expect(wsSend).not.toHaveBeenCalled()
    expect(useWebSocketStore.getState().errorMessage).toContain('composerContent.token')
  })

  it('Socket.IO: masked bearer token on connect, masked emit payload', async () => {
    useSocketIOStore.setState({
      url: 'https://x.test',
      bearerToken: M,
      connectionState: 'disconnected',
    })
    await useSocketIOStore.getState().connect()
    expect(sioConnect).not.toHaveBeenCalled()
    expect(useSocketIOStore.getState().errorMessage).toContain('bearerToken')

    useSocketIOStore.setState({
      connectionState: 'connected',
      connectionId: 'c',
      emitEvent: 'login',
      emitPayload: `{"auth":{"apiKey":"${M}"}}`,
      errorMessage: null,
    })
    await useSocketIOStore.getState().emit()
    expect(sioEmit).not.toHaveBeenCalled()
    expect(useSocketIOStore.getState().errorMessage).toContain('emitPayload.auth.apiKey')
  })

  it('SOAP: masked Password in the envelope', async () => {
    useSoapStore.setState({
      mode: 'manual',
      endpointUrl: 'https://soap.test/svc',
      rawXml: `<Envelope><Body><Login><Password>${M}</Password></Login></Body></Envelope>`,
    })
    await useSoapStore.getState().sendSoap()
    expect(requestSend).not.toHaveBeenCalled()
    expect(responseError()).toContain('envelope.Password')
  })

  it('a real value sends normally (no false positive)', async () => {
    useRequestStore.setState({
      method: 'POST',
      url: 'https://x.test/login',
      params: [],
      headers: [],
      body: { type: 'json', content: '{"user":"a","password":"real-pw"}' },
      auth: { type: 'none' },
    })
    await useRequestStore.getState().sendRequest()
    expect(requestSend).toHaveBeenCalled()
  })
})
