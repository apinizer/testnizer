/**
 * Keystore Studio INTEROP gate (blocker R1) — shells REAL `keytool` / `openssl`
 * on engine output and reads real keytool-produced fixtures back through the
 * engine. This is the only thing that proves the pure-TS JKS writer and the
 * hand-assembled multi-alias PKCS12 are byte-correct for the Java/OpenSSL world;
 * the jks-js / node-forge round-trips are circular and prove nothing here.
 *
 * Gate policy: HARD-FAIL in CI when keytool/openssl are missing (a green-but-
 * unproven build must never ship), but SKIP on a JDK-less local dev box.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KeystoreEngine, serializeKeyStore } from '../../src/main/lib/keystore'

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/certs')
const PW = 'testpassword'

function has(tool: string, args: string[]): boolean {
  try {
    execFileSync(tool, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const hasKeytool = has('keytool', ['-help'])
const hasOpenssl = has('openssl', ['version'])

if (process.env.CI && (!hasKeytool || !hasOpenssl)) {
  throw new Error(
    `Keystore interop gate requires keytool (${hasKeytool}) and openssl (${hasOpenssl}) in CI. ` +
      'Add actions/setup-java + openssl to the quality job (design R1).',
  )
}

function pemToDer(pem: string, label: string): Buffer {
  const b64 = pem.split(`-----BEGIN ${label}-----`)[1].split(`-----END ${label}-----`)[0].replace(/\s+/g, '')
  return Buffer.from(b64, 'base64')
}
const certDer = (f: string): Buffer => pemToDer(readFileSync(join(CERTS, f), 'utf8'), 'CERTIFICATE')
const keyDer = (f: string): Buffer => pemToDer(readFileSync(join(CERTS, f), 'utf8'), 'PRIVATE KEY')

const gate = hasKeytool && hasOpenssl ? describe : describe.skip

gate('keystore interop (keytool + openssl)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ks-interop-'))

  it('engine-written JKS opens with keytool -list and shows the alias', () => {
    const entries = [
      { alias: 'test-client', kind: 'key' as const, privateKeyPkcs8Der: keyDer('client.pkcs8.key'), entryPassword: PW, certChainDer: [certDer('client.crt'), certDer('ca.crt')] },
      { alias: 'testca', kind: 'cert' as const, certDer: certDer('ca.crt') },
    ]
    const jks = serializeKeyStore(entries as never, 'JKS', PW)
    const p = join(tmp, 'engine.jks')
    writeFileSync(p, jks)
    const out = execFileSync(
      'keytool',
      ['-list', '-keystore', p, '-storetype', 'JKS', '-storepass', PW],
      { encoding: 'utf8' },
    )
    expect(out).toMatch(/Your keystore contains 2 entries/)
    expect(out).toMatch(/test-client.*PrivateKeyEntry/)
    expect(out).toMatch(/testca.*trustedCertEntry/)
  })

  it('engine-written JKS key protector is decryptable by real keytool (forces key recovery)', () => {
    // `keytool -list` only verifies the store MAC + decodes the cert chain — it NEVER
    // decrypts the private key. Force a real JDK to run the Sun "JavaKeyStore" key
    // protector (salt + iterated-SHA1 keystream XOR + trailing integrity digest, the
    // most bug-prone part of jks-writer) by converting to PKCS12: -importkeystore must
    // recover+re-encrypt the key or it exits non-zero. This is the only committed proof
    // the key ciphertext is byte-correct for Java (verify finding: keytool-list alone
    // would pass on a corrupted key).
    const entries = [
      { alias: 'test-client', kind: 'key' as const, privateKeyPkcs8Der: keyDer('client.pkcs8.key'), entryPassword: PW, certChainDer: [certDer('client.crt'), certDer('ca.crt')] },
    ]
    const src = join(tmp, 'protector.jks')
    writeFileSync(src, serializeKeyStore(entries as never, 'JKS', PW))
    const dest = join(tmp, 'protector-out.p12')
    // Throws on non-zero exit if the Sun protector output cannot be decrypted.
    // No -srckeypass: entry pw == store pw here, and keytool takes the key password
    // from -srcstorepass when importing the whole keystore (passing -srckeypass without
    // -srcalias makes keytool reject the whole-store import). It still MUST decrypt the
    // key to re-encrypt it into the PKCS12 destination — that is what exercises protectKey.
    execFileSync(
      'keytool',
      ['-importkeystore', '-noprompt',
        '-srckeystore', src, '-srcstoretype', 'JKS', '-srcstorepass', PW,
        '-destkeystore', dest, '-deststoretype', 'PKCS12', '-deststorepass', PW],
      { stdio: 'pipe' },
    )
    const listed = execFileSync(
      'keytool',
      ['-list', '-keystore', dest, '-storetype', 'PKCS12', '-storepass', PW],
      { encoding: 'utf8' },
    )
    expect(listed).toMatch(/test-client.*PrivateKeyEntry/)
  })

  it('a keytool-produced JKS is read back by the engine', () => {
    const engine = new KeystoreEngine()
    const { sessionId, meta } = engine.open(readFileSync(join(CERTS, 'client.jks')), PW, 'JKS')
    expect(meta.aliasCount).toBe(1)
    expect(meta.aliases[0].alias).toBe('test-client')
    expect(meta.aliases[0].hasPrivateKey).toBe(true)
    const detail = engine.aliasDetail(sessionId, 'test-client')
    expect(detail.chain[0].subjectDN).toContain('CN=test-client')
  })

  it('engine-written PKCS12 opens with BOTH keytool -list and openssl pkcs12 -info', () => {
    const entries = [
      { alias: 'test-client', kind: 'key' as const, privateKeyPkcs8Der: keyDer('client.pkcs8.key'), entryPassword: PW, certChainDer: [certDer('client.crt')] },
    ]
    const p12 = serializeKeyStore(entries as never, 'PKCS12', PW)
    const p = join(tmp, 'engine.p12')
    writeFileSync(p, p12)

    const kt = execFileSync(
      'keytool',
      ['-list', '-keystore', p, '-storetype', 'PKCS12', '-storepass', PW],
      { encoding: 'utf8' },
    )
    expect(kt).toMatch(/test-client.*PrivateKeyEntry/)

    const ossl = execFileSync(
      'openssl',
      ['pkcs12', '-info', '-in', p, '-passin', `pass:${PW}`, '-nokeys', '-passout', 'pass:x'],
      { encoding: 'utf8' },
    )
    // keytool -list above already verifies the PKCS12 MAC end-to-end.
    expect(ossl).toMatch(/friendlyName: test-client/)
  })

  it('engine multi-alias PKCS12 shows every alias with correct friendlyName in keytool', () => {
    const entries = [
      { alias: 'rsa-key', kind: 'key' as const, privateKeyPkcs8Der: keyDer('client.pkcs8.key'), entryPassword: PW, certChainDer: [certDer('client.crt')] },
      { alias: 'ec-key', kind: 'key' as const, privateKeyPkcs8Der: keyDer('ec-p256.pkcs8.key'), entryPassword: PW, certChainDer: [certDer('ec-p256.crt')] },
      { alias: 'trusted-ca', kind: 'cert' as const, certDer: certDer('ca.crt') },
    ]
    const p12 = serializeKeyStore(entries as never, 'PKCS12', PW)
    const p = join(tmp, 'engine-multi.p12')
    writeFileSync(p, p12)

    const kt = execFileSync(
      'keytool',
      ['-list', '-keystore', p, '-storetype', 'PKCS12', '-storepass', PW],
      { encoding: 'utf8' },
    )
    expect(kt).toMatch(/Your keystore contains 3 entries/)
    expect(kt).toMatch(/rsa-key.*PrivateKeyEntry/)
    expect(kt).toMatch(/ec-key.*PrivateKeyEntry/)
    expect(kt).toMatch(/trusted-ca.*trustedCertEntry/)

    // friendlyName parity via openssl too.
    const ossl = execFileSync(
      'openssl',
      ['pkcs12', '-info', '-in', p, '-passin', `pass:${PW}`, '-nokeys', '-passout', 'pass:x'],
      { encoding: 'utf8' },
    )
    for (const name of ['rsa-key', 'ec-key', 'trusted-ca']) {
      expect(ossl).toContain(`friendlyName: ${name}`)
    }
  })
})
