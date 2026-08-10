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
  const b64 = pem
    .split(`-----BEGIN ${label}-----`)[1]
    .split(`-----END ${label}-----`)[0]
    .replace(/\s+/g, '')
  return Buffer.from(b64, 'base64')
}
const certDer = (f: string): Buffer => pemToDer(readFileSync(join(CERTS, f), 'utf8'), 'CERTIFICATE')
const keyDer = (f: string): Buffer => pemToDer(readFileSync(join(CERTS, f), 'utf8'), 'PRIVATE KEY')

const gate = hasKeytool && hasOpenssl ? describe : describe.skip

gate('keystore interop (keytool + openssl)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ks-interop-'))

  it('engine-written JKS opens with keytool -list and shows the alias', () => {
    const entries = [
      {
        alias: 'test-client',
        kind: 'key' as const,
        privateKeyPkcs8Der: keyDer('client.pkcs8.key'),
        entryPassword: PW,
        certChainDer: [certDer('client.crt'), certDer('ca.crt')],
      },
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
      {
        alias: 'test-client',
        kind: 'key' as const,
        privateKeyPkcs8Der: keyDer('client.pkcs8.key'),
        entryPassword: PW,
        certChainDer: [certDer('client.crt'), certDer('ca.crt')],
      },
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
      [
        '-importkeystore',
        '-noprompt',
        '-srckeystore',
        src,
        '-srcstoretype',
        'JKS',
        '-srcstorepass',
        PW,
        '-destkeystore',
        dest,
        '-deststoretype',
        'PKCS12',
        '-deststorepass',
        PW,
      ],
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
      {
        alias: 'test-client',
        kind: 'key' as const,
        privateKeyPkcs8Der: keyDer('client.pkcs8.key'),
        entryPassword: PW,
        certChainDer: [certDer('client.crt')],
      },
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

  it('engine-GENERATED RSA key pair → PKCS12 opens in keytool -list -v (alias + cert)', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    await engine.generateKeyPair(sessionId, {
      alias: 'genrsa',
      keyAlgorithm: 'RSA',
      keySize: 2048,
      subjectDN: 'CN=gen-rsa',
      subjectAlternativeNames: ['gen.example.com'],
      validityDays: 365,
    })
    const p = join(tmp, 'gen-rsa.p12')
    writeFileSync(p, engine.serialize(sessionId))
    const out = execFileSync(
      'keytool',
      ['-list', '-v', '-keystore', p, '-storetype', 'PKCS12', '-storepass', PW],
      { encoding: 'utf8' },
    )
    expect(out).toMatch(/Alias name: genrsa/)
    expect(out).toMatch(/Entry type: PrivateKeyEntry/)
    expect(out).toMatch(/Owner: CN=gen-rsa/)
  })

  it('engine-GENERATED RSA key pair → JKS opens in keytool -list -v', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('JKS', PW)
    await engine.generateKeyPair(sessionId, {
      alias: 'genjks',
      keyAlgorithm: 'RSA',
      keySize: 2048,
      subjectDN: 'CN=gen-jks',
    })
    const p = join(tmp, 'gen-rsa.jks')
    writeFileSync(p, engine.serialize(sessionId))
    const out = execFileSync(
      'keytool',
      ['-list', '-v', '-keystore', p, '-storetype', 'JKS', '-storepass', PW],
      { encoding: 'utf8' },
    )
    expect(out).toMatch(/Alias name: genjks/)
    expect(out).toMatch(/Entry type: PrivateKeyEntry/)
    expect(out).toMatch(/Owner: CN=gen-jks/)
  })

  it('engine-GENERATED EC P-256 key pair → PKCS12 opens in keytool -list -v', async () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    await engine.generateKeyPair(sessionId, {
      alias: 'genec',
      keyAlgorithm: 'EC',
      curve: 'P-256',
      subjectDN: 'CN=gen-ec',
    })
    const p = join(tmp, 'gen-ec.p12')
    writeFileSync(p, engine.serialize(sessionId))
    const out = execFileSync(
      'keytool',
      ['-list', '-v', '-keystore', p, '-storetype', 'PKCS12', '-storepass', PW],
      { encoding: 'utf8' },
    )
    expect(out).toMatch(/Alias name: genec/)
    expect(out).toMatch(/Entry type: PrivateKeyEntry/)
    expect(out).toMatch(/Owner: CN=gen-ec/)
  })

  it('engine-GENERATED AES-256 secret key shows SecretKeyEntry in keytool (KS-F2-63)', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', PW)
    engine.generateSecretKey(sessionId, {
      alias: 'skio',
      keyAlgorithm: 'AES',
      keySize: 256,
      entryPassword: PW,
    })
    const p = join(tmp, 'skio.p12')
    writeFileSync(p, engine.serialize(sessionId))
    const out = execFileSync(
      'keytool',
      ['-list', '-keystore', p, '-storepass', PW, '-storetype', 'PKCS12'],
      { encoding: 'utf8' },
    )
    expect(out).toMatch(/skio/)
    expect(out).toMatch(/SecretKeyEntry/)
  })

  it('engine multi-alias PKCS12 shows every alias with correct friendlyName in keytool', () => {
    const entries = [
      {
        alias: 'rsa-key',
        kind: 'key' as const,
        privateKeyPkcs8Der: keyDer('client.pkcs8.key'),
        entryPassword: PW,
        certChainDer: [certDer('client.crt')],
      },
      {
        alias: 'ec-key',
        kind: 'key' as const,
        privateKeyPkcs8Der: keyDer('ec-p256.pkcs8.key'),
        entryPassword: PW,
        certChainDer: [certDer('ec-p256.crt')],
      },
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

gate('keystore B4 convert interop (both directions)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ks-b4-'))

  it('engine convert JKS→PKCS12 opens with openssl pkcs12 -info AND keytool -list', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.open(
      serializeKeyStore(
        [
          {
            alias: 'test-client',
            kind: 'key' as const,
            privateKeyPkcs8Der: keyDer('client.pkcs8.key'),
            entryPassword: PW,
            certChainDer: [certDer('client.crt'), certDer('ca.crt')],
          },
        ] as never,
        'JKS',
        PW,
      ),
      PW,
      'JKS',
    )
    // JKS → PKCS12
    const conv = engine.convert(sessionId, 'PKCS12', 'p12pass', PW)
    expect(conv.meta.type).toBe('PKCS12')
    const p12 = engine.serialize(conv.sessionId)
    const p = join(tmp, 'conv.p12')
    writeFileSync(p, p12)

    const ossl = execFileSync(
      'openssl',
      ['pkcs12', '-info', '-in', p, '-passin', 'pass:p12pass', '-nokeys', '-passout', 'pass:x'],
      { encoding: 'utf8' },
    )
    expect(ossl).toContain('friendlyName: test-client')

    // -nocerts extracts a private key → the key survived JKS→PKCS12.
    const keys = execFileSync(
      'openssl',
      ['pkcs12', '-in', p, '-passin', 'pass:p12pass', '-nocerts', '-noenc'],
      { encoding: 'utf8' },
    )
    expect(keys).toMatch(/BEGIN (?:ENCRYPTED )?PRIVATE KEY/)

    const kt = execFileSync(
      'keytool',
      ['-list', '-keystore', p, '-storetype', 'PKCS12', '-storepass', 'p12pass'],
      { encoding: 'utf8' },
    )
    expect(kt).toMatch(/test-client.*PrivateKeyEntry/)
  })

  it('engine convert PKCS12→JKS opens with real keytool -list (key recoverable)', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.open(readFileSync(join(CERTS, 'client.p12')), PW, 'PKCS12')
    // PKCS12 → JKS
    const conv = engine.convert(sessionId, 'JKS', 'jkspass', PW)
    expect(conv.meta.type).toBe('JKS')
    const jks = engine.serialize(conv.sessionId)
    const p = join(tmp, 'conv.jks')
    writeFileSync(p, jks)

    const kt = execFileSync(
      'keytool',
      ['-list', '-v', '-keystore', p, '-storetype', 'JKS', '-storepass', 'jkspass'],
      { encoding: 'utf8' },
    )
    expect(kt).toMatch(/test-client/)
    expect(kt).toMatch(/PrivateKeyEntry/)

    // Force real key recovery by re-importing to PKCS12 (must decrypt the Sun
    // protector written under the NEW store password).
    const dest = join(tmp, 'conv-roundtrip.p12')
    execFileSync(
      'keytool',
      [
        '-importkeystore',
        '-noprompt',
        '-srckeystore',
        p,
        '-srcstoretype',
        'JKS',
        '-srcstorepass',
        'jkspass',
        '-destkeystore',
        dest,
        '-deststoretype',
        'PKCS12',
        '-deststorepass',
        'jkspass',
      ],
      { stdio: 'pipe' },
    )
    expect(readFileSync(dest).length).toBeGreaterThan(0)
  })

  it('round-trip JKS→PKCS12→JKS preserves entry count + key recoverability (keytool)', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.open(readFileSync(join(CERTS, 'client.jks')), PW, 'JKS')
    const start = engine.inspect(sessionId).aliasCount
    const toP12 = engine.convert(sessionId, 'PKCS12', 'mid', PW)
    const back = engine.convert(toP12.sessionId, 'JKS', 'final', 'mid')
    expect(back.meta.aliasCount).toBe(start)
    const p = join(tmp, 'roundtrip.jks')
    writeFileSync(p, engine.serialize(back.sessionId))
    const kt = execFileSync(
      'keytool',
      ['-list', '-keystore', p, '-storetype', 'JKS', '-storepass', 'final'],
      { encoding: 'utf8' },
    )
    expect(kt).toMatch(/test-client.*PrivateKeyEntry/)
  })

  it('saveAs-equivalent setEntryPassword survives keytool key recovery under the new entry pw', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('JKS', 'store')
    // Generate synchronously via importKeyMaterial to keep the KAT deterministic.
    engine.importKeyMaterial(sessionId, {
      alias: 'a',
      privateKeyPem: readFileSync(join(CERTS, 'client.pkcs8.key'), 'utf8'),
      certificatePem: readFileSync(join(CERTS, 'client.crt'), 'utf8'),
    })
    engine.setEntryPassword(sessionId, 'a', 'keypw', 'store')
    const p = join(tmp, 'ep.jks')
    writeFileSync(p, engine.serialize(sessionId))
    // keytool exports the cert only when the correct -keypass is supplied.
    const der = execFileSync(
      'keytool',
      ['-exportcert', '-alias', 'a', '-keystore', p, '-storetype', 'JKS', '-storepass', 'store'],
      { encoding: 'buffer' },
    )
    expect(der.length).toBeGreaterThan(0)
    // Wrong entry password → keytool -keypasswd cannot recover the key.
    let failed = false
    try {
      execFileSync(
        'keytool',
        [
          '-keypasswd',
          '-alias',
          'a',
          '-keystore',
          p,
          '-storetype',
          'JKS',
          '-storepass',
          'store',
          '-keypass',
          'store',
          '-new',
          'x',
        ],
        { stdio: 'pipe' },
      )
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
  })
  /**
   * GATE for the empty-PKCS#12-password decision.
   *
   * `createEmpty` accepts a blank store password for PKCS#12 so a passwordless
   * TRUSTSTORE can be created (the Create dialog labels the field optional, and
   * the TLS Inspector's "Add as trusted" needs exactly this). That is only
   * defensible if the bytes are a real, readable PKCS#12 for the rest of the
   * world — not just for our own reader. If this test ever fails, the decision
   * must be reverted to "label the field required" rather than shipping a file
   * only Testnizer can open.
   */
  it('an EMPTY-password PKCS12 truststore is readable by openssl', () => {
    const engine = new KeystoreEngine()
    const { sessionId } = engine.createEmpty('PKCS12', '')
    engine.importTrustedCertificate(sessionId, {
      alias: 'ca',
      certificateContent: readFileSync(join(CERTS, 'ca.crt'), 'utf8'),
    })
    const p = join(tmp, 'nopass.p12')
    writeFileSync(p, engine.serialize(sessionId))

    const out = execFileSync(
      'openssl',
      ['pkcs12', '-info', '-in', p, '-nokeys', '-passin', 'pass:'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    expect(out).toMatch(/BEGIN CERTIFICATE|friendlyName/i)
  })
})
