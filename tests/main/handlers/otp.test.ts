/**
 * Smoke tests for `otp:*` IPC handlers — CRUD envelope, secret-never-leaks,
 * encryption round-trip, and live code generation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

vi.mock('../../../src/main/lib/secure-storage', () => ({
  encryptSecret: (s: string | null | undefined) => (s ? `enc:${s}` : null),
  decryptSecret: (s: string | null | undefined) => (s ? s.replace(/^enc:/, '') : null),
}))

const { registerOtpHandlers } = await import('../../../src/main/ipc/otp.handler')

// GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ == "12345678901234567890"
const SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  registerOtpHandlers()
})

type Res<T> = { success: boolean; data?: T; error?: string }

describe('otp:add + list', () => {
  it('starts empty', async () => {
    const res = (await harness.invoke('otp:list')) as Res<unknown[]>
    expect(res.success).toBe(true)
    expect(res.data).toEqual([])
  })

  it('adds an entry, stores the secret ENCRYPTED, and never returns it', async () => {
    const add = (await harness.invoke('otp:add', {
      issuer: 'ACME',
      account: 'alice',
      secret: SECRET_B32,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      type: 'totp',
    })) as Res<Record<string, unknown>>
    expect(add.success).toBe(true)
    expect(add.data?.issuer).toBe('ACME')
    expect(add.data?.hasSecret).toBe(true)
    // The metadata returned to the renderer must NOT carry the secret.
    expect(add.data).not.toHaveProperty('secret')

    // The DB column is encrypted (enc: prefix from the mock).
    const row = testDb.prepare('SELECT secret FROM otp_entries').get() as { secret: string }
    expect(row.secret.startsWith('enc:')).toBe(true)
    expect(row.secret).not.toBe(SECRET_B32)

    const list = (await harness.invoke('otp:list')) as Res<Array<Record<string, unknown>>>
    expect(list.data?.[0]?.account).toBe('alice')
    expect(list.data?.[0]).not.toHaveProperty('secret')
  })

  it('rejects an invalid Base32 secret with an error envelope', async () => {
    const res = (await harness.invoke('otp:add', { secret: 'not base32 !!!' })) as Res<unknown>
    expect(res.success).toBe(false)
  })
})

describe('otp:codes + code', () => {
  it('produces a live numeric code for a stored entry', async () => {
    await harness.invoke('otp:add', { secret: SECRET_B32, digits: 6, type: 'totp' })
    const res = (await harness.invoke('otp:codes')) as Res<
      Array<{ code: string | null; secondsRemaining: number }>
    >
    expect(res.success).toBe(true)
    expect(res.data?.[0]?.code).toMatch(/^\d{6}$/)
    expect(res.data?.[0]?.secondsRemaining).toBeGreaterThan(0)
    expect(res.data?.[0]?.secondsRemaining).toBeLessThanOrEqual(30)
  })

  it('advances and persists the counter for HOTP on otp:code', async () => {
    const add = (await harness.invoke('otp:add', {
      secret: SECRET_B32,
      type: 'hotp',
      counter: 0,
    })) as Res<{ id: string }>
    const id = add.data!.id

    const first = (await harness.invoke('otp:code', id)) as Res<{ code: string }>
    const second = (await harness.invoke('otp:code', id)) as Res<{ code: string }>
    expect(first.data?.code).toMatch(/^\d{6}$/)
    expect(second.data?.code).toMatch(/^\d{6}$/)
    // Counter advanced → different codes, and the DB counter is now 2.
    expect(first.data?.code).not.toBe(second.data?.code)
    const row = testDb.prepare('SELECT counter FROM otp_entries WHERE id = ?').get(id) as {
      counter: number
    }
    expect(row.counter).toBe(2)
  })
})

describe('otp:parseUri + reveal + delete', () => {
  it('parses an otpauth URI', async () => {
    const res = (await harness.invoke(
      'otp:parseUri',
      'otpauth://totp/ACME:bob?secret=GEZDGNBVGY3TQOJQ&issuer=ACME&digits=8&period=60',
    )) as Res<{ issuer: string; account: string; digits: number; period: number }>
    expect(res.success).toBe(true)
    expect(res.data?.issuer).toBe('ACME')
    expect(res.data?.account).toBe('bob')
    expect(res.data?.digits).toBe(8)
    expect(res.data?.period).toBe(60)
  })

  it('reveals the plaintext secret only on explicit request', async () => {
    const add = (await harness.invoke('otp:add', { secret: SECRET_B32 })) as Res<{ id: string }>
    const reveal = (await harness.invoke('otp:reveal', add.data!.id)) as Res<string>
    expect(reveal.success).toBe(true)
    expect(reveal.data).toBe(SECRET_B32)
  })

  it('deletes an entry', async () => {
    const add = (await harness.invoke('otp:add', { secret: SECRET_B32 })) as Res<{ id: string }>
    await harness.invoke('otp:delete', add.data!.id)
    const list = (await harness.invoke('otp:list')) as Res<unknown[]>
    expect(list.data).toEqual([])
  })
})
