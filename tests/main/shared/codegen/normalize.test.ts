/**
 * Issue #280 — the shared normaliser decides what every snippet sends: URL
 * (path variables, params before `#fragment`, percent-encoding that keeps
 * `{{var}}`), headers (user wins over auth, implied Content-Type, no
 * multipart Content-Type), auth (API key in query, Basic as credentials),
 * GraphQL JSON body, settings.
 */
import { describe, expect, it } from 'vitest'
import {
  base64Utf8,
  buildSnippetUrl,
  encodeSnippetUrl,
  graphqlJson,
  normalizeRequest,
} from '../../../../src/shared/codegen'

const base = { method: 'get', url: 'https://api.test/x' }

describe('snippet URL', () => {
  it('inserts table params BEFORE the fragment (they used to land after it)', () => {
    expect(buildSnippetUrl('https://a.test/p?x=1#frag', [{ key: 'y', value: '2' }])).toBe(
      'https://a.test/p?x=1&y=2#frag',
    )
    expect(buildSnippetUrl('https://a.test/p#frag', [{ key: 'y', value: '2' }])).toBe(
      'https://a.test/p?y=2#frag',
    )
  })

  it('keeps the URL query and drops table rows that would duplicate it (issue #17/#22)', () => {
    expect(
      buildSnippetUrl('https://a.test/p?id=1&id=2', [
        { key: 'id', value: '3' },
        { key: 'off', value: '1', enabled: false },
        { key: '', value: 'orphan' },
      ]),
    ).toBe('https://a.test/p?id=1&id=2')
  })

  it('percent-encodes unsafe characters, never double-encodes, keeps {{var}} readable', () => {
    expect(encodeSnippetUrl('https://a.test/ünï cødé?q="x"&p=50%25&r=100%')).toBe(
      'https://a.test/%C3%BCn%C3%AF%20c%C3%B8d%C3%A9?q=%22x%22&p=50%25&r=100%25',
    )
    expect(encodeSnippetUrl('{{baseUrl}}/a b/{{id}}?t={{my token}}')).toBe(
      '{{baseUrl}}/a%20b/{{id}}?t={{my token}}',
    )
  })

  it('applies path variables first (issue #276)', () => {
    const r = normalizeRequest({
      ...base,
      url: 'https://api.test/users/:id',
      pathVariables: [{ key: 'id', value: '42' }],
    })
    expect(r.url).toBe('https://api.test/users/42')
    expect(r.method).toBe('GET')
  })
})

describe('auth', () => {
  it('appends an API key "in query" to the URL', () => {
    const r = normalizeRequest({
      ...base,
      auth: { type: 'api-key', apiKey: { key: 'k', value: 'v w', in: 'query' } },
    })
    expect(r.url).toBe('https://api.test/x?k=v%20w')
    expect(r.headers).toEqual([])
  })

  it('a user Authorization header beats the auth tab (engine rule)', () => {
    const headers = [{ key: 'authorization', value: 'Custom 1', enabled: true }]
    const bearer = normalizeRequest({
      ...base,
      headers,
      auth: { type: 'bearer', bearer: { token: 't' } },
    })
    expect(bearer.headers).toEqual([{ key: 'authorization', value: 'Custom 1' }])
    const basic = normalizeRequest({
      ...base,
      headers,
      auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
    })
    expect(basic.auth).toBeUndefined()
  })

  it('keeps Basic / Digest / NTLM as credentials for the language API', () => {
    expect(
      normalizeRequest({
        ...base,
        auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
      }).auth,
    ).toEqual({
      scheme: 'basic',
      username: 'u',
      password: 'p',
    })
    expect(
      normalizeRequest({
        ...base,
        auth: { type: 'ntlm', ntlm: { username: 'u', password: 'p', domain: 'D' } },
      }).auth,
    ).toEqual({ scheme: 'ntlm', username: 'D\\u', password: 'p' })
  })

  it('an OAuth2 token becomes a Bearer header', () => {
    const r = normalizeRequest({ ...base, auth: { type: 'oauth2', oauth2: { token: 'abc' } } })
    expect(r.headers).toEqual([{ key: 'Authorization', value: 'Bearer abc' }])
  })

  it('base64 is of the UTF-8 bytes (btoa would throw on müller)', () => {
    expect(base64Utf8('müller:pässword')).toBe('bcO8bGxlcjpww6Rzc3dvcmQ=')
    expect(base64Utf8('admin:s3cret')).toBe('YWRtaW46czNjcmV0')
  })
})

describe('body and Content-Type', () => {
  it('adds the Content-Type the body implies unless the user set one', () => {
    const xml = normalizeRequest({
      ...base,
      method: 'POST',
      body: { type: 'xml', content: '<a/>' },
    })
    expect(xml.headers).toEqual([{ key: 'Content-Type', value: 'application/xml' }])
    const user = normalizeRequest({
      ...base,
      method: 'POST',
      headers: [{ key: 'content-type', value: 'text/xml', enabled: true }],
      body: { type: 'xml', content: '<a/>' },
    })
    expect(user.headers).toEqual([{ key: 'content-type', value: 'text/xml' }])
    const bin = normalizeRequest({
      ...base,
      method: 'PUT',
      body: { type: 'binary', binaryPath: '/f.bin' },
    })
    expect(bin.headers).toEqual([{ key: 'Content-Type', value: 'application/octet-stream' }])
    expect(bin.body).toEqual({ mode: 'binary', path: '/f.bin' })
  })

  it('form-data never carries a Content-Type (the library writes the boundary)', () => {
    const r = normalizeRequest({
      ...base,
      method: 'POST',
      headers: [{ key: 'Content-Type', value: 'multipart/form-data', enabled: true }],
      body: {
        type: 'form-data',
        formData: [
          { key: 't', value: 'v' },
          { key: 'f', value: 'a.png', type: 'file', filePath: '/tmp/a.png' },
        ],
      },
    })
    expect(r.headers).toEqual([])
    expect(r.body).toEqual({
      mode: 'form-data',
      parts: [
        { kind: 'text', key: 't', value: 'v' },
        { kind: 'file', key: 'f', path: '/tmp/a.png', fileName: 'a.png' },
      ],
    })
  })

  it('urlencoded: enabled rows, encoded like Send', () => {
    const r = normalizeRequest({
      ...base,
      method: 'POST',
      body: {
        type: 'urlencoded',
        urlEncoded: [
          { key: 'a b', value: 'c&d' },
          { key: 'x', value: '1', enabled: false },
        ],
      },
    })
    expect(r.body).toEqual({
      mode: 'urlencoded',
      fields: [{ key: 'a b', value: 'c&d' }],
      encoded: 'a%20b=c%26d',
    })
  })

  it('GraphQL: the JSON body Send posts; unparseable variables → {} (Send)', () => {
    expect(graphqlJson('{ me }', '{"a":1}')).toBe('{"query":"{ me }","variables":{"a":1}}')
    expect(graphqlJson('{ me }', '{"a": {{n}}}')).toBe('{"query":"{ me }","variables":{}}')
    const r = normalizeRequest({
      ...base,
      method: 'POST',
      body: { type: 'graphql', graphql: { query: 'q', variables: '' } },
    })
    expect(r.body).toEqual({ mode: 'raw', format: 'json', content: '{"query":"q","variables":{}}' })
    expect(r.headers).toEqual([{ key: 'Content-Type', value: 'application/json' }])
  })

  it('an empty raw body is no body', () => {
    expect(
      normalizeRequest({ ...base, method: 'POST', body: { type: 'json', content: '' } }).body,
    ).toBeUndefined()
  })
})

describe('settings', () => {
  it('only explicit values are carried', () => {
    expect(
      normalizeRequest({
        ...base,
        settings: { timeout: null, followRedirects: true, sslVerification: true },
      }).settings,
    ).toEqual({})
    expect(
      normalizeRequest({
        ...base,
        settings: { timeout: 1500, followRedirects: false, sslVerification: false },
      }).settings,
    ).toEqual({
      timeoutMs: 1500,
      followRedirects: false,
      insecure: true,
    })
  })
})
