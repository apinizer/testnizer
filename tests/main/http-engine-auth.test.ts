/**
 * Auth-header generation tests for `src/main/protocols/http.engine.ts`.
 *
 * The auth builders (`applyAuth`, `generateHawkHeader`,
 * `generateAwsSignatureHeaders`) are NOT exported, so these tests drive the
 * public `executeHttpRequest` path and inspect the `Authorization` (+ signing)
 * headers the engine actually puts on the wire. A local `http.createServer`
 * captures every inbound header so we can assert the EXACT value a real server
 * would receive — important because these are crypto signers that fail
 * silently (a wrong byte still produces a plausible-looking header).
 *
 * Coverage: basic, bearer (default + custom prefix), api-key (header + query),
 * oauth2, digest, ntlm, hawk, aws-signature (SigV4).
 *
 * IMPORTANT IMPLEMENTATION NOTES discovered while writing these tests — the
 * assertions below pin the ENGINE'S CURRENT BEHAVIOUR, which differs from a
 * naive reading of the auth-type names:
 *
 *   • digest  — the engine does NOT implement RFC 2617 digest. It merely sets
 *     axios's `config.auth`, and axios 1.16 turns that into a plain
 *     `Authorization: Basic base64(user:pass)` header (it has no
 *     WWW-Authenticate challenge/response logic). So "digest" currently
 *     behaves identically to basic. We assert that real behaviour rather than
 *     a digest `response=` hash that the code never produces.
 *
 *   • ntlm    — same story. The engine sets `config.auth` with
 *     `DOMAIN\username`, which axios emits as
 *     `Authorization: Basic base64(DOMAIN\user:pass)`. No NTLMSSP Type-1
 *     ("Negotiate TlRMTVNTUA...") message is ever generated.
 *
 * If/when the engine grows a real digest/NTLM handshake these two tests must
 * be rewritten — they are intentionally strict so that change is caught.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, createHmac } from 'node:crypto'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'

// ─── Local capture server ────────────────────────────────────
//
// Every request records the inbound headers + url + body. The handler can be
// swapped per-test for the digest 401-challenge dance.

interface Captured {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
}

let server: Server
let port = 0
let captured: Captured | null = null
// When set, this overrides the default 200 handler (used for the digest
// challenge test). Return `true` if it fully handled the response.
let customHandler: ((cap: Captured, res: import('node:http').ServerResponse) => boolean) | null = null

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          const cap: Captured = {
            method: req.method ?? '',
            url: req.url ?? '',
            headers: req.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }
          captured = cap
          if (customHandler && customHandler(cap, res)) return
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        })
      })
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port
        resolve()
      })
    }),
)

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

function baseUrl(path = '/'): string {
  return `http://127.0.0.1:${port}${path}`
}

function reset(): void {
  captured = null
  customHandler = null
}

// ─── basic ───────────────────────────────────────────────────

describe('http.engine auth — basic', () => {
  it('emits Authorization: Basic base64(user:pass) exactly', async () => {
    reset()
    const res = await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/basic'),
      auth: { type: 'basic', basic: { username: 'aladdin', password: 'opensesame' } },
      timeout: 3000,
    })
    expect(res.status).toBe(200)
    const expected = 'Basic ' + Buffer.from('aladdin:opensesame').toString('base64')
    // base64('aladdin:opensesame') === 'YWxhZGRpbjpvcGVuc2VzYW1l'
    expect(expected).toBe('Basic YWxhZGRpbjpvcGVuc2VzYW1l')
    expect(captured?.headers.authorization).toBe(expected)
    // Also exposed in actualRequest for the Run Results panel.
    expect(res.actualRequest?.headers?.Authorization).toBe(expected)
  })

  it('strips a colon from the username (RFC 7617 §2) before encoding', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/basic'),
      auth: { type: 'basic', basic: { username: 'us:er', password: 'pw' } },
      timeout: 3000,
    })
    // The colon is stripped → "user:pw".
    const expected = 'Basic ' + Buffer.from('user:pw').toString('base64')
    expect(captured?.headers.authorization).toBe(expected)
  })

  it('does not clobber an explicit Authorization header set in Headers tab', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/basic'),
      headers: [{ id: '1', key: 'Authorization', value: 'Bearer manual', enabled: true }],
      auth: { type: 'basic', basic: { username: 'x', password: 'y' } },
      timeout: 3000,
    })
    expect(captured?.headers.authorization).toBe('Bearer manual')
  })
})

// ─── bearer ──────────────────────────────────────────────────

describe('http.engine auth — bearer', () => {
  it('emits Authorization: Bearer <token> by default', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/bearer'),
      auth: { type: 'bearer', bearer: { token: 'abc.def.ghi' } },
      timeout: 3000,
    })
    expect(captured?.headers.authorization).toBe('Bearer abc.def.ghi')
  })

  it('honours a custom prefix (e.g. Token)', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/bearer'),
      auth: { type: 'bearer', bearer: { token: 'xyz', prefix: 'Token' } },
      timeout: 3000,
    })
    expect(captured?.headers.authorization).toBe('Token xyz')
  })
})

// ─── api-key ─────────────────────────────────────────────────

describe('http.engine auth — api-key', () => {
  it('places the key in a custom header when in === "header"', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/apikey'),
      auth: { type: 'api-key', apiKey: { key: 'X-Api-Key', value: 'secret-123', in: 'header' } },
      timeout: 3000,
    })
    expect(captured?.headers['x-api-key']).toBe('secret-123')
    // Must NOT also leak into the query string.
    expect(captured?.url).toBe('/apikey')
  })

  it('places the key in the query string when in === "query"', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/apikey'),
      auth: { type: 'api-key', apiKey: { key: 'api_key', value: 'q-value', in: 'query' } },
      timeout: 3000,
    })
    expect(captured?.url).toContain('api_key=q-value')
    // Not added as a header.
    expect(captured?.headers['api_key']).toBeUndefined()
  })
})

// ─── oauth2 ──────────────────────────────────────────────────

describe('http.engine auth — oauth2', () => {
  it('emits Authorization: Bearer <oauth2 token>', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/oauth2'),
      auth: { type: 'oauth2', oauth2: { token: 'oauth-access-token' } },
      timeout: 3000,
    })
    expect(captured?.headers.authorization).toBe('Bearer oauth-access-token')
  })
})

// ─── digest ──────────────────────────────────────────────────
//
// The engine delegates to axios `config.auth`, which (axios 1.16) has no
// digest handshake and emits a Basic header. These tests pin that real
// behaviour. The second test stands up a 401 WWW-Authenticate challenge to
// prove the engine does NOT perform the digest response dance (no second
// request carrying a `Digest ... response=` header).

describe('http.engine auth — digest (currently basic-equivalent)', () => {
  it('emits Authorization: Basic base64(user:pass) — engine has no real digest', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/digest'),
      auth: { type: 'digest', digest: { username: 'mufasa', password: 'Circle Of Life' } },
      timeout: 3000,
    })
    const auth = captured?.headers.authorization ?? ''
    // It is a Basic header, decoding back to the exact credentials.
    expect(auth.startsWith('Basic ')).toBe(true)
    const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf8')
    expect(decoded).toBe('mufasa:Circle Of Life')
    // Explicitly NOT a digest header.
    expect(auth.startsWith('Digest ')).toBe(false)
  })

  it('does NOT answer a 401 WWW-Authenticate digest challenge with a Digest response', async () => {
    reset()
    let requestCount = 0
    customHandler = (_req, res) => {
      requestCount++
      if (requestCount === 1) {
        // First hit: issue an RFC 2617 digest challenge.
        res.writeHead(401, {
          'WWW-Authenticate':
            'Digest realm="testrealm@host.com", qop="auth", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
        })
        res.end('challenge')
        return true
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return true
    }
    const res = await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/digest'),
      auth: { type: 'digest', digest: { username: 'mufasa', password: 'Circle Of Life' } },
      timeout: 3000,
    })
    // Engine does not retry with a digest response — it sees the 401 directly.
    expect(res.status).toBe(401)
    expect(requestCount).toBe(1)
    // The lone request carried a Basic (not Digest) header.
    expect((captured?.headers.authorization ?? '').startsWith('Basic ')).toBe(true)
  })
})

// ─── ntlm ────────────────────────────────────────────────────
//
// Also `config.auth`-based → Basic header with DOMAIN\username. No NTLMSSP
// Type-1 Negotiate message is produced by the engine.

describe('http.engine auth — ntlm (currently basic-equivalent)', () => {
  it('encodes DOMAIN\\username:password as Basic — no NTLMSSP Type-1 message', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/ntlm'),
      auth: {
        type: 'ntlm',
        ntlm: { username: 'jdoe', password: 'p@ss', domain: 'CORP' },
      },
      timeout: 3000,
    })
    const auth = captured?.headers.authorization ?? ''
    expect(auth.startsWith('Basic ')).toBe(true)
    const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf8')
    expect(decoded).toBe('CORP\\jdoe:p@ss')
    // Explicitly NOT a Negotiate / NTLMSSP handshake.
    expect(auth.startsWith('Negotiate ')).toBe(false)
    expect(auth.startsWith('NTLM ')).toBe(false)
    // The NTLMSSP signature base64-encodes to a string starting "TlRMTVNTUA".
    expect(auth).not.toContain('TlRMTVNTUA')
  })

  it('omits the domain prefix when no domain is supplied', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/ntlm'),
      auth: { type: 'ntlm', ntlm: { username: 'solo', password: 'pw' } },
      timeout: 3000,
    })
    const auth = captured?.headers.authorization ?? ''
    const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf8')
    expect(decoded).toBe('solo:pw')
  })
})

// ─── hawk ────────────────────────────────────────────────────
//
// ts + nonce are generated internally (not injectable), so we assert the
// structure of every field AND recompute the MAC from the ts/nonce the engine
// emitted — that turns the "mac is base64" smoke check into a real
// cryptographic round-trip against the engine's own normalized-string format.

describe('http.engine auth — hawk', () => {
  function parseHawk(header: string): Record<string, string> {
    // `Hawk id="...", ts="...", nonce="...", mac="..."`
    const out: Record<string, string> = {}
    const body = header.replace(/^Hawk\s+/, '')
    for (const m of body.matchAll(/(\w+)="([^"]*)"/g)) {
      out[m[1]] = m[2]
    }
    return out
  }

  it('emits a structurally complete Hawk header and a MAC that round-trips (sha256)', async () => {
    reset()
    await executeHttpRequest({
      method: 'POST',
      url: baseUrl('/hawk/resource?a=1'),
      auth: {
        type: 'hawk',
        hawk: { authId: 'dh37fgj492je', authKey: 'werxhqb98rpaxn39848xrunpaw3489ru', algorithm: 'sha256' },
      },
      timeout: 3000,
    })
    const auth = captured?.headers.authorization ?? ''
    expect(auth.startsWith('Hawk ')).toBe(true)
    const f = parseHawk(auth)
    expect(f.id).toBe('dh37fgj492je')
    expect(f.ts).toMatch(/^\d+$/)
    expect(f.nonce).toMatch(/^\w+$/)
    expect(f.mac).toMatch(/^[A-Za-z0-9+/]+=*$/) // base64

    // Recompute the MAC from the engine's emitted ts/nonce using the same
    // normalized-string layout the engine uses (RFC-ish Hawk header MAC).
    // The URL carries an explicit port, so the engine signs that port (it only
    // falls back to 80/443 when the URL omits it).
    const normalized =
      [
        'hawk.1.header',
        f.ts,
        f.nonce,
        'POST',
        '/hawk/resource?a=1',
        '127.0.0.1',
        String(port),
        '', // payload hash (none)
        '', // ext
      ].join('\n') + '\n'
    const expectedMac = createHmac('sha256', 'werxhqb98rpaxn39848xrunpaw3489ru')
      .update(normalized)
      .digest('base64')
    expect(f.mac).toBe(expectedMac)
  })

  it('uses HMAC-SHA1 when algorithm is sha1', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/hawk'),
      auth: {
        type: 'hawk',
        hawk: { authId: 'idy', authKey: 'keyz', algorithm: 'sha1' },
      },
      timeout: 3000,
    })
    const f = parseHawk(captured?.headers.authorization ?? '')
    const normalized =
      ['hawk.1.header', f.ts, f.nonce, 'GET', '/hawk', '127.0.0.1', String(port), '', ''].join(
        '\n',
      ) + '\n'
    const expectedMac = createHmac('sha1', 'keyz').update(normalized).digest('base64')
    expect(f.mac).toBe(expectedMac)
    // sha1 MAC is 20 bytes → 28 base64 chars.
    expect(Buffer.from(f.mac, 'base64').length).toBe(20)
  })
})

// ─── aws-signature (SigV4) ───────────────────────────────────
//
// The signing date (`new Date()`) is generated internally and not injectable,
// so a fully fixed-input deterministic signature isn't possible. Instead we
// capture the `X-Amz-Date` the engine emitted and RE-DERIVE the full SigV4
// signature from it — a real cryptographic verification (not just a "looks
// like hex" structural check). We also assert the canonical Authorization
// field layout and the payload-hash header.

describe('http.engine auth — aws-signature (SigV4)', () => {
  const accessKey = 'AKIDEXAMPLE'
  const secretKey = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
  const region = 'us-east-1'
  const service = 'execute-api'

  function awsSigningKey(secret: string, dateStamp: string, reg: string, svc: string): Buffer {
    const kDate = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest()
    const kRegion = createHmac('sha256', kDate).update(reg).digest()
    const kService = createHmac('sha256', kRegion).update(svc).digest()
    return createHmac('sha256', kService).update('aws4_request').digest()
  }

  it('emits a canonical AWS4-HMAC-SHA256 Authorization header that re-derives correctly', async () => {
    reset()
    const bodyContent = '{"hello":"world"}'
    await executeHttpRequest({
      method: 'POST',
      url: baseUrl('/aws/path?b=2&a=1'),
      body: { type: 'json', content: bodyContent },
      auth: {
        type: 'aws-signature',
        awsSignature: { accessKey, secretKey, region, service },
      },
      timeout: 3000,
    })

    const auth = captured?.headers.authorization ?? ''
    const amzDate = String(captured?.headers['x-amz-date'] ?? '')
    const payloadHashHeader = String(captured?.headers['x-amz-content-sha256'] ?? '')

    // Structural: the canonical field layout.
    expect(amzDate).toMatch(/^\d{8}T\d{6}Z$/)
    const credScope = `${amzDate.slice(0, 8)}/${region}/${service}/aws4_request`
    const m = auth.match(
      /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/,
    )
    expect(m).not.toBeNull()
    const [, credential, signedHeaders, signature] = m!
    expect(credential).toBe(`${accessKey}/${credScope}`)
    expect(signedHeaders).toBe('host;x-amz-date')

    // Payload hash header matches SHA256(body).
    const expectedPayloadHash = createHash('sha256').update(bodyContent).digest('hex')
    expect(payloadHashHeader).toBe(expectedPayloadHash)

    // Cryptographic re-derivation of the signature from the engine's amzDate.
    // NOTE: the engine signs `parsed.hostname` (no port) in the canonical
    // `host:` line even though the on-the-wire Host header includes the port.
    const dateStamp = amzDate.slice(0, 8)
    const canonicalHeaders = `host:127.0.0.1\nx-amz-date:${amzDate}\n`
    const canonicalRequest = [
      'POST',
      '/aws/path',
      'b=2&a=1', // engine forwards the query verbatim (no sorting)
      canonicalHeaders,
      'host;x-amz-date',
      expectedPayloadHash,
    ].join('\n')
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n')
    const signingKey = awsSigningKey(secretKey, dateStamp, region, service)
    const expectedSignature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    expect(signature).toBe(expectedSignature)
  })

  it('hashes the empty payload for a body-less GET', async () => {
    reset()
    await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/aws'),
      auth: {
        type: 'aws-signature',
        awsSignature: { accessKey, secretKey, region, service },
      },
      timeout: 3000,
    })
    const payloadHashHeader = String(captured?.headers['x-amz-content-sha256'] ?? '')
    // SHA256 of the empty string.
    expect(payloadHashHeader).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})
