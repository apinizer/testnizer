/**
 * Socket.IO / WebSocket saved-request metadata across builds (issues #282 /
 * #283).
 *
 *   1. A row saved by THIS build opens on an OLDER one (a teammate pulling the
 *      shared project before upgrading). The old readers below are copied from
 *      `applyProtocolMetadata` as it was before the parity work (commit
 *      671bdee): they read only `subscriptions` / `emitPayload` and a
 *      `composerMode` of exactly 'json' | 'text'. Without the mirror keys the
 *      old build opened the request with no listened events and an empty emit
 *      body, and a WebSocket XML composer fell back to its default format.
 *   2. Reopen + re-save of an unchanged request writes the same row, so git's
 *      `sameExport` sees no change (no no-op "Auto-save" commit on switch).
 */
import { describe, it, expect, vi } from 'vitest'
import { makeElectronMock } from './handlers/helpers'
import {
  readSioMeta,
  readWsMeta,
  sioMetaOf,
  wsMetaOf,
  type SioRequestFields,
  type WsRequestFields,
} from '../../src/renderer/lib/realtime-meta'
import { DEFAULT_SIO_SETTINGS, DEFAULT_WS_SETTINGS } from '../../src/shared/realtime'

vi.mock('electron', () => {
  const base = makeElectronMock()
  return {
    ...base,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s, 'utf-8').reverse(),
      decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8'),
    },
  }
})
vi.mock('../../src/main/db/database', () => ({ getDb: () => undefined }))
class FakeStore {
  get(): unknown {
    return undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { sameExport } = await import('../../src/main/ipc/git.handler')

// ─── The pre-#282/#283 readers, verbatim in behaviour ────────────────────

interface OldSioState {
  url?: string
  namespace?: string
  bearerToken?: string
  emitEvent?: string
  emitPayload?: string
  subscriptions?: string[]
}
function oldReadSocketIO(s: Record<string, unknown>): OldSioState {
  const out: OldSioState = {}
  if (typeof s.url === 'string') out.url = s.url
  if (typeof s.namespace === 'string') out.namespace = s.namespace
  if (typeof s.bearerToken === 'string') out.bearerToken = s.bearerToken
  if (typeof s.emitEvent === 'string') out.emitEvent = s.emitEvent
  if (typeof s.emitPayload === 'string') out.emitPayload = s.emitPayload
  if (Array.isArray(s.subscriptions)) {
    out.subscriptions = s.subscriptions.filter((x): x is string => typeof x === 'string')
  }
  return out
}

interface OldWsState {
  url?: string
  headers?: unknown[]
  composerContent?: string
  composerMode?: 'json' | 'text'
  autoScroll?: boolean
}
function oldReadWebSocket(w: Record<string, unknown>): OldWsState {
  const out: OldWsState = {}
  if (typeof w.url === 'string') out.url = w.url
  if (Array.isArray(w.customHeaders)) out.headers = w.customHeaders
  if (typeof w.composerContent === 'string') out.composerContent = w.composerContent
  if (w.composerMode === 'json' || w.composerMode === 'text') out.composerMode = w.composerMode
  if (typeof w.autoScroll === 'boolean') out.autoScroll = w.autoScroll
  return out
}

/** What a row looks like once it went through the DB / project file. */
const roundTrip = <T>(v: T): Record<string, unknown> =>
  JSON.parse(JSON.stringify(v)) as Record<string, unknown>

// ─── Fixtures ───────────────────────────────────────────────────────────

function sioFields(): SioRequestFields {
  return {
    url: 'http://127.0.0.1:3000?room=a',
    namespace: '/chat',
    bearerToken: '{{token}}',
    customHeaders: [{ id: 'h1', key: 'X-Tenant', value: 't1', enabled: true }],
    params: [{ id: 'p1', key: 'room', value: 'a', enabled: true }],
    settings: { ...DEFAULT_SIO_SETTINGS, path: '/io', retryCount: 3 },
    listeners: [
      { id: 'l1', name: 'chat', description: 'room messages', listen: true },
      { id: 'l2', name: 'typing', description: '', listen: false },
      { id: 'l3', name: 'presence', description: '', listen: true },
    ],
    listenAll: false,
    emitEvent: 'chat',
    emitArgs: [
      { id: 'a1', content: '{"text":"hi"}', contentType: 'json' },
      { id: 'a2', content: 'second', contentType: 'text' },
    ],
    emitAck: true,
    savedMessages: [
      {
        id: 's1',
        name: 'hello',
        eventName: 'chat',
        acknowledgement: false,
        args: [{ id: 'a3', content: '"x"', contentType: 'json' }],
      },
    ],
  }
}

function wsFields(composerMode: WsRequestFields['composerMode']): WsRequestFields {
  return {
    url: 'ws://127.0.0.1:4000/echo?x=1',
    customHeaders: [{ id: 'h1', key: 'X-Tenant', value: 't1', enabled: true }],
    params: [{ id: 'p1', key: 'x', value: '1', enabled: true }],
    settings: { ...DEFAULT_WS_SETTINGS, handshakeTimeout: 5000 },
    composerContent: '<ping/>',
    composerMode,
    autoScroll: false,
    savedMessages: [{ id: 'm1', name: 'ping', content: '<ping/>', contentType: 'xml' }],
  }
}

// ─── 1. Old build reads a new row ───────────────────────────────────────

describe('a row saved by the new editors opens on a pre-#283 build (Socket.IO)', () => {
  it('the old reader gets the listened names and the first argument', () => {
    const old = oldReadSocketIO(roundTrip(sioMetaOf(sioFields())))
    expect(old).toEqual({
      url: 'http://127.0.0.1:3000?room=a',
      namespace: '/chat',
      bearerToken: '{{token}}',
      emitEvent: 'chat',
      emitPayload: '{"text":"hi"}',
      subscriptions: ['chat', 'presence'],
    })
  })

  it('no arguments → an empty emit body; blank listener names are not subscriptions', () => {
    const f = sioFields()
    f.emitArgs = []
    f.listeners = [{ id: 'l1', name: '  ', description: '', listen: true }]
    const old = oldReadSocketIO(roundTrip(sioMetaOf(f)))
    expect(old.emitPayload).toBe('')
    expect(old.subscriptions).toEqual([])
  })

  it('the new reader still prefers listeners / emitArgs over the mirrors', () => {
    const read = readSioMeta(roundTrip(sioMetaOf(sioFields())))
    expect(read.listeners).toEqual(sioFields().listeners)
    expect(read.emitArgs).toEqual(sioFields().emitArgs)
    expect(read.listenAll).toBe(false)
  })
})

describe('a row saved by the new editor opens on a pre-#282 build (WebSocket)', () => {
  it.each([
    ['json', 'json'],
    ['text', 'text'],
    ['xml', 'text'],
    ['html', 'text'],
    ['base64', 'text'],
    ['hex', 'text'],
  ] as const)('composer format %s → old composerMode %s', (format, legacy) => {
    const old = oldReadWebSocket(roundTrip(wsMetaOf(wsFields(format))))
    expect(old).toEqual({
      url: 'ws://127.0.0.1:4000/echo?x=1',
      headers: [{ id: 'h1', key: 'X-Tenant', value: 't1', enabled: true }],
      composerContent: '<ping/>',
      composerMode: legacy,
      autoScroll: false,
    })
  })

  it('the new reader takes the full format from composerType', () => {
    expect(readWsMeta(roundTrip(wsMetaOf(wsFields('xml')))).composerMode).toBe('xml')
    expect(readWsMeta(roundTrip(wsMetaOf(wsFields('hex')))).composerMode).toBe('hex')
  })

  it('a pre-#282 row (composerMode only) still reads its format', () => {
    expect(readWsMeta({ composerMode: 'json' }).composerMode).toBe('json')
    expect(readWsMeta({ composerMode: 'text' }).composerMode).toBe('text')
  })
})

// ─── 2. Reopen + re-save is a no-op for git ─────────────────────────────

function exportWith(metadata: Record<string, unknown>): Record<string, unknown> {
  return {
    version: '1.0',
    exportedAt: new Date(0).toISOString(),
    project: { id: 'p1', name: 'Shared', display_name: null, description: null },
    saved_requests: [
      {
        id: 'r1',
        project_id: 'p1',
        name: 'live feed',
        protocol: Object.keys(metadata)[0],
        metadata: JSON.stringify(metadata),
      },
    ],
  }
}

describe('reopen + re-save writes the same row (git sameExport)', () => {
  it('Socket.IO', () => {
    const meta1 = sioMetaOf(sioFields())
    const reopened = { ...sioFields(), ...readSioMeta(roundTrip(meta1)) }
    const meta2 = sioMetaOf(reopened)
    expect(JSON.stringify(meta2)).toBe(JSON.stringify(meta1))
    const onDisk = JSON.stringify(exportWith({ socketio: meta1 }), null, 2)
    expect(sameExport(onDisk, exportWith({ socketio: meta2 }))).toBe(true)
  })

  it.each(['json', 'xml', 'hex'] as const)('WebSocket (%s composer)', (format) => {
    const meta1 = wsMetaOf(wsFields(format))
    const reopened = { ...wsFields('text'), ...readWsMeta(roundTrip(meta1)) }
    const meta2 = wsMetaOf(reopened)
    expect(JSON.stringify(meta2)).toBe(JSON.stringify(meta1))
    const onDisk = JSON.stringify(exportWith({ websocket: meta1 }), null, 2)
    expect(sameExport(onDisk, exportWith({ websocket: meta2 }))).toBe(true)
  })

  it('a real edit still reads as a change', () => {
    const meta1 = sioMetaOf(sioFields())
    const edited = sioMetaOf({ ...sioFields(), emitEvent: 'other' })
    const onDisk = JSON.stringify(exportWith({ socketio: meta1 }), null, 2)
    expect(sameExport(onDisk, exportWith({ socketio: edited }))).toBe(false)
  })
})
