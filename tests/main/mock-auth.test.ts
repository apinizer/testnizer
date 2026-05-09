import { describe, it, expect } from 'vitest'
import { checkAuth, resolveAuthConfig } from '../../src/main/mock/auth'
import type { AuthConfig } from '../../src/main/mock/types'

describe('resolveAuthConfig', () => {
  it('returns server default when no override', () => {
    const server: AuthConfig = { type: 'none' }
    expect(resolveAuthConfig(server, null)).toEqual(server)
  })
  it('endpoint override wins when provided', () => {
    const server: AuthConfig = { type: 'none' }
    const override: AuthConfig = { type: 'bearer', tokens: ['t'] }
    expect(resolveAuthConfig(server, override)).toEqual(override)
  })
})

describe('checkAuth — none', () => {
  it('always allows', () => {
    expect(
      checkAuth({ config: { type: 'none' }, headers: {}, query: {} }).ok,
    ).toBe(true)
  })
})

describe('checkAuth — bearer', () => {
  const cfg: AuthConfig = { type: 'bearer', tokens: ['secret-1', 'secret-2'] }

  it('rejects missing Authorization header', () => {
    const r = checkAuth({ config: cfg, headers: {}, query: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.failure.status).toBe(401)
      expect(r.failure.headers['www-authenticate']).toContain('Bearer')
    }
  })

  it('rejects malformed scheme', () => {
    const r = checkAuth({
      config: cfg,
      headers: { authorization: 'Basic foo' },
      query: {},
    })
    expect(r.ok).toBe(false)
  })

  it('rejects unknown token', () => {
    const r = checkAuth({
      config: cfg,
      headers: { authorization: 'Bearer wrong' },
      query: {},
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.headers['www-authenticate']).toContain('invalid_token')
  })

  it('accepts a known token (any in list)', () => {
    expect(
      checkAuth({
        config: cfg,
        headers: { authorization: 'Bearer secret-1' },
        query: {},
      }).ok,
    ).toBe(true)
    expect(
      checkAuth({
        config: cfg,
        headers: { authorization: 'Bearer secret-2' },
        query: {},
      }).ok,
    ).toBe(true)
  })

  it('is case-insensitive on the scheme', () => {
    expect(
      checkAuth({
        config: cfg,
        headers: { authorization: 'bearer secret-1' },
        query: {},
      }).ok,
    ).toBe(true)
  })
})

describe('checkAuth — basic', () => {
  const cfg: AuthConfig = {
    type: 'basic',
    users: [{ username: 'alice', password: 'wonderland' }],
  }

  it('rejects missing header', () => {
    expect(checkAuth({ config: cfg, headers: {}, query: {} }).ok).toBe(false)
  })

  it('accepts valid base64 credentials', () => {
    const b64 = Buffer.from('alice:wonderland').toString('base64')
    expect(
      checkAuth({
        config: cfg,
        headers: { authorization: `Basic ${b64}` },
        query: {},
      }).ok,
    ).toBe(true)
  })

  it('rejects wrong password', () => {
    const b64 = Buffer.from('alice:wrong').toString('base64')
    expect(
      checkAuth({
        config: cfg,
        headers: { authorization: `Basic ${b64}` },
        query: {},
      }).ok,
    ).toBe(false)
  })

  it('rejects malformed (no colon) decoded value', () => {
    const b64 = Buffer.from('nocolon').toString('base64')
    expect(
      checkAuth({
        config: cfg,
        headers: { authorization: `Basic ${b64}` },
        query: {},
      }).ok,
    ).toBe(false)
  })
})

describe('checkAuth — apiKey', () => {
  it('reads from header by name', () => {
    const cfg: AuthConfig = { type: 'apiKey', in: 'header', name: 'X-API-Key', keys: ['k1'] }
    expect(
      checkAuth({ config: cfg, headers: { 'x-api-key': 'k1' }, query: {} }).ok,
    ).toBe(true)
  })

  it('reads from query when configured', () => {
    const cfg: AuthConfig = { type: 'apiKey', in: 'query', name: 'apikey', keys: ['k1'] }
    expect(checkAuth({ config: cfg, headers: {}, query: { apikey: 'k1' } }).ok).toBe(true)
  })

  it('rejects missing or wrong key', () => {
    const cfg: AuthConfig = { type: 'apiKey', in: 'header', name: 'X-Key', keys: ['k1'] }
    expect(checkAuth({ config: cfg, headers: {}, query: {} }).ok).toBe(false)
    expect(
      checkAuth({ config: cfg, headers: { 'x-key': 'wrong' }, query: {} }).ok,
    ).toBe(false)
  })
})
