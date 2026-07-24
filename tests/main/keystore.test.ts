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
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import forge from 'node-forge'
import * as x509 from '@peculiar/x509'
import {
  KeystoreEngine,
  KeystoreValidationException,
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
