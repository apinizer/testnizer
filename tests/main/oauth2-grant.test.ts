/**
 * OAuth 2.0 token grant (v1.4.18) — fetchOAuth2Token performs the client
 * credentials / password grant the engine auto-runs for oauth2 auth. Mocks
 * axios so no network is touched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const post = vi.fn()
vi.mock('axios', () => ({
  default: { post: (...args: unknown[]) => post(...args) },
}))

import { fetchOAuth2Token } from '../../src/main/protocols/http.engine'

function ok(data: unknown) {
  return { status: 200, data }
}

beforeEach(() => {
  post.mockReset()
})

describe('fetchOAuth2Token', () => {
  it('client_credentials with header client auth → Basic header + grant_type in body', async () => {
    post.mockResolvedValueOnce(ok({ access_token: 'AT', token_type: 'Bearer', expires_in: 3600 }))
    const res = await fetchOAuth2Token({
      grantType: 'client_credentials',
      tokenUrl: 'https://idp/token',
      clientId: 'cid',
      clientSecret: 'secret',
      scope: 'read write',
      clientAuth: 'header',
    })
    expect(res.accessToken).toBe('AT')
    expect(res.expiresIn).toBe(3600)

    const [url, body, cfg] = post.mock.calls[0]
    expect(url).toBe('https://idp/token')
    const params = new URLSearchParams(body as string)
    expect(params.get('grant_type')).toBe('client_credentials')
    expect(params.get('scope')).toBe('read write')
    expect(params.get('client_id')).toBeNull() // creds are in the header, not the body
    const auth = (cfg as { headers: Record<string, string> }).headers.Authorization
    expect(auth).toBe('Basic ' + Buffer.from('cid:secret').toString('base64'))
  })

  it('client_credentials with body client auth → client_id/secret in the body', async () => {
    post.mockResolvedValueOnce(ok({ access_token: 'AT2' }))
    await fetchOAuth2Token({
      grantType: 'client_credentials',
      tokenUrl: 'https://idp/token',
      clientId: 'cid',
      clientSecret: 'secret',
      clientAuth: 'body',
    })
    const params = new URLSearchParams(post.mock.calls[0][1] as string)
    expect(params.get('client_id')).toBe('cid')
    expect(params.get('client_secret')).toBe('secret')
    expect((post.mock.calls[0][2] as { headers: Record<string, string> }).headers.Authorization).toBeUndefined()
  })

  it('password grant sends username + password', async () => {
    post.mockResolvedValueOnce(ok({ access_token: 'AT3' }))
    await fetchOAuth2Token({
      grantType: 'password',
      tokenUrl: 'https://idp/token',
      clientId: 'cid',
      username: 'alice',
      password: 'pw',
    })
    const params = new URLSearchParams(post.mock.calls[0][1] as string)
    expect(params.get('grant_type')).toBe('password')
    expect(params.get('username')).toBe('alice')
    expect(params.get('password')).toBe('pw')
  })

  it('throws on non-2xx with the server detail', async () => {
    post.mockResolvedValueOnce({ status: 401, data: { error: 'invalid_client' } })
    await expect(
      fetchOAuth2Token({ tokenUrl: 'https://idp/token', clientId: 'x' }),
    ).rejects.toThrow(/401|invalid_client/)
  })

  it('throws when the response has no access_token', async () => {
    post.mockResolvedValueOnce(ok({ token_type: 'Bearer' }))
    await expect(
      fetchOAuth2Token({ tokenUrl: 'https://idp/token', clientId: 'x' }),
    ).rejects.toThrow(/no access_token/i)
  })

  it('requires a tokenUrl', async () => {
    await expect(fetchOAuth2Token({ clientId: 'x' })).rejects.toThrow(/Token URL/i)
  })
})
