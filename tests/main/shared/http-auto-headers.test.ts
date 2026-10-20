/**
 * Issue #204 — `computeAutoHeaders`, the pure preview of every header the HTTP
 * engine adds on top of the user's Headers-tab rows. Wire parity with the real
 * engine lives in `tests/main/http-auto-headers-parity.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import {
  computeAutoHeaders,
  countSentAutoHeaders,
  defaultContentTypeForBody,
  formatDefaultUserAgent,
  hasUserContentType,
  SEND_TIME_TOKEN,
  AXIOS_DEFAULT_ACCEPT,
  AXIOS_DEFAULT_ACCEPT_ENCODING,
  type AutoHeaderInput,
  type AutoHeaderRow,
} from '../../../src/shared/http-auto-headers'
import { HISTORY_MASK } from '../../../src/shared/credential-headers'

const base: AutoHeaderInput = {
  method: 'GET',
  url: 'https://api.example.com/v1/users',
  headers: [],
  body: { type: 'none' },
  auth: null,
  appVersion: '1.5.4',
}

function rows(over: Partial<AutoHeaderInput>): AutoHeaderRow[] {
  return computeAutoHeaders({ ...base, ...over })
}
function find(rs: AutoHeaderRow[], name: string): AutoHeaderRow | undefined {
  return rs.find((r) => r.name.toLowerCase() === name.toLowerCase())
}
function all(rs: AutoHeaderRow[], name: string): AutoHeaderRow[] {
  return rs.filter((r) => r.name.toLowerCase() === name.toLowerCase())
}

describe('engine defaults (always present)', () => {
  it('GET without body: Accept, User-Agent, Accept-Encoding, Host, Connection, Cookie — no Content-Type / Content-Length', () => {
    const rs = rows({})
    expect(find(rs, 'Accept')).toMatchObject({ value: AXIOS_DEFAULT_ACCEPT, source: 'engine' })
    expect(find(rs, 'User-Agent')).toMatchObject({ value: 'Testnizer/1.5.4', source: 'engine' })
    expect(find(rs, 'Accept-Encoding')?.value).toBe(AXIOS_DEFAULT_ACCEPT_ENCODING)
    expect(find(rs, 'Host')?.value).toBe('api.example.com')
    expect(find(rs, 'Connection')?.value).toBe('close')
    expect(find(rs, 'Cookie')).toMatchObject({ source: 'cookie', sendTime: true })
    expect(find(rs, 'Content-Type')).toBeUndefined()
    expect(find(rs, 'Content-Length')).toBeUndefined()
  })

  it('Host keeps a non-default port and drops the default one', () => {
    expect(find(rows({ url: 'http://127.0.0.1:8080/x' }), 'Host')?.value).toBe('127.0.0.1:8080')
    expect(find(rows({ url: 'https://h.example:443/x' }), 'Host')?.value).toBe('h.example')
  })

  it('an unresolved {{var}} host or a missing app version become send-time rows', () => {
    const rs = rows({ url: '{{baseUrl}}/users', appVersion: undefined })
    expect(find(rs, 'Host')).toMatchObject({ value: SEND_TIME_TOKEN, sendTime: true })
    expect(find(rs, 'User-Agent')).toMatchObject({ sendTime: true })
  })

  it('formatDefaultUserAgent is the engine format', () => {
    expect(formatDefaultUserAgent('9.9.9')).toBe('Testnizer/9.9.9')
  })
})

describe('body modes', () => {
  it.each([
    ['json', 'application/json'],
    ['xml', 'application/xml'],
    ['text', 'text/plain'],
    ['html', 'text/html'],
    ['javascript', 'application/javascript'],
    ['urlencoded', 'application/x-www-form-urlencoded'],
  ])('raw %s → Content-Type %s + send-time Content-Length', (type, ct) => {
    const rs = rows({ method: 'POST', body: { type, content: 'x' } })
    expect(defaultContentTypeForBody(type)).toBe(ct)
    expect(all(rs, 'Content-Type')).toEqual([{ name: 'Content-Type', value: ct, source: 'engine' }])
    expect(find(rs, 'Content-Length')).toMatchObject({ value: SEND_TIME_TOKEN, sendTime: true })
  })

  it('form-data → boundary computed at send, and a user Content-Type never wins', () => {
    const rs = rows({
      method: 'POST',
      body: { type: 'form-data' },
      headers: [{ key: 'Content-Type', value: 'multipart/form-data', enabled: true }],
    })
    const ct = all(rs, 'Content-Type')
    expect(ct).toHaveLength(1)
    expect(ct[0].value).toBe(`multipart/form-data; boundary=${SEND_TIME_TOKEN}`)
    expect(ct[0].sendTime).toBe(true)
    expect(ct[0].overriddenByUser).toBeUndefined()
    expect(defaultContentTypeForBody('form-data')).toBeUndefined()
  })

  it('binary → octet-stream only once a file is chosen', () => {
    expect(
      find(
        rows({ method: 'POST', body: { type: 'binary', binaryPath: '/tmp/a.bin' } }),
        'Content-Type',
      )?.value,
    ).toBe('application/octet-stream')
    // No file: no data, so axios' POST default applies instead.
    expect(find(rows({ method: 'POST', body: { type: 'binary' } }), 'Content-Type')?.value).toBe(
      'application/x-www-form-urlencoded',
    )
  })

  it('no body on POST/PUT/PATCH → axios form default + Content-Length 0; QUERY → length only; DELETE → neither', () => {
    for (const m of ['POST', 'PUT', 'PATCH']) {
      const rs = rows({ method: m })
      expect(find(rs, 'Content-Type')?.value).toBe('application/x-www-form-urlencoded')
      expect(find(rs, 'Content-Length')?.value).toBe('0')
    }
    const q = rows({ method: 'QUERY' })
    expect(find(q, 'Content-Type')).toBeUndefined()
    expect(find(q, 'Content-Length')?.value).toBe('0')
    const d = rows({ method: 'DELETE' })
    expect(find(d, 'Content-Type')).toBeUndefined()
    expect(find(d, 'Content-Length')).toBeUndefined()
  })

  it('a JSON body on GET still carries Content-Type + Content-Length', () => {
    const rs = rows({ method: 'GET', body: { type: 'json', content: '{}' } })
    expect(find(rs, 'Content-Type')?.value).toBe('application/json')
    expect(find(rs, 'Content-Length')).toBeDefined()
  })
})

describe('auth types', () => {
  it('none / inherit-unresolved (null) → no Authorization', () => {
    expect(find(rows({ auth: { type: 'none' } }), 'Authorization')).toBeUndefined()
    expect(find(rows({ auth: null }), 'Authorization')).toBeUndefined()
  })

  it('basic → "Basic" + mask, never the base64 credential', () => {
    const r = find(
      rows({ auth: { type: 'basic', basic: { username: 'alice', password: 's3cr3t-pw' } } }),
      'Authorization',
    )
    expect(r).toMatchObject({ value: `Basic ${HISTORY_MASK}`, source: 'auth' })
    expect(r?.value).not.toContain(Buffer.from('alice:s3cr3t-pw').toString('base64'))
  })

  it('bearer keeps the scheme (and a custom prefix) and masks the token', () => {
    const rs = rows({ auth: { type: 'bearer', bearer: { token: 'eyJhbGciOi.secret.sig' } } })
    expect(find(rs, 'Authorization')?.value).toBe(`Bearer ${HISTORY_MASK}`)
    const custom = rows({
      auth: { type: 'bearer', bearer: { token: 'abc12345', prefix: 'Token' } },
    })
    expect(find(custom, 'Authorization')?.value).toBe(`Token ${HISTORY_MASK}`)
  })

  it('a pure {{var}} template is shown as-is', () => {
    const rs = rows({ auth: { type: 'bearer', bearer: { token: '{{accessToken}}' } } })
    expect(find(rs, 'Authorization')?.value).toBe('Bearer {{accessToken}}')
    // Mixed literal + template is still masked.
    const mixed = rows({ auth: { type: 'bearer', bearer: { token: 'abc{{x}}' } } })
    expect(find(mixed, 'Authorization')?.value).toBe(`Bearer ${HISTORY_MASK}`)
  })

  it('api-key in header → masked row under its own name (even a non-credential-looking name)', () => {
    const rs = rows({
      auth: {
        type: 'api-key',
        apiKey: { key: 'X-Tenant', value: 'tenant-secret-1', in: 'header' },
      },
    })
    expect(find(rs, 'X-Tenant')).toMatchObject({ value: HISTORY_MASK, source: 'auth' })
  })

  it('api-key in query → no header row', () => {
    const rs = rows({
      auth: { type: 'api-key', apiKey: { key: 'api_key', value: 'k-123456', in: 'query' } },
    })
    expect(find(rs, 'api_key')).toBeUndefined()
    expect(rs.some((r) => r.source === 'auth')).toBe(false)
  })

  it('oauth2: a token → Bearer mask; a fetchable grant without token → send-time; otherwise nothing', () => {
    const withToken = rows({ auth: { type: 'oauth2', oauth2: { token: 'tok-abcdef123' } } })
    expect(find(withToken, 'Authorization')?.value).toBe(`Bearer ${HISTORY_MASK}`)
    const fetchable = rows({
      auth: {
        type: 'oauth2',
        oauth2: { grantType: 'client_credentials', tokenUrl: 'https://as/token', clientId: 'c' },
      },
    })
    expect(find(fetchable, 'Authorization')).toMatchObject({
      value: `Bearer ${SEND_TIME_TOKEN}`,
      sendTime: true,
    })
    const interactive = rows({
      auth: {
        type: 'oauth2',
        oauth2: { grantType: 'authorization_code', tokenUrl: 'https://as/token', clientId: 'c' },
      },
    })
    expect(find(interactive, 'Authorization')).toBeUndefined()
  })

  it('digest / ntlm / hawk / aws-signature are calculated at send', () => {
    const digest = find(
      rows({ auth: { type: 'digest', digest: { username: 'u', password: 'p' } } }),
      'Authorization',
    )
    expect(digest).toMatchObject({ value: `Digest ${SEND_TIME_TOKEN}`, sendTime: true })
    const ntlmRows = rows({ auth: { type: 'ntlm', ntlm: { username: 'u', password: 'p' } } })
    expect(find(ntlmRows, 'Authorization')).toMatchObject({ sendTime: true })
    expect(find(ntlmRows, 'Connection')?.value).toBe('keep-alive')
    const hawk = find(
      rows({ auth: { type: 'hawk', hawk: { authId: 'id', authKey: 'k', algorithm: 'sha256' } } }),
      'Authorization',
    )
    expect(hawk).toMatchObject({ value: `Hawk ${SEND_TIME_TOKEN}`, sendTime: true })
    const aws = rows({
      auth: {
        type: 'aws-signature',
        awsSignature: { accessKey: 'AK', secretKey: 'SK', region: 'eu', service: 's3' },
      },
    })
    for (const n of ['Authorization', 'X-Amz-Date', 'X-Amz-Content-Sha256']) {
      expect(find(aws, n)).toMatchObject({ source: 'auth', sendTime: true })
    }
  })

  it('wsse adds nothing on HTTP', () => {
    expect(rows({ auth: { type: 'wsse' } }).some((r) => r.source === 'auth')).toBe(false)
  })
})

describe('user-header precedence', () => {
  it('a user Authorization (any case) overrides auth; digest is not overridable', () => {
    const user = [{ key: 'authorization', value: 'Bearer mine', enabled: true }]
    const bearer = rows({ headers: user, auth: { type: 'bearer', bearer: { token: 'abc12345' } } })
    expect(find(bearer, 'Authorization')?.overriddenByUser).toBe(true)
    const digest = rows({
      headers: user,
      auth: { type: 'digest', digest: { username: 'u', password: 'p' } },
    })
    expect(find(digest, 'Authorization')?.overriddenByUser).toBeUndefined()
  })

  it('a disabled or empty-key user row does not override', () => {
    const rs = rows({
      headers: [
        { key: 'Accept', value: 'text/xml', enabled: false },
        { key: '', value: 'x', enabled: true },
      ],
    })
    expect(find(rs, 'Accept')?.overriddenByUser).toBeUndefined()
  })

  it('User-Agent / Accept / Host / Connection / Accept-Encoding are overridden case-insensitively', () => {
    const rs = rows({
      headers: ['user-agent', 'accept', 'host', 'connection', 'accept-encoding'].map((key) => ({
        key,
        value: 'v',
        enabled: true,
      })),
    })
    for (const n of ['User-Agent', 'Accept', 'Host', 'Connection', 'Accept-Encoding']) {
      expect(find(rs, n)?.overriddenByUser).toBe(true)
    }
    // Only Cookie is left, and it is not counted (sent only if the jar has cookies).
    expect(countSentAutoHeaders(rs)).toBe(0)
  })

  it('body Content-Type: a user Content-Type in ANY case overrides it (user header wins)', () => {
    for (const key of ['Content-Type', 'content-type', 'CONTENT-TYPE']) {
      const rs = rows({
        method: 'POST',
        body: { type: 'json', content: '{}' },
        headers: [{ key, value: 'application/vnd.api+json', enabled: true }],
      })
      expect(find(rs, 'Content-Type')?.overriddenByUser).toBe(true)
    }
    expect(hasUserContentType({ 'Content-Type': 'x' })).toBe(true)
    expect(hasUserContentType({ 'content-type': 'x' })).toBe(true)
    expect(hasUserContentType({ 'CoNtEnT-TyPe': 'x' })).toBe(true)
    // An empty value is "not set" — the engine still applies its default.
    expect(hasUserContentType({ 'content-type': '' })).toBe(false)
    expect(hasUserContentType({})).toBe(false)
  })

  it('a user Cookie header never suppresses the jar row (cookies are appended)', () => {
    const rs = rows({ headers: [{ key: 'Cookie', value: 'a=1', enabled: true }] })
    expect(find(rs, 'Cookie')?.overriddenByUser).toBeUndefined()
  })

  it('the count excludes overridden rows and the conditional Cookie row', () => {
    const rs = rows({ auth: { type: 'bearer', bearer: { token: 'abc12345' } } })
    // Accept, Authorization, User-Agent, Accept-Encoding, Host, Connection
    expect(countSentAutoHeaders(rs)).toBe(6)
  })
})

describe('masking', () => {
  const SECRET = 'sk-live-0123456789abcdef'
  it('no auth type ever renders a literal credential', () => {
    const auths: AutoHeaderInput['auth'][] = [
      { type: 'basic', basic: { username: SECRET, password: SECRET } },
      { type: 'bearer', bearer: { token: SECRET } },
      { type: 'api-key', apiKey: { key: 'X-Api-Key', value: SECRET, in: 'header' } },
      { type: 'oauth2', oauth2: { token: SECRET } },
      { type: 'digest', digest: { username: SECRET, password: SECRET } },
      { type: 'hawk', hawk: { authId: SECRET, authKey: SECRET, algorithm: 'sha256' } },
      {
        type: 'aws-signature',
        awsSignature: { accessKey: SECRET, secretKey: SECRET, region: 'r', service: 's' },
      },
    ]
    for (const auth of auths) {
      const json = JSON.stringify(rows({ auth }))
      expect(json).not.toContain(SECRET)
      expect(json).not.toContain(Buffer.from(`${SECRET}:${SECRET}`).toString('base64'))
    }
  })

  it('user header values are not echoed into the auto rows', () => {
    const rs = rows({
      headers: [{ key: 'Authorization', value: `Bearer ${SECRET}`, enabled: true }],
    })
    expect(JSON.stringify(rs)).not.toContain(SECRET)
  })
})
