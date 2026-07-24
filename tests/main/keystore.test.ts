/**
 * Keystore Studio engine — known-answer / round-trip tests (no Electron, no DB).
 *
 * Covers the Faz 0 engine surface: createEmpty → inspect(0) → generateKeyPair
 * (RSA 2048 + EC P-256/384/521) → inspect(1) → aliasDetail (self-signed);
 * secp256k1 rejection; and JKS + PKCS12 serialize round-trips read back through
 * the same engine (which uses jks-js / node-forge under the hood).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
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
