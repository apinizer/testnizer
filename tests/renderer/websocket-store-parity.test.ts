/**
 * Issue #282 — WebSocket request model in the store.
 *
 * Fail-before (pre-#282): no Params / Settings, `composerMode` only json |
 * text, a binary composer did not exist (the engine only sent text), received
 * binary frames were relabelled `text`, no saved messages, no connection rows,
 * and the TLS / timeout / reconnect / max size settings never reached connect.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import {
  restoreProtocolFromMetadata,
  snapshotProtocol,
} from '../../src/renderer/lib/save-active-request'
import type { Tab } from '../../src/renderer/types'

type WsEvt = Record<string, unknown> & { connectionId: string; type: string }
let handlers: Array<(e: WsEvt) => void>
const connect = vi.fn(async () => ({ success: true, data: { connectionId: 'w1' } }))
const send = vi.fn(async () => ({ success: true, data: true }))

beforeEach(() => {
  handlers = []
  connect.mockClear()
  send.mockClear()
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    ws: {
      connect,
      send,
      disconnect: vi.fn(async () => ({ success: true })),
      cancelConnect: vi.fn(async () => ({ success: true })),
      onEvent: (h: (e: WsEvt) => void) => {
        handlers.push(h)
        return () => (handlers = handlers.filter((x) => x !== h))
      },
    },
  }
  useEnvironmentStore.setState({ getActiveVariables: () => ({ host: 'h.test', tok: 'T1' }) })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useWebSocketStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useWebSocketStore.getState().switchToTab('w-new')
})

const ws = () => useWebSocketStore.getState()
const push = (e: Omit<WsEvt, 'timestamp'>): void =>
  handlers.slice().forEach((h) => h({ timestamp: Date.now(), ...e }))
const tab = (id: string): Tab => ({ id, protocol: 'websocket' }) as unknown as Tab

async function connected(): Promise<void> {
  ws().setUrl('ws://{{host}}/live')
  const p = ws().connect()
  push({ connectionId: 'w1', type: 'open' })
  await p
}

describe('save → reopen', () => {
  it('round-trips params, settings, format and saved messages', () => {
    ws().setUrl('ws://a.test/live?room=1')
    ws().setSettings({ strictSSL: false, maxPayload: 0, retryCount: 3 })
    ws().setComposerMode('xml')
    ws().setComposerContent('<a/>')
    ws().saveCurrentMessage()
    const meta = snapshotProtocol(tab('w-new')).protocolMeta

    useTabsStore.setState({ tabs: [tab('w-re')], activeTabId: 'w-re' })
    restoreProtocolFromMetadata('websocket', JSON.parse(JSON.stringify(meta)))
    const r = ws()
    expect(r._currentTabId).toBe('w-re')
    expect(r.params.map((p) => [p.key, p.value])).toEqual([['room', '1']])
    expect(r.settings).toMatchObject({ strictSSL: false, maxPayload: 0, retryCount: 3 })
    expect(r.composerMode).toBe('xml')
    expect(r.savedMessages.map((m) => [m.content, m.contentType])).toEqual([['<a/>', 'xml']])
  })

  it('an old saved request opens as before (json / text composer, default settings)', () => {
    useTabsStore.setState({ tabs: [tab('w-old')], activeTabId: 'w-old' })
    restoreProtocolFromMetadata('websocket', {
      websocket: {
        url: 'wss://old.test',
        customHeaders: [{ id: 'h', key: 'X-A', value: '1', enabled: true }],
        composerContent: 'hi',
        composerMode: 'text',
        autoScroll: false,
      },
    })
    const r = ws()
    expect(r.url).toBe('wss://old.test')
    expect(r.composerMode).toBe('text')
    expect(r.autoScroll).toBe(false)
    expect(r.settings).toEqual({
      strictSSL: true,
      handshakeTimeout: 15_000,
      retryCount: 0,
      retryDelay: 5_000,
      maxPayload: 100,
    })
    expect(r.savedMessages).toEqual([])
  })
})

describe('connect', () => {
  it('passes the settings and resolved URL / headers', async () => {
    ws().setHeaders([{ id: 'h', key: 'Authorization', value: 'Bearer {{tok}}', enabled: true }])
    ws().setSettings({ strictSSL: false, handshakeTimeout: 2000 })
    await connected()
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'ws://h.test/live',
        headers: { Authorization: 'Bearer T1' },
        settings: expect.objectContaining({ strictSSL: false, handshakeTimeout: 2000 }),
      }),
    )
    expect(ws().messages.map((m) => [m.direction, m.event])).toEqual([['system', 'connected']])
  })
})

describe('binary', () => {
  it('a hex message is sent as binary and logged as base64', async () => {
    await connected()
    useWebSocketStore.setState({ composerMode: 'hex', composerContent: 'de ad' })
    await ws().sendMessage()
    expect(send).toHaveBeenCalledWith('w1', 'de ad', { binary: 'hex' })
    const row = ws().messages[ws().messages.length - 1]
    expect(row).toMatchObject({ direction: 'sent', contentType: 'binary', content: '3q0=' })
  })

  it('invalid hex is refused in the editor, nothing is sent', async () => {
    await connected()
    useWebSocketStore.setState({ composerMode: 'hex', composerContent: 'zz' })
    await ws().sendMessage()
    expect(send).not.toHaveBeenCalled()
    expect(ws().errorMessage).toMatch(/hexadecimal/i)
  })

  it('a received binary frame stays binary', async () => {
    await connected()
    push({ connectionId: 'w1', type: 'message', data: 'AP8=', contentType: 'binary' })
    expect(ws().messages[ws().messages.length - 1]).toMatchObject({
      direction: 'received',
      contentType: 'binary',
      content: 'AP8=',
    })
  })
})

describe('connection rows', () => {
  it('reconnecting / reconnected / close land as system rows on the owning tab', async () => {
    await connected()
    ws().switchToTab('w-other')
    push({ connectionId: 'w1', type: 'reconnecting', attempt: 1, code: 1006 })
    push({ connectionId: 'w1', type: 'open', reconnected: true })
    push({ connectionId: 'w1', type: 'close', code: 1001, reason: 'away' })
    expect(ws().messages).toEqual([])
    const owner = ws()._tabStates.get('w-new')!
    expect(owner.messages.map((m) => m.event)).toEqual([
      'connected',
      'reconnecting',
      'reconnected',
      'disconnected',
    ])
    expect(owner.connectionState).toBe('disconnected')
    expect(owner.errorMessage).toBe('Closed (1001: away)')
  })
})

describe('saved messages', () => {
  it('save / update / load / delete, and save a logged binary frame as base64', async () => {
    ws().setComposerMode('text')
    ws().setComposerContent('one')
    ws().saveCurrentMessage()
    ws().setComposerContent('two')
    ws().saveCurrentMessage()
    expect(ws().savedMessages.map((m) => m.content)).toEqual(['two'])
    ws().addSavedMessage()
    expect(ws().composerContent).toBe('')
    ws().loadSavedMessage(ws().savedMessages[0].id)
    expect(ws().composerContent).toBe('two')
    ws().deleteSavedMessage(ws().savedMessages[0].id)
    expect(ws().savedMessages).toHaveLength(1)

    await connected()
    push({ connectionId: 'w1', type: 'message', data: 'AP8=', contentType: 'binary' })
    const rowId = ws().messages[ws().messages.length - 1].id
    ws().saveLoggedMessage(rowId)
    expect(ws().savedMessages[ws().savedMessages.length - 1]).toMatchObject({
      content: 'AP8=',
      contentType: 'base64',
    })
  })
})

describe('localStorage', () => {
  it('withholds literal credential params / headers; keeps {{var}}; memory keeps the value', () => {
    ws().setUrl('wss://a.test/live?api_key=LIT-1&x=1')
    ws().setHeaders([{ id: 'h', key: 'Authorization', value: 'Bearer LIT-2', enabled: true }])
    ws().addParam()
    const id = ws().params[ws().params.length - 1].id
    ws().updateParam(id, { key: 'token', value: '{{tok}}' })
    const stored = window.localStorage.getItem('testnizer-websocket') ?? ''
    expect(stored).not.toContain('LIT-1')
    expect(stored).not.toContain('LIT-2')
    expect(stored).toContain('{{tok}}')
    expect(ws().params.find((p) => p.key === 'api_key')?.value).toBe('LIT-1')
  })
})
