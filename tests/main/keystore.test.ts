/**
 * Keystore Studio engine — known-answer / round-trip tests (no Electron, no DB).
 *
 * Covers the Faz 0 engine surface: createEmpty → inspect(0) → generateKeyPair
 * (RSA 2048 + EC P-256/384/521) → inspect(1) → aliasDetail (self-signed);
 * secp256k1 rejection; and JKS + PKCS12 serialize round-trips read back through
 * the same engine (which uses jks-js / node-forge under the hood).
 */

// reflect-metadata MUST load before @peculiar/x509 (see keystore.ts header).
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  X509Certificate,
  createPrivateKey,
  createSecretKey,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import forge from 'node-forge'
import * as x509 from '@peculiar/x509'
import {
  KeystoreEngine,
  KeystoreValidationException,
  KeystoreEngineException,
  resolveType,
  buildCertificateInfo,
  parseKeyStore,
  serializeKeyStore,
} from '../../src/main/lib/keystore'

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/certs')
const PW = 'testpassword'

function pemToDer(pem: string, label: string): Buffer {
  const b64 = pem.split(`-----BEGIN ${label}-----`)[1].split(`-----END ${label}-----`)[0].replace(/\s+/g, '')
  return Buffer.from(b64, 'base64')
}
const certDer = (f: string): Buffer => pemToDer(readFileSync(join(CERTS, f), 'utf8'), 'CERTIFICATE')
const keyDer = (f: string): Buffer => pemToDer(readFileSync(join(CERTS, f), 'utf8'), 'PRIVATE KEY')

describe('resolveType', () => {
  it('defaults empty/nullish to JKS', () => {
    expect(resolveType()).toBe('JKS')
    expect(resolveType('')).toBe('JKS')
    expect(resolveType('  ')).toBe('JKS')
  })
  it('normalizes case and PKCS#12 spelling', () => {
    expect(resolveType('jks')).toBe('JKS')
    expect(resolveType('pkcs12')).toBe('PKCS12')
    expect(resolveType('PKCS#12')).toBe('PKCS12')
  })
  it('rejects an unsupported type verbatim', () => {
    expect(() => resolveType('BKS')).toThrow('Unsupported keystore type: BKS')
  })
})

describe('createEmpty + validation', () => {
  it('creates an empty keystore with aliasCount 0', () => {
    const engine = new KeystoreEngine()
    const { sessionId, meta } = engine.createEmpty('PKCS12', PW)
    expect(sessionId).toBeTruthy()
    expect(meta.type).toBe('PKCS12')
    expect(meta.aliasCount).toBe(0)
    expect(meta.aliases).toEqual([])
    expect(engine.inspect(sessionId).aliasCount).toBe(0)
  })
  it('rejects an empty store password', () => {
    const engine = new KeystoreEngine()
    expect(() => engine.createEmpty('JKS', '')).toThrow(KeystoreValidationException)
    expect(() => engine.createEmpty('JKS', '')).toThrow('Store password cannot be empty')
  })
})

describe('generateKeyPair — RSA + EC self-signed, then inspect/aliasDetail', () => {
  it('RSA 2048 → inspect(1) → self-signed detail', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    const meta = await engine.generateKeyPair(sessionId, {
      alias: 'rsa',
      keyAlgorithm: 'RSA',
      keySize: 2048,
      subjectDN: 'CN=rsa-test',
      keyUsage: ['digitalSignature', 'keyCertSign'],
      basicConstraintsCa: true,
      validityDays: 365,
    })
    expect(meta.aliasCount).toBe(1)
    const summary = meta.aliases[0]
    expect(summary.alias).toBe('rsa')
    expect(summary.entryType).toBe('KEY')
    expect(summary.hasPrivateKey).toBe(true)
    expect(summary.keyAlgorithm).toBe('RSA')

    const detail = engine.aliasDetail(sessionId, 'rsa')
    expect(detail.hasPrivateKey).toBe(true)
    expect(detail.chain).toHaveLength(1)
    const info = detail.chain[0]
    expect(info.subjectDN).toBe('CN=rsa-test')
    expect(info.issuerDN).toBe('CN=rsa-test') // self-signed
    expect(info.publicKeyAlgorithm).toBe('RSA')
    expect(info.keySize).toBe(2048)
    expect(info.sigAlgName).toBe('SHA256withRSA')
    expect(info.sha1Fingerprint).toMatch(/^([0-9A-F]{2}:){19}[0-9A-F]{2}$/)
    expect(info.sha256Fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    expect(info.pem).toContain('BEGIN CERTIFICATE')
  })

  it.each([
    ['P-256', 256],
    ['P-384', 384],
    ['P-521', 521],
  ])('EC %s → keySize %i, EC alg, self-signed', async (curve, size) => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    await engine.generateKeyPair(sessionId, {
      alias: 'ec',
      keyAlgorithm: 'EC',
      curve,
      subjectDN: `CN=ec-${curve}`,
    })
    const detail = engine.aliasDetail(sessionId, 'ec')
    const info = detail.chain[0]
    expect(info.publicKeyAlgorithm).toBe('EC')
    expect(info.keySize).toBe(size)
    expect(info.sigAlgName).toBe('SHA256withECDSA')
    expect(info.subjectDN).toBe(`CN=ec-${curve}`)
    expect(info.issuerDN).toBe(`CN=ec-${curve}`)
  })

  it('honors SubjectAlternativeNames on an EC cert', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    await engine.generateKeyPair(sessionId, {
      alias: 'ec-san',
      keyAlgorithm: 'EC',
      curve: 'P-256',
      subjectAlternativeNames: ['example.com', '127.0.0.1'],
    })
    const info = engine.aliasDetail(sessionId, 'ec-san').chain[0]
    expect(info.subjectAlternativeNames).toContain('example.com')
    expect(info.subjectAlternativeNames).toContain('127.0.0.1')
  })

  it('rejects secp256k1 with the exact message', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    await expect(
      engine.generateKeyPair(sessionId, { alias: 'k', keyAlgorithm: 'EC', curve: 'secp256k1' }),
    ).rejects.toThrow('Unsupported EC curve: secp256k1')
  })

  it('rejects a duplicate alias', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    await engine.generateKeyPair(sessionId, { alias: 'dup', keyAlgorithm: 'RSA', keySize: 2048 })
    await expect(
      engine.generateKeyPair(sessionId, { alias: 'dup', keyAlgorithm: 'RSA', keySize: 2048 }),
    ).rejects.toThrow('Alias already exists: dup')
  })

  it('rejects an unsupported RSA key size', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('JKS', PW)
    await expect(
      engine.generateKeyPair(sessionId, { alias: 'x', keyAlgorithm: 'RSA', keySize: 999 }),
    ).rejects.toThrow('Unsupported RSA key size: 999')
  })
})

describe('generateKeyPair — Faz 2 full option KATs', () => {
  it.each([
    [3072],
    [4096],
  ])('RSA %i self-signed → keySize + SHA256withRSA', async (bits) => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    await engine.generateKeyPair(sessionId, {
      alias: `r${bits}`,
      keyAlgorithm: 'RSA',
      keySize: bits,
      basicConstraintsCa: false,
    })
    const info = engine.aliasDetail(sessionId, `r${bits}`).chain[0]
    expect(info.keySize).toBe(bits)
    expect(info.publicKeyAlgorithm).toBe('RSA')
    expect(info.version).toBe(3)
    expect(info.subjectDN).toBe(info.issuerDN) // self-signed
  }, 30000)

  it('RSA full option set: SAN (DNS+IP) / keyUsage / serial / validity / CA', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    await engine.generateKeyPair(sessionId, {
      alias: 'full',
      keyAlgorithm: 'RSA',
      keySize: 2048,
      subjectDN: 'CN=full.example.com, O=Example Inc, C=TR',
      subjectAlternativeNames: ['full.example.com', '10.0.0.5'],
      keyUsage: ['digitalSignature', 'keyCertSign', 'cRLSign'],
      basicConstraintsCa: true,
      serialNumber: '0x0A1B2C3D',
      validityDays: 365,
    })
    const info = engine.aliasDetail(sessionId, 'full').chain[0]
    // Serial is rendered as canonical minimal hex (KS-F2-23..25): no leading
    // zero even though the cert DER integer is even-length padded on the build side.
    expect(info.serialNumber).toBe('a1b2c3d')
    expect(info.subjectDN).toContain('CN=full.example.com')
    expect(info.subjectAlternativeNames).toEqual(
      expect.arrayContaining(['full.example.com', '10.0.0.5']),
    )
    expect(new Date(info.notAfter).getTime() - new Date(info.notBefore).getTime()).toBe(
      365 * 86400000,
    )
    // keyUsage + basicConstraints aren't in CertificateInfo — decode from the PEM.
    const cert = forge.pki.certificateFromPem(info.pem)
    const ku = cert.getExtension('keyUsage') as {
      digitalSignature: boolean
      keyCertSign: boolean
      cRLSign: boolean
    }
    expect(ku.digitalSignature).toBe(true)
    expect(ku.keyCertSign).toBe(true)
    expect(ku.cRLSign).toBe(true)
    const bc = cert.getExtension('basicConstraints') as { cA: boolean }
    expect(bc.cA).toBe(true)
  })

  it('decimal serialNumber is rendered as canonical lowercase hex (no leading zero)', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    await engine.generateKeyPair(sessionId, {
      alias: 'serdec',
      keyAlgorithm: 'RSA',
      keySize: 2048,
      serialNumber: '123456789',
    })
    // 123456789 === 0x75BCD15 (7 hex digits → odd → even-length padded to 075bcd15
    // in the cert DER, but READ BACK as the minimal canonical hex 75bcd15).
    expect(engine.aliasDetail(sessionId, 'serdec').chain[0].serialNumber).toBe('75bcd15')
  })

  it('a 0x-hex serial reads back as minimal canonical hex (no leading zero)', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    // 0x1985E1A5800 is 11 hex digits (odd) → padded to 01985e1a5800 in DER, but
    // must read back without the leading zero.
    await engine.generateKeyPair(sessionId, {
      alias: 'serhex',
      keyAlgorithm: 'RSA',
      keySize: 2048,
      serialNumber: '0x1985E1A5800',
    })
    expect(engine.aliasDetail(sessionId, 'serhex').chain[0].serialNumber).toBe('1985e1a5800')
  })

  it('the default now-millis serial reads back canonical (no leading zero)', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    // No serialNumber ⇒ engine defaults to Date.now() ms. Whatever the value, the
    // rendered serial is minimal canonical hex: it never carries a DER pad zero.
    await engine.generateKeyPair(sessionId, { alias: 'serdef', keyAlgorithm: 'RSA', keySize: 2048 })
    const serial = engine.aliasDetail(sessionId, 'serdef').chain[0].serialNumber
    expect(serial).not.toMatch(/^0/)
    // Canonical form is idempotent under BigInt round-trip.
    expect(serial).toBe(BigInt('0x' + serial).toString(16))
  })
})

describe('generateKeyPair — R10 cross-builder parity (node-forge RSA vs @peculiar EC)', () => {
  it('RSA and EC self-signed certs encode identical keyUsage / basicConstraints / SAN', async () => {
    // The RSA path builds the X.509 with node-forge; the EC path builds it with
    // @peculiar/x509. Feeding BOTH the SAME full option set and decoding the two
    // generated cert PEMs with ONE reader must yield IDENTICAL extension
    // encodings — otherwise the two builders have silently drifted (R10).
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    const shared = {
      subjectAlternativeNames: ['api.example.com', '192.168.1.10'],
      keyUsage: ['digitalSignature', 'keyCertSign', 'cRLSign'],
      basicConstraintsCa: true,
      serialNumber: '0x1122334455',
      validityDays: 730,
    }
    await engine.generateKeyPair(sessionId, {
      alias: 'rsa',
      keyAlgorithm: 'RSA',
      keySize: 2048,
      ...shared,
    })
    await engine.generateKeyPair(sessionId, {
      alias: 'ec',
      keyAlgorithm: 'EC',
      curve: 'P-256',
      ...shared,
    })

    const rsaPem = engine.aliasDetail(sessionId, 'rsa').chain[0].pem
    const ecPem = engine.aliasDetail(sessionId, 'ec').chain[0].pem

    // Single reader (@peculiar/x509 parses both RSA and EC certs) → the
    // comparison isolates the two BUILDERS.
    const decode = (pem: string) => {
      const cert = new x509.X509Certificate(pem)
      const ku = cert.getExtension(x509.KeyUsagesExtension)
      const bc = cert.getExtension(x509.BasicConstraintsExtension)
      const san = cert.getExtension(x509.SubjectAlternativeNameExtension)
      return {
        keyUsage: ku?.usages ?? 0,
        kuCritical: ku?.critical ?? false,
        ca: bc?.ca ?? false,
        bcCritical: bc?.critical ?? false,
        sans: (san?.names.items ?? []).map((n) => `${n.type}:${n.value}`).sort(),
      }
    }
    const rsa = decode(rsaPem)
    const ec = decode(ecPem)

    // Parity: the two builders must produce byte-identical extension semantics.
    expect(rsa).toEqual(ec)

    // And the shared option set is faithfully encoded on both.
    const F = x509.KeyUsageFlags
    expect(rsa.keyUsage).toBe(F.digitalSignature | F.keyCertSign | F.cRLSign)
    expect(rsa.kuCritical).toBe(true)
    expect(rsa.ca).toBe(true)
    expect(rsa.bcCritical).toBe(true)

    // SAN entries via the app's own canonical reader (Node X509) on BOTH certs —
    // DNS + IP land identically regardless of which builder produced the cert.
    const rsaSan = buildCertificateInfo(pemToDer(rsaPem, 'CERTIFICATE')).subjectAlternativeNames
    const ecSan = buildCertificateInfo(pemToDer(ecPem, 'CERTIFICATE')).subjectAlternativeNames
    expect(rsaSan.sort()).toEqual(ecSan.sort())
    expect(rsaSan).toEqual(expect.arrayContaining(['api.example.com', '192.168.1.10']))
  }, 30000)
})

describe('generateSecretKey — AES, PKCS12-only (Faz 2 Group B)', () => {
  it('default keySize (256) AES entry: KEY / no-private-key / empty chain', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', 'changeit')
    const meta = engine.generateSecretKey(sessionId, { alias: 'aes', entryPassword: 'changeit' })
    expect(meta.type).toBe('PKCS12')
    expect(meta.aliasCount).toBe(1)
    const sum = meta.aliases[0]
    expect(sum).toMatchObject({
      alias: 'aes',
      entryType: 'KEY',
      hasPrivateKey: false,
      chainLength: 0,
    })
    expect(sum.subjectDN).toBeUndefined()
    expect(sum.issuerDN).toBeUndefined()
    const detail = engine.aliasDetail(sessionId, 'aes')
    expect(detail.hasPrivateKey).toBe(false)
    expect(detail.chain).toEqual([])
  })

  it.each([[128], [192], [256]])('AES %i serialize round-trips (reopen sees the secret)', (size) => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', 'changeit')
    engine.generateSecretKey(sessionId, { alias: 'sk', keyAlgorithm: 'AES', keySize: size })
    const bytes = engine.serialize(sessionId)
    const reopened = engine.open(bytes, 'changeit', 'PKCS12')
    expect(reopened.meta.aliasCount).toBe(1)
    expect(reopened.meta.aliases[0]).toMatchObject({
      alias: 'sk',
      entryType: 'KEY',
      hasPrivateKey: false,
      chainLength: 0,
    })
  })

  it('a key pair + a secret key round-trip together through the secret-bag filter', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', 'changeit')
    await engine.generateKeyPair(sessionId, { alias: 'rsa', keyAlgorithm: 'RSA', keySize: 2048 })
    const meta = engine.generateSecretKey(sessionId, {
      alias: 'aes',
      keyAlgorithm: 'AES',
      keySize: 256,
    })
    expect(meta.aliasCount).toBe(2)
    const bytes = engine.serialize(sessionId)
    const reopened = engine.open(bytes, 'changeit', 'PKCS12')
    expect(reopened.meta.aliases.map((a) => a.alias).sort()).toEqual(['aes', 'rsa'])
    const byAlias = Object.fromEntries(reopened.meta.aliases.map((a) => [a.alias, a]))
    expect(byAlias.rsa.hasPrivateKey).toBe(true)
    expect(byAlias.aes.hasPrivateKey).toBe(false)
    expect(byAlias.aes.chainLength).toBe(0)
  })

  it('a generated key pair + secret key recover with the STORE password (no per-entry-password data loss)', async () => {
    // Regression guard for the Faz B2 finding: generate protects entries with
    // the store password only. Reopening with the STORE password must recover
    // BOTH the private-key bytes and the raw secret bytes — proving no entry is
    // shrouded under a mismatched per-entry password (which the store-password
    // parse path could not decrypt → silent data loss).
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', 'store-pw')
    await engine.generateKeyPair(sessionId, { alias: 'kp', keyAlgorithm: 'RSA', keySize: 2048 })
    engine.generateSecretKey(sessionId, { alias: 'sk', keyAlgorithm: 'AES', keySize: 256 })
    const bytes = engine.serialize(sessionId)

    const parsed = parseKeyStore(bytes, 'store-pw', 'PKCS12')
    const byAlias = Object.fromEntries(parsed.map((e) => [e.alias, e]))
    expect(Object.keys(byAlias).sort()).toEqual(['kp', 'sk'])

    const kp = byAlias.kp as { kind: string; privateKeyPkcs8Der: Buffer; certChainDer: Buffer[] }
    expect(kp.kind).toBe('key')
    expect(kp.privateKeyPkcs8Der.length).toBeGreaterThan(0) // private key recovered
    expect(kp.certChainDer).toHaveLength(1)

    const sk = byAlias.sk as { kind: string; secretKeyRaw: Buffer }
    expect(sk.kind).toBe('secret')
    expect(sk.secretKeyRaw).toHaveLength(32) // AES-256 raw key recovered
  }, 30000)

  it('is rejected on a JKS keystore with the exact message', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('JKS', 'changeit')
    expect(() =>
      engine.generateSecretKey(sessionId, { alias: 'skjks', keyAlgorithm: 'AES', keySize: 256 }),
    ).toThrow('Secret keys can only be stored in a PKCS12 keystore')
    expect(engine.inspect(sessionId).aliasCount).toBe(0)
  })

  it('rejects unsupported AES key size / non-AES algorithm / duplicate alias', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', 'changeit')
    expect(() =>
      engine.generateSecretKey(sessionId, { alias: 'x', keyAlgorithm: 'AES', keySize: 512 }),
    ).toThrow('Unsupported AES key size: 512')
    expect(() =>
      engine.generateSecretKey(sessionId, { alias: 'x', keyAlgorithm: 'DES', keySize: 56 }),
    ).toThrow('Unsupported secret key algorithm: DES')
    expect(() => engine.generateSecretKey(sessionId, { alias: '' })).toThrow('Alias cannot be empty')
    engine.generateSecretKey(sessionId, { alias: 'dup', keyAlgorithm: 'AES', keySize: 256 })
    expect(() =>
      engine.generateSecretKey(sessionId, { alias: 'dup', keyAlgorithm: 'AES', keySize: 256 }),
    ).toThrow('Alias already exists: dup')
    expect(engine.inspect(sessionId).aliasCount).toBe(1)
  })
})

describe('buildCertificateInfo — fixture certs', () => {
  it('reads an RSA client cert', () => {
    const info = buildCertificateInfo(certDer('client.crt'))
    expect(info.subjectDN).toContain('CN=test-client')
    expect(info.publicKeyAlgorithm).toBe('RSA')
    expect(info.keySize).toBe(2048)
    expect(info.notBefore).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
  it('reads an EC P-384 cert with field-size keySize', () => {
    const info = buildCertificateInfo(certDer('ec-p384.crt'))
    expect(info.publicKeyAlgorithm).toBe('EC')
    expect(info.keySize).toBe(384)
  })
})

describe('serialize round-trip — PKCS12 (multi-alias) via engine', () => {
  it('serializes 2 keys + 1 trusted cert and reads them all back', () => {
    const entries = [
      { alias: 'rsa-key', kind: 'key' as const, privateKeyPkcs8Der: keyDer('client.pkcs8.key'), entryPassword: PW, certChainDer: [certDer('client.crt'), certDer('ca.crt')] },
      { alias: 'ec-key', kind: 'key' as const, privateKeyPkcs8Der: keyDer('ec-p256.pkcs8.key'), entryPassword: PW, certChainDer: [certDer('ec-p256.crt')] },
      { alias: 'trusted-ca', kind: 'cert' as const, certDer: certDer('ca.crt') },
    ]
    // Cast through the engine's exported serialize/parse (EntryModel is internal).
    const bytes = serializeKeyStore(entries as never, 'PKCS12', PW)
    expect(bytes.length).toBeGreaterThan(0)

    const parsed = parseKeyStore(bytes, PW, 'PKCS12')
    const byAlias = Object.fromEntries(parsed.map((e) => [e.alias, e]))
    expect(Object.keys(byAlias).sort()).toEqual(['ec-key', 'rsa-key', 'trusted-ca'])
    expect(byAlias['rsa-key'].kind).toBe('key')
    expect(byAlias['ec-key'].kind).toBe('key')
    expect(byAlias['trusted-ca'].kind).toBe('cert')
  })

  it('round-trips an engine-generated PKCS12 session (open → same aliases)', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    await engine.generateKeyPair(sessionId, { alias: 'a', keyAlgorithm: 'RSA', keySize: 2048 })
    await engine.generateKeyPair(sessionId, { alias: 'b', keyAlgorithm: 'EC', curve: 'P-256' })
    const bytes = engine.serialize(sessionId)

    const reopened = engine.open(bytes, PW, 'PKCS12')
    expect(reopened.meta.aliasCount).toBe(2)
    expect(reopened.meta.aliases.map((a) => a.alias).sort()).toEqual(['a', 'b'])
    expect(reopened.meta.aliases.every((a) => a.hasPrivateKey)).toBe(true)
  })
})

describe('serialize round-trip — JKS via engine (jks-js read oracle)', () => {
  it('writes a key + trusted cert and reads both back', () => {
    const entries = [
      { alias: 'test-client', kind: 'key' as const, privateKeyPkcs8Der: keyDer('client.pkcs8.key'), entryPassword: PW, certChainDer: [certDer('client.crt'), certDer('ca.crt')] },
      { alias: 'testca', kind: 'cert' as const, certDer: certDer('ca.crt') },
    ]
    const bytes = serializeKeyStore(entries as never, 'JKS', PW)
    expect(bytes.readUInt32BE(0)).toBe(0xfeedfeed)

    const parsed = parseKeyStore(bytes, PW, 'JKS')
    const byAlias = Object.fromEntries(parsed.map((e) => [e.alias, e]))
    expect(Object.keys(byAlias).sort()).toEqual(['test-client', 'testca'])
    expect(byAlias['test-client'].kind).toBe('key')
    expect((byAlias['test-client'] as { certChainDer: Buffer[] }).certChainDer).toHaveLength(2)
    expect(byAlias['testca'].kind).toBe('cert')
  })

  it('rejects a wrong store password with an engine exception', () => {
    const entries = [{ alias: 'testca', kind: 'cert' as const, certDer: certDer('ca.crt') }]
    const bytes = serializeKeyStore(entries as never, 'JKS', PW)
    expect(() => parseKeyStore(bytes, 'wrongpass', 'JKS')).toThrow(/wrong|corrupt/i)
  })

  it('rejects empty keystore content', () => {
    expect(() => parseKeyStore(Buffer.alloc(0), PW, 'JKS')).toThrow('Keystore content cannot be empty')
  })
})

describe('reads a keytool-produced JKS fixture (interop read path)', () => {
  it('opens client.jks and lists the PrivateKeyEntry', () => {
    const engine = new KeystoreEngine()
    const { meta } = engine.open(readFileSync(join(CERTS, 'client.jks')), PW, 'JKS')
    expect(meta.aliasCount).toBe(1)
    const a = meta.aliases[0]
    expect(a.alias).toBe('test-client')
    expect(a.entryType).toBe('KEY')
    expect(a.hasPrivateKey).toBe(true)
  })

  it('opens truststore.jks and lists the TrustedCertificateEntry', () => {
    const engine = new KeystoreEngine()
    const { sessionId, meta } = engine.open(readFileSync(join(CERTS, 'truststore.jks')), PW, 'JKS')
    expect(meta.aliasCount).toBe(1)
    expect(meta.aliases[0].entryType).toBe('CERTIFICATE')
    expect(meta.aliases[0].hasPrivateKey).toBe(false)
    const detail = engine.aliasDetail(sessionId, 'testca')
    expect(detail.chain[0].subjectDN).toContain('Testnizer Test CA')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Faz B3 — Import (importPkcs12 / importKeyMaterial / importPem /
// importTrustedCertificate / verifyKeyMatchesCertificate). Spec §8.3.
// ─────────────────────────────────────────────────────────────────────────────

const read = (f: string): string => readFileSync(join(CERTS, f), 'utf8')
const bytes = (f: string): Buffer => readFileSync(join(CERTS, f))
const pubKeyOf = (certFile: string): KeyObject => new X509Certificate(certDer(certFile)).publicKey
const privKeyOf = (keyFile: string): KeyObject => createPrivateKey(read(keyFile))

describe('importPkcs12 — copyEntry (spec §6.10)', () => {
  it('KS-F3-01 single-alias key entry into an empty PKCS12 target', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    const meta = engine.importPkcs12(sessionId, {
      sourceBytes: bytes('client.p12'),
      sourcePassword: PW,
      sourceAlias: 'test-client',
    })
    expect(meta.aliasCount).toBe(1)
    const detail = engine.aliasDetail(sessionId, 'test-client')
    expect(detail.entryType).toBe('KEY')
    expect(detail.hasPrivateKey).toBe(true)
    expect(detail.chain.length).toBe(2)
    expect(detail.chain[0].subjectDN).toContain('test-client')
  })

  it('KS-F3-02 all-aliases (sourceAlias omitted) from a single-entry source', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    const meta = engine.importPkcs12(sessionId, { sourceBytes: bytes('client.p12'), sourcePassword: PW })
    expect(meta.aliasCount).toBe(1)
    expect(meta.aliases[0].alias).toBe('test-client')
  })

  it('KS-F3-03 all-aliases copies both a KEY and a trusted CERTIFICATE into PKCS12', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    const meta = engine.importPkcs12(sessionId, { sourceBytes: bytes('multi.p12'), sourcePassword: PW })
    // multi.p12 = key `test-client` + cert `ca-root` + secret `aes-secret`.
    expect(meta.aliasCount).toBe(3)
    const kinds = meta.aliases.map((a) => `${a.alias}:${a.entryType}:${a.hasPrivateKey}`).sort()
    expect(kinds).toContain('test-client:KEY:true')
    expect(kinds).toContain('ca-root:CERTIFICATE:false')
    expect(kinds).toContain('aes-secret:KEY:false') // secret entry
  })

  it('KS-F3-04 target alias override', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importPkcs12(sessionId, {
      sourceBytes: bytes('client.p12'),
      sourcePassword: PW,
      sourceAlias: 'test-client',
      targetAlias: 'my-imported-key',
    })
    const meta = engine.inspect(sessionId)
    expect(meta.aliases[0].alias).toBe('my-imported-key')
  })

  it('KS-F3-06 secret key INTO a PKCS12 target is copied', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    const meta = engine.importPkcs12(sessionId, {
      sourceBytes: bytes('secret.p12'),
      sourcePassword: PW,
      sourceAlias: 'aes-secret',
    })
    expect(meta.aliasCount).toBe(1)
    expect(meta.aliases[0].entryType).toBe('KEY')
    expect(meta.aliases[0].hasPrivateKey).toBe(false)
  })

  it('KS-F3-07 FLAGSHIP: all-aliases into JKS skips the secret, copies key/cert', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('JKS', PW)
    const meta = engine.importPkcs12(sessionId, { sourceBytes: bytes('multi.p12'), sourcePassword: PW })
    expect(meta.aliasCount).toBe(2) // aes-secret skipped
    expect(meta.aliases.some((a) => a.alias === 'aes-secret')).toBe(false)
    expect(meta.aliases.some((a) => a.alias === 'test-client')).toBe(true)
    expect(meta.aliases.some((a) => a.alias === 'ca-root')).toBe(true)
  })

  it('KS-F3-08 secret-only source into a JKS target → No importable entries', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('JKS', PW)
    expect(() =>
      engine.importPkcs12(sessionId, {
        sourceBytes: bytes('secret.p12'),
        sourcePassword: PW,
        sourceAlias: 'aes-secret',
      }),
    ).toThrow('No importable entries found in the source keystore')
    expect(engine.inspect(sessionId).aliasCount).toBe(0)
  })

  it('KS-F3-09 sourceAlias not present → Source alias not found', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importPkcs12(sessionId, {
        sourceBytes: bytes('client.p12'),
        sourcePassword: PW,
        sourceAlias: 'does-not-exist',
      }),
    ).toThrow('Source alias not found: does-not-exist')
  })

  it('KS-F3-10 target alias collision → Target alias already exists', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importPkcs12(sessionId, {
      sourceBytes: bytes('client.p12'),
      sourcePassword: PW,
      sourceAlias: 'test-client',
    })
    expect(() =>
      engine.importPkcs12(sessionId, {
        sourceBytes: bytes('client.p12'),
        sourcePassword: PW,
        sourceAlias: 'test-client',
      }),
    ).toThrow('Target alias already exists: test-client')
    expect(engine.inspect(sessionId).aliasCount).toBe(1)
  })

  it('KS-F3-11 empty source content → validation error', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importPkcs12(sessionId, { sourceBytes: Buffer.alloc(0), sourcePassword: PW }),
    ).toThrow('Source keystore content cannot be empty')
  })

  it('KS-F3-12 wrong source password → engine error, no key leak', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    try {
      engine.importPkcs12(sessionId, { sourceBytes: bytes('client.p12'), sourcePassword: 'WRONG' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(KeystoreEngineException)
      expect(String((e as Error).message)).not.toContain('PRIVATE KEY')
    }
    expect(engine.inspect(sessionId).aliasCount).toBe(0)
  })

  it('KS-F3-13 key entry with an empty certificate chain → throws', () => {
    // Craft a key-only PKCS12 source (no cert bag) via node-forge low-level.
    const keys = forge.pki.rsa.generateKeyPair(1024)
    // Type-correct stand-in for the old `null` cert arg: forge types `cert` as
    // `Certificate | Certificate[]`, so an empty array is accepted and emits a
    // key-only P12 (no cert bag). `generateLocalKeyId: false` is required — with
    // the default forge would try to SHA-1 `cert[0]` (undefined) and throw.
    const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [], PW, {
      friendlyName: 'orphan-key',
      algorithm: '3des',
      generateLocalKeyId: false,
    })
    const source = Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importPkcs12(sessionId, {
        sourceBytes: source,
        sourcePassword: PW,
        sourceAlias: 'orphan-key',
      }),
    ).toThrow('Key entry has no certificate chain: orphan-key')
    expect(engine.inspect(sessionId).aliasCount).toBe(0)
  })

  it('KS-F3-14 bad/corrupted source bytes → engine error', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importPkcs12(sessionId, { sourceBytes: bytes('bad.p12'), sourcePassword: PW }),
    ).toThrow(KeystoreEngineException)
  })

  it('KS-F3-46 copyEntry rejects a source P12 whose key does not match its cert (§6.7)', () => {
    // Craft a source P12 that pairs a FRESH RSA key with an UNRELATED cert
    // (server.crt) under one shared localKeyId. parsePkcs12 pairs them by
    // localKeyId; the copy path must run the key-cert match gate and refuse the
    // mismatched pair rather than seat it into the target keystore.
    const wrongKey = forge.pki.rsa.generateKeyPair(1024)
    const cert = forge.pki.certificateFromPem(read('server.crt'))
    const asn1obj = forge.pkcs12.toPkcs12Asn1(wrongKey.privateKey, cert, PW, {
      friendlyName: 'mismatch',
      algorithm: '3des',
    })
    const source = Buffer.from(forge.asn1.toDer(asn1obj).getBytes(), 'binary')
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importPkcs12(sessionId, {
        sourceBytes: source,
        sourcePassword: PW,
        sourceAlias: 'mismatch',
      }),
    ).toThrow('Private key does not match the provided certificate')
    expect(engine.inspect(sessionId).aliasCount).toBe(0)
  })

  it('KS-F3-47 pairs a localKeyId-less key with its cert by SPKI (§6.10 interop)', () => {
    // Some Windows CryptoAPI / manual exports omit localKeyId + friendlyName.
    // The key then has no attribute link to its cert — parsePkcs12 must pair
    // them by SPKI (authoritative), NOT leave the key with an empty chain.
    const key = forge.pki.privateKeyFromPem(read('client.key'))
    const cert = forge.pki.certificateFromPem(read('client.crt'))
    const asn1obj = forge.pkcs12.toPkcs12Asn1(key, cert, PW, {
      generateLocalKeyId: false,
      algorithm: '3des',
    })
    const source = Buffer.from(forge.asn1.toDer(asn1obj).getBytes(), 'binary')
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    const meta = engine.importPkcs12(sessionId, { sourceBytes: source, sourcePassword: PW })
    expect(meta.aliasCount).toBe(1)
    const alias = meta.aliases[0].alias
    const d = engine.aliasDetail(sessionId, alias)
    expect(d.entryType).toBe('KEY')
    expect(d.hasPrivateKey).toBe(true)
    // The cert was paired by SPKI despite the missing localKeyId.
    expect(d.chain.length).toBe(1)
    expect(d.chain[0].subjectDN).toContain('test-client')
  })
})

describe('importKeyMaterial (spec §4.5 / §6.7 / §6.11)', () => {
  it('KS-F3-15 RSA PKCS#8 key + cert', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    const meta = engine.importKeyMaterial(sessionId, {
      alias: 'rsa-pkcs8',
      privateKeyPem: read('client.pkcs8.key'),
      certificatePem: read('client.crt'),
    })
    expect(meta.aliasCount).toBe(1)
    const d = engine.aliasDetail(sessionId, 'rsa-pkcs8')
    expect(d.entryType).toBe('KEY')
    expect(d.hasPrivateKey).toBe(true)
    expect(d.chain[0].publicKeyAlgorithm).toBe('RSA')
    expect(d.chain[0].keySize).toBe(2048)
    expect(d.chain[0].subjectDN).toContain('test-client')
  })

  it('KS-F3-16 RSA OpenSSL/PKCS#1 traditional key + cert', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importKeyMaterial(sessionId, {
      alias: 'rsa-openssl',
      privateKeyPem: read('client.key'),
      certificatePem: read('client.crt'),
    })
    expect(engine.aliasDetail(sessionId, 'rsa-openssl').chain[0].publicKeyAlgorithm).toBe('RSA')
  })

  it('KS-F3-17 EC P-256 PKCS#8 key + cert', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importKeyMaterial(sessionId, {
      alias: 'ec256',
      privateKeyPem: read('ec-p256.pkcs8.key'),
      certificatePem: read('ec-p256.crt'),
    })
    const d = engine.aliasDetail(sessionId, 'ec256')
    expect(d.chain[0].publicKeyAlgorithm).toBe('EC')
    expect(d.chain[0].keySize).toBe(256)
  })

  it('KS-F3-18 EC P-256 SEC1 (BEGIN EC PRIVATE KEY) key', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importKeyMaterial(sessionId, {
      alias: 'ec256-sec1',
      privateKeyPem: read('ec-p256.key'),
      certificatePem: read('ec-p256.crt'),
    })
    expect(engine.aliasDetail(sessionId, 'ec256-sec1').chain[0].publicKeyAlgorithm).toBe('EC')
  })

  it('KS-F3-19 EC P-384 key + cert', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importKeyMaterial(sessionId, {
      alias: 'ec384',
      privateKeyPem: read('ec-p384.pkcs8.key'),
      certificatePem: read('ec-p384.crt'),
    })
    expect(engine.aliasDetail(sessionId, 'ec384').chain[0].keySize).toBe(384)
  })

  it('KS-F3-20 multi-cert chain — key must match the LEAF, not the CA', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importKeyMaterial(sessionId, {
      alias: 'chain-key',
      privateKeyPem: read('client.pkcs8.key'),
      certificatePem: read('client.crt') + '\n' + read('ca.crt'),
    })
    expect(engine.aliasDetail(sessionId, 'chain-key').chain.length).toBe(2)
  })

  it('KS-F3-21 key does NOT match certificate → throws, no entry added', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importKeyMaterial(sessionId, {
        alias: 'mismatch',
        privateKeyPem: read('client.key'),
        certificatePem: read('server.crt'),
      }),
    ).toThrow('Private key does not match the provided certificate')
    expect(engine.inspect(sessionId).aliasCount).toBe(0)
  })

  it('KS-F3-22 empty private key → Private key (PEM) cannot be empty', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importKeyMaterial(sessionId, {
        alias: 'k',
        privateKeyPem: '',
        certificatePem: read('client.crt'),
      }),
    ).toThrow('Private key (PEM) cannot be empty')
  })

  it('KS-F3-23 no key block / unparseable key', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importKeyMaterial(sessionId, {
        alias: 'k',
        privateKeyPem: 'hello world',
        certificatePem: read('client.crt'),
      }),
    ).toThrow('No private key found in the provided PEM')
    expect(() =>
      engine.importKeyMaterial(sessionId, {
        alias: 'k',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nZ3JiZ2Jn\n-----END PRIVATE KEY-----',
        certificatePem: read('client.crt'),
      }),
    ).toThrow('Could not parse private key from PEM')
  })

  it('KS-F3-24 missing/invalid certificate → At least one certificate (PEM) is required', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importKeyMaterial(sessionId, {
        alias: 'k',
        privateKeyPem: read('client.pkcs8.key'),
        certificatePem: '',
      }),
    ).toThrow('At least one certificate (PEM) is required')
    expect(() =>
      engine.importKeyMaterial(sessionId, {
        alias: 'k',
        privateKeyPem: read('client.pkcs8.key'),
        certificatePem: 'not a cert',
      }),
    ).toThrow('At least one certificate (PEM) is required')
  })

  it('KS-F3-25 alias already exists (requireNewAlias)', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importKeyMaterial(sessionId, {
      alias: 'dup',
      privateKeyPem: read('client.pkcs8.key'),
      certificatePem: read('client.crt'),
    })
    expect(() =>
      engine.importKeyMaterial(sessionId, {
        alias: 'dup',
        privateKeyPem: read('client.pkcs8.key'),
        certificatePem: read('client.crt'),
      }),
    ).toThrow('Alias already exists: dup')
  })

  it('KS-F3-26 empty alias → Alias cannot be empty', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importKeyMaterial(sessionId, {
        alias: '',
        privateKeyPem: read('client.pkcs8.key'),
        certificatePem: read('client.crt'),
      }),
    ).toThrow('Alias cannot be empty')
  })

  it('KS-F3-48 root-first chain: leaf located anywhere + reordered, not rejected', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    // certChainDer[0] is the CA (root); the leaf that matches the key is SECOND.
    // The old leaf[0] assumption falsely rejected this — the chain search must
    // find the matching cert and reorder it to the leaf position.
    const meta = engine.importKeyMaterial(sessionId, {
      alias: 'rootfirst',
      privateKeyPem: read('client.pkcs8.key'),
      certificatePem: read('ca.crt') + '\n' + read('client.crt'),
    })
    expect(meta.aliasCount).toBe(1)
    const d = engine.aliasDetail(sessionId, 'rootfirst')
    expect(d.entryType).toBe('KEY')
    expect(d.chain.length).toBe(2)
    // Leaf reordered to position 0; the CA follows.
    expect(d.chain[0].subjectDN).toContain('test-client')
    expect(d.chain[1].subjectDN).toContain('Testnizer Test CA')
  })
})

describe('importPem (spec §4.6)', () => {
  it('KS-F3-28 combined key+cert block → key entry', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    const meta = engine.importPem(sessionId, {
      alias: 'combined',
      pemContent: read('client.pkcs8.key') + '\n' + read('client.crt') + '\n' + read('ca.crt'),
    })
    expect(meta.aliasCount).toBe(1)
    const d = engine.aliasDetail(sessionId, 'combined')
    expect(d.entryType).toBe('KEY')
    expect(d.hasPrivateKey).toBe(true)
    expect(d.chain.length).toBe(2)
  })

  it('KS-F3-29 cert-only → trusted certificate entry', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importPem(sessionId, { alias: 'ca-trust', pemContent: read('ca.crt') })
    const d = engine.aliasDetail(sessionId, 'ca-trust')
    expect(d.entryType).toBe('CERTIFICATE')
    expect(d.hasPrivateKey).toBe(false)
    expect(d.chain[0].subjectDN).toContain('Testnizer Test CA')
  })

  it('KS-F3-30 cert-only multi-cert PEM imports the FIRST cert', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importPem(sessionId, {
      alias: 'first-only',
      pemContent: read('client.crt') + '\n' + read('ca.crt'),
    })
    const d = engine.aliasDetail(sessionId, 'first-only')
    expect(d.chain.length).toBe(1)
    expect(d.chain[0].subjectDN).toContain('test-client')
  })

  it('KS-F3-31 private key present but no certificate → throws', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importPem(sessionId, { alias: 'keyonly', pemContent: read('client.pkcs8.key') }),
    ).toThrow('A certificate is required to import a private key')
  })

  it('KS-F3-32 neither key nor certificate → throws', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importPem(sessionId, {
        alias: 'empty',
        pemContent: '-----BEGIN NONSENSE-----\nZ3Ji\n-----END NONSENSE-----',
      }),
    ).toThrow('No private key or certificate found in the provided PEM')
    expect(() => engine.importPem(sessionId, { alias: 'e2', pemContent: 'hello world' })).toThrow(
      'No private key or certificate found in the provided PEM',
    )
  })

  it('KS-F3-33 key + mismatched cert in the same block → throws', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importPem(sessionId, {
        alias: 'mm',
        pemContent: read('client.key') + '\n' + read('server.crt'),
      }),
    ).toThrow('Private key does not match the provided certificate')
    expect(engine.inspect(sessionId).aliasCount).toBe(0)
  })
})

describe('importTrustedCertificate (spec §4.7)', () => {
  it('KS-F3-34 from PEM', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importTrustedCertificate(sessionId, { alias: 'ca', certificateContent: read('ca.crt') })
    const d = engine.aliasDetail(sessionId, 'ca')
    expect(d.entryType).toBe('CERTIFICATE')
    expect(d.hasPrivateKey).toBe(false)
    expect(d.chain[0].subjectDN).toContain('Testnizer Test CA')
    expect(d.chain[0].issuerDN).toBe(d.chain[0].subjectDN) // self-signed root
  })

  it('KS-F3-35 from base64 DER (no PEM headers)', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importTrustedCertificate(sessionId, {
      alias: 'der-cert',
      certificateContent: read('client.der.b64'),
    })
    expect(engine.aliasDetail(sessionId, 'der-cert').chain[0].subjectDN).toContain('test-client')
  })

  it('KS-F3-36 content has no certificate → throws', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importTrustedCertificate(sessionId, {
        alias: 'x',
        certificateContent: 'not base64, not pem',
      }),
    ).toThrow('No certificate found in the provided content')
    expect(() =>
      engine.importTrustedCertificate(sessionId, { alias: 'x', certificateContent: 'aGVsbG8=' }),
    ).toThrow('No certificate found in the provided content')
  })

  it('KS-F3-37 alias already exists → throws', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.importTrustedCertificate(sessionId, { alias: 'ca', certificateContent: read('ca.crt') })
    expect(() =>
      engine.importTrustedCertificate(sessionId, { alias: 'ca', certificateContent: read('ca.crt') }),
    ).toThrow('Alias already exists: ca')
  })

  it('KS-F3-38 empty alias → Alias cannot be empty', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    expect(() =>
      engine.importTrustedCertificate(sessionId, { alias: '', certificateContent: read('ca.crt') }),
    ).toThrow('Alias cannot be empty')
  })
})

describe('verifyKeyMatchesCertificate (spec §6.7 — CRITICAL)', () => {
  it('KS-F3-39 RSA matching pair passes', () => {
    const engine = new KeystoreEngine()
    expect(() =>
      engine.verifyKeyMatchesCertificate(privKeyOf('client.pkcs8.key'), pubKeyOf('client.crt')),
    ).not.toThrow()
  })

  it('KS-F3-40 EC matching pair passes', () => {
    const engine = new KeystoreEngine()
    expect(() =>
      engine.verifyKeyMatchesCertificate(privKeyOf('ec-p256.key'), pubKeyOf('ec-p256.crt')),
    ).not.toThrow()
  })

  it('KS-F3-41 mismatched pair throws', () => {
    const engine = new KeystoreEngine()
    expect(() =>
      engine.verifyKeyMatchesCertificate(privKeyOf('client.pkcs8.key'), pubKeyOf('server.crt')),
    ).toThrow('Private key does not match the provided certificate')
  })

  it('KS-F3-42 unsupported algorithm (Ed25519) matching pair does not throw', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const engine = new KeystoreEngine()
    expect(() => engine.verifyKeyMatchesCertificate(privateKey, publicKey)).not.toThrow()
  })

  it('KS-F3-43 the check actually validates (not stubbed)', () => {
    const engine = new KeystoreEngine()
    // Matching passes …
    expect(() =>
      engine.verifyKeyMatchesCertificate(privKeyOf('client.pkcs8.key'), pubKeyOf('client.crt')),
    ).not.toThrow()
    // … swapping in a different public key throws (real SPKI compare / verify).
    expect(() =>
      engine.verifyKeyMatchesCertificate(privKeyOf('client.pkcs8.key'), pubKeyOf('server.crt')),
    ).toThrow('Private key does not match the provided certificate')
  })

  it('KS-F3-44 unverifiable pair FAILS CLOSED (rejects, never silently accepts)', () => {
    const engine = new KeystoreEngine()
    const priv = privKeyOf('client.pkcs8.key')
    // A symmetric KeyObject can neither export an SPKI nor verify a sign/verify
    // probe. The old gate fell through to the probe and SILENTLY ACCEPTED when it
    // could not run; the fail-closed gate MUST reject an unverifiable pair.
    const unverifiable = createSecretKey(randomBytes(32))
    expect(() => engine.verifyKeyMatchesCertificate(priv, unverifiable)).toThrow(
      KeystoreValidationException,
    )
  })
})
