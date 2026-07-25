/**
 * `jwks:build` (#61 / Faz D1) — the boundary where key material becomes a
 * publishable document.
 *
 * The end-to-end proof lives in `tests/main/jwks-serve.test.ts` (real server,
 * real GET). This file pins the handler's own contract:
 *
 *  - PUBLIC-JWK-ONLY (D1-4) — nothing derived from `privateJwk` can leave, for
 *    ANY source arm, and the last-gate assertion rejects a document that still
 *    carries a private member instead of publishing a "fixed" one.
 *  - NO-LEAK — no PEM, no passphrase, no private JWK in the envelope, and an
 *    error message never quotes a secret.
 *  - ROTATION — `extraKeys` extends the set, newest first, de-duplicated.
 *  - FAIL LOUD — an unusable source produces `{success:false}` with an
 *    actionable message rather than a short, silently-wrong key set.
 */

// reflect-metadata MUST load before @peculiar/x509 (keystore-bridge pulls it in).
import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupHandlerHarness, makeElectronMock } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

const { registerJwksHandlers } = await import('../../../src/main/ipc/jwks.handler')
const { resolveKeyMaterial } = await import('../../../src/main/lib/keystore-bridge')

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/certs')
const fixture = (f: string): string => readFileSync(join(CERTS, f), 'utf8')

const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'] as const

const RSA_SOURCE = {
  kind: 'inline' as const,
  certPem: fixture('client.crt'),
  keyPem: fixture('client.pkcs8.key'),
}
const EC_SOURCE = {
  kind: 'inline' as const,
  certPem: fixture('ec-p256.crt'),
  keyPem: fixture('ec-p256.pkcs8.key'),
}
/** Cert only — no private key at all. Publishing needs nothing more. */
const CERT_ONLY_SOURCE = { kind: 'inline' as const, certPem: fixture('ca.crt') }

interface BuildResult {
  body: string
  kids: string[]
  count: number
}
type Envelope = { success: boolean; data?: BuildResult; error?: string }

const build = (payload: unknown): Promise<Envelope> =>
  harness.invoke('jwks:build', payload) as Promise<Envelope>

beforeEach(() => {
  harness.reset()
  registerJwksHandlers()
})

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC-JWK-ONLY (D1-4) + NO-LEAK
// ═══════════════════════════════════════════════════════════════════════════

describe('jwks:build — public-JWK-only (D1-4)', () => {
  it('publishes the public half of a source that HAS a private key, and only that', async () => {
    const material = resolveKeyMaterial(RSA_SOURCE, 'jwk')
    // Sanity: the source really does carry a private key, else this proves nothing.
    expect(material.privateJwk).toHaveProperty('d')

    const res = await build({ sources: [RSA_SOURCE] })
    expect(res.success).toBe(true)
    const doc = JSON.parse(res.data!.body) as { keys: Record<string, unknown>[] }
    expect(doc.keys).toHaveLength(1)
    for (const member of PRIVATE_MEMBERS) expect(doc.keys[0]).not.toHaveProperty(member)
    expect(doc.keys[0].n).toBe(material.publicJwk?.n)
    expect(res.data!.kids).toEqual([material.publicJwk?.kid])
  })

  it('never lets private key bytes or a PEM into the envelope', async () => {
    const material = resolveKeyMaterial(RSA_SOURCE, 'jwk')
    const res = await build({ sources: [RSA_SOURCE] })
    const envelope = JSON.stringify(res)
    expect(envelope).not.toContain(String(material.privateJwk?.d))
    expect(envelope).not.toContain(String(material.privateJwk?.p))
    expect(envelope).not.toContain('PRIVATE KEY')
    expect(res.data).toEqual({
      body: expect.any(String),
      kids: expect.any(Array),
      count: 1,
    })
  })

  it('sanitizes caller-supplied extraKeys — a hand-pasted PRIVATE JWK is stripped', async () => {
    const priv = resolveKeyMaterial(RSA_SOURCE, 'jwk').privateJwk!
    const res = await build({ sources: [EC_SOURCE], extraKeys: [priv] })
    expect(res.success).toBe(true)
    for (const member of PRIVATE_MEMBERS) {
      expect(res.data!.body).not.toContain(`"${member}"`)
    }
    expect(res.data!.body).not.toContain(String(priv.d))
    expect(res.data!.count).toBe(2)
  })

  it('REFUSES a symmetric key — a shared secret has no publishable half', async () => {
    const res = await build({ extraKeys: [{ kty: 'oct', k: 'c3VwZXItc2VjcmV0', kid: 'hs' }] })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/never be published/)
    expect(JSON.stringify(res)).not.toContain('c3VwZXItc2VjcmV0')
  })

  it('works from a certificate-only source (no private key needed to publish)', async () => {
    const res = await build({ sources: [CERT_ONLY_SOURCE] })
    expect(res.success).toBe(true)
    expect(res.data!.count).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Rotation semantics
// ═══════════════════════════════════════════════════════════════════════════

describe('jwks:build — rotation', () => {
  it('freshly resolved sources lead, previously published keys follow', async () => {
    const first = await build({ sources: [RSA_SOURCE] })
    const existing = (JSON.parse(first.data!.body) as { keys: JsonWebKey[] }).keys

    const rotated = await build({ sources: [EC_SOURCE], extraKeys: existing })
    expect(rotated.data!.count).toBe(2)
    const ecKid = resolveKeyMaterial(EC_SOURCE, 'jwk').publicJwk?.kid
    const rsaKid = resolveKeyMaterial(RSA_SOURCE, 'jwk').publicJwk?.kid
    expect(rotated.data!.kids).toEqual([ecKid, rsaKid])
  })

  it('re-picking the same key does not duplicate it', async () => {
    const first = await build({ sources: [RSA_SOURCE] })
    const existing = (JSON.parse(first.data!.body) as { keys: JsonWebKey[] }).keys
    const again = await build({ sources: [RSA_SOURCE], extraKeys: existing })
    expect(again.data!.count).toBe(1)
    // Byte-identical, so re-filling writes no churn into mock_responses.body.
    expect(again.data!.body).toBe(first.data!.body)
  })

  it('is deterministic — the same input yields the same body text', async () => {
    const a = await build({ sources: [RSA_SOURCE, EC_SOURCE] })
    const b = await build({ sources: [RSA_SOURCE, EC_SOURCE] })
    expect(a.data!.body).toBe(b.data!.body)
    expect(a.data!.count).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Fail loud
// ═══════════════════════════════════════════════════════════════════════════

describe('jwks:build — fail loud', () => {
  it('refuses an empty request rather than serving an empty key set by accident', async () => {
    const res = await build({})
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/at least one key/i)
  })

  it('returns the envelope shape (never throws) for an unreadable source', async () => {
    const res = await build({ sources: [{ kind: 'inline', certPem: 'not a certificate' }] })
    expect(res.success).toBe(false)
    expect(typeof res.error).toBe('string')
    expect(res.error!.length).toBeGreaterThan(0)
  })

  it('does not echo a passphrase back in an error', async () => {
    const res = await build({
      sources: [
        {
          kind: 'inline',
          certPem: fixture('client.crt'),
          keyPem: 'garbage',
          passphrase: 'hunter2-should-never-appear',
        },
      ],
    })
    // The public half comes from the certificate, so this may well succeed —
    // either way the secret must not appear anywhere in the envelope.
    expect(JSON.stringify(res)).not.toContain('hunter2-should-never-appear')
  })
})
