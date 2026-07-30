/**
 * Faz F — Live TLS/SSL endpoint inspector (#64).
 *
 * All correctness is proven against LOCAL `tls.createServer` fixtures with
 * certs minted in-test (node-forge) — self-signed + local-CA-signed leaf. No
 * external network is required for any assertion. The present-vs-validate lever
 * is exercised offline: a local-CA leaf is `authorized:false` UNLESS the CA is
 * supplied via `caCerts` (F-2 merge).
 *
 * The ONE case that genuinely needs the public internet (proving system roots
 * survive the caCerts merge against a real endpoint) is gated behind
 * TLS_INSPECT_NET=1; the deterministic offline half (local-CA leaf stays
 * authorized when extra caCerts are ALSO supplied) is always run.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import * as tls from 'node:tls'
import type { AddressInfo } from 'node:net'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { setupHandlerHarness, makeElectronMock } from './handlers/helpers'
import {
  inspectTls,
  buildConnectOptions,
  classifyExpiry,
  type TlsInspectResult,
} from '../../src/main/protocols/tls-inspect.engine'
import { KeystoreEngine, KeystoreValidationException } from '../../src/main/lib/keystore'

// ─── Cert minting (node-forge) ────────────────────────────────────────────

interface Minted {
  cert: forge.pki.Certificate
  key: forge.pki.rsa.PrivateKey
  certPem: string
  keyPem: string
}

interface SanEntry {
  type: number // 2 = DNS, 7 = IP
  value?: string
  ip?: string
}

function randomSerial(): string {
  // Leading '01' keeps the high bit clear so it is not read as a negative int.
  return '01' + forge.util.bytesToHex(forge.random.getBytesSync(8))
}

function mintCert(args: {
  cn: string
  sans?: SanEntry[]
  notBefore: Date
  notAfter: Date
  ca?: Minted
  isCa?: boolean
}): Minted {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  cert.validity.notBefore = args.notBefore
  cert.validity.notAfter = args.notAfter
  const subject = [{ name: 'commonName', value: args.cn }]
  cert.setSubject(subject)
  cert.setIssuer(args.ca ? args.ca.cert.subject.attributes : subject)

  const extensions: Parameters<typeof cert.setExtensions>[0] = []
  if (args.isCa) extensions.push({ name: 'basicConstraints', cA: true })
  if (args.sans && args.sans.length > 0) {
    extensions.push({ name: 'subjectAltName', altNames: args.sans })
  }
  cert.setExtensions(extensions)

  cert.sign(args.ca ? args.ca.key : keys.privateKey, forge.md.sha256.create())
  return {
    cert,
    key: keys.privateKey,
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  }
}

/** Peer-cert CN can be typed `string | string[]`; normalise to a single name. */
function cnOf(cn: string | string[] | undefined): string | undefined {
  return Array.isArray(cn) ? cn[0] : cn
}

// ─── Local TLS fixture server ─────────────────────────────────────────────

interface Fixture {
  server: tls.Server
  port: number
  /** Set by mTLS servers — the client cert subject CN the server saw. */
  lastClientCn?: string
}

function startServer(opts: tls.TlsOptions): Promise<Fixture> {
  return new Promise((resolve) => {
    const fixture: Fixture = { server: null as unknown as tls.Server, port: 0 }
    const server = tls.createServer(opts, (socket) => {
      if (opts.requestCert) {
        const peer = socket.getPeerCertificate()
        if (peer && peer.subject) fixture.lastClientCn = cnOf(peer.subject.CN)
      }
      socket.on('error', () => {})
      socket.on('data', () => {})
      socket.end()
    })
    server.on('error', () => {})
    server.listen(0, '127.0.0.1', () => {
      fixture.server = server
      fixture.port = (server.address() as AddressInfo).port
      resolve(fixture)
    })
  })
}

function closeServer(f: Fixture | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!f?.server) return resolve()
    f.server.close(() => resolve())
  })
}

// ─── Shared material ──────────────────────────────────────────────────────

const YEAR = 365 * 24 * 60 * 60 * 1000
let ca: Minted
let caLeaf: Minted // CA-signed, SAN localhost + 127.0.0.1
let selfLeaf: Minted // self-signed, SAN localhost
let client: Minted // CA-signed client cert for mTLS
let tmp: string

let selfServer: Fixture
let caServer: Fixture
let mtlsServer: Fixture

beforeAll(async () => {
  const now = Date.now()
  const nb = new Date(now - YEAR)
  const na = new Date(now + YEAR)

  ca = mintCert({ cn: 'Testnizer Test CA', notBefore: nb, notAfter: na, isCa: true })
  caLeaf = mintCert({
    cn: 'localhost',
    sans: [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
    ],
    notBefore: nb,
    notAfter: na,
    ca,
  })
  selfLeaf = mintCert({
    cn: 'localhost',
    sans: [{ type: 2, value: 'localhost' }],
    notBefore: nb,
    notAfter: na,
  })
  client = mintCert({ cn: 'test-client', notBefore: nb, notAfter: na, ca })

  tmp = mkdtempSync(join(tmpdir(), 'tls-inspect-'))
  writeFileSync(join(tmp, 'client.crt'), client.certPem)
  writeFileSync(join(tmp, 'client.key'), client.keyPem)

  selfServer = await startServer({ key: selfLeaf.keyPem, cert: selfLeaf.certPem })
  // Present the full chain (leaf + CA) so the walk sees an intermediate/root.
  caServer = await startServer({ key: caLeaf.keyPem, cert: caLeaf.certPem + ca.certPem })
  mtlsServer = await startServer({
    key: caLeaf.keyPem,
    cert: caLeaf.certPem + ca.certPem,
    ca: [ca.certPem],
    requestCert: true,
    rejectUnauthorized: false,
  })
}, 30_000)

afterAll(async () => {
  await Promise.all([closeServer(selfServer), closeServer(caServer), closeServer(mtlsServer)])
})

// ─── classifyExpiry (pure) ────────────────────────────────────────────────

describe('classifyExpiry', () => {
  const now = new Date('2026-07-23T00:00:00Z')

  it('valid — far from expiry', () => {
    expect(classifyExpiry('2027-07-23T00:00:00Z', now)).toBe('valid')
  })

  it('expiring — within the 30-day warn window (+15d)', () => {
    expect(classifyExpiry('2026-08-07T00:00:00Z', now)).toBe('expiring')
  })

  it('expired — past notAfter', () => {
    expect(classifyExpiry('2026-07-22T00:00:00Z', now)).toBe('expired')
  })

  it('boundaries — exactly at warn edge is expiring, just past it is valid', () => {
    // +30d exactly ⇒ expiring (<= warnDays)
    expect(classifyExpiry('2026-08-22T00:00:00Z', now)).toBe('expiring')
    // +31d ⇒ valid
    expect(classifyExpiry('2026-08-23T00:00:01Z', now)).toBe('valid')
  })

  it('at-instant expiry (remaining <= 0) is expired', () => {
    expect(classifyExpiry('2026-07-23T00:00:00Z', now)).toBe('expired')
  })

  it('accepts a Date and a custom warnDays', () => {
    expect(classifyExpiry(new Date('2026-07-30T00:00:00Z'), now, 3)).toBe('valid')
    expect(classifyExpiry(new Date('2026-07-25T00:00:00Z'), now, 3)).toBe('expiring')
  })

  it('unparseable notAfter is treated as expired (fail closed)', () => {
    expect(classifyExpiry('not-a-date', now)).toBe('expired')
  })
})

// ─── Engine: self-signed present + not-authorized ─────────────────────────

describe('inspectTls — self-signed endpoint (PRESENT vs VALIDATE)', () => {
  it('presents a chain but reports authorized:false with an authorizationError', async () => {
    const r = await inspectTls({
      host: '127.0.0.1',
      port: selfServer.port,
      servername: 'localhost',
      timeoutMs: 4000,
    })
    expect(r.ok).toBe(true)
    expect(r.chain.length).toBeGreaterThanOrEqual(1)
    expect(r.selfSigned).toBe(true)
    expect(r.authorized).toBe(false)
    expect(r.authorizationError).toBeTruthy()
    expect(r.authorizationError).toMatch(/SELF_SIGNED|SELF-SIGNED/i)
    // Leaf metadata surfaced from buildCertificateInfo.
    expect(r.chain[0].subjectDN).toContain('localhost')
    expect(r.chain[0].publicKeyAlgorithm).toBe('RSA')
    expect(r.chain[0].keySize).toBe(2048)
    expect(r.protocol).toMatch(/^TLSv1\.[23]$/)
    expect(r.cipher).not.toBeNull()
  })

  it('walks the presented chain leaf-first for a CA-issued server', async () => {
    const r = await inspectTls({
      host: '127.0.0.1',
      port: caServer.port,
      servername: 'localhost',
      timeoutMs: 4000,
    })
    expect(r.ok).toBe(true)
    // Leaf then issuing CA.
    expect(r.chain.length).toBe(2)
    expect(r.chain[0].subjectDN).toContain('localhost')
    expect(r.chain[1].subjectDN).toContain('Testnizer Test CA')
    expect(r.selfSigned).toBe(false)
  })
})

// ─── Engine: caCerts merge (F-2) ──────────────────────────────────────────

describe('inspectTls — caCerts merge makes a local-CA leaf authorized (F-2)', () => {
  it('is authorized:false WITHOUT the CA (present-vs-validate lever)', async () => {
    const r = await inspectTls({
      host: '127.0.0.1',
      port: caServer.port,
      servername: 'localhost',
      timeoutMs: 4000,
    })
    expect(r.authorized).toBe(false)
    expect(r.authorizationError).toMatch(/UNABLE_TO_(GET|VERIFY)|SELF_SIGNED_CERT_IN_CHAIN/i)
  })

  it('becomes authorized:true when the CA is supplied via caCerts (merged with system roots)', async () => {
    const r = await inspectTls({
      host: '127.0.0.1',
      port: caServer.port,
      servername: 'localhost',
      caCerts: [Buffer.from(ca.certPem, 'utf8')],
      timeoutMs: 4000,
    })
    expect(r.ok).toBe(true)
    expect(r.authorized).toBe(true)
    expect(r.authorizationError).toBeUndefined()
    expect(r.hostnameValid).toBe(true)
  })

  it.runIf(process.env.TLS_INSPECT_NET === '1')(
    'NETWORK: a system-trusted public leaf stays authorized when extra caCerts are also supplied',
    async () => {
      const r = await inspectTls({
        host: 'example.com',
        port: 443,
        servername: 'example.com',
        caCerts: [Buffer.from(ca.certPem, 'utf8')],
        timeoutMs: 8000,
      })
      expect(r.ok).toBe(true)
      // The MERGE (not replace) keeps system roots so a real public cert still
      // validates even though we ALSO injected an unrelated local CA.
      expect(r.authorized).toBe(true)
    },
  )
})

// ─── Engine: buildConnectOptions CA-merge property (F-2, offline) ─────────
// Pins merge-not-replace WITHOUT the network. A regression to bare
// `ca: opts.caCerts` would drop the system roots and be caught here, closing
// the gap where only the TLS_INSPECT_NET=1 case proved the property.

describe('buildConnectOptions — F-2 CA merge (deterministic, offline)', () => {
  const extra = Buffer.from(
    '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n',
    'utf8',
  )

  it('OMITS ca entirely when no caCerts supplied (Node uses the default store)', () => {
    const o = buildConnectOptions({ host: 'h' }, 'h', 443, 'h')
    expect(o.ca).toBeUndefined()
  })

  it('MERGES extra anchors with the full system root store (never replaces it)', () => {
    const roots = tls.rootCertificates
    expect(roots.length).toBeGreaterThan(0) // sanity: system roots exist
    const o = buildConnectOptions({ host: 'h', caCerts: [extra] }, 'h', 443, 'h')
    expect(Array.isArray(o.ca)).toBe(true)
    const ca = o.ca as Array<string | Buffer>
    // length === all system roots + the one extra anchor → proves MERGE, not replace
    expect(ca.length).toBe(roots.length + 1)
    // every system root is still present, and the extra anchor is appended last
    expect(ca.slice(0, roots.length)).toEqual([...roots])
    expect(ca[ca.length - 1]).toBe(extra)
  })

  it('appends multiple caCerts after the system roots in order', () => {
    const roots = tls.rootCertificates
    const a = Buffer.from('A')
    const b = Buffer.from('B')
    const o = buildConnectOptions({ host: 'h', caCerts: [a, b] }, 'h', 443, 'h')
    const ca = o.ca as Array<string | Buffer>
    expect(ca.length).toBe(roots.length + 2)
    expect(ca[ca.length - 2]).toBe(a)
    expect(ca[ca.length - 1]).toBe(b)
  })
})

// ─── Engine: hostnameValid via checkServerIdentity (F-1) ──────────────────

describe('inspectTls — hostnameValid via tls.checkServerIdentity (F-1)', () => {
  it('true when servername matches a SAN', async () => {
    const r = await inspectTls({
      host: '127.0.0.1',
      port: caServer.port,
      servername: 'localhost',
      timeoutMs: 4000,
    })
    expect(r.hostnameValid).toBe(true)
    expect(typeof r.hostnameValid).toBe('boolean')
  })

  it('false when servername is not in the SANs', async () => {
    const r = await inspectTls({
      host: '127.0.0.1',
      port: caServer.port,
      servername: 'not-in-san.example.com',
      timeoutMs: 4000,
    })
    expect(r.hostnameValid).toBe(false)
    // A pure boolean, never the string checkHost would return.
    expect(typeof r.hostnameValid).toBe('boolean')
    // …and this must be a real FINDING, not the placeholder `baseResult` fills
    // in on a transport failure — which is also `hostnameValid:false`. Without
    // these two lines the test passes even when nothing was inspected.
    expect(r.ok).toBe(true)
    expect(r.chain.length).toBeGreaterThan(0)
  })

  it('an EXPIRED certificate still reports ok:true — it is a finding, not a failure', async () => {
    // The renderer hides certificate verdicts when `ok` is false, so the whole
    // "misleading badges" fix rests on expired/untrusted/mismatched certificates
    // keeping `ok:true`. That was covered for self-signed and untrusted but
    // never for expiry, because every fixture was minted with a future notAfter.
    const past = mintCert({
      cn: 'localhost',
      sans: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
      ],
      notBefore: new Date(Date.now() - 2 * YEAR),
      notAfter: new Date(Date.now() - YEAR),
    })
    const server = await startServer({ cert: past.certPem, key: past.keyPem })
    try {
      const r = await inspectTls({ host: '127.0.0.1', port: server.port, timeoutMs: 4000 })
      expect(r.ok).toBe(true)
      expect(r.chain.length).toBeGreaterThan(0)
      expect(r.expired).toBe(true)
      expect(r.validityStatus).toBe('expired')
      expect(r.daysToExpiry).toBeLessThan(0)
    } finally {
      await closeServer(server)
    }
  })
})

// ─── Engine: legacy TLS handled error (F-3) ───────────────────────────────

describe('inspectTls — legacy TLS 1.0/1.1 handled error (F-3)', () => {
  it('returns ok:false with a handled string for maxVersion TLSv1 — NOT a raw throw', async () => {
    const r = await inspectTls({
      host: '127.0.0.1',
      port: caServer.port,
      servername: 'localhost',
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1',
      timeoutMs: 4000,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('Electron cannot negotiate TLS 1.0/1.1 for inspection')
    // Must not have leaked a BoringSSL/TypeError string.
    expect(r.error).not.toMatch(/ERR_SSL|BoringSSL|TypeError|RangeError|INVALID_COMMAND/i)
  })

  it('also refuses minVersion TLSv1.1', async () => {
    const r = await inspectTls({
      host: '127.0.0.1',
      port: caServer.port,
      minVersion: 'TLSv1.1',
      timeoutMs: 4000,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/cannot negotiate TLS 1\.0\/1\.1/)
  })

  it('never throws — resolves for every legacy request', async () => {
    await expect(
      inspectTls({ host: '127.0.0.1', port: caServer.port, maxVersion: 'TLSv1' }),
    ).resolves.toMatchObject({ ok: false })
  })
})

// ─── Engine: cipher forwarding (F-4) + transport failures ─────────────────

describe('inspectTls — cipher control + transport handling', () => {
  it('forwards an explicit cipher string without throwing', async () => {
    const r = await inspectTls({
      host: '127.0.0.1',
      port: caServer.port,
      servername: 'localhost',
      ciphers: 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256',
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
      timeoutMs: 4000,
    })
    expect(r.ok).toBe(true)
    expect(r.protocol).toBe('TLSv1.2')
  })

  it('returns ok:false with an error for a missing host', async () => {
    const r = await inspectTls({ host: '   ' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Host is required/)
  })

  it('returns ok:false (handled) for a refused connection', async () => {
    const r = await inspectTls({ host: '127.0.0.1', port: 1, timeoutMs: 3000 })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('honours the timeout and destroys the socket', async () => {
    // 10.255.255.1 is a non-routable address — connect stalls until timeout.
    const r = await inspectTls({ host: '10.255.255.1', port: 443, timeoutMs: 1200 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/timed out|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i)
  }, 6000)
})

// ─── Engine: file-source mTLS client cert attach (F-6) ────────────────────

describe('inspectTls — mTLS client cert reaches the wire (F-6, file source)', () => {
  it('attaches file-read client cert buffers so the server sees the client cert', async () => {
    // Observe the server side deterministically: the client engine resolves on
    // its own `secureConnect` and destroys the socket, which can run a tick
    // before the server's connection callback — so await the server observation.
    const seenCn = new Promise<string | undefined>((resolve) => {
      mtlsServer.server.once('secureConnection', (socket) => {
        const peer = (socket as tls.TLSSocket).getPeerCertificate()
        resolve(peer && peer.subject ? cnOf(peer.subject.CN) : undefined)
      })
    })
    const r = await inspectTls({
      host: '127.0.0.1',
      port: mtlsServer.port,
      servername: 'localhost',
      // Pin TLS 1.2 so the client Certificate is delivered mid-handshake and
      // the server completes BEFORE the client fires secureConnect (in TLS 1.3
      // the client cert rides the final flight and the inspector's immediate
      // socket.destroy() can drop it before the server reads it).
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
      caCerts: [Buffer.from(ca.certPem, 'utf8')],
      clientCert: {
        cert: Buffer.from(client.certPem, 'utf8'),
        key: Buffer.from(client.keyPem, 'utf8'),
      },
      timeoutMs: 4000,
    })
    expect(r.ok).toBe(true)
    // The server recorded the client CN it received during the handshake.
    expect(await seenCn).toBe('test-client')
  })
})

// ─── Handler: envelope + file-source resolution + no-leak ─────────────────

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())
const { registerTlsHandlers, buildInspectOptions } = await import('../../src/main/ipc/tls.handler')

beforeEach(() => {
  harness.reset()
  registerTlsHandlers()
})

describe('tls:inspect handler', () => {
  it('wraps the result in the {success,data} envelope', async () => {
    const res = (await harness.invoke('tls:inspect', {
      host: '127.0.0.1',
      port: caServer.port,
      servername: 'localhost',
      timeoutMs: 4000,
    })) as { success: boolean; data?: TlsInspectResult }
    expect(res.success).toBe(true)
    expect(res.data?.chain.length).toBeGreaterThanOrEqual(1)
  })

  it('resolves a file-source client cert into buffers (buildInspectOptions, F-6)', () => {
    const opts = buildInspectOptions({
      host: '127.0.0.1',
      clientCert: {
        kind: 'file',
        certPath: join(tmp, 'client.crt'),
        keyPath: join(tmp, 'client.key'),
      },
    })
    expect(Buffer.isBuffer(opts.clientCert?.cert)).toBe(true)
    expect(Buffer.isBuffer(opts.clientCert?.key)).toBe(true)
    expect(opts.clientCert?.cert?.toString('utf8')).toContain('BEGIN CERTIFICATE')
    // No leak: file-source key stays a Buffer in main — it never crosses IPC.
  })

  it('decodes base64 caCerts and resolves inline client cert', () => {
    const opts = buildInspectOptions({
      host: 'h',
      caCerts: [Buffer.from(ca.certPem, 'utf8').toString('base64')],
      clientCert: { kind: 'inline', certPem: client.certPem, keyPem: client.keyPem },
    })
    expect(opts.caCerts?.length).toBe(1)
    expect(opts.caCerts?.[0].toString('utf8')).toContain('BEGIN CERTIFICATE')
    expect(Buffer.isBuffer(opts.clientCert?.cert)).toBe(true)
  })

  it('rejects an inline client cert that is not a certificate (fail loud)', () => {
    expect(() =>
      buildInspectOptions({
        host: 'h',
        clientCert: { kind: 'inline', certPem: 'not a cert' },
      }),
    ).toThrow()
  })

  it('the handler JSON response carries NO private key material (NO-LEAK)', async () => {
    const res = (await harness.invoke('tls:inspect', {
      host: '127.0.0.1',
      port: mtlsServer.port,
      servername: 'localhost',
      caCerts: [Buffer.from(ca.certPem, 'utf8').toString('base64')],
      clientCert: { kind: 'inline', certPem: client.certPem, keyPem: client.keyPem },
      timeoutMs: 4000,
    })) as { success: boolean; data?: TlsInspectResult }
    expect(res.success).toBe(true)
    const json = JSON.stringify(res)
    expect(json).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/)
    // The client private key bytes we passed in must not echo back anywhere.
    const keyBody = client.keyPem
      .replace(/-----[^-]+-----/g, '')
      .replace(/\s+/g, '')
      .slice(0, 64)
    expect(json).not.toContain(keyBody)
  })
})

// ─── F-5 verify: existing keystore importTrustedCert reject behavior ──────
//
// The TLS inspector "Add as trusted" link calls the EXISTING
// window.api.keystore.importTrustedCert (B3) — NOT a duplicated method. These
// pin that the existing method accepts a real cert and rejects private-key /
// garbage input. (Oversized >1 MiB is NOT capped by the existing method — see
// the report's F-5 hardening flag; not asserted here to avoid pinning a gap.)

describe('keystore.importTrustedCertificate (existing, F-5 reuse) reject behavior', () => {
  it('accepts a valid certificate PEM', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', 'pw')
    const meta = engine.importTrustedCertificate(sessionId, {
      alias: 'trusted-ca',
      certificateContent: ca.certPem,
    })
    expect(meta.aliasCount).toBe(1)
  })

  it('rejects a private-key PEM (no CERTIFICATE block)', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', 'pw')
    expect(() =>
      engine.importTrustedCertificate(sessionId, {
        alias: 'k',
        certificateContent: client.keyPem,
      }),
    ).toThrow(KeystoreValidationException)
  })

  it('rejects garbage input', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', 'pw')
    expect(() =>
      engine.importTrustedCertificate(sessionId, {
        alias: 'g',
        certificateContent: 'this is not a certificate at all',
      }),
    ).toThrow()
  })
})
