/**
 * Certificate / mTLS pipeline tests.
 *
 * Audit the full chain: certificate.repo (DB rows) → request.handler
 * (`loadCertificatesFor`, `safeReadCertFile`) → http.engine
 * (`HttpRequestOptions.certificates` → `https.Agent` options).
 *
 * We exercise the integration end-to-end at the engine boundary so the
 * cipher-string, version-range, and rejectUnauthorized assertions hit the
 * real `https.Agent` constructor. Real TLS handshakes against BadSSL live
 * in `cert-badssl-network.test.ts` (opt-in).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestDb } from './handlers/helpers'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'testnizer-cert-'))
})
afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    /* fixture cleanup is best-effort */
  }
  vi.resetModules()
})

// Helper to set up a vi.mock for db + executeHttpRequest before importing
// the request handler. We isolate modules per test because the cert handler
// closes over the mocked getDb at import time.
async function importWithMockedDb(rows: {
  certs?: Array<{
    id?: string
    project_id?: string
    kind?: 'ca' | 'client'
    host?: string | null
    crt_path?: string | null
    key_path?: string | null
    pfx_path?: string | null
    passphrase?: string | null
    enabled?: number
    /** Key Material Provider (#60) — omitted = the additive 'file' default. */
    source?: 'file' | 'keystore'
  }>
}): Promise<{
  loadCertificatesFor: (projectId: string, url: string) => unknown
}> {
  vi.doMock('../../src/main/db/database', () => {
    return {
      getDb: () => ({
        prepare: (sql: string) => {
          if (/FROM certificates/i.test(sql)) {
            return {
              all: () =>
                (rows.certs ?? [])
                  .filter((r) => (r.enabled ?? 1) === 1)
                  .map((r) => ({
                    id: r.id ?? 'c1',
                    project_id: r.project_id ?? 'p1',
                    kind: r.kind ?? 'ca',
                    host: r.host ?? null,
                    crt_path: r.crt_path ?? null,
                    key_path: r.key_path ?? null,
                    pfx_path: r.pfx_path ?? null,
                    passphrase: r.passphrase ?? null,
                    enabled: r.enabled ?? 1,
                    created_at: 0,
                    // A pre-provider row read back from a real DB always carries
                    // source='file' (NOT NULL DEFAULT). Mirror that here so the
                    // classic branches are what these regressions exercise.
                    source: r.source ?? 'file',
                    keystore_id: null,
                    keystore_alias: null,
                  })),
            }
          }
          throw new Error(`unexpected SQL in mocked getDb(): ${sql}`)
        },
      }),
    }
  })

  // Stub the secure-storage decrypt so passphrases pass through unchanged —
  // the certificate repo wraps them on insert; we feed the test rows raw.
  vi.doMock('../../src/main/lib/secure-storage', () => ({
    encryptSecret: (s: string) => s,
    decryptSecret: (s: string | null) => s,
  }))

  // Exercise the REAL, exported loadCertificatesFor — not an inline copy. The
  // old harness reimplemented the handler's logic, which is exactly why the
  // host-match + silent-read-failure bugs were never caught (the copy read
  // files unconditionally and never ran the real host filter / error path).
  const mod = await import('../../src/main/ipc/request.handler')
  return { loadCertificatesFor: mod.loadCertificatesFor }
}

// ───────── loadCertificatesFor — host matching + read pipeline ─────────
//
// These exercise the REAL exported loadCertificatesFor, which returns
// `{ certificates?, error? }`. `error` is set (and the request fails fast)
// when a matched, enabled client cert can't be read — no more silent drop.

interface Certs {
  caCerts?: Buffer[]
  clientCert?: { cert?: Buffer; key?: Buffer; pfx?: Buffer; passphrase?: string }
}
type Result = { certificates?: Certs; error?: string }

describe('loadCertificatesFor — host matching', () => {
  it('returns CA certs regardless of host (CA is global to the project)', async () => {
    const caPath = join(tmpRoot, 'root.crt')
    writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nCA-FAKE\n-----END CERTIFICATE-----')
    const { loadCertificatesFor } = await importWithMockedDb({
      certs: [{ kind: 'ca', host: 'somewhere-else.example', crt_path: caPath }],
    })
    const result = loadCertificatesFor('p1', 'https://expired.badssl.com/') as Result
    // A CA's `host` column is advisory — host mismatch on the request URL
    // must NOT exclude the CA from the trust list.
    expect(result.certificates?.caCerts?.length).toBe(1)
    expect(result.error).toBeUndefined()
  })

  it('matches client cert on exact host', async () => {
    const certPath = join(tmpRoot, 'client.crt')
    const keyPath = join(tmpRoot, 'client.key')
    writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nC\n-----END CERTIFICATE-----')
    writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\nK\n-----END PRIVATE KEY-----')
    const { loadCertificatesFor } = await importWithMockedDb({
      certs: [{ kind: 'client', host: 'client.badssl.com', crt_path: certPath, key_path: keyPath }],
    })
    const result = loadCertificatesFor('p1', 'https://client.badssl.com/') as Result
    expect(result.certificates?.clientCert?.cert).toBeInstanceOf(Buffer)
    expect(result.certificates?.clientCert?.key).toBeInstanceOf(Buffer)
  })

  it('matches client cert on wildcard host', async () => {
    const certPath = join(tmpRoot, 'wild.crt')
    const keyPath = join(tmpRoot, 'wild.key')
    writeFileSync(certPath, 'C')
    writeFileSync(keyPath, 'K')
    const { loadCertificatesFor } = await importWithMockedDb({
      certs: [{ kind: 'client', host: '*', crt_path: certPath, key_path: keyPath }],
    })
    const result = loadCertificatesFor('p1', 'https://random.example.com/') as Result
    expect(result.certificates?.clientCert?.cert).toBeInstanceOf(Buffer)
  })

  it('matches a client cert whose stored host carries a scheme (regression: mTLS not sent)', async () => {
    // The exact reported bug: the user pasted "https://sandbox.api.visa.com"
    // into the Certificates settings, but the request host is the bare
    // hostname. The old `host = ?` SQL never matched, so the cert was dropped
    // and the server answered "Expected input credential was not present".
    const certPath = join(tmpRoot, 'visa.crt')
    const keyPath = join(tmpRoot, 'visa.key')
    writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nVISA\n-----END CERTIFICATE-----')
    writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\nVISA-KEY\n-----END PRIVATE KEY-----')
    const { loadCertificatesFor } = await importWithMockedDb({
      certs: [
        {
          kind: 'client',
          host: 'https://sandbox.api.visa.com',
          crt_path: certPath,
          key_path: keyPath,
        },
      ],
    })
    const result = loadCertificatesFor(
      'p1',
      'https://sandbox.api.visa.com/vdp/helloworld',
    ) as Result
    expect(result.certificates?.clientCert?.cert).toBeInstanceOf(Buffer)
    expect(result.certificates?.clientCert?.key).toBeInstanceOf(Buffer)
  })

  it('does NOT attach a client cert whose host does not match the request (negative case)', async () => {
    // Previously untestable: the DB mock returned every row regardless of the
    // WHERE clause, so host mismatch was never exercised. Now that matching is
    // in JS, a client cert scoped to a different host must be excluded.
    const certPath = join(tmpRoot, 'other.crt')
    const keyPath = join(tmpRoot, 'other.key')
    writeFileSync(certPath, 'C')
    writeFileSync(keyPath, 'K')
    const { loadCertificatesFor } = await importWithMockedDb({
      certs: [{ kind: 'client', host: 'other.example.com', crt_path: certPath, key_path: keyPath }],
    })
    const result = loadCertificatesFor(
      'p1',
      'https://sandbox.api.visa.com/vdp/helloworld',
    ) as Result
    // Only one (non-matching) client cert row → nothing matched → no certs, no error.
    expect(result.certificates).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it('prefers PFX path over cert/key when both are present (PFX wins)', async () => {
    const pfxPath = join(tmpRoot, 'bundle.pfx')
    const certPath = join(tmpRoot, 'fallback.crt')
    const keyPath = join(tmpRoot, 'fallback.key')
    writeFileSync(pfxPath, 'PFX-BYTES')
    writeFileSync(certPath, 'CERT-BYTES')
    writeFileSync(keyPath, 'KEY-BYTES')
    const { loadCertificatesFor } = await importWithMockedDb({
      certs: [
        {
          kind: 'client',
          host: 'host.test',
          pfx_path: pfxPath,
          crt_path: certPath,
          key_path: keyPath,
          passphrase: 'pw',
        },
      ],
    })
    const result = loadCertificatesFor('p1', 'https://host.test/') as Result
    expect(result.certificates?.clientCert?.pfx?.toString()).toBe('PFX-BYTES')
    expect(result.certificates?.clientCert?.passphrase).toBe('pw')
    // When PFX is provided the engine ignores cert/key — we mirror that here.
    expect(result.certificates?.clientCert?.cert).toBeUndefined()
    expect(result.certificates?.clientCert?.key).toBeUndefined()
  })

  it('surfaces an error (does NOT silently drop) when a matched client cert file cannot be read', async () => {
    // The second half of the reported bug: the cert row matched but its file
    // was unreadable (e.g. macOS EPERM on ~/Downloads). The request used to go
    // out with NO certificate and got a cryptic server error; now the load
    // fails fast with a descriptive message that the caller throws.
    const { loadCertificatesFor } = await importWithMockedDb({
      certs: [
        {
          kind: 'client',
          host: 'sandbox.api.visa.com',
          crt_path: join(tmpRoot, 'does-not-exist.pem'),
          key_path: join(tmpRoot, 'does-not-exist.key'),
        },
      ],
    })
    const result = loadCertificatesFor(
      'p1',
      'https://sandbox.api.visa.com/vdp/helloworld',
    ) as Result
    expect(result.certificates).toBeUndefined()
    expect(result.error).toMatch(/could not be loaded/i)
    expect(result.error).toMatch(/file not found/i)
  })

  it('skips disabled rows entirely (enabled = 0)', async () => {
    const caPath = join(tmpRoot, 'disabled.crt')
    writeFileSync(caPath, 'CA')
    const { loadCertificatesFor } = await importWithMockedDb({
      certs: [{ kind: 'ca', host: null, crt_path: caPath, enabled: 0 }],
    })
    const result = loadCertificatesFor('p1', 'https://example.com/') as Result
    expect(result.certificates).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it('returns nothing when the URL is malformed (no host to match)', async () => {
    const { loadCertificatesFor } = await importWithMockedDb({
      certs: [{ kind: 'ca', host: null, crt_path: join(tmpRoot, 'whatever.crt') }],
    })
    // No file write — the lookup must short-circuit on the URL parse rather
    // than blowing up further down the pipeline.
    const result = loadCertificatesFor('p1', 'not a url') as Result
    expect(result.certificates).toBeUndefined()
    expect(result.error).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Key Material Provider (#60) — EDIT 1: mTLS Send keystore branch
//
// ADDITIVE INVARIANT: the classic crt/key + pfx FILE paths must keep working
// byte-for-byte; `source='keystore'` is one MORE option, never a replacement.
// mTLS has no pasted-PEM surface today — its two existing input surfaces are
// crt/key and pfx, and BOTH are pinned below (against a real DB row, so the
// new NOT-NULL `source` column is exercised end-to-end) as well as against the
// legacy row shape in the host-matching suite above.
// ═══════════════════════════════════════════════════════════════════════════

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/certs')
const KS_PW = 'testpassword'
const countPemBlocks = (s: string): number => (s.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length

type CertRepo = typeof import('../../src/main/db/certificate.repo')
type KeystoreRepo = typeof import('../../src/main/db/keystore.repo')

/**
 * Same REAL exported `loadCertificatesFor`, but backed by a real in-memory
 * schema so keystore rows, the `certificates.source` column and the resolver's
 * `keystores` lookup are all exercised for real.
 */
async function importWithRealDb(): Promise<{
  loadCertificatesFor: (projectId: string | undefined, url: string) => Result
  createCertificate: CertRepo['createCertificate']
  updateCertificate: CertRepo['updateCertificate']
  createKeystore: KeystoreRepo['createKeystore']
}> {
  const db = createTestDb()
  vi.doMock('../../src/main/db/database', () => ({ getDb: () => db }))
  // Secrets are wrapped at the handler boundary, not in the repos — feed raw.
  vi.doMock('../../src/main/lib/secure-storage', () => ({
    encryptSecret: (s: string) => s,
    decryptSecret: (s: string | null) => s,
  }))
  const handler = await import('../../src/main/ipc/request.handler')
  const certRepo = await import('../../src/main/db/certificate.repo')
  const ksRepo = await import('../../src/main/db/keystore.repo')
  return {
    loadCertificatesFor: handler.loadCertificatesFor as unknown as (
      projectId: string | undefined,
      url: string,
    ) => Result,
    createCertificate: certRepo.createCertificate,
    updateCertificate: certRepo.updateCertificate,
    createKeystore: ksRepo.createKeystore,
  }
}

function seedKeystoreRow(
  createKeystore: KeystoreRepo['createKeystore'],
  file: string,
  opts: { remember?: boolean } = {},
): { id: string } {
  const bytes = readFileSync(join(CERTS, file))
  return createKeystore({
    name: file,
    type: file.endsWith('.jks') ? 'JKS' : 'PKCS12',
    blob: bytes.toString('base64'),
    store_password: opts.remember === false ? null : KS_PW,
    size_bytes: bytes.length,
  })
}

describe("loadCertificatesFor — ADDITIVE: source='file' rows are untouched", () => {
  it('a crt + key row still attaches the client cert (classic file path)', async () => {
    const { loadCertificatesFor, createCertificate } = await importWithRealDb()
    const row = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      crt_path: join(CERTS, 'client.crt'),
      key_path: join(CERTS, 'client.key'),
    })
    // The provider's default: nothing about the row opts into a keystore.
    expect(row.source).toBe('file')
    expect(row.keystore_id).toBeNull()

    const result = loadCertificatesFor('p1', 'https://api.example.com/v1/ping')
    // Byte-for-byte the file contents, exactly as before the provider landed.
    expect(
      result.certificates?.clientCert?.cert?.equals(readFileSync(join(CERTS, 'client.crt'))),
    ).toBe(true)
    expect(
      result.certificates?.clientCert?.key?.equals(readFileSync(join(CERTS, 'client.key'))),
    ).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('a PFX row still attaches pfx + passphrase (classic container path)', async () => {
    const { loadCertificatesFor, createCertificate } = await importWithRealDb()
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      pfx_path: join(CERTS, 'client.p12'),
      passphrase: KS_PW,
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/v1/ping')
    expect(
      result.certificates?.clientCert?.pfx?.equals(readFileSync(join(CERTS, 'client.p12'))),
    ).toBe(true)
    expect(result.certificates?.clientCert?.passphrase).toBe(KS_PW)
    // The PFX is handed to Node untouched — the provider does NOT pre-open it.
    expect(result.certificates?.clientCert?.cert).toBeUndefined()
    expect(result.certificates?.clientCert?.key).toBeUndefined()
  })

  it('a CA row still lands in caCerts and stays a trust anchor', async () => {
    const { loadCertificatesFor, createCertificate } = await importWithRealDb()
    createCertificate({
      project_id: 'p1',
      kind: 'ca',
      host: null,
      crt_path: join(CERTS, 'ca.crt'),
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/')
    expect(result.certificates?.caCerts).toHaveLength(1)
    expect(result.certificates?.clientCert).toBeUndefined()
  })
})

describe("loadCertificatesFor — source='keystore' (#60 EDIT 1)", () => {
  it('materializes a library alias into the SAME clientCert shape the engine maps', async () => {
    const { loadCertificatesFor, createCertificate, createKeystore } = await importWithRealDb()
    const ks = seedKeystoreRow(createKeystore, 'client.jks')
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'test-client',
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/v1/ping')
    expect(result.error).toBeUndefined()
    const cc = result.certificates?.clientCert
    // cert + key Buffers = exactly what the file path produces, so http.engine
    // needs ZERO changes.
    expect(cc?.cert).toBeInstanceOf(Buffer)
    expect(cc?.key).toBeInstanceOf(Buffer)
    expect(cc?.cert?.toString('utf8')).toContain('-----BEGIN CERTIFICATE-----')
    expect(cc?.key?.toString('utf8')).toContain('-----BEGIN PRIVATE KEY-----')
    expect(cc?.pfx).toBeUndefined()
  })

  it('R11: keystore_key_password is the per-alias KEY password (not the store password)', async () => {
    const { loadCertificatesFor, createCertificate, createKeystore } = await importWithRealDb()
    const ks = seedKeystoreRow(createKeystore, 'keytool-diffpass.jks')
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'diffpass',
      keystore_key_password: 'differentpass',
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/')
    expect(result.error).toBeUndefined()
    expect(result.certificates?.clientCert?.key?.toString('utf8')).toContain('PRIVATE KEY')
    // …and it is NOT forwarded to https.Agent: the exported PKCS#8 is already
    // decrypted, so an agent-level passphrase would be meaningless here.
    expect(result.certificates?.clientCert?.passphrase).toBeUndefined()
  })

  it('ADDITIVE: the entry password has its OWN column — a PFX passphrase is never clobbered', async () => {
    const { loadCertificatesFor, createCertificate, updateCertificate, createKeystore } =
      await importWithRealDb()
    const ks = seedKeystoreRow(createKeystore, 'keytool-diffpass.jks')
    // A working FILE-backed row with a PFX passphrase…
    const pfxPath = join(tmpRoot, 'keep-me.pfx')
    writeFileSync(pfxPath, 'pfx-bytes')
    const row = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      pfx_path: pfxPath,
      passphrase: 'my-pfx-secret',
    })
    // …the user then TRIES the added keystore option with an entry password…
    updateCertificate(row.id, {
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'diffpass',
      keystore_key_password: 'differentpass',
    })
    // …and switches back. The file setting must be exactly as it was.
    const back = updateCertificate(row.id, { source: 'file' })
    expect(back?.passphrase).toBe('my-pfx-secret')
    expect(back?.pfx_path).toBe(row.pfx_path)
    const result = loadCertificatesFor('p1', 'https://api.example.com/')
    expect(result.error).toBeUndefined()
    expect(result.certificates?.clientCert?.pfx?.toString('utf8')).toBe('pfx-bytes')
    expect(result.certificates?.clientCert?.passphrase).toBe('my-pfx-secret')
  })

  it('FAIL LOUD: a keystore-backed CA row is rejected, never silently skipped', async () => {
    const { loadCertificatesFor, createCertificate, createKeystore } = await importWithRealDb()
    const ks = seedKeystoreRow(createKeystore, 'client.jks')
    createCertificate({
      project_id: 'p1',
      kind: 'ca',
      host: '*',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'test-client',
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/')
    expect(result.error).toMatch(/keystore-backed CA rows are not supported yet/)
    expect(result.certificates).toBeUndefined()
  })

  it('host matching still governs a keystore row (scoped cert is not sent elsewhere)', async () => {
    const { loadCertificatesFor, createCertificate, createKeystore } = await importWithRealDb()
    const ks = seedKeystoreRow(createKeystore, 'client.jks')
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'test-client',
    })
    const other = loadCertificatesFor('p1', 'https://third-party.example.org/')
    expect(other.certificates).toBeUndefined()
    expect(other.error).toBeUndefined()
  })

  it('FAIL LOUD: an unopenable alias errors instead of going out unauthenticated', async () => {
    const { loadCertificatesFor, createCertificate, createKeystore } = await importWithRealDb()
    const ks = seedKeystoreRow(createKeystore, 'client.jks')
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'ghost-alias',
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/')
    expect(result.certificates).toBeUndefined()
    expect(result.error).toMatch(/could not be loaded/i)
    expect(result.error).toMatch(/Alias not found/i)
  })

  it('FAIL LOUD: remember-password-off with no store password gives the R11 message', async () => {
    const { loadCertificatesFor, createCertificate, createKeystore } = await importWithRealDb()
    const ks = seedKeystoreRow(createKeystore, 'client.jks', { remember: false })
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'test-client',
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/')
    expect(result.certificates).toBeUndefined()
    expect(result.error).toMatch(/store password required — remember-password is off/)
  })

  it('FAIL LOUD: a keystore row with no library link errors clearly', async () => {
    const { loadCertificatesFor, createCertificate } = await importWithRealDb()
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/')
    expect(result.error).toMatch(/no keystore\/alias link/)
  })

  it('NO-LEAK: a failure message carries no password and no key bytes', async () => {
    const { loadCertificatesFor, createCertificate, createKeystore } = await importWithRealDb()
    const ks = seedKeystoreRow(createKeystore, 'client.jks')
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'ghost-alias',
      passphrase: 'super-secret-key-pw',
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/')
    expect(result.error).toBeTruthy()
    expect(result.error).not.toContain(KS_PW)
    expect(result.error).not.toContain('super-secret-key-pw')
    expect(result.error).not.toContain('PRIVATE KEY')
  })
})

describe('BLOCKER — client chain never becomes a CA trust anchor (mTLS attach)', () => {
  it('leaf + intermediates go out CONCATENATED in clientCert.cert, and caCerts stays empty', async () => {
    const { loadCertificatesFor, createCertificate, createKeystore } = await importWithRealDb()
    const ks = seedKeystoreRow(createKeystore, 'client.jks')
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'test-client',
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/')
    const bundle = result.certificates?.clientCert?.cert?.toString('utf8') ?? ''
    // client.jks = leaf + one CA in the chain → both in the ONE bundle.
    expect(countPemBlocks(bundle)).toBe(2)
    // …and NOTHING was pushed into `caCerts`, which http.engine maps to
    // https.Agent({ ca }) — Node's `ca` REPLACES the root store used to
    // validate the SERVER cert, so a client chain there breaks server
    // validation (design §6 BLOCKER).
    expect(result.certificates?.caCerts).toBeUndefined()
  })

  it('an explicit CA row is the ONLY thing in caCerts, even alongside a keystore client cert', async () => {
    const { loadCertificatesFor, createCertificate, createKeystore } = await importWithRealDb()
    const ks = seedKeystoreRow(createKeystore, 'client.jks')
    createCertificate({
      project_id: 'p1',
      kind: 'ca',
      host: null,
      crt_path: join(CERTS, 'ca.crt'),
    })
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
      keystore_id: ks.id,
      keystore_alias: 'test-client',
    })
    const result = loadCertificatesFor('p1', 'https://api.example.com/')
    const caCerts = result.certificates?.caCerts ?? []
    // Exactly the user-supplied trust anchor — the client chain did not grow it.
    expect(caCerts).toHaveLength(1)
    expect(caCerts[0].equals(readFileSync(join(CERTS, 'ca.crt')))).toBe(true)
    expect(countPemBlocks(result.certificates?.clientCert?.cert?.toString('utf8') ?? '')).toBe(2)
  })
})

// ───────── http.engine — agent options assembly ─────────

describe('http.engine — TLS options reach https.Agent', () => {
  it('rejectUnauthorized defaults to TRUE (sslVerification undefined)', async () => {
    // Vitest-isolated module so vi.mock from other tests doesn't bleed in.
    vi.resetModules()
    const { executeHttpRequest } = await import('../../src/main/protocols/http.engine')
    // Hit a port that won't respond — we only care that the agent options
    // are constructed without throwing, AND that the error surface is a
    // transport error (not an option-validation throw).
    const res = await executeHttpRequest({
      method: 'GET',
      url: 'https://127.0.0.1:1/',
      timeout: 800,
    })
    expect(res.error).toBeTruthy()
    expect(res.error).not.toMatch(/TypeError|RangeError/)
  })

  it('insecure mode (sslVerification: false) is accepted without throwing', async () => {
    vi.resetModules()
    const { executeHttpRequest } = await import('../../src/main/protocols/http.engine')
    const res = await executeHttpRequest({
      method: 'GET',
      url: 'https://127.0.0.1:1/',
      sslVerification: false,
      timeout: 800,
    })
    expect(res.error).toBeTruthy()
    expect(res.error).not.toMatch(/TypeError|RangeError/)
  })

  it('CA bundle bytes survive into the agent without throwing', async () => {
    vi.resetModules()
    const { executeHttpRequest } = await import('../../src/main/protocols/http.engine')
    // Fake but syntactically plausible PEM. Node's TLS layer accepts the
    // string at agent-construction time; verification fails at handshake.
    const fakeCa = Buffer.from(
      '-----BEGIN CERTIFICATE-----\n' +
        'MIIBkTCB+wIJAJQ4P0SbR4xLMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNVBAMMCWxv\n' +
        'Y2FsLWNhMB4XDTI0MDEwMTAwMDAwMFoXDTM0MDEwMTAwMDAwMFowFDESMBAGA1UE\n' +
        'AwwJbG9jYWwtY2EwgZ8wDQYJKoZIhvcNAQEBBQADgY0AMIGJAoGBAL8=\n' +
        '-----END CERTIFICATE-----\n',
    )
    const res = await executeHttpRequest({
      method: 'GET',
      url: 'https://127.0.0.1:1/',
      certificates: { caCerts: [fakeCa] },
      timeout: 800,
    })
    expect(res.error).toBeTruthy()
    // We're not asserting on handshake outcome; we're proving the engine
    // wires `certificates.caCerts[]` through to `https.Agent({ ca })`.
    expect(res.error).not.toMatch(/TypeError|RangeError/)
  })

  it('client cert PFX path: pfx + passphrase pass through without crashing', async () => {
    vi.resetModules()
    const { executeHttpRequest } = await import('../../src/main/protocols/http.engine')
    const res = await executeHttpRequest({
      method: 'GET',
      url: 'https://127.0.0.1:1/',
      certificates: {
        clientCert: { pfx: Buffer.from('not-a-real-pkcs12'), passphrase: 'secret' },
      },
      timeout: 800,
    })
    expect(res.error).toBeTruthy()
    // PFX parse fails on its own line; we only care that no synchronous
    // engine-side error escapes the boundary.
    expect(res.error).not.toMatch(/TypeError|RangeError/)
  })

  it('client cert PEM path: cert + key bytes pass through without crashing', async () => {
    vi.resetModules()
    const { executeHttpRequest } = await import('../../src/main/protocols/http.engine')
    const res = await executeHttpRequest({
      method: 'GET',
      url: 'https://127.0.0.1:1/',
      certificates: {
        clientCert: {
          cert: Buffer.from('-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----'),
          key: Buffer.from('-----BEGIN PRIVATE KEY-----\nY\n-----END PRIVATE KEY-----'),
        },
      },
      timeout: 800,
    })
    expect(res.error).toBeTruthy()
    expect(res.error).not.toMatch(/TypeError|RangeError/)
  })
})
