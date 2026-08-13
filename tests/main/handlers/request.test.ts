/**
 * Smoke tests for `request:send` and `request:cancel` IPC handlers.
 *
 * The HTTP engine is stubbed so no real network call is made.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

let engineShouldThrow = false
// When set, the engine mock returns this instead of the default JSON response —
// lets a test drive a binary (base64) response through the handler.
let engineResponseOverride: Record<string, unknown> | null = null
vi.mock('../../../src/main/protocols/http.engine', () => ({
  // The handler also imports stripUrlCredentials from this module (used when
  // building the history snapshot) — the mock must export it or the
  // history-save try/catch swallows a "missing export" error and writes nothing.
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(async () => {
    if (engineShouldThrow) throw new Error('engine boom')
    if (engineResponseOverride) return engineResponseOverride
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      bodySize: 2,
      timing: { total: 4 },
      actualRequest: {
        method: 'GET',
        url: 'http://example/x',
        headers: {},
        body: '',
      },
    }
  }),
}))

/** Rows `loadCertificatesFor` sees. Empty by default = today's behaviour. */
let certRows: Array<Record<string, unknown>> = []
vi.mock('../../../src/main/db/certificate.repo', () => ({
  listCertificatesForHost: () => certRows,
  // keystore-bridge imports this for its `certRow` arm — the mock must export
  // it or the resolver's module binding is missing.
  getCertificate: (id: string) => certRows.find((r) => r.id === id),
}))

const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { executeHttpRequest } = await import('../../../src/main/protocols/http.engine')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  engineShouldThrow = false
  engineResponseOverride = null
  certRows = []
  vi.mocked(executeHttpRequest).mockClear()
  registerRequestHandlers()
})

describe('request:send', () => {
  it('returns success envelope with engine response', async () => {
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://example/x',
    })) as { success: boolean; data?: { status: number } }
    expect(res.success).toBe(true)
    expect(res.data?.status).toBe(200)
  })

  it('returns error envelope when engine throws', async () => {
    engineShouldThrow = true
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://example/x',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/engine boom/)
  })

  // Issue #25 follow-up: a binary (base64) response must persist its
  // `bodyEncoding` flag into the history snapshot, otherwise reopening the
  // entry renders the base64 as plain text instead of previewing the image.
  it('persists bodyEncoding in the history snapshot for a binary response', async () => {
    engineResponseOverride = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'image/png' },
      body: 'iVBORw0KGgo=',
      bodyEncoding: 'base64',
      bodySize: 8,
      timing: { total: 7 },
      actualRequest: { method: 'GET', url: 'http://example/img.png', headers: {}, body: '' },
    }
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://example/img.png',
    })) as { success: boolean }
    expect(res.success).toBe(true)

    const row = testDb
      .prepare('SELECT response_snapshot FROM history ORDER BY executed_at DESC LIMIT 1')
      .get() as { response_snapshot: string } | undefined
    expect(row, 'history row was written').toBeTruthy()
    const snap = JSON.parse(row!.response_snapshot) as { bodyEncoding?: string; body?: string }
    expect(snap.bodyEncoding).toBe('base64')
    expect(snap.body).toBe('iVBORw0KGgo=')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Key Material Provider (#60) EDIT 1 — NO-LEAK at the IPC boundary.
//
// Resolved PEM / key bytes / passphrases are MAIN-ONLY. They must reach the
// engine and NOTHING else: not the `{success,data}` reply, not the history
// snapshot the handler persists.
// ═══════════════════════════════════════════════════════════════════════════

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/certs')

describe('request:send — keystore-backed client cert never leaks to the renderer', () => {
  it('attaches the cert to the engine but returns no key material', async () => {
    const jks = readFileSync(join(CERTS, 'client.jks'))
    const ksId = randomUUID()
    testDb
      .prepare(
        `INSERT INTO keystores (id, name, type, blob, store_password, alias_count, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ksId, 'client.jks', 'JKS', jks.toString('base64'), 'testpassword', 1, jks.length, 0, 0)
    certRows = [
      {
        id: 'cert-1',
        project_id: 'p1',
        kind: 'client',
        host: 'example',
        crt_path: null,
        key_path: null,
        pfx_path: null,
        passphrase: null,
        enabled: 1,
        created_at: 0,
        source: 'keystore',
        keystore_id: ksId,
        keystore_alias: 'test-client',
      },
    ]

    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://example/x',
      _projectId: 'p1',
      _workspaceId: 'w1',
    })) as { success: boolean; data?: unknown }
    expect(res.success).toBe(true)

    // The engine DID receive the resolved material (main-side).
    const sent = vi.mocked(executeHttpRequest).mock.calls[0]?.[0] as {
      certificates?: { clientCert?: { cert?: Buffer; key?: Buffer } }
    }
    expect(sent?.certificates?.clientCert?.key?.toString('utf8')).toContain('PRIVATE KEY')

    // …and the renderer-bound reply carries none of it.
    const reply = JSON.stringify(res)
    expect(reply).not.toContain('PRIVATE KEY')
    expect(reply).not.toContain('BEGIN CERTIFICATE')
    expect(reply).not.toContain('testpassword')
    expect(reply).not.toContain('certificates')

    // Neither does the persisted history snapshot.
    const row = testDb
      .prepare('SELECT request_snapshot FROM history ORDER BY executed_at DESC LIMIT 1')
      .get() as { request_snapshot: string } | undefined
    expect(row?.request_snapshot).not.toContain('PRIVATE KEY')
    expect(row?.request_snapshot).not.toContain('BEGIN CERTIFICATE')
  })

  it('FAIL LOUD: an unopenable alias fails the send instead of going out unauthenticated', async () => {
    const jks = readFileSync(join(CERTS, 'client.jks'))
    const ksId = randomUUID()
    testDb
      .prepare(
        `INSERT INTO keystores (id, name, type, blob, store_password, alias_count, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ksId, 'client.jks', 'JKS', jks.toString('base64'), 'testpassword', 1, jks.length, 0, 0)
    certRows = [
      {
        id: 'cert-1',
        project_id: 'p1',
        kind: 'client',
        host: 'example',
        crt_path: null,
        key_path: null,
        pfx_path: null,
        passphrase: null,
        enabled: 1,
        created_at: 0,
        source: 'keystore',
        keystore_id: ksId,
        keystore_alias: 'ghost',
      },
    ]
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://example/x',
      _projectId: 'p1',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/could not be loaded/i)
    // The request never reached the wire.
    expect(vi.mocked(executeHttpRequest)).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Issue #104 — the Send path must scope the engine's cookie jar to the
// project. The renderer sends the active project as `_projectId` (history
// metadata); the handler must map it onto the engine's `projectId` field,
// otherwise every Send reads/writes the shared "_default" jar while the
// Runner uses the per-project jar — a login cookie stored by Send never
// reaches a Run (and vice versa), and two projects' Send cookies bleed
// into each other.
// ═══════════════════════════════════════════════════════════════════════════

describe('request:send — cookie jar project scoping (issue #104)', () => {
  it('maps _projectId onto the engine options as projectId', async () => {
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://example/x',
      _projectId: 'p1',
      _workspaceId: 'w1',
    })) as { success: boolean }
    expect(res.success).toBe(true)

    const sent = vi.mocked(executeHttpRequest).mock.calls[0]?.[0] as {
      projectId?: string | null
    }
    expect(sent?.projectId).toBe('p1')
  })

  it('leaves projectId unset without _projectId so Quick Test stays on the "_default" jar', async () => {
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://example/x',
    })) as { success: boolean }
    expect(res.success).toBe(true)

    const sent = vi.mocked(executeHttpRequest).mock.calls[0]?.[0] as {
      projectId?: string | null
    }
    expect(sent?.projectId ?? undefined).toBeUndefined()
  })
})

describe('request:cancel', () => {
  it('returns success envelope with data: false when no in-flight request', async () => {
    const res = (await harness.invoke('request:cancel', 'no-such-id')) as {
      success: boolean
      data?: boolean
    }
    expect(res.success).toBe(true)
    expect(res.data).toBe(false)
  })
})
