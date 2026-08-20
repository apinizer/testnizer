/**
 * Multi-project isolation — the OAuth 2.0 token cache keyed the public half of
 * the credentials and not the secret half.
 *
 * `tokenUrl + clientId + scope + grantType + username + clientAuth` identified
 * a cached token; `clientSecret` and (for the password grant) `password` did
 * not take part. Two projects pointing at the same identity provider with the
 * same client id and a per-tenant secret therefore shared one token, and any
 * secret rotation kept serving the token minted with the old one until it
 * expired — an hour by default.
 *
 * `{{variables}}` are resolved before the engine sees this config, so keys do
 * differ whenever the URL or client id come from an environment. The gap was
 * specifically the case where only the secret differs.
 */
import { describe, it, expect } from 'vitest'
import { oauth2CacheKey, type OAuth2GrantConfig } from '../../src/main/protocols/http.engine'

function config(over: Partial<OAuth2GrantConfig> = {}): OAuth2GrantConfig {
  return {
    grantType: 'client_credentials',
    tokenUrl: 'https://idp.example.test/oauth2/token',
    clientId: 'testnizer',
    clientSecret: 'secret-a',
    scope: 'read',
    clientAuth: 'header',
    ...over,
  } as OAuth2GrantConfig
}

describe('oauth2 cache identity', () => {
  it('separates two callers that differ only by client secret', () => {
    expect(oauth2CacheKey(config())).not.toBe(oauth2CacheKey(config({ clientSecret: 'secret-b' })))
  })

  it('separates two password-grant callers that differ only by password', () => {
    const base = config({ grantType: 'password', username: 'ncetinkaya', password: 'one' })
    expect(oauth2CacheKey(base)).not.toBe(oauth2CacheKey({ ...base, password: 'two' }))
  })

  it('treats a rotated secret as a different token, not the same one', () => {
    const before = oauth2CacheKey(config({ clientSecret: 'old' }))
    const after = oauth2CacheKey(config({ clientSecret: 'new' }))
    expect(before).not.toBe(after)
  })

  it('still reuses the cache for an identical configuration', () => {
    expect(oauth2CacheKey(config())).toBe(oauth2CacheKey(config()))
  })

  it('keeps separating the fields it always did', () => {
    const base = oauth2CacheKey(config())
    for (const over of [
      { tokenUrl: 'https://other.example.test/token' },
      { clientId: 'other' },
      { scope: 'write' },
      { clientAuth: 'body' as const },
    ]) {
      expect(oauth2CacheKey(config(over)), JSON.stringify(over)).not.toBe(base)
    }
  })

  it('does not carry the secret in plaintext — the key lives in a long-lived map', () => {
    const key = oauth2CacheKey(config({ clientSecret: 'super-secret-value' }))
    expect(key).not.toContain('super-secret-value')
  })

  it('handles a missing secret without collapsing onto a set one', () => {
    expect(oauth2CacheKey(config({ clientSecret: undefined }))).not.toBe(
      oauth2CacheKey(config({ clientSecret: '' + 'x' })),
    )
  })
})
