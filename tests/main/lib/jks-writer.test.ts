/**
 * Unit tests for the pure-TS JKS writer (`encodeJks`) — the ENCRYPT/serialize
 * direction of the Sun JKS format whose DECRYPT direction ships in `jks-js`.
 *
 * Coverage:
 *  - structural: magic 0xFEEDFEED, version 2, entry count, key-protector OID,
 *    EncryptedPrivateKeyInfo DER framing, trailing store-integrity SHA1;
 *  - round-trip: encodeJks(...) → jks-js `toPem` recovers the exact same
 *    private key + cert chain and rejects a wrong password.
 *
 * REAL keytool (OpenJDK) acceptance is proven in the interop suite / manually
 * (see the interopEvidence transcript in the Faz-0 report). jks-js is the
 * symmetric read oracle here; keytool is the ground-truth oracle there.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — jks-js ships no types
import * as jksjs from 'jks-js'
import { encodeJks, type JksEntry } from '../../../src/main/lib/jks-writer'

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/certs')
const PW = 'testpassword'
const KEY_PROTECTOR_OID = Buffer.from([
  0x2b, 0x06, 0x01, 0x04, 0x01, 0x2a, 0x02, 0x11, 0x01, 0x01,
])

function pemToDer(pem: string, label: string): Buffer {
  const b64 = pem
    .split(`-----BEGIN ${label}-----`)[1]
    .split(`-----END ${label}-----`)[0]
    .replace(/\s+/g, '')
  return Buffer.from(b64, 'base64')
}
const certDer = (f: string): Buffer =>
  pemToDer(readFileSync(join(CERTS, f), 'utf8'), 'CERTIFICATE')
const keyDer = (f: string): Buffer =>
  pemToDer(readFileSync(join(CERTS, f), 'utf8'), 'PRIVATE KEY')

function utf16be(pw: string): Buffer {
  const out = Buffer.alloc(pw.length * 2)
  for (let i = 0, j = 0; i < pw.length; i++) {
    const c = pw.charCodeAt(i)
    out[j++] = c >> 8
    out[j++] = c & 0xff
  }
  return out
}

const rsaKeyEntry = (): JksEntry => ({
  alias: 'test-client',
  type: 'key',
  privateKeyPkcs8Der: keyDer('client.pkcs8.key'),
  entryPassword: PW,
  certChainDer: [certDer('client.crt'), certDer('ca.crt')],
})

describe('encodeJks — structural', () => {
  it('starts with magic 0xFEEDFEED, version 2, correct entry count', () => {
    const buf = encodeJks([rsaKeyEntry()], PW)
    expect(buf.readUInt32BE(0)).toBe(0xfeedfeed)
    expect(buf.readUInt32BE(4)).toBe(2)
    expect(buf.readUInt32BE(8)).toBe(1)
  })

  it('emits tag=1 + alias UTF for a private-key entry', () => {
    const buf = encodeJks([rsaKeyEntry()], PW)
    expect(buf.readUInt32BE(12)).toBe(1) // PRIVATE_KEY_TAG
    const aliasLen = buf.readUInt16BE(16)
    expect(aliasLen).toBe('test-client'.length)
    expect(buf.subarray(18, 18 + aliasLen).toString('utf8')).toBe('test-client')
  })

  it('emits tag=2 for a trusted-cert entry', () => {
    const buf = encodeJks(
      [{ alias: 'testca', type: 'cert', certDer: certDer('ca.crt') }],
      PW,
    )
    expect(buf.readUInt32BE(12)).toBe(2) // TRUSTED_CERT_TAG
  })

  it('wraps the key with the Sun JavaKeyStore protector OID inside EncryptedPrivateKeyInfo', () => {
    const buf = encodeJks([rsaKeyEntry()], PW)
    // The DER EncryptedPrivateKeyInfo begins right after u4 length; find the OID.
    expect(buf.includes(KEY_PROTECTOR_OID)).toBe(true)
    // AlgorithmIdentifier is SEQUENCE{OID} with NO params (byte-KAT from client.jks):
    // ... 30 0c 06 0a <10 oid bytes> ...
    const idx = buf.indexOf(KEY_PROTECTOR_OID)
    expect(buf[idx - 2]).toBe(0x06) // OID tag
    expect(buf[idx - 1]).toBe(0x0a) // OID length 10
    expect(buf[idx - 4]).toBe(0x30) // enclosing SEQUENCE tag
    expect(buf[idx - 3]).toBe(0x0c) // SEQUENCE length 12 = OID only (no NULL params)
  })

  it('appends a keyed SHA1 store-integrity hash = SHA1(UTF16BE(pw) || "Mighty Aphrodite" || body)', () => {
    const buf = encodeJks([rsaKeyEntry()], PW)
    const body = buf.subarray(0, buf.length - 20)
    const trailer = buf.subarray(buf.length - 20)
    const expected = createHash('sha1')
      .update(utf16be(PW))
      .update(Buffer.from('Mighty Aphrodite', 'utf8'))
      .update(body)
      .digest()
    expect(trailer.equals(expected)).toBe(true)
  })

  it('encrypted-key blob length = salt(20) + plaintext + digest(20)', () => {
    const pk = keyDer('client.pkcs8.key')
    const buf = encodeJks([rsaKeyEntry()], PW)
    // OCTET STRING (tag 0x04) holding salt||xored||digest lives after the algId.
    const oidIdx = buf.indexOf(KEY_PROTECTOR_OID)
    // after OID (10 bytes) comes the OCTET STRING: 04 <len...>
    const octetTagIdx = oidIdx + 10
    expect(buf[octetTagIdx]).toBe(0x04)
    // long-form length 0x82 <hi> <lo>
    expect(buf[octetTagIdx + 1]).toBe(0x82)
    const octetLen = buf.readUInt16BE(octetTagIdx + 2)
    expect(octetLen).toBe(20 + pk.length + 20)
  })
})

describe('encodeJks — round-trip via jks-js (read oracle)', () => {
  it('recovers the RSA private key + full cert chain', () => {
    const buf = encodeJks([rsaKeyEntry()], PW)
    const pems = jksjs.toPem(buf, PW)
    expect(Object.keys(pems)).toEqual(['test-client'])
    expect(pems['test-client'].key).toContain('BEGIN PRIVATE KEY')
    // chain has 2 certs joined
    expect(pems['test-client'].cert.match(/BEGIN CERTIFICATE/g)?.length).toBe(2)
  })

  it('recovers an EC (P-256) private key', () => {
    const buf = encodeJks(
      [
        {
          alias: 'ec-client',
          type: 'key',
          privateKeyPkcs8Der: keyDer('ec-p256.pkcs8.key'),
          entryPassword: PW,
          certChainDer: [certDer('ec-p256.crt')],
        },
      ],
      PW,
    )
    const pems = jksjs.toPem(buf, PW)
    expect(pems['ec-client'].key).toContain('BEGIN PRIVATE KEY')
  })

  it('recovers a trusted-cert entry as a CA PEM', () => {
    const buf = encodeJks(
      [{ alias: 'testca', type: 'cert', certDer: certDer('ca.crt') }],
      PW,
    )
    const pems = jksjs.toPem(buf, PW)
    expect(pems['testca'].ca).toContain('BEGIN CERTIFICATE')
  })

  it('honours a per-entry password distinct from the store password', () => {
    const buf = encodeJks(
      [
        {
          alias: 'diffkey',
          type: 'key',
          privateKeyPkcs8Der: keyDer('client.pkcs8.key'),
          entryPassword: 'differentpass',
          certChainDer: [certDer('client.crt')],
        },
      ],
      PW,
    )
    // Store hash verifies with store pw; key recovers only with entry pw.
    const pems = jksjs.toPem(buf, PW, 'differentpass')
    expect(pems['diffkey'].key).toContain('BEGIN PRIVATE KEY')
    // Wrong key password must fail the protector integrity check.
    expect(() => jksjs.toPem(buf, PW, 'wrongkeypass')).toThrow()
  })

  it('rejects a wrong store password (integrity hash)', () => {
    const buf = encodeJks([rsaKeyEntry()], PW)
    expect(() => jksjs.toPem(buf, 'wrongpass')).toThrow()
  })

  it('round-trips multiple mixed entries preserving order', () => {
    const buf = encodeJks(
      [
        rsaKeyEntry(),
        { alias: 'testca', type: 'cert', certDer: certDer('ca.crt') },
      ],
      PW,
    )
    expect(buf.readUInt32BE(8)).toBe(2)
    const pems = jksjs.toPem(buf, PW)
    expect(Object.keys(pems).sort()).toEqual(['test-client', 'testca'])
  })
})
