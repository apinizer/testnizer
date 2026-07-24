/**
 * Smoke tests for `keystore:*` IPC handlers — envelope shape for every channel,
 * a NO-LEAK spine (no response carries a private key, a password, or raw
 * keystore bytes), the Model-B encrypt round-trip (remembered + not-remembered),
 * and library CRUD.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

// Deterministic, reversible "encryption" so we can assert what the DB holds.
// `mockEnc.available` is flipped by the plaintext-hardening test to simulate a
// missing/locked OS keychain (vitest allows a `mock`-prefixed hoisted binding).
const mockEnc = { available: true }
vi.mock('../../../src/main/lib/secure-storage', () => ({
  encryptSecret: (s: string | null | undefined) => (s ? `enc:${s}` : null),
  decryptSecret: (s: string | null | undefined) => (s ? s.replace(/^enc:/, '') : null),
  isEncryptionAvailable: () => mockEnc.available,
}))

const { registerKeystoreHandlers } = await import('../../../src/main/ipc/keystore.handler')
const { keystoreEngine } = await import('../../../src/main/lib/keystore')
const { dialog } = await import('electron')

type Res<T> = { success: boolean; data?: T; error?: string }

const STORE_PASSWORD = 'changeit-secret-pw'
const ALIAS = 'client-key'

/** Build a populated PKCS12 session (one RSA key entry) and return its bytes. */
async function makePopulatedKeystoreB64(): Promise<{ sessionId: string; b64: string }> {
  const created = keystoreEngine.createEmpty('PKCS12', STORE_PASSWORD)
  await keystoreEngine.generateKeyPair(created.sessionId, {
    alias: ALIAS,
    keyAlgorithm: 'RSA',
    keySize: 1024,
    subjectDN: 'CN=Keystore Test',
  })
  const bytes = keystoreEngine.serialize(created.sessionId)
  return { sessionId: created.sessionId, b64: bytes.toString('base64') }
}

/** Assert a handler response never leaks a key/password/raw-blob. */
function assertNoLeak(res: Res<unknown>, blobB64: string): void {
  const json = JSON.stringify(res)
  expect(json).not.toContain('PRIVATE KEY')
  expect(json).not.toContain(STORE_PASSWORD)
  // The full serialized keystore must never travel to the renderer.
  expect(json).not.toContain(blobB64)
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  registerKeystoreHandlers()
})

describe('keystore:pickFile', () => {
  it('returns success:false when the dialog is cancelled', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const res = (await harness.invoke('keystore:pickFile')) as Res<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toBe('Cancelled')
  })

  it('returns the picked path + a detected type', async () => {
    const path = join(tmpdir(), `ks-${randomUUID()}.p12`)
    writeFileSync(path, Buffer.from('dummy'))
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const res = (await harness.invoke('keystore:pickFile')) as Res<{
      path: string
      fileName: string
      type: string
    }>
    expect(res.success).toBe(true)
    expect(res.data?.path).toBe(path)
    expect(res.data?.type).toBe('PKCS12')
  })
})

describe('keystore:createNew', () => {
  it('creates an empty session and returns a sessionId + meta', async () => {
    const res = (await harness.invoke('keystore:createNew', {
      type: 'JKS',
      password: STORE_PASSWORD,
    })) as Res<{ sessionId: string; meta: { type: string; aliasCount: number } }>
    expect(res.success).toBe(true)
    expect(res.data?.sessionId).toBeTruthy()
    expect(res.data?.meta.type).toBe('JKS')
    expect(res.data?.meta.aliasCount).toBe(0)
    // No secret in the envelope.
    expect(JSON.stringify(res)).not.toContain(STORE_PASSWORD)
  })
})

describe('keystore:open + list + aliasDetail (no-leak spine)', () => {
  it('opens from base64 bytes, lists aliases, and never leaks the key/pw/bytes', async () => {
    const { b64 } = await makePopulatedKeystoreB64()

    const open = (await harness.invoke('keystore:open', {
      bytes: b64,
      password: STORE_PASSWORD,
      type: 'PKCS12',
    })) as Res<{ sessionId: string; meta: { aliasCount: number; aliases: unknown[] } }>
    expect(open.success).toBe(true)
    expect(open.data?.meta.aliasCount).toBe(1)
    assertNoLeak(open, b64)

    const sessionId = open.data!.sessionId

    const list = (await harness.invoke('keystore:list', sessionId)) as Res<{
      aliases: Array<{ alias: string; hasPrivateKey: boolean }>
    }>
    expect(list.success).toBe(true)
    expect(list.data?.aliases[0]?.alias).toBe(ALIAS)
    expect(list.data?.aliases[0]?.hasPrivateKey).toBe(true)
    assertNoLeak(list, b64)

    const detail = (await harness.invoke('keystore:aliasDetail', {
      sessionId,
      alias: ALIAS,
    })) as Res<{ hasPrivateKey: boolean; chain: Array<{ pem: string }> }>
    expect(detail.success).toBe(true)
    expect(detail.data?.hasPrivateKey).toBe(true)
    // The chain DOES carry the public cert PEM (expected) but NOT the private key.
    expect(detail.data?.chain[0]?.pem).toContain('BEGIN CERTIFICATE')
    assertNoLeak(detail, b64)
  })

  it('rejects a wrong password with an error envelope', async () => {
    const { b64 } = await makePopulatedKeystoreB64()
    const res = (await harness.invoke('keystore:open', {
      bytes: b64,
      password: 'wrong-password',
      type: 'PKCS12',
    })) as Res<unknown>
    expect(res.success).toBe(false)
  })

  it('errors when neither path nor bytes are provided', async () => {
    const res = (await harness.invoke('keystore:open', {})) as Res<unknown>
    expect(res.success).toBe(false)
  })
})

describe('keystore:generateKeyPair + generateSecretKey (mutate + no-leak)', () => {
  it('generateKeyPair mutates the session and returns public meta only', async () => {
    const created = (await harness.invoke('keystore:createNew', {
      type: 'PKCS12',
      password: STORE_PASSWORD,
    })) as Res<{ sessionId: string }>
    const sessionId = created.data!.sessionId

    const gen = (await harness.invoke('keystore:generateKeyPair', {
      sessionId,
      alias: 'srv',
      keyAlgorithm: 'RSA',
      keySize: 1024,
      subjectDN: 'CN=srv',
      entryPassword: 'entrypw',
    })) as Res<{ sessionId: string; meta: { aliasCount: number; aliases: { alias: string }[] } }>
    expect(gen.success).toBe(true)
    expect(gen.data?.sessionId).toBe(sessionId)
    expect(gen.data?.meta.aliasCount).toBe(1)
    expect(gen.data?.meta.aliases[0].alias).toBe('srv')

    const json = JSON.stringify(gen)
    expect(json).not.toContain('PRIVATE KEY')
    expect(json).not.toContain(STORE_PASSWORD)
    expect(json).not.toContain('entrypw')

    // inspect confirms the alias landed in the live session.
    const list = (await harness.invoke('keystore:list', sessionId)) as Res<{
      aliases: { alias: string; hasPrivateKey: boolean }[]
    }>
    expect(list.data?.aliases[0].alias).toBe('srv')
    expect(list.data?.aliases[0].hasPrivateKey).toBe(true)
  })

  it('generateSecretKey adds an AES entry, leaking no key/password material', async () => {
    const created = (await harness.invoke('keystore:createNew', {
      type: 'PKCS12',
      password: STORE_PASSWORD,
    })) as Res<{ sessionId: string }>
    const sessionId = created.data!.sessionId

    const gen = (await harness.invoke('keystore:generateSecretKey', {
      sessionId,
      alias: 'skx',
      keyAlgorithm: 'AES',
      keySize: 256,
      entryPassword: 'entrypw',
    })) as Res<{
      meta: { type: string; aliasCount: number; aliases: { alias: string; hasPrivateKey: boolean; chainLength: number }[] }
    }>
    expect(gen.success).toBe(true)
    expect(gen.data?.meta.type).toBe('PKCS12')
    expect(gen.data?.meta.aliasCount).toBe(1)
    expect(gen.data?.meta.aliases[0]).toMatchObject({
      alias: 'skx',
      hasPrivateKey: false,
      chainLength: 0,
    })
    const json = JSON.stringify(gen)
    expect(json).not.toContain('entrypw')
    expect(json).not.toContain(STORE_PASSWORD)
  })

  it('generateSecretKey is rejected on a JKS session', async () => {
    const created = (await harness.invoke('keystore:createNew', {
      type: 'JKS',
      password: STORE_PASSWORD,
    })) as Res<{ sessionId: string }>
    const sessionId = created.data!.sessionId

    const gen = (await harness.invoke('keystore:generateSecretKey', {
      sessionId,
      alias: 'skjks',
      keyAlgorithm: 'AES',
      keySize: 256,
    })) as Res<unknown>
    expect(gen.success).toBe(false)
    expect(gen.error).toBe('Secret keys can only be stored in a PKCS12 keystore')
  })
})

describe('keystore:closeSession', () => {
  it('disposes the session so subsequent list fails', async () => {
    const created = (await harness.invoke('keystore:createNew', {
      type: 'JKS',
      password: STORE_PASSWORD,
    })) as Res<{ sessionId: string }>
    const sessionId = created.data!.sessionId

    const close = (await harness.invoke('keystore:closeSession', sessionId)) as Res<{
      closed: boolean
    }>
    expect(close.success).toBe(true)
    expect(close.data?.closed).toBe(true)

    const list = (await harness.invoke('keystore:list', sessionId)) as Res<unknown>
    expect(list.success).toBe(false)
  })
})

describe('Model-B library: save → list → open round-trip', () => {
  it('persists the blob ENCRYPTED, remembers the password, and re-opens', async () => {
    const { sessionId, b64 } = await makePopulatedKeystoreB64()

    const save = (await harness.invoke('keystore:librarySave', {
      sessionId,
      name: 'My Prod Keystore',
      rememberPassword: true,
    })) as Res<Record<string, unknown>>
    expect(save.success).toBe(true)
    expect(save.data?.name).toBe('My Prod Keystore')
    expect(save.data?.alias_count).toBe(1)
    // The metadata row returned must NOT carry the blob or password.
    expect(save.data).not.toHaveProperty('blob')
    expect(save.data).not.toHaveProperty('store_password')

    // The DB columns are ENCRYPTED (enc: prefix from the mock) and are NOT the
    // raw base64 blob / plaintext password.
    const row = testDb
      .prepare('SELECT blob, store_password FROM keystores')
      .get() as { blob: string; store_password: string }
    expect(row.blob.startsWith('enc:')).toBe(true)
    expect(row.blob).not.toBe(b64)
    expect(row.store_password).toBe(`enc:${STORE_PASSWORD}`)

    const list = (await harness.invoke('keystore:libraryList')) as Res<
      Array<Record<string, unknown>>
    >
    expect(list.success).toBe(true)
    expect(list.data?.[0]?.name).toBe('My Prod Keystore')
    // `remembered` is the boolean derivation of store_password != null.
    expect(list.data?.[0]?.remembered).toBe(true)
    // libraryList is META ONLY.
    expect(list.data?.[0]).not.toHaveProperty('blob')
    expect(list.data?.[0]).not.toHaveProperty('store_password')
    assertNoLeak(list, b64)

    const id = list.data![0].id as string

    // Remembered password ⇒ no password needed on open.
    const open = (await harness.invoke('keystore:libraryOpen', { id })) as Res<{
      sessionId: string
      meta: { aliasCount: number; aliases: Array<{ alias: string }> }
    }>
    expect(open.success).toBe(true)
    expect(open.data?.meta.aliasCount).toBe(1)
    expect(open.data?.meta.aliases[0]?.alias).toBe(ALIAS)
    assertNoLeak(open, b64)
  })

  it('does NOT remember the password when opt-out; open needs the caller password', async () => {
    const { sessionId, b64 } = await makePopulatedKeystoreB64()

    const save = (await harness.invoke('keystore:librarySave', {
      sessionId,
      name: 'No-Remember KS',
      rememberPassword: false,
    })) as Res<{ id: string }>
    expect(save.success).toBe(true)

    const row = testDb
      .prepare('SELECT store_password FROM keystores')
      .get() as { store_password: string | null }
    expect(row.store_password).toBeNull()

    // libraryList reports this entry as not-remembered ⇒ UI prompts for the pw.
    const list = (await harness.invoke('keystore:libraryList')) as Res<
      Array<{ id: string; remembered: boolean }>
    >
    expect(list.data?.[0]?.remembered).toBe(false)

    const id = save.data!.id

    // Wrong/absent password fails to parse.
    const bad = (await harness.invoke('keystore:libraryOpen', { id })) as Res<unknown>
    expect(bad.success).toBe(false)

    // Correct caller-supplied password opens.
    const good = (await harness.invoke('keystore:libraryOpen', {
      id,
      password: STORE_PASSWORD,
    })) as Res<{ meta: { aliasCount: number } }>
    expect(good.success).toBe(true)
    expect(good.data?.meta.aliasCount).toBe(1)
    assertNoLeak(good, b64)
  })

  it('does NOT persist a remembered password when OS encryption is unavailable', async () => {
    mockEnc.available = false
    try {
      const { sessionId } = await makePopulatedKeystoreB64()
      // rememberPassword requested, but the keychain is missing/locked ⇒ the
      // handler must force it OFF rather than write cleartext to SQLite.
      const save = (await harness.invoke('keystore:librarySave', {
        sessionId,
        name: 'No-Keychain KS',
        rememberPassword: true,
      })) as Res<{ id: string; remembered: boolean }>
      expect(save.success).toBe(true)
      expect(save.data?.remembered).toBe(false)

      const row = testDb
        .prepare('SELECT store_password FROM keystores')
        .get() as { store_password: string | null }
      expect(row.store_password).toBeNull()
    } finally {
      mockEnc.available = true
    }
  })

  it('updates an existing library row in place when id is supplied', async () => {
    const { sessionId } = await makePopulatedKeystoreB64()
    const save = (await harness.invoke('keystore:librarySave', {
      sessionId,
      name: 'Original',
      rememberPassword: true,
    })) as Res<{ id: string }>
    const id = save.data!.id

    const upd = (await harness.invoke('keystore:librarySave', {
      sessionId,
      name: 'Renamed',
      rememberPassword: true,
      id,
    })) as Res<{ id: string; name: string }>
    expect(upd.success).toBe(true)
    expect(upd.data?.id).toBe(id)
    expect(upd.data?.name).toBe('Renamed')

    const count = testDb.prepare('SELECT COUNT(*) AS n FROM keystores').get() as { n: number }
    expect(count.n).toBe(1)
  })

  it('deletes a library entry', async () => {
    const { sessionId } = await makePopulatedKeystoreB64()
    const save = (await harness.invoke('keystore:librarySave', {
      sessionId,
      name: 'To Delete',
    })) as Res<{ id: string }>
    const id = save.data!.id

    const del = (await harness.invoke('keystore:libraryDelete', { id })) as Res<{
      deleted: boolean
    }>
    expect(del.success).toBe(true)

    const list = (await harness.invoke('keystore:libraryList')) as Res<unknown[]>
    expect(list.data).toEqual([])
  })

  it('rejects a blank name', async () => {
    const { sessionId } = await makePopulatedKeystoreB64()
    const res = (await harness.invoke('keystore:librarySave', {
      sessionId,
      name: '   ',
    })) as Res<unknown>
    expect(res.success).toBe(false)
  })
})

describe('keystore import handlers (Faz B3) — envelope + no-leak', () => {
  const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/certs')
  const readCert = (f: string): string => readFileSync(join(CERTS, f), 'utf8')
  const readB64 = (f: string): string => readFileSync(join(CERTS, f)).toString('base64')

  async function newPkcs12Session(): Promise<string> {
    const created = (await harness.invoke('keystore:createNew', {
      type: 'PKCS12',
      password: 'changeit',
    })) as Res<{ sessionId: string }>
    return created.data!.sessionId
  }

  it('keystore:importKeyMaterial mutates the session and returns public meta only', async () => {
    const sessionId = await newPkcs12Session()
    const res = (await harness.invoke('keystore:importKeyMaterial', {
      sessionId,
      alias: 'imported',
      privateKeyPem: readCert('client.pkcs8.key'),
      certificatePem: readCert('client.crt'),
    })) as Res<{ sessionId: string; meta: { aliasCount: number } }>
    expect(res.success).toBe(true)
    expect(res.data!.sessionId).toBe(sessionId)
    expect(res.data!.meta.aliasCount).toBe(1)
    // NO-LEAK: the private key PEM must never round-trip back to the renderer.
    const json = JSON.stringify(res)
    expect(json).not.toContain('PRIVATE KEY')
    expect(json).not.toContain('changeit')
  })

  it('keystore:importPkcs12 reads source bytes (base64) in main, leaks nothing', async () => {
    const sessionId = await newPkcs12Session()
    const b64 = readB64('client.p12')
    const res = (await harness.invoke('keystore:importPkcs12', {
      sessionId,
      sourceBytes: b64,
      sourcePassword: 'testpassword',
      sourceAlias: 'test-client',
    })) as Res<{ meta: { aliasCount: number } }>
    expect(res.success).toBe(true)
    expect(res.data!.meta.aliasCount).toBe(1)
    const json = JSON.stringify(res)
    expect(json).not.toContain('PRIVATE KEY')
    expect(json).not.toContain('testpassword')
    // The raw source keystore bytes must not travel back to the renderer.
    expect(json).not.toContain(b64)
  })

  it('keystore:importPem (cert-only) adds a trusted certificate', async () => {
    const sessionId = await newPkcs12Session()
    const res = (await harness.invoke('keystore:importPem', {
      sessionId,
      alias: 'ca-trust',
      pemContent: readCert('ca.crt'),
    })) as Res<{ meta: { aliases: { entryType: string }[] } }>
    expect(res.success).toBe(true)
    expect(res.data!.meta.aliases[0].entryType).toBe('CERTIFICATE')
  })

  it('keystore:importTrustedCert accepts base64 DER', async () => {
    const sessionId = await newPkcs12Session()
    const res = (await harness.invoke('keystore:importTrustedCert', {
      sessionId,
      alias: 'der',
      certificateContent: readCert('client.der.b64'),
    })) as Res<{ meta: { aliasCount: number } }>
    expect(res.success).toBe(true)
    expect(res.data!.meta.aliasCount).toBe(1)
  })

  it('KS-F3-45 validation error → {success:false} with the verbatim §8 string', async () => {
    const sessionId = await newPkcs12Session()
    const res = (await harness.invoke('keystore:importPkcs12', {
      sessionId,
      sourceBytes: '',
      sourcePassword: 'x',
    })) as Res<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toBe('Source keystore content cannot be empty')
  })

  it('KS-F3-45 engine error (wrong source password) → {success:false}, no key/password leak', async () => {
    const sessionId = await newPkcs12Session()
    const res = (await harness.invoke('keystore:importPkcs12', {
      sessionId,
      sourceBytes: readB64('client.p12'),
      sourcePassword: 'WRONG',
    })) as Res<unknown>
    expect(res.success).toBe(false)
    expect(res.error).not.toContain('PRIVATE KEY')
    expect(res.error).not.toContain('WRONG')
  })

  it('KS-F3-21 key-cert MISMATCH is rejected at the handler boundary', async () => {
    const sessionId = await newPkcs12Session()
    const res = (await harness.invoke('keystore:importKeyMaterial', {
      sessionId,
      alias: 'mismatch',
      privateKeyPem: readCert('client.key'),
      certificatePem: readCert('server.crt'),
    })) as Res<unknown>
    expect(res.success).toBe(false)
    expect(res.error).toBe('Private key does not match the provided certificate')
  })
})
