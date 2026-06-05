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
 * oauth2, digest (MD5 + SHA-256 + RFC 2069 no-qop), ntlm (full NTLMSSP
 * handshake), hawk, aws-signature (SigV4).
 *
 * digest and ntlm exercise the engine's REAL challenge/response handshakes
 * (added when the earlier silent Basic-fallback was fixed): the local server
 * issues a 401 challenge and each test asserts the engine answers with a
 * correct Digest `response=` hash, or completes the NTLMSSP Type 1 → Type 2 →
 * Type 3 exchange — never a `Basic` header.
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

afterAll(
  () =>
    new Promise<void>((resolve) => {
      // NTLM forces keep-alive sockets; terminate them so close() actually fires.
      ;(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
      server.close(() => resolve())
    }),
)

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

// ─── digest (RFC 2617 / RFC 7616) ────────────────────────────
//
// The engine sends the request, reads the 401 `WWW-Authenticate: Digest`
// challenge, computes the response hash and resends. The server here validates
// that hash exactly (recomputing HA1/HA2/response), so a 200 proves the engine
// produced a cryptographically correct Digest answer — not a smoke check.

function md5hex(s: string): string {
  return createHash('md5').update(s).digest('hex')
}
function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}
function parseAuthParams(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  const body = header.replace(/^\w+\s+/, '')
  const re = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3]
  return out
}

const DIGEST_USER = 'mufasa'
const DIGEST_PASS = 'Circle Of Life'
const DIGEST_REALM = 'testrealm@host.com'
const DIGEST_NONCE = 'dcd98b7102dd2f0e8b11d0f600bfb0c093'

describe('http.engine auth — digest', () => {
  it('answers an MD5 / qop=auth challenge with a correct response hash', async () => {
    reset()
    const seen: string[] = []
    customHandler = (cap, res) => {
      const auth = (cap.headers.authorization as string) ?? ''
      seen.push(auth)
      if (!auth.startsWith('Digest ')) {
        res.writeHead(401, {
          'WWW-Authenticate': `Digest realm="${DIGEST_REALM}", qop="auth", nonce="${DIGEST_NONCE}", opaque="op-1"`,
        })
        res.end('challenge')
        return true
      }
      const p = parseAuthParams(auth)
      const ha1 = md5hex(`${DIGEST_USER}:${DIGEST_REALM}:${DIGEST_PASS}`)
      const ha2 = md5hex(`${cap.method}:${p.uri}`)
      const expected = md5hex(`${ha1}:${DIGEST_NONCE}:${p.nc}:${p.cnonce}:auth:${ha2}`)
      res.writeHead(p.response === expected ? 200 : 403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: p.response === expected }))
      return true
    }
    const res = await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/secure/resource'),
      auth: { type: 'digest', digest: { username: DIGEST_USER, password: DIGEST_PASS } },
      timeout: 5000,
    })
    expect(res.status).toBe(200) // server accepted our computed digest response
    expect(seen.length).toBe(2) // probe (401 challenge) + authenticated retry
    expect(seen[1].startsWith('Digest ')).toBe(true)
    const p = parseAuthParams(seen[1])
    expect(p.username).toBe(DIGEST_USER)
    expect(p.realm).toBe(DIGEST_REALM)
    expect(p.nonce).toBe(DIGEST_NONCE)
    expect(p.uri).toBe('/secure/resource')
    expect(p.qop).toBe('auth')
    expect(p.opaque).toBe('op-1')
    expect(p.response).toMatch(/^[0-9a-f]{32}$/)
  })

  it('uses SHA-256 when the challenge specifies algorithm=SHA-256 (RFC 7616)', async () => {
    reset()
    const seen: string[] = []
    customHandler = (cap, res) => {
      const auth = (cap.headers.authorization as string) ?? ''
      seen.push(auth)
      if (!auth.startsWith('Digest ')) {
        res.writeHead(401, {
          'WWW-Authenticate': `Digest realm="${DIGEST_REALM}", qop="auth", nonce="${DIGEST_NONCE}", algorithm=SHA-256`,
        })
        res.end('challenge')
        return true
      }
      const p = parseAuthParams(auth)
      const ha1 = sha256hex(`${DIGEST_USER}:${DIGEST_REALM}:${DIGEST_PASS}`)
      const ha2 = sha256hex(`${cap.method}:${p.uri}`)
      const expected = sha256hex(`${ha1}:${DIGEST_NONCE}:${p.nc}:${p.cnonce}:auth:${ha2}`)
      res.writeHead(p.response === expected ? 200 : 403)
      res.end('done')
      return true
    }
    const res = await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/secure/sha'),
      auth: { type: 'digest', digest: { username: DIGEST_USER, password: DIGEST_PASS } },
      timeout: 5000,
    })
    expect(res.status).toBe(200)
    expect(parseAuthParams(seen[1]).algorithm).toBe('SHA-256')
    // SHA-256 response digest is 64 hex chars, not MD5's 32.
    expect(parseAuthParams(seen[1]).response).toMatch(/^[0-9a-f]{64}$/)
  })

  it('falls back to the RFC 2069 (no-qop) response when the challenge omits qop', async () => {
    reset()
    const seen: string[] = []
    customHandler = (cap, res) => {
      const auth = (cap.headers.authorization as string) ?? ''
      seen.push(auth)
      if (!auth.startsWith('Digest ')) {
        res.writeHead(401, {
          'WWW-Authenticate': `Digest realm="${DIGEST_REALM}", nonce="${DIGEST_NONCE}"`,
        })
        res.end('challenge')
        return true
      }
      const p = parseAuthParams(auth)
      const ha1 = md5hex(`${DIGEST_USER}:${DIGEST_REALM}:${DIGEST_PASS}`)
      const ha2 = md5hex(`${cap.method}:${p.uri}`)
      const expected = md5hex(`${ha1}:${DIGEST_NONCE}:${ha2}`)
      res.writeHead(p.response === expected ? 200 : 403)
      res.end('done')
      return true
    }
    const res = await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/secure/legacy'),
      auth: { type: 'digest', digest: { username: DIGEST_USER, password: DIGEST_PASS } },
      timeout: 5000,
    })
    expect(res.status).toBe(200)
    const p = parseAuthParams(seen[1])
    // No-qop mode: the engine must omit qop/nc/cnonce entirely.
    expect(p.qop).toBeUndefined()
    expect(p.nc).toBeUndefined()
    expect(p.cnonce).toBeUndefined()
  })
})

// ─── ntlm (NTLMSSP, via axios-ntlm) ──────────────────────────
//
// Full handshake: the engine sends the request, the server answers 401 `NTLM`,
// axios-ntlm sends a Type 1 (Negotiate), the server returns a Type 2 challenge,
// axios-ntlm sends a Type 3, the server accepts (200). A valid NTLMv2-capable
// Type 2 (NTLM2_KEY + TARGET_INFO flags) is needed or createType3Message would
// fall down the legacy DES path.

const NTLM_TYPE2_B64 = 'TlRMTVNTUAACAAAAAAAAADAAAAABAIgAU3J2Tm9uY2UAAAAAAAAAAAQABAAwAAAAAAAAAA=='

function ntlmMessageType(auth: string | undefined): number {
  if (!auth) return 0
  const b64 = auth.replace(/^NTLM\s+/i, '')
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 12 || buf.toString('ascii', 0, 7) !== 'NTLMSSP') return -1
  return buf.readUInt32LE(8)
}

describe('http.engine auth — ntlm', () => {
  it('completes the NTLMSSP Type 1 → Type 2 → Type 3 handshake (never Basic)', async () => {
    reset()
    const seen: (string | undefined)[] = []
    customHandler = (cap, res) => {
      const auth = cap.headers.authorization as string | undefined
      seen.push(auth)
      const t = ntlmMessageType(auth)
      if (!auth) {
        res.writeHead(401, { 'WWW-Authenticate': 'NTLM' })
        res.end('need-ntlm')
      } else if (t === 1) {
        res.writeHead(401, { 'WWW-Authenticate': `NTLM ${NTLM_TYPE2_B64}` })
        res.end('type2')
      } else if (t === 3) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } else {
        res.writeHead(400)
        res.end('bad')
      }
      return true
    }
    const res = await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/ntlm/resource'),
      auth: {
        type: 'ntlm',
        ntlm: { username: 'jdoe', password: 'p@ss', domain: 'CORP', workstation: 'WS1' },
      },
      timeout: 8000,
    })
    expect(res.status).toBe(200) // handshake completed end-to-end
    const types = seen.map((a) => ntlmMessageType(a))
    expect(types).toContain(1) // Type 1 Negotiate was sent
    expect(types).toContain(3) // Type 3 Authenticate was sent
    // Never a Basic header — this is the regression guard for the old fallback.
    expect(seen.some((a) => (a ?? '').startsWith('Basic '))).toBe(false)
  })

  it('engages NTLM (Type 1 sent) even when no domain is supplied', async () => {
    reset()
    const seen: (string | undefined)[] = []
    customHandler = (cap, res) => {
      const auth = cap.headers.authorization as string | undefined
      seen.push(auth)
      const t = ntlmMessageType(auth)
      if (!auth) {
        res.writeHead(401, { 'WWW-Authenticate': 'NTLM' })
        res.end()
      } else if (t === 1) {
        res.writeHead(401, { 'WWW-Authenticate': `NTLM ${NTLM_TYPE2_B64}` })
        res.end()
      } else {
        res.writeHead(200)
        res.end('ok')
      }
      return true
    }
    const res = await executeHttpRequest({
      method: 'GET',
      url: baseUrl('/ntlm/nodomain'),
      auth: { type: 'ntlm', ntlm: { username: 'solo', password: 'pw' } },
      timeout: 8000,
    })
    expect(res.status).toBe(200)
    expect(seen.map((a) => ntlmMessageType(a))).toContain(3)
    expect(seen.some((a) => (a ?? '').startsWith('Basic '))).toBe(false)
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
