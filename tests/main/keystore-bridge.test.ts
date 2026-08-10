/**
 * Key Material Provider (#60) — `exportAliasPem` (the private-key extraction
 * door) + `resolveKeyMaterial` (the ONE main-process resolver).
 *
 * Every non-negotiable invariant in the design is pinned here as a test, not a
 * comment:
 *
 *  - ADDITIVE      — the `inline` (pasted PEM) and `file` (crt/key/pfx) arms
 *                    reproduce today's behaviour untouched; the keystore arms
 *                    are pure additions.
 *  - BLOCKER (§6)  — a client cert's chain goes out as ONE concatenated PEM
 *                    bundle in `certBuffer`; the resolver NEVER produces a
 *                    `ca` / `caCerts` / `caCertBuffers` field that could reach
 *                    `https.Agent({ ca })` and replace the server-trust roots.
 *  - R11           — STORE password on the keystores row, per-alias KEY
 *                    password on the certificates row; NULL store_password
 *                    (remember-off) uses `source.storePassword` or FAILS LOUD.
 *  - R12           — blob size cap PRE-decode + shape validation; file branch
 *                    realpath/symlink-resolve + size cap + keystore-AWARE
 *                    extension whitelist.
 *  - FAIL LOUD     — nothing resolvable throws a clear error, never silent-empty.
 *  - `jwk` need    — public/private JWK split with an RFC 7638 kid; the
 *                    publishable half never carries a private member.
 */

// reflect-metadata MUST load before @peculiar/x509 (see keystore.ts header).
import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { X509Certificate, createPrivateKey } from 'node:crypto'
import { createTestDb } from './handlers/helpers'

// secure-storage imports `electron`; stub it so the resolver can run in Node.
// `isEncryptionAvailable() === false` means `decryptSecret` passes NON-prefixed
// values straight through — so the fixtures below store plaintext blobs, which
// is exactly the documented plaintext-at-rest fallback path.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string): Buffer => Buffer.from(s),
    decryptString: (b: Buffer): string => b.toString('utf8'),
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { createKeystore } = await import('../../src/main/db/keystore.repo')
const { createCertificate } = await import('../../src/main/db/certificate.repo')
const { exportAliasPem, listKeyAliases } = await import('../../src/main/lib/keystore')
const { resolveKeyMaterial, KeyMaterialError } = await import('../../src/main/lib/keystore-bridge')
type MaterialSource = import('../../src/main/lib/keystore-bridge').MaterialSource

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/certs')
const fixture = (f: string): Buffer => readFileSync(join(CERTS, f))
const PW = 'testpassword'

const TMP = mkdtempSync(join(tmpdir(), 'testnizer-keymaterial-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

beforeEach(() => {
  testDb = createTestDb()
})

/** Persist a keystore fixture as a library row (plaintext blob — see mock above). */
function seedKeystore(file: string, opts: { remember?: boolean; type?: 'JKS' | 'PKCS12' } = {}) {
  const bytes = fixture(file)
  return createKeystore({
    name: file,
    type: opts.type ?? (file.endsWith('.jks') ? 'JKS' : 'PKCS12'),
    blob: bytes.toString('base64'),
    store_password: opts.remember === false ? null : PW,
    size_bytes: bytes.length,
  })
}

const countPemBlocks = (s: string): number => (s.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length

// ═══════════════════════════════════════════════════════════════════════════
// 1. exportAliasPem — the ONE private-key extraction door
// ═══════════════════════════════════════════════════════════════════════════

describe('exportAliasPem (keystore.ts)', () => {
  it('round-trips a JKS alias to leaf PEM + PKCS#8 key PEM + chain', () => {
    const out = exportAliasPem(fixture('client.jks'), PW, 'JKS', 'test-client')
    expect(out.certPem).toContain('-----BEGIN CERTIFICATE-----')
    expect(out.keyPem).toContain('-----BEGIN PRIVATE KEY-----')
    expect(out.chainPem.length).toBeGreaterThanOrEqual(1)
    // The exported leaf is byte-identical (public-key wise) to the fixture cert.
    const exported = new X509Certificate(out.certPem)
    const onDisk = new X509Certificate(fixture('client.crt'))
    expect(exported.publicKey.export({ format: 'pem', type: 'spki' })).toEqual(
      onDisk.publicKey.export({ format: 'pem', type: 'spki' }),
    )
    // The exported private key really belongs to that certificate.
    expect(exported.checkPrivateKey(createPrivateKey(out.keyPem))).toBe(true)
  })

  it('round-trips a PKCS#12 alias too', () => {
    const out = exportAliasPem(fixture('client.p12'), PW, 'PKCS12', 'test-client')
    expect(out.certPem).toContain('-----BEGIN CERTIFICATE-----')
    expect(out.keyPem).toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('R11: honours a per-alias KEY password different from the store password', () => {
    const out = exportAliasPem(
      fixture('keytool-diffpass.jks'),
      PW,
      'JKS',
      'diffpass',
      'differentpass',
    )
    expect(out.keyPem).toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('R11: FAILS LOUD when the distinct entry password is missing', () => {
    expect(() => exportAliasPem(fixture('keytool-diffpass.jks'), PW, 'JKS', 'diffpass')).toThrow(
      /Cannot recover key entry 'diffpass'/,
    )
  })

  it('fails loud on an unknown alias', () => {
    expect(() => exportAliasPem(fixture('client.jks'), PW, 'JKS', 'nope')).toThrow(
      /Alias not found in keystore: nope/,
    )
  })

  it('fails loud on a trusted-certificate (public-only) alias — no private key to extract', () => {
    expect(() => exportAliasPem(fixture('truststore.jks'), PW, 'JKS', 'testca')).toThrow(
      /holds no private key/,
    )
  })

  it('fails loud on a wrong store password', () => {
    expect(() => exportAliasPem(fixture('client.jks'), 'wrong', 'JKS', 'test-client')).toThrow()
  })

  it('listKeyAliases exposes only PUBLIC alias metadata', () => {
    expect(listKeyAliases(fixture('client.jks'), PW, 'JKS')).toEqual(['test-client'])
    expect(listKeyAliases(fixture('truststore.jks'), PW, 'JKS')).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. resolveKeyMaterial — inline (ADDITIVE: today's default paste path)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveKeyMaterial — inline source', () => {
  const certPem = fixture('client.crt').toString('utf8')
  const keyPem = fixture('client.pkcs8.key').toString('utf8')
  const caPem = fixture('ca.crt').toString('utf8')

  it("need 'pem' passes pasted PEM through unchanged", () => {
    const m = resolveKeyMaterial({ kind: 'inline', certPem, keyPem, passphrase: 'p' }, 'pem')
    expect(m.certPem).toBe(certPem.trim())
    expect(m.keyPem).toBe(keyPem.trim())
    expect(m.passphrase).toBe('p')
    expect(m.certBuffer).toBeUndefined()
  })

  it("need 'buffer' derives Buffers from the pasted PEM", () => {
    const m = resolveKeyMaterial({ kind: 'inline', certPem, keyPem }, 'buffer')
    expect(m.certBuffer?.toString('utf8')).toContain('-----BEGIN CERTIFICATE-----')
    expect(m.keyBuffer?.toString('utf8')).toContain('PRIVATE KEY')
    expect(m.chainBuffers).toBeUndefined()
  })

  it('public-only inline material returns NO private key', () => {
    const m = resolveKeyMaterial({ kind: 'inline', certPem }, 'buffer')
    expect(m.keyPem).toBeUndefined()
    expect(m.keyBuffer).toBeUndefined()
    expect(m.certBuffer?.toString('utf8')).not.toContain('PRIVATE KEY')
  })

  it('FAIL LOUD: empty pasted PEM throws instead of resolving to nothing', () => {
    expect(() => resolveKeyMaterial({ kind: 'inline', certPem: '   ' }, 'pem')).toThrow(
      KeyMaterialError,
    )
    expect(() => resolveKeyMaterial({ kind: 'inline', certPem: '' }, 'pem')).toThrow(
      /No key material/,
    )
  })

  it('BLOCKER: an inline chain lands in the cert BUNDLE, never in a ca-shaped field', () => {
    const m = resolveKeyMaterial({ kind: 'inline', certPem, keyPem, chainPem: [caPem] }, 'buffer')
    expect(countPemBlocks(m.certBuffer!.toString('utf8'))).toBe(2)
    expect(m.chainBuffers).toHaveLength(1)
    for (const k of Object.keys(m)) expect(k).not.toMatch(/^ca/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. resolveKeyMaterial — file (ADDITIVE: today's crt/key/pfx selection)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveKeyMaterial — file source', () => {
  it('reads a crt + key pair exactly as the classic path does', () => {
    const m = resolveKeyMaterial(
      {
        kind: 'file',
        certPath: join(CERTS, 'client.crt'),
        keyPath: join(CERTS, 'client.key'),
        passphrase: 'secret',
      },
      'pem',
    )
    expect(m.certPem).toBe(fixture('client.crt').toString('utf8'))
    expect(m.keyPem).toBe(fixture('client.key').toString('utf8'))
    expect(m.passphrase).toBe('secret')
  })

  it('a cert-only file yields public-only material (no private key)', () => {
    const m = resolveKeyMaterial({ kind: 'file', certPath: join(CERTS, 'ca.crt') }, 'buffer')
    expect(m.keyPem).toBeUndefined()
    expect(m.keyBuffer).toBeUndefined()
  })

  it('opens a PFX container and materializes its single key entry', () => {
    const m = resolveKeyMaterial(
      { kind: 'file', pfxPath: join(CERTS, 'client.p12'), passphrase: PW },
      'pem',
    )
    expect(m.certPem).toContain('-----BEGIN CERTIFICATE-----')
    expect(m.keyPem).toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('R12: the keystore-AWARE whitelist accepts .jks (the old cert whitelist did not)', () => {
    const m = resolveKeyMaterial(
      { kind: 'file', pfxPath: join(CERTS, 'client.jks'), passphrase: PW },
      'pem',
    )
    expect(m.keyPem).toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('a multi-ENTRY container with exactly one key entry still resolves unambiguously', () => {
    // multi.p12 = PrivateKeyEntry + TrustedCertificateEntry + SecretKeyEntry.
    // Only the single PRIVATE-KEY entry is a candidate, so no alias is needed.
    const m = resolveKeyMaterial(
      { kind: 'file', pfxPath: join(CERTS, 'multi.p12'), passphrase: PW },
      'pem',
    )
    expect(m.keyPem).toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('R12: rejects an untrusted extension', () => {
    expect(() =>
      resolveKeyMaterial({ kind: 'file', certPath: join(CERTS, 'README.md') }, 'pem'),
    ).toThrow(/unsupported file type "\.md"/)
  })

  it('R12: resolves symlinks FIRST so a .pem link to a non-whitelisted target is rejected', () => {
    const link = join(TMP, 'evil.pem')
    rmSync(link, { force: true })
    symlinkSync(join(CERTS, 'README.md'), link)
    expect(() => resolveKeyMaterial({ kind: 'file', certPath: link }, 'pem')).toThrow(
      /unsupported file type "\.md"/,
    )
  })

  it('R12: rejects an oversized file', () => {
    const big = join(TMP, 'huge.pem')
    writeFileSync(big, Buffer.alloc(1024 * 1024 + 10, 0x41))
    expect(() => resolveKeyMaterial({ kind: 'file', certPath: big }, 'pem')).toThrow(/larger than/)
  })

  it('FAIL LOUD: a file source with no paths at all throws', () => {
    expect(() => resolveKeyMaterial({ kind: 'file' }, 'pem')).toThrow(/No key material/)
  })

  it('FAIL LOUD: a missing file throws instead of resolving to nothing', () => {
    expect(() =>
      resolveKeyMaterial({ kind: 'file', certPath: join(TMP, 'nope.pem') }, 'pem'),
    ).toThrow(/file not found/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. resolveKeyMaterial — keystore source (+ R11 + R12)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveKeyMaterial — keystore source', () => {
  it("need 'pem' materializes a library alias", () => {
    const ks = seedKeystore('client.jks')
    const m = resolveKeyMaterial(
      { kind: 'keystore', keystoreId: ks.id, alias: 'test-client' },
      'pem',
    )
    expect(m.certPem).toContain('-----BEGIN CERTIFICATE-----')
    expect(m.keyPem).toContain('-----BEGIN PRIVATE KEY-----')
    expect(m.chainPem).toHaveLength(1)
  })

  it("need 'buffer' gives clientCert-ready Buffers", () => {
    const ks = seedKeystore('client.p12', { type: 'PKCS12' })
    const m = resolveKeyMaterial(
      { kind: 'keystore', keystoreId: ks.id, alias: 'test-client' },
      'buffer',
    )
    expect(m.certBuffer).toBeInstanceOf(Buffer)
    expect(m.keyBuffer).toBeInstanceOf(Buffer)
    expect(m.keyBuffer!.toString('utf8')).toContain('PRIVATE KEY')
  })

  it('R11: NULL store_password (remember-off) resolves with source.storePassword', () => {
    const ks = seedKeystore('client.jks', { remember: false })
    const m = resolveKeyMaterial(
      { kind: 'keystore', keystoreId: ks.id, alias: 'test-client', storePassword: PW },
      'pem',
    )
    expect(m.keyPem).toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('R11: NULL store_password with NO source.storePassword FAILS LOUD with a distinct message', () => {
    const ks = seedKeystore('client.jks', { remember: false })
    expect(() =>
      resolveKeyMaterial({ kind: 'keystore', keystoreId: ks.id, alias: 'test-client' }, 'pem'),
    ).toThrow(/store password required — remember-password is off/)
  })

  it('R11: a per-alias KEY password opens an entry whose pw differs from the store pw', () => {
    const ks = seedKeystore('keytool-diffpass.jks')
    const ok = resolveKeyMaterial(
      { kind: 'keystore', keystoreId: ks.id, alias: 'diffpass', keyPassword: 'differentpass' },
      'pem',
    )
    expect(ok.keyPem).toContain('-----BEGIN PRIVATE KEY-----')
    expect(() =>
      resolveKeyMaterial({ kind: 'keystore', keystoreId: ks.id, alias: 'diffpass' }, 'pem'),
    ).toThrow(/Cannot recover key entry/)
  })

  it('fails loud on an unknown library id / unknown alias', () => {
    expect(() =>
      resolveKeyMaterial({ kind: 'keystore', keystoreId: 'nope', alias: 'a' }, 'pem'),
    ).toThrow(/Keystore not found in the library/)
    const ks = seedKeystore('client.jks')
    expect(() =>
      resolveKeyMaterial({ kind: 'keystore', keystoreId: ks.id, alias: 'ghost' }, 'pem'),
    ).toThrow(/Alias not found/)
  })

  it('R12: rejects an oversized stored blob BEFORE decoding it', () => {
    const row = createKeystore({
      name: 'oversized',
      type: 'JKS',
      // > 5 MiB once decoded — must be refused on the base64 string.
      blob: 'A'.repeat(7_500_000),
      store_password: PW,
    })
    expect(() =>
      resolveKeyMaterial({ kind: 'keystore', keystoreId: row.id, alias: 'x' }, 'pem'),
    ).toThrow(/exceeds the 5242880-byte limit/)
  })

  it('R12: rejects a stored blob that is not actually a keystore', () => {
    const row = createKeystore({
      name: 'garbage',
      type: 'JKS',
      blob: Buffer.from('definitely not a keystore, just some text').toString('base64'),
      store_password: PW,
    })
    expect(() =>
      resolveKeyMaterial({ kind: 'keystore', keystoreId: row.id, alias: 'x' }, 'pem'),
    ).toThrow(/not a JKS keystore/)
  })

  it('R12: rejects a stored PKCS12 blob that is not DER', () => {
    const row = createKeystore({
      name: 'garbage12',
      type: 'PKCS12',
      blob: Buffer.from('nope nope nope').toString('base64'),
      store_password: PW,
    })
    expect(() =>
      resolveKeyMaterial({ kind: 'keystore', keystoreId: row.id, alias: 'x' }, 'pem'),
    ).toThrow(/not a PKCS#12 keystore/)
  })

  it('no-leak: the thrown message never contains the store password or PEM', () => {
    const ks = seedKeystore('client.jks')
    try {
      resolveKeyMaterial({ kind: 'keystore', keystoreId: ks.id, alias: 'ghost' }, 'pem')
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).not.toContain(PW)
      expect(msg).not.toContain('PRIVATE KEY')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. resolveKeyMaterial — certRow source (R11 double-password end-to-end)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveKeyMaterial — certRow source', () => {
  it("ADDITIVE: a classic source='file' row resolves through the file rails", () => {
    const row = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      crt_path: join(CERTS, 'client.crt'),
      key_path: join(CERTS, 'client.key'),
      passphrase: 'pfxpass',
    })
    expect(row.source).toBe('file')
    const m = resolveKeyMaterial({ kind: 'certRow', certificateId: row.id }, 'pem')
    expect(m.certPem).toContain('-----BEGIN CERTIFICATE-----')
    expect(m.passphrase).toBe('pfxpass')
  })

  it("a source='keystore' row dereferences library + alias, using passphrase as the KEY password", () => {
    const ks = seedKeystore('keytool-diffpass.jks')
    const row = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: '*',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'diffpass',
      // R11: the certificates row carries the per-alias KEY password only.
      passphrase: 'differentpass',
    })
    const m = resolveKeyMaterial({ kind: 'certRow', certificateId: row.id }, 'buffer')
    expect(m.keyBuffer!.toString('utf8')).toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('R11: keystore-backed certRow + remember-off keystore FAILS LOUD (no store pw anywhere)', () => {
    const ks = seedKeystore('client.jks', { remember: false })
    const row = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: '*',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'test-client',
    })
    expect(() => resolveKeyMaterial({ kind: 'certRow', certificateId: row.id }, 'pem')).toThrow(
      /store password required — remember-password is off/,
    )
  })

  it('fails loud on a missing row / a keystore row with no link', () => {
    expect(() => resolveKeyMaterial({ kind: 'certRow', certificateId: 'ghost' }, 'pem')).toThrow(
      /Certificate row not found/,
    )
    const broken = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: '*',
      source: 'keystore',
    })
    expect(() => resolveKeyMaterial({ kind: 'certRow', certificateId: broken.id }, 'pem')).toThrow(
      /no keystore\/alias link/,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. THE BLOCKER — client chain must never become a CA trust anchor
// ═══════════════════════════════════════════════════════════════════════════

describe('BLOCKER — client chain vs CA trust anchors', () => {
  it('a keystore-backed client cert returns leaf+chain CONCATENATED in the cert bundle', () => {
    const ks = seedKeystore('client.jks')
    const m = resolveKeyMaterial(
      { kind: 'keystore', keystoreId: ks.id, alias: 'test-client' },
      'buffer',
    )
    const bundle = m.certBuffer!.toString('utf8')
    // Leaf FIRST, then every chain member — exactly what a TLS peer consumes
    // for client auth. Two blocks for client.jks (leaf + CA root).
    expect(countPemBlocks(bundle)).toBe(1 + (m.chainPem?.length ?? 0))
    expect(countPemBlocks(bundle)).toBe(2)
    expect(bundle.indexOf(m.certPem.trim())).toBe(0)
  })

  it('the resolved material exposes NO ca / caCerts / caCertBuffers field', () => {
    const ks = seedKeystore('client.jks')
    for (const need of ['pem', 'buffer'] as const) {
      const m = resolveKeyMaterial(
        { kind: 'keystore', keystoreId: ks.id, alias: 'test-client' },
        need,
      )
      const keys = Object.keys(m)
      expect(keys).not.toContain('ca')
      expect(keys).not.toContain('caCerts')
      expect(keys).not.toContain('caCertBuffers')
      // Nothing ca-shaped at all — the field a careless consumer would hand to
      // `https.Agent({ ca })` simply does not exist.
      expect(keys.filter((k) => /^ca/i.test(k))).toEqual([])
    }
  })

  it('chainBuffers is a SEPARATE, informational field — not the cert bundle, not trust anchors', () => {
    const ks = seedKeystore('client.jks')
    const m = resolveKeyMaterial(
      { kind: 'keystore', keystoreId: ks.id, alias: 'test-client' },
      'buffer',
    )
    expect(m.chainBuffers).toHaveLength(1)
    // Each chain member is its OWN buffer and is also inside the bundle.
    expect(countPemBlocks(m.chainBuffers![0].toString('utf8'))).toBe(1)
    expect(m.certBuffer!.toString('utf8')).toContain(m.chainBuffers![0].toString('utf8').trim())
    // The bundle is strictly larger than the leaf alone.
    expect(m.certBuffer!.length).toBeGreaterThan(Buffer.byteLength(m.certPem))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. Need coverage / stubs
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveKeyMaterial — needs', () => {
  const certPem = fixture('client.crt').toString('utf8')

  // ── need 'jwk' (#61) ───────────────────────────────────────────────────────
  // Implemented with node:crypto, NOT `jose`: jose is ESM-only and importing it
  // into main is the v1.4.19 launch-crash class, and its API is async while
  // every existing caller of resolveKeyMaterial is synchronous.
  it("need 'jwk' exports a public JWK with an RFC 7638 kid", () => {
    const m = resolveKeyMaterial({ kind: 'inline', certPem }, 'jwk')
    expect(m.publicJwk).toBeDefined()
    expect(m.publicJwk!.kty).toBeTruthy()
    // base64url SHA-256 → 43 chars, no padding, no + or /
    expect(m.publicJwk!.kid).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("need 'jwk' NEVER puts a private member in the publishable half", () => {
    const keyPem = fixture('client.key').toString('utf8')
    const m = resolveKeyMaterial({ kind: 'inline', certPem, keyPem }, 'jwk')
    for (const member of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k']) {
      expect(m.publicJwk).not.toHaveProperty(member)
    }
    // …while the private half is available to MAIN for signing.
    expect(m.privateJwk).toBeDefined()
    expect(m.privateJwk).toHaveProperty('d')
    // Both halves describe the same key, so they share the thumbprint.
    expect(m.privateJwk!.kid).toBe(m.publicJwk!.kid)
  })

  it("need 'jwk' omits the private JWK for public-only material", () => {
    const m = resolveKeyMaterial({ kind: 'inline', certPem }, 'jwk')
    expect(m.privateJwk).toBeUndefined()
  })

  it("need 'jwk' produces a STABLE kid for the same key", () => {
    const a = resolveKeyMaterial({ kind: 'inline', certPem }, 'jwk')
    const b = resolveKeyMaterial({ kind: 'inline', certPem }, 'jwk')
    expect(a.publicJwk!.kid).toBe(b.publicJwk!.kid)
  })

  it("need 'jwk' works for an EC key too (not just RSA)", () => {
    const { generateKeyPairSync, X509Certificate: _X } =
      require('node:crypto') as typeof import('node:crypto')
    void _X
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    // A bare SPKI PEM is a valid `certPem` input for the public half.
    const spki = publicKey.export({ type: 'spki', format: 'pem' }) as string
    const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    const m = resolveKeyMaterial({ kind: 'inline', certPem: spki, keyPem: pkcs8 }, 'jwk')
    expect(m.publicJwk!.kty).toBe('EC')
    expect(m.publicJwk!.crv).toBe('P-256')
    expect(m.publicJwk).not.toHaveProperty('d')
    expect(m.privateJwk).toHaveProperty('d')
  })

  it('rejects an unknown need and an unknown source kind', () => {
    expect(() => resolveKeyMaterial({ kind: 'inline', certPem }, 'keyObject' as never)).toThrow(
      /Unsupported key material need/,
    )
    expect(() => resolveKeyMaterial({ kind: 'nope' } as never, 'pem')).toThrow(
      /Unsupported key material source/,
    )
    expect(() => resolveKeyMaterial(undefined as never, 'pem')).toThrow(
      /No key material source supplied/,
    )
  })

  it('every implemented need is covered for every source kind', () => {
    const ks = seedKeystore('client.jks')
    const fileRow = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: '*',
      crt_path: join(CERTS, 'client.crt'),
      key_path: join(CERTS, 'client.key'),
    })
    const sources: MaterialSource[] = [
      { kind: 'inline', certPem, keyPem: fixture('client.pkcs8.key').toString('utf8') },
      { kind: 'file', certPath: join(CERTS, 'client.crt'), keyPath: join(CERTS, 'client.key') },
      { kind: 'keystore', keystoreId: ks.id, alias: 'test-client' },
      { kind: 'certRow', certificateId: fileRow.id },
    ]
    for (const source of sources) {
      for (const need of ['pem', 'buffer'] as const) {
        const m = resolveKeyMaterial(source, need)
        expect(m.certPem).toContain('-----BEGIN CERTIFICATE-----')
        expect(m.keyPem).toContain('PRIVATE KEY')
        if (need === 'buffer') {
          expect(m.certBuffer).toBeInstanceOf(Buffer)
          expect(m.keyBuffer).toBeInstanceOf(Buffer)
        } else {
          expect(m.certBuffer).toBeUndefined()
        }
      }
      // 'jwk' resolves for every source too, and its publishable half is clean
      // whatever the source was.
      const jwk = resolveKeyMaterial(source, 'jwk')
      expect(jwk.publicJwk?.kid).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(jwk.publicJwk).not.toHaveProperty('d')
      expect(jwk.privateJwk).toHaveProperty('d')
    }
  })
})
