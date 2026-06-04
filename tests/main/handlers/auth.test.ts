/**
 * Smoke tests for `auth:*` IPC handlers.
 *
 * Covers password set, login, session lookup, change, disable, recover,
 * logout, listUsers. We mock `os-auth.verifyOsPassword` so the recovery
 * flow doesn't try to actually verify the OS user's password.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

let mockOsAuthOk = true
vi.mock('../../../src/main/lib/os-auth', () => ({
  verifyOsPassword: async () =>
    mockOsAuthOk ? { ok: true } : { ok: false, error: 'wrong os password' },
}))

const { registerAuthHandlers } = await import('../../../src/main/ipc/auth.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  mockOsAuthOk = true
  registerAuthHandlers()
})

describe('auth:hasPassword', () => {
  it('reports false when no password has been set', async () => {
    const res = (await harness.invoke('auth:hasPassword')) as {
      success: boolean
      data?: { hasPassword: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.hasPassword).toBe(false)
  })
})

describe('auth:setPassword + login', () => {
  it('rejects weak passwords', async () => {
    const res = (await harness.invoke('auth:setPassword', { password: 'short' })) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/8 characters|number|letter/)
  })

  it('creates a user with a valid password and returns a session', async () => {
    const res = (await harness.invoke('auth:setPassword', {
      password: 'longpass1',
    })) as {
      success: boolean
      data?: { user: { id: string }; session: { token: string } }
    }
    expect(res.success).toBe(true)
    expect(typeof res.data?.user.id).toBe('string')
    expect(typeof res.data?.session.token).toBe('string')

    // hasPassword now flips to true.
    const has = (await harness.invoke('auth:hasPassword')) as {
      data?: { hasPassword: boolean }
    }
    expect(has.data?.hasPassword).toBe(true)

    // login with the right password works.
    const login = (await harness.invoke('auth:login', { password: 'longpass1' })) as {
      success: boolean
    }
    expect(login.success).toBe(true)

    // wrong password fails.
    const bad = (await harness.invoke('auth:login', { password: 'wrongpass1' })) as {
      success: boolean
      error?: string
    }
    expect(bad.success).toBe(false)
  })
})

describe('auth:getSession + logout + listUsers', () => {
  it('looks up an existing session and then revokes it', async () => {
    const setup = (await harness.invoke('auth:setPassword', {
      password: 'longpass1',
    })) as { data: { session: { token: string } } }

    const got = (await harness.invoke('auth:getSession', setup.data.session.token)) as {
      success: boolean
      data?: { user: { id: string } }
    }
    expect(got.success).toBe(true)
    expect(typeof got.data?.user.id).toBe('string')

    const out = (await harness.invoke('auth:logout', setup.data.session.token)) as {
      success: boolean
    }
    expect(out.success).toBe(true)

    // Session is gone — getSession now returns success: false.
    const after = (await harness.invoke(
      'auth:getSession',
      setup.data.session.token,
    )) as { success: boolean }
    expect(after.success).toBe(false)
  })

  it('lists users (envelope)', async () => {
    const res = (await harness.invoke('auth:listUsers')) as {
      success: boolean
      data?: unknown[]
    }
    expect(res.success).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
  })
})

describe('auth:changePassword + disablePassword', () => {
  it('changes the password and disables it', async () => {
    const setup = (await harness.invoke('auth:setPassword', {
      password: 'longpass1',
    })) as { data: { user: { id: string } } }

    const change = (await harness.invoke('auth:changePassword', {
      userId: setup.data.user.id,
      currentPassword: 'longpass1',
      newPassword: 'newerpass2',
    })) as { success: boolean }
    expect(change.success).toBe(true)

    const disable = (await harness.invoke('auth:disablePassword', {
      userId: setup.data.user.id,
      currentPassword: 'newerpass2',
    })) as { success: boolean }
    expect(disable.success).toBe(true)
  })

  it('rejects changePassword with the wrong current password', async () => {
    const setup = (await harness.invoke('auth:setPassword', {
      password: 'longpass1',
    })) as { data: { user: { id: string } } }
    const res = (await harness.invoke('auth:changePassword', {
      userId: setup.data.user.id,
      currentPassword: 'wrongpass9',
      newPassword: 'whateverpass1',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/incorrect/)
  })
})

describe('auth:recoverPassword', () => {
  it('recovers via OS password and rotates sessions', async () => {
    await harness.invoke('auth:setPassword', { password: 'oldpass11' })
    const res = (await harness.invoke('auth:recoverPassword', {
      osPassword: 'pretend',
      newPassword: 'newpass22',
    })) as { success: boolean; data?: { session: { token: string } } }
    expect(res.success).toBe(true)
    expect(typeof res.data?.session.token).toBe('string')
  })

  it('rejects when no password-protected account exists', async () => {
    const res = (await harness.invoke('auth:recoverPassword', {
      osPassword: 'pretend',
      newPassword: 'newpass22',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
  })

  it('surfaces the OS auth error', async () => {
    await harness.invoke('auth:setPassword', { password: 'oldpass11' })
    mockOsAuthOk = false
    const res = (await harness.invoke('auth:recoverPassword', {
      osPassword: 'pretend',
      newPassword: 'newpass22',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/wrong os password/)
  })
})
