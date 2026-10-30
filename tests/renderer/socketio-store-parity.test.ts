/**
 * Issue #283 — Socket.IO request model in the store: what is saved, what an
 * old saved request opens as, what reaches the connection, what never reaches
 * localStorage.
 *
 * Fail-before (pre-#283): handshake headers were never passed to `connect`;
 * there was no Params / Settings / listener model, a single payload, no ack,
 * no saved messages.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import {
  restoreProtocolFromMetadata,
  snapshotProtocol,
} from '../../src/renderer/lib/save-active-request'
import type { Tab } from '../../src/renderer/types'

const connect = vi.fn(async () => ({ success: true, data: { connectionId: 'c1' } }))
const emitArgs = vi.fn(async () => ({ success: true }))
const setListen = vi.fn(async () => ({ success: true }))

beforeEach(() => {
  connect.mockClear()
  emitArgs.mockClear()
  setListen.mockClear()
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    socketio: {
      connect,
      emitArgs,
      setListen,
      disconnect: vi.fn(async () => ({ success: true })),
      cancelConnect: vi.fn(async () => ({ success: true })),
      onEvent: () => () => undefined,
      onClosed: () => () => undefined,
    },
  }
  useEnvironmentStore.setState({ getActiveVariables: () => ({ team: 'blue', who: 'ann' }) })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useSocketIOStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useSocketIOStore.getState().switchToTab('t-new')
})

const sio = () => useSocketIOStore.getState()
const tab = (id: string): Tab => ({ id, protocol: 'socketio' }) as unknown as Tab

function openTab(id: string): void {
  useTabsStore.setState({ tabs: [tab(id)], activeTabId: id })
}

describe('a new request', () => {
  it('follows Postman: only listened events, defaults = the pre-settings behaviour', () => {
    expect(sio().listenAll).toBe(false)
    expect(sio().settings).toEqual({
      strictSSL: true,
      handshakeTimeout: 10_000,
      retryCount: 0,
      retryDelay: 1_000,
      version: '4',
      path: '/socket.io',
      transport: 'auto',
    })
  })
})

describe('save → reopen', () => {
  it('round-trips every request field through the endpoint metadata', () => {
    const s = sio()
    s.setUrl('http://sio.test?room=1')
    s.addHeader()
    const hid = sio().customHeaders[sio().customHeaders.length - 1].id
    s.updateHeader(hid, { key: 'X-Team', value: '{{team}}' })
    s.setSettings({ retryCount: 2, path: '/io' })
    s.setNewListener('chat')
    s.addListener()
    s.setEmitEvent('join')
    s.setEmitAck(true)
    s.addArg()
    const aid = sio().emitArgs[1].id
    s.updateArg(aid, { content: 'AQI=', contentType: 'base64' })
    s.saveCurrentMessage()

    const meta = snapshotProtocol(tab('t-new')).protocolMeta
    openTab('t-reopen')
    restoreProtocolFromMetadata('socketio', JSON.parse(JSON.stringify(meta)))

    const r = sio()
    expect(r._currentTabId).toBe('t-reopen')
    expect(r.url).toBe('http://sio.test?room=1')
    expect(r.params.map((p) => [p.key, p.value])).toEqual([['room', '1']])
    expect(r.customHeaders.some((h) => h.key === 'X-Team' && h.value === '{{team}}')).toBe(true)
    expect(r.settings).toMatchObject({ retryCount: 2, path: '/io' })
    expect(r.listeners.map((l) => [l.name, l.listen])).toEqual([['chat', true]])
    expect(r.listenAll).toBe(false)
    expect(r.emitAck).toBe(true)
    expect(r.emitArgs.map((a) => a.contentType)).toEqual(['json', 'base64'])
    expect(r.savedMessages).toHaveLength(1)
    expect(r.savedMessages[0]).toMatchObject({ eventName: 'join', acknowledgement: true })
  })

  it('an old saved request opens exactly as before: subscriptions listened, every event shown', () => {
    openTab('t-old')
    restoreProtocolFromMetadata('socketio', {
      socketio: {
        url: 'http://old.test',
        namespace: '/chat',
        bearerToken: '',
        subscriptions: ['a', 'b'],
        emitEvent: 'go',
        emitPayload: 'not json',
      },
    })
    const r = sio()
    expect(r.listenAll).toBe(true)
    expect(r.listeners.map((l) => [l.name, l.listen])).toEqual([
      ['a', true],
      ['b', true],
    ])
    expect(r.emitArgs.map((a) => [a.content, a.contentType])).toEqual([['not json', 'text']])
    expect(r.settings.retryCount).toBe(0)
    expect(r.customHeaders.every((h) => h.key === '')).toBe(true)
  })
})

describe('connect', () => {
  it('sends resolved headers, settings and the listen config (headers used to be dropped)', async () => {
    const s = sio()
    s.setUrl('http://sio.test')
    s.setHeaders([
      { id: 'h1', key: 'X-Team', value: '{{team}}', enabled: true },
      { id: 'h2', key: 'X-Off', value: 'x', enabled: false },
    ])
    s.setSettings({ path: '/{{who}}' })
    s.setNewListener('chat')
    s.addListener()
    await sio().connect()
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        extraHeaders: { 'X-Team': 'blue' },
        settings: expect.objectContaining({ path: '/ann' }),
        listen: { all: false, events: ['chat'] },
      }),
    )
  })

  it('a listener edit while connected updates the connection', async () => {
    sio().setUrl('http://sio.test')
    await sio().connect()
    sio().setListenAll(true)
    expect(setListen).toHaveBeenLastCalledWith('c1', { all: true, events: [] })
    sio().setNewListener('news')
    sio().addListener()
    expect(setListen).toHaveBeenLastCalledWith('c1', { all: true, events: ['news'] })
  })
})

describe('emit', () => {
  it('sends every argument resolved, with the ack flag; an empty name sends `message`', async () => {
    sio().setUrl('http://sio.test')
    await sio().connect()
    useSocketIOStore.setState({
      emitEvent: '  ',
      emitAck: true,
      emitArgs: [
        { id: 'a', content: '{"t":"{{team}}"}', contentType: 'json' },
        { id: 'b', content: 'ff00', contentType: 'hex' },
      ],
    })
    await sio().emit()
    expect(emitArgs).toHaveBeenCalledWith(
      'c1',
      'message',
      [
        { content: '{"t":"blue"}', contentType: 'json' },
        { content: 'ff00', contentType: 'hex' },
      ],
      { ack: true },
    )
  })

  it('shows the engine error (invalid JSON argument) on the tab', async () => {
    sio().setUrl('http://sio.test')
    await sio().connect()
    emitArgs.mockResolvedValueOnce({
      success: false,
      error: 'Argument 1 is not valid JSON',
    } as never)
    await sio().emit()
    expect(sio().errorMessage).toMatch(/not valid JSON/)
  })
})

describe('saved messages', () => {
  it('Save adds, then updates the loaded message; load / rename / delete', () => {
    const s = sio()
    s.setEmitEvent('ping')
    s.saveCurrentMessage()
    const id = sio().savedMessages[0].id
    expect(sio().activeSavedMessageId).toBe(id)
    sio().setEmitEvent('pong')
    sio().saveCurrentMessage()
    expect(sio().savedMessages).toHaveLength(1)
    expect(sio().savedMessages[0].eventName).toBe('pong')

    sio().addSavedMessage()
    expect(sio().savedMessages).toHaveLength(2)
    sio().loadSavedMessage(id)
    expect(sio().emitEvent).toBe('pong')
    sio().renameSavedMessage(id, 'Pong it')
    expect(sio().savedMessages[0].name).toBe('Pong it')
    sio().deleteSavedMessage(id)
    expect(sio().savedMessages).toHaveLength(1)
    expect(sio().activeSavedMessageId).not.toBe(id)
  })

  it('a received event is saved with its event name and every argument', () => {
    useSocketIOStore.setState({
      events: [
        {
          id: 'e1',
          direction: 'in',
          event: 'news',
          data: ['hi', { n: 1 }, { $binary: 'AQI=', size: 2 }],
          args: ['hi', { n: 1 }, { $binary: 'AQI=', size: 2 }],
          timestamp: 1,
        },
      ],
    })
    sio().saveTimelineEntry('e1')
    const m = sio().savedMessages[0]
    expect(m.eventName).toBe('news')
    expect(m.args.map((a) => [a.content, a.contentType])).toEqual([
      ['hi', 'text'],
      ['{\n  "n": 1\n}', 'json'],
      ['AQI=', 'base64'],
    ])
  })
})

describe('localStorage', () => {
  it('withholds literal credential headers / params / URL query; {{var}} values stay', () => {
    const s = sio()
    s.setUrl('http://sio.test?token=LIT-123&room=1')
    s.setHeaders([
      { id: 'h1', key: 'Authorization', value: 'Bearer LIT-456', enabled: true },
      { id: 'h2', key: 'X-Api-Key', value: '{{key}}', enabled: true },
    ])
    const stored = window.localStorage.getItem('testnizer-socketio') ?? ''
    expect(stored).not.toContain('LIT-123')
    expect(stored).not.toContain('LIT-456')
    expect(stored).toContain('{{key}}')
    expect(stored).toContain('room=1')
    // Memory keeps the values for the session.
    expect(sio().customHeaders[0].value).toBe('Bearer LIT-456')
  })

  it('tabs keep their own listeners and settings', () => {
    sio().setNewListener('a')
    sio().addListener()
    sio().setSettings({ retryCount: 5 })
    sio().switchToTab('t-other')
    expect(sio().listeners).toEqual([])
    expect(sio().settings.retryCount).toBe(0)
    sio().switchToTab('t-new')
    expect(sio().listeners.map((l) => l.name)).toEqual(['a'])
    expect(sio().settings.retryCount).toBe(5)
  })
})
