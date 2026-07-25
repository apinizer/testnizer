/**
 * `jose:*` IPC handlers (#63) — the renderer-facing contract for JOSE ops.
 *
 * What is pinned here:
 *
 *  - ADDITIVE  — the `{inline}` arm (a pasted secret / pasted PEM) is the
 *                DEFAULT path and round-trips sign→verify for HS256 and RS256,
 *                exactly what the Tools → JWT Debugger does today.
 *  - NO-LEAK   — a KEYSTORE-backed sign returns the token and NOTHING else: no
 *                PEM, no private JWK, no passphrase, nowhere in the envelope.
 *                Main resolves the key, signs with it, and it dies in main.
 *  - HONEST    — the keystore-signed token really is signed by that key: it
 *                verifies against a JWKS built from the SAME source's public
 *                JWK (`buildJwks` + `resolveKeyMaterial(…, 'jwk')`).
 *
 * These handlers are the reason JOSE lives in main at all — a keystore key must
 * never be handed to the renderer to sign with.
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

const { registerJoseHandlers } = await import('../../../src/main/ipc/jose.handler')
const { createKeystore } = await import('../../../src/main/db/keystore.repo')
const { resolveKeyMaterial } = await import('../../../src/main/lib/keystore-bridge')
const { buildJwks } = await import('../../../src/main/lib/jwks')

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/certs')
const fixture = (f: string): string => readFileSync(join(CERTS, f), 'utf8')
const STORE_PW = 'testpassword'

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

beforeEach(() => {
  testDb = createTestDb()
  harness.reset()
  registerJoseHandlers()
})

/** Seed `client.jks` as a library row (safeStorage stub = plaintext at rest). */
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

// ═══════════════════════════════════════════════════════════════════════════
// 1. ADDITIVE — the pasted-material default path
// ═══════════════════════════════════════════════════════════════════════════

describe('jose:sign → jose:verify — inline arm (the default path)', () => {
  it('round-trips HS256 with a pasted shared secret', async () => {
    const signed = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'HS256',
      payload: { sub: 'alice', role: 'admin' },
      key: { inline: { secret: 'super-secret-value' } },
    })) as Envelope<string>
    expect(signed.success).toBe(true)
    expect(signed.data).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)

    const verified = (await harness.invoke('jose:verify', {
      mode: 'jwt',
      token: signed.data,
      algorithms: ['HS256'],
      key: { inline: { secret: 'super-secret-value' } },
    })) as Envelope<{ payload: Record<string, unknown>; header: Record<string, unknown> }>
    expect(verified.success).toBe(true)
    expect(verified.data?.payload.sub).toBe('alice')
    expect(verified.data?.header.alg).toBe('HS256')
  })

  it('rejects HS256 verification with the wrong secret', async () => {
    const signed = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'HS256',
      payload: { sub: 'alice' },
      key: { inline: { secret: 'right' } },
    })) as Envelope<string>
    const verified = (await harness.invoke('jose:verify', {
      mode: 'jwt',
      token: signed.data,
      algorithms: ['HS256'],
      key: { inline: { secret: 'wrong' } },
    })) as Envelope<unknown>
    expect(verified.success).toBe(false)
    expect(verified.error).toBeTruthy()
  })

  it('round-trips RS256 with a pasted PKCS#8 key + certificate PEM', async () => {
    const signed = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'RS256',
      payload: { sub: 'bob' },
      key: { inline: { privateKeyPem: fixture('client.pkcs8.key') } },
    })) as Envelope<string>
    expect(signed.success).toBe(true)

    // Verification takes the CERTIFICATE PEM — importX509 handles it, which is
    // what users actually paste.
    const verified = (await harness.invoke('jose:verify', {
      mode: 'jwt',
      token: signed.data,
      algorithms: ['RS256'],
      key: { inline: { certPem: fixture('client.crt') } },
    })) as Envelope<{ payload: Record<string, unknown> }>
    expect(verified.success).toBe(true)
    expect(verified.data?.payload.sub).toBe('bob')
  })

  it('signs an arbitrary payload as a compact JWS too (mode: jws)', async () => {
    const signed = (await harness.invoke('jose:sign', {
      mode: 'jws',
      alg: 'HS256',
      payload: 'raw payload bytes',
      key: { inline: { secret: 's3cret' } },
    })) as Envelope<string>
    // `alg` is REQUIRED here: the handler's fallback reads the algorithm by
    // decoding the token, and that decode goes through `decodeJwt`, which
    // throws on a JWS whose payload is not JSON claims. Pinned so the DTO doc
    // ("send `alg` for mode:'jws'") stays honest.
    const verified = (await harness.invoke('jose:verify', {
      mode: 'jws',
      token: signed.data,
      alg: 'HS256',
      algorithms: ['HS256'],
      key: { inline: { secret: 's3cret' } },
    })) as Envelope<{ payload: string }>
    expect(verified.success).toBe(true)
    expect(verified.data?.payload).toBe('raw payload bytes')
  })

  it("mode:'jws' with NO alg fails loud rather than guessing (non-JSON payload)", async () => {
    const signed = (await harness.invoke('jose:sign', {
      mode: 'jws',
      alg: 'HS256',
      payload: 'raw payload bytes',
      key: { inline: { secret: 's3cret' } },
    })) as Envelope<string>
    const verified = (await harness.invoke('jose:verify', {
      mode: 'jws',
      token: signed.data,
      key: { inline: { secret: 's3cret' } },
    })) as Envelope<unknown>
    expect(verified.success).toBe(false)
    expect(verified.error).toMatch(/algorithm/i)
  })

  it('jose:decode reads a token without verifying it', async () => {
    const signed = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'HS256',
      payload: { sub: 'carol' },
      key: { inline: { secret: 'x' } },
    })) as Envelope<string>
    const decoded = (await harness.invoke('jose:decode', signed.data)) as Envelope<{
      header: Record<string, unknown>
      payload: Record<string, unknown>
    }>
    expect(decoded.success).toBe(true)
    expect(decoded.data?.header.alg).toBe('HS256')
    expect(decoded.data?.payload.sub).toBe('carol')
  })

  it('FAILS LOUD when the inline arm carries nothing usable', async () => {
    const res = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'RS256',
      payload: {},
      key: { inline: {} },
    })) as Envelope<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/needs a private key/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. NO-LEAK — a keystore-backed sign returns a token and nothing else
// ═══════════════════════════════════════════════════════════════════════════

describe('jose:sign — keystore-backed source (NO-LEAK)', () => {
  it('returns ONLY the token: no PEM, no private JWK, no passphrase', async () => {
    const keystoreId = seedKeystore()
    const source = { kind: 'keystore' as const, keystoreId, alias: 'test-client' }

    const res = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'RS256',
      payload: { sub: 'from-keystore' },
      key: { source },
    })) as Envelope<string>

    expect(res.success).toBe(true)
    expect(typeof res.data).toBe('string')
    expect(res.data).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
    // The envelope carries the token and the envelope flags — nothing else.
    expect(Object.keys(res).sort()).toEqual(['data', 'success'])

    // Now assert against the ACTUAL key material this source resolves to: none
    // of it may appear anywhere in the serialized IPC response.
    const material = resolveKeyMaterial(source, 'jwk')
    const wire = JSON.stringify(res)
    expect(wire).not.toContain('PRIVATE KEY')
    expect(wire).not.toContain('BEGIN CERTIFICATE')
    expect(wire).not.toContain(STORE_PW)
    expect(wire).not.toContain(String(material.privateJwk!.d))
    expect(wire).not.toContain(String(material.privateJwk!.p))
    expect(wire).not.toContain(String(material.privateJwk!.q))
    // The public modulus is not leaked either — the renderer asked for a
    // signature, not for a key in any form.
    expect(wire).not.toContain(String(material.publicJwk!.n))
  })

  it('the keystore-signed token verifies against a JWKS built from the same source', async () => {
    const keystoreId = seedKeystore()
    const source = { kind: 'keystore' as const, keystoreId, alias: 'test-client' }
    const publicJwk = resolveKeyMaterial(source, 'jwk').publicJwk!
    const jwks = buildJwks({ keys: [publicJwk] })

    const signed = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'RS256',
      payload: { sub: 'from-keystore' },
      header: { kid: publicJwk.kid },
      key: { source },
    })) as Envelope<string>
    expect(signed.success).toBe(true)

    const verified = (await harness.invoke('jose:verify', {
      mode: 'jwt',
      token: signed.data,
      algorithms: ['RS256'],
      jwks,
    })) as Envelope<{ payload: Record<string, unknown>; header: Record<string, unknown> }>
    expect(verified.success).toBe(true)
    expect(verified.data?.payload.sub).toBe('from-keystore')
    expect(verified.data?.header.kid).toBe(publicJwk.kid)
  })

  it('refuses to use a keystore key for a shared-secret algorithm', async () => {
    const keystoreId = seedKeystore()
    const res = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'HS256',
      payload: {},
      key: { source: { kind: 'keystore', keystoreId, alias: 'test-client' } },
    })) as Envelope<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/shared-secret algorithm/)
  })

  it('surfaces a resolver failure as {success:false} without leaking secrets', async () => {
    const keystoreId = seedKeystore()
    const res = (await harness.invoke('jose:sign', {
      mode: 'jwt',
      alg: 'RS256',
      payload: {},
      key: { source: { kind: 'keystore', keystoreId, alias: 'ghost-alias' } },
    })) as Envelope<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Alias not found/)
    expect(res.error).not.toContain(STORE_PW)
    expect(res.error).not.toContain('PRIVATE KEY')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. JWE — same key union, same envelope
// ═══════════════════════════════════════════════════════════════════════════

describe('jose:encrypt → jose:decrypt', () => {
  it('round-trips RSA-OAEP-256 / A256GCM with pasted PEM', async () => {
    const encrypted = (await harness.invoke('jose:encrypt', {
      alg: 'RSA-OAEP-256',
      enc: 'A256GCM',
      plaintext: 'top secret payload',
      key: { inline: { certPem: fixture('client.crt') } },
    })) as Envelope<string>
    expect(encrypted.success).toBe(true)

    const decrypted = (await harness.invoke('jose:decrypt', {
      alg: 'RSA-OAEP-256',
      enc: 'A256GCM',
      jwe: encrypted.data,
      key: { inline: { privateKeyPem: fixture('client.pkcs8.key') } },
    })) as Envelope<{ plaintext: string }>
    expect(decrypted.success).toBe(true)
    expect(decrypted.data?.plaintext).toBe('top secret payload')
  })

  it('decrypts with a keystore-backed key without returning it', async () => {
    const keystoreId = seedKeystore()
    const source = { kind: 'keystore' as const, keystoreId, alias: 'test-client' }
    const encrypted = (await harness.invoke('jose:encrypt', {
      alg: 'RSA-OAEP-256',
      enc: 'A256GCM',
      plaintext: 'keystore round trip',
      key: { source },
    })) as Envelope<string>
    expect(encrypted.success).toBe(true)

    const decrypted = (await harness.invoke('jose:decrypt', {
      alg: 'RSA-OAEP-256',
      enc: 'A256GCM',
      jwe: encrypted.data,
      key: { source },
    })) as Envelope<{ plaintext: string }>
    expect(decrypted.success).toBe(true)
    expect(decrypted.data?.plaintext).toBe('keystore round trip')
    expect(JSON.stringify(decrypted)).not.toContain('PRIVATE KEY')
  })
})
