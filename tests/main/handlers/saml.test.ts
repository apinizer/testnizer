/**
 * `saml:*` IPC handlers (#65, Faz E) — the renderer-facing SAML surface.
 *
 * The deep security matrix (every XSW variant, the HMAC allowlist, DTD
 * expansion, the binding bombs) lives in `tests/main/saml-engine.test.ts`. What
 * is pinned HERE is the SURFACE — the four invariants the handler layer owns:
 *
 *  - ADDITIVE  — `{ inline: { certPem, privateKeyPem } }` with NO `source`
 *                anywhere is the DEFAULT and only mandatory path: sign→verify
 *                round-trips on pasted PEM alone.
 *  - PROVIDER  — `{ source }` is ONE added arm, resolved HERE (never in the
 *                pure engine) through `resolveKeyMaterial(..., 'pem')`, and it
 *                really signs with that key: the result verifies against the
 *                same alias' certificate.
 *  - NO-LEAK   — no response ever carries a private key, a resolved PEM, or a
 *                write-only store/entry password.
 *  - FAIL LOUD — neither arm resolvable → `{success:false}` with an actionable
 *                message. A wrapped/HMAC/DOCTYPE document comes back as an
 *                explicit REJECTION naming the failed check, never a silent
 *                "valid".
 */

// reflect-metadata MUST load before @peculiar/x509 (see keystore.ts header).
import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerSamlHandlers } = await import('../../../src/main/ipc/saml.handler')
const { createKeystore } = await import('../../../src/main/db/keystore.repo')
const { resolveKeyMaterial } = await import('../../../src/main/lib/keystore-bridge')
const { verifySaml } = await import('../../../src/main/protocols/saml.engine')

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/certs')
const fixture = (f: string): string => readFileSync(join(CERTS, f), 'utf8')
const STORE_PW = 'testpassword'

const CERT_PEM = fixture('server.crt')
const KEY_PEM = fixture('server.key')
const FOREIGN_CERT = fixture('client.crt')

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

interface VerifyData {
  valid: boolean
  reason?: string
  checks: { name: string; ok: boolean; detail?: string }[]
  signedElement?: { id: string; localName: string }
}

beforeEach(() => {
  testDb = createTestDb()
  harness.reset()
  registerSamlHandlers()
})

function seedKeystore(): string {
  const bytes = readFileSync(join(CERTS, 'client.jks'))
  return createKeystore({
    name: 'client.jks',
    type: 'JKS',
    blob: bytes.toString('base64'),
    store_password: STORE_PW,
    size_bytes: bytes.length,
  }).id
}

async function buildAssertionXml(overrides: Record<string, unknown> = {}): Promise<string> {
  const res = (await harness.invoke('saml:build', {
    kind: 'assertion',
    config: {
      id: '_a1',
      issuer: 'https://idp.example.com',
      subject: { nameId: 'alice@corp.example', recipient: 'https://sp.example.com/acs' },
      audience: 'https://sp.example.com',
      ...overrides,
    },
  })) as Envelope<{ xml: string; id: string }>
  expect(res.success).toBe(true)
  return res.data!.xml
}

function failedCheck(data: VerifyData): string {
  return data.checks.find((c) => !c.ok)?.name ?? '(none)'
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. ADDITIVE — pasted PEM, no keySource anywhere
// ═══════════════════════════════════════════════════════════════════════════

describe('saml:build → saml:sign → saml:verify — the inline default path', () => {
  it('builds every document kind without any key material', async () => {
    const req = (await harness.invoke('saml:build', {
      kind: 'authnRequest',
      config: { issuer: 'https://sp.example.com', assertionConsumerServiceURL: 'https://sp/acs' },
    })) as Envelope<{ xml: string; id: string; issueInstant: string }>
    expect(req.success).toBe(true)
    expect(req.data!.xml).toContain('<samlp:AuthnRequest')
    expect(req.data!.id).toMatch(/^_[0-9a-f]{32}$/)

    const resp = (await harness.invoke('saml:build', {
      kind: 'response',
      config: {
        issuer: 'https://idp.example.com',
        assertion: { issuer: 'https://idp.example.com', subject: { nameId: 'bob' } },
      },
    })) as Envelope<{ xml: string; assertionId?: string }>
    expect(resp.success).toBe(true)
    expect(resp.data!.xml).toContain('<samlp:Response')
    expect(resp.data!.assertionId).toBeTruthy()
  })

  it('ADDITIVE: signs with pasted cert + key and NO keySource, then verifies', async () => {
    const xml = await buildAssertionXml()

    const signed = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
      // The whole payload: one arm, pasted PEM. No `source` key exists.
      key: { inline: { certPem: CERT_PEM, privateKeyPem: KEY_PEM } },
    })) as Envelope<{ xml: string }>

    expect(signed.success).toBe(true)
    expect(signed.data!.xml).toContain('<ds:Signature')

    const verified = (await harness.invoke('saml:verify', {
      xml: signed.data!.xml,
      key: { inline: { certPem: CERT_PEM } },
      options: { validateConditions: false },
    })) as Envelope<VerifyData>

    expect(verified.success).toBe(true)
    expect(verified.data!.valid).toBe(true)
    expect(verified.data!.signedElement).toEqual({ id: '_a1', localName: 'Assertion' })
    expect(verified.data!.checks.every((c) => c.ok)).toBe(true)
  })

  it('an encrypted pasted private key is unwrapped in main (passphrase never returned)', async () => {
    const { generateKeyPairSync, createPrivateKey } = await import('node:crypto')
    // Reuse the fixture certificate's key, re-exported under a passphrase.
    const encrypted = createPrivateKey(KEY_PEM)
      .export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: 'hunter2' })
      .toString()
    expect(encrypted).toContain('ENCRYPTED PRIVATE KEY')
    expect(typeof generateKeyPairSync).toBe('function')

    const xml = await buildAssertionXml()
    const signed = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
      key: { inline: { certPem: CERT_PEM, privateKeyPem: encrypted, passphrase: 'hunter2' } },
    })) as Envelope<{ xml: string }>

    expect(signed.success).toBe(true)
    expect(JSON.stringify(signed)).not.toContain('hunter2')
    expect(verifySaml(signed.data!.xml, CERT_PEM, { validateConditions: false }).valid).toBe(true)
  })

  it('round-trips both bindings without any key material', async () => {
    const xml = await buildAssertionXml()
    for (const binding of ['redirect', 'post'] as const) {
      const enc = (await harness.invoke('saml:encode', { xml, binding })) as Envelope<{
        value: string
      }>
      expect(enc.success).toBe(true)
      const dec = (await harness.invoke('saml:decode', {
        value: enc.data!.value,
        binding,
      })) as Envelope<{ xml: string }>
      expect(dec.success).toBe(true)
      expect(dec.data!.xml).toBe(xml)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. PROVIDER — the ONE added arm, resolved in the handler
// ═══════════════════════════════════════════════════════════════════════════

describe('saml:sign — keystore-backed source', () => {
  it('resolves the source through the provider and really signs with that key', async () => {
    const keystoreId = seedKeystore()
    const source = { kind: 'keystore' as const, keystoreId, alias: 'test-client' }
    const xml = await buildAssertionXml()

    const signed = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
      key: { source },
    })) as Envelope<{ xml: string }>
    expect(signed.success).toBe(true)

    // Honest signature: it verifies against the SAME alias' certificate…
    const aliasCert = resolveKeyMaterial(source, 'pem').certPem
    const ok = (await harness.invoke('saml:verify', {
      xml: signed.data!.xml,
      key: { inline: { certPem: aliasCert } },
      options: { validateConditions: false },
    })) as Envelope<VerifyData>
    expect(ok.data!.valid).toBe(true)

    // …and NOT against an unrelated certificate (trust anchor = caller cert).
    // `client.crt` is the same key pair the `test-client` alias holds, so the
    // negative uses `server.crt` — a genuinely foreign anchor.
    expect(aliasCert.replace(/\s+/g, '')).toContain(FOREIGN_CERT.replace(/\s+/g, '').slice(30, 90))
    const bad = (await harness.invoke('saml:verify', {
      xml: signed.data!.xml,
      key: { inline: { certPem: CERT_PEM } },
      options: { validateConditions: false },
    })) as Envelope<VerifyData>
    expect(bad.data!.valid).toBe(false)
    expect(failedCheck(bad.data!)).toBe('signature-value')
  })

  it('ADDITIVE equivalence: inline and keystore arms produce IDENTICAL signed XML', async () => {
    // The two arms are only interchangeable if they are byte-identical for the
    // same key — otherwise "use the keystore instead of pasting" silently
    // changes what a relying party receives.
    const keystoreId = seedKeystore()
    const source = { kind: 'keystore' as const, keystoreId, alias: 'test-client' }
    const material = resolveKeyMaterial(source, 'pem')
    const xml = await buildAssertionXml()

    const viaSource = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
      key: { source },
    })) as Envelope<{ xml: string }>

    const viaInline = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
      key: { inline: { certPem: material.certPem, privateKeyPem: material.keyPem } },
    })) as Envelope<{ xml: string }>

    expect(viaSource.success && viaInline.success).toBe(true)
    // RSA-SHA256 (PKCS#1 v1.5) is deterministic, so equality is meaningful here.
    expect(viaSource.data!.xml).toBe(viaInline.data!.xml)
  })

  it('the trust anchor can also come from a source (verify, public half only)', async () => {
    const keystoreId = seedKeystore()
    const source = { kind: 'keystore' as const, keystoreId, alias: 'test-client' }
    const xml = await buildAssertionXml()

    const signed = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
      key: { source },
    })) as Envelope<{ xml: string }>

    const verified = (await harness.invoke('saml:verify', {
      xml: signed.data!.xml,
      key: { source },
      options: { validateConditions: false },
    })) as Envelope<VerifyData>
    expect(verified.success).toBe(true)
    expect(verified.data!.valid).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. NO-LEAK — every response, every channel
// ═══════════════════════════════════════════════════════════════════════════

describe('NO-LEAK — nothing key-shaped crosses back to the renderer', () => {
  it('a keystore-backed sign returns only the signed XML', async () => {
    const keystoreId = seedKeystore()
    const source = {
      kind: 'keystore' as const,
      keystoreId,
      alias: 'test-client',
      storePassword: STORE_PW,
    }
    const xml = await buildAssertionXml()

    const res = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
      key: { source },
    })) as Envelope<{ xml: string }>

    expect(res.success).toBe(true)
    expect(Object.keys(res).sort()).toEqual(['data', 'success'])
    expect(Object.keys(res.data!)).toEqual(['xml'])

    const material = resolveKeyMaterial(source, 'pem')
    const wire = JSON.stringify(res)
    expect(wire).not.toContain('PRIVATE KEY')
    expect(wire).not.toContain(STORE_PW)
    expect(wire).not.toContain(material.keyPem!.slice(40, 120))
    // The write-only keySource itself is never echoed back either.
    expect(wire).not.toContain('keystoreId')
    expect(wire).not.toContain('keySource')
  })

  it('every other channel is equally clean (build / verify / encode / decode)', async () => {
    const xml = await buildAssertionXml()
    const signed = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
      key: { inline: { certPem: CERT_PEM, privateKeyPem: KEY_PEM, passphrase: '' } },
    })) as Envelope<{ xml: string }>

    const encoded = (await harness.invoke('saml:encode', {
      xml: signed.data!.xml,
      binding: 'redirect',
    })) as Envelope<{ value: string }>
    const decoded = (await harness.invoke('saml:decode', {
      value: encoded.data!.value,
      binding: 'redirect',
    })) as Envelope<{ xml: string }>
    const verified = (await harness.invoke('saml:verify', {
      xml: signed.data!.xml,
      key: { inline: { certPem: CERT_PEM } },
      options: { validateConditions: false },
    })) as Envelope<VerifyData>

    const keyBody = KEY_PEM.replace(/-----[^-]+-----/g, '')
      .replace(/\s+/g, '')
      .slice(0, 60)
    for (const res of [signed, encoded, decoded, verified]) {
      const wire = JSON.stringify(res)
      expect(wire).not.toContain('PRIVATE KEY')
      expect(wire).not.toContain(keyBody)
      expect(wire).not.toContain('privateKeyPem')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. FAIL LOUD — neither arm, and the security rejections through IPC
// ═══════════════════════════════════════════════════════════════════════════

describe('FAIL LOUD — key material', () => {
  it('rejects a sign payload with NEITHER arm', async () => {
    const xml = await buildAssertionXml()
    const res = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
    })) as Envelope<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/No key material/i)
    expect(res.data).toBeUndefined()
  })

  it('rejects an inline arm missing the private key (never emits unsigned XML)', async () => {
    const xml = await buildAssertionXml()
    const res = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      key: { inline: { certPem: CERT_PEM } },
    })) as Envelope<{ xml: string }>
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/certificate PEM and a private key PEM/)
    expect(res.data).toBeUndefined()
  })

  it('rejects a verify payload with no trust anchor', async () => {
    const res = (await harness.invoke('saml:verify', {
      xml: '<x/>',
      key: { inline: {} },
    })) as Envelope<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/certificate to trust/)
  })

  it('surfaces a resolver failure without leaking the store password', async () => {
    const keystoreId = seedKeystore()
    const xml = await buildAssertionXml()
    const res = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      key: {
        source: { kind: 'keystore', keystoreId, alias: 'ghost-alias', storePassword: STORE_PW },
      },
    })) as Envelope<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Alias not found/)
    expect(res.error).not.toContain(STORE_PW)
    expect(res.error).not.toContain('PRIVATE KEY')
  })

  it('rejects a bad passphrase without quoting key material', async () => {
    const { createPrivateKey } = await import('node:crypto')
    const encrypted = createPrivateKey(KEY_PEM)
      .export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: 'right' })
      .toString()
    const xml = await buildAssertionXml()
    const res = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      key: { inline: { certPem: CERT_PEM, privateKeyPem: encrypted, passphrase: 'wrong' } },
    })) as Envelope<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/could not be decrypted/)
    expect(res.error).not.toContain('wrong')
    expect(res.error).not.toContain('PRIVATE KEY')
  })
})

describe('FAIL LOUD — the security rejections survive the IPC boundary', () => {
  it('XSW: a wrapped document is REJECTED with the wrapping check named', async () => {
    const xml = await buildAssertionXml()
    const signed = (await harness.invoke('saml:sign', {
      xml,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
      key: { inline: { certPem: CERT_PEM, privateKeyPem: KEY_PEM } },
    })) as Envelope<{ xml: string }>

    // Classic XSW: keep the signed assertion inside <Extensions> and put an
    // evil, UNSIGNED assertion in the position a consumer actually reads.
    const evil = (
      await buildAssertionXml({ id: '_evil', subject: { nameId: 'attacker@evil' } })
    ).replace(/^<\?xml[^>]*\?>/, '')
    const wrapped =
      `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r1">` +
      `<samlp:Extensions>${signed.data!.xml}</samlp:Extensions>${evil}</samlp:Response>`

    const res = (await harness.invoke('saml:verify', {
      xml: wrapped,
      key: { inline: { certPem: CERT_PEM } },
      options: { validateConditions: false, requireAssertionSigned: true },
    })) as Envelope<VerifyData>

    // The handler succeeded; the DOCUMENT was rejected — and the report says
    // exactly which guarantee broke, so the UI can be specific.
    expect(res.success).toBe(true)
    expect(res.data!.valid).toBe(false)
    expect(['signed-element-scope', 'assertion-signed', 'reference-target']).toContain(
      failedCheck(res.data!),
    )
    expect(res.data!.reason).toBeTruthy()
  })

  it('a DOCTYPE document is rejected before parsing, on every channel that takes XML', async () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x "boom">]><samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r"/>`

    const verified = (await harness.invoke('saml:verify', {
      xml: evil,
      key: { inline: { certPem: CERT_PEM } },
    })) as Envelope<VerifyData>
    expect(verified.success).toBe(true)
    expect(verified.data!.valid).toBe(false)
    expect(failedCheck(verified.data!)).toBe('doctype')

    const signed = (await harness.invoke('saml:sign', {
      xml: evil,
      algorithm: 'RSA-SHA256',
      key: { inline: { certPem: CERT_PEM, privateKeyPem: KEY_PEM } },
    })) as Envelope<unknown>
    expect(signed.success).toBe(false)
    expect(signed.error).toMatch(/DOCTYPE/)

    const encoded = (await harness.invoke('saml:encode', {
      xml: evil,
      binding: 'post',
    })) as Envelope<unknown>
    expect(encoded.success).toBe(false)
    expect(encoded.error).toMatch(/DOCTYPE/)

    // And the guard re-applies to a DECODED payload — attacker-controlled bytes.
    const smuggled = Buffer.from(evil, 'utf8').toString('base64')
    const decoded = (await harness.invoke('saml:decode', {
      value: smuggled,
      binding: 'post',
    })) as Envelope<unknown>
    expect(decoded.success).toBe(false)
    expect(decoded.error).toMatch(/DOCTYPE/)
  })

  it('an unsigned document is rejected rather than reported "valid"', async () => {
    const res = (await harness.invoke('saml:verify', {
      xml: await buildAssertionXml(),
      key: { inline: { certPem: CERT_PEM } },
      options: { validateConditions: false },
    })) as Envelope<VerifyData>
    expect(res.data!.valid).toBe(false)
    expect(failedCheck(res.data!)).toBe('signature-present')
  })

  it('an unknown binding / document kind fails loud instead of guessing', async () => {
    const bad = (await harness.invoke('saml:encode', {
      xml: '<x/>',
      binding: 'artifact',
    })) as Envelope<unknown>
    expect(bad.success).toBe(false)
    expect(bad.error).toMatch(/unknown binding/)

    const kind = (await harness.invoke('saml:build', {
      kind: 'metadata',
      config: {},
    })) as Envelope<unknown>
    expect(kind.success).toBe(false)
    expect(kind.error).toMatch(/unknown document kind/)
  })
})
