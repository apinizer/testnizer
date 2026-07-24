/**
 * certificate.repo — Key Material Provider (#60) schema commit.
 *
 * Pins the ADDITIVE INVARIANT at the persistence layer: the three new columns
 * (`source`, `keystore_id`, `keystore_alias`) must be pure additions — an
 * old-shape create/update (the exact payload today's `certificate.handler`
 * sends) has to keep producing a byte-for-byte classic file-backed row, with
 * `source` defaulting to 'file' and the keystore columns NULL.
 *
 * Runs against the in-memory createTestDb() whose SCHEMA_SQL mirrors the
 * production `certificates` table (CLAUDE.md test-helper schema-sync gotcha).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb } from './handlers/helpers'

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const {
  listCertificates,
  listCertificatesForHost,
  getCertificate,
  createCertificate,
  updateCertificate,
  deleteCertificate,
} = await import('../../src/main/db/certificate.repo')

beforeEach(() => {
  testDb = createTestDb()
})

describe('certificate.repo — provider columns (additive)', () => {
  it("ADDITIVE: an old-shape file create still yields source='file' + NULL keystore columns", () => {
    const row = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      crt_path: '/certs/client.crt',
      key_path: '/certs/client.key',
      passphrase: 'enc:v1:PW',
    })

    expect(row.source).toBe('file')
    expect(row.keystore_id).toBeNull()
    expect(row.keystore_alias).toBeNull()
    // Classic columns untouched.
    expect(row.crt_path).toBe('/certs/client.crt')
    expect(row.key_path).toBe('/certs/client.key')
    expect(row.pfx_path).toBeNull()
    expect(row.passphrase).toBe('enc:v1:PW')
    expect(row.enabled).toBe(1)
  })

  it('persists a keystore-backed row and reads it back through getCertificate', () => {
    const row = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: '*',
      source: 'keystore',
      keystore_id: 'ks-1',
      keystore_alias: 'client1',
      // R11: `passphrase` is the per-alias KEY password here; the STORE
      // password lives on the keystores row.
      passphrase: 'enc:v1:KEYPW',
    })

    expect(row.source).toBe('keystore')
    expect(row.keystore_id).toBe('ks-1')
    expect(row.keystore_alias).toBe('client1')
    // Keystore rows carry no file paths.
    expect(row.crt_path).toBeNull()
    expect(row.key_path).toBeNull()
    expect(row.pfx_path).toBeNull()

    const fetched = getCertificate(row.id)
    expect(fetched?.id).toBe(row.id)
    expect(fetched?.source).toBe('keystore')
    expect(fetched?.keystore_id).toBe('ks-1')
    expect(fetched?.keystore_alias).toBe('client1')
    expect(fetched?.passphrase).toBe('enc:v1:KEYPW')
  })

  it('getCertificate returns undefined for an unknown id', () => {
    expect(getCertificate('nope')).toBeUndefined()
  })

  it('ADDITIVE: an old-shape update never flips source or drops the keystore link', () => {
    const row = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
      keystore_id: 'ks-1',
      keystore_alias: 'client1',
    })

    // Exactly the shape today's certificate:update handler sends — no
    // knowledge of the new columns at all.
    const updated = updateCertificate(row.id, { host: 'other.example.com', enabled: false })

    expect(updated?.host).toBe('other.example.com')
    expect(updated?.enabled).toBe(0)
    expect(updated?.source).toBe('keystore')
    expect(updated?.keystore_id).toBe('ks-1')
    expect(updated?.keystore_alias).toBe('client1')
  })

  it('updates the provider columns when explicitly patched (file → keystore and back)', () => {
    const row = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      crt_path: '/certs/client.crt',
    })
    expect(row.source).toBe('file')

    const toKeystore = updateCertificate(row.id, {
      source: 'keystore',
      keystore_id: 'ks-9',
      keystore_alias: 'alias-9',
      crt_path: null,
    })
    expect(toKeystore?.source).toBe('keystore')
    expect(toKeystore?.keystore_id).toBe('ks-9')
    expect(toKeystore?.crt_path).toBeNull()

    const backToFile = updateCertificate(row.id, {
      source: 'file',
      keystore_id: null,
      keystore_alias: null,
      crt_path: '/certs/client.crt',
    })
    expect(backToFile?.source).toBe('file')
    expect(backToFile?.keystore_id).toBeNull()
    expect(backToFile?.keystore_alias).toBeNull()
    expect(backToFile?.crt_path).toBe('/certs/client.crt')
  })

  it('host matching is unchanged — a keystore row still needs a host to be selected', () => {
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'api.example.com',
      source: 'keystore',
      keystore_id: 'ks-1',
      keystore_alias: 'matched',
    })
    createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: 'nope.example.com',
      source: 'keystore',
      keystore_id: 'ks-1',
      keystore_alias: 'unmatched',
    })

    const rows = listCertificatesForHost('p1', 'https://api.example.com/v1/thing')
    expect(rows.map((r) => r.keystore_alias)).toEqual(['matched'])
  })

  it('list + delete still work over rows of both sources', () => {
    const fileRow = createCertificate({ project_id: 'p1', kind: 'ca', crt_path: '/certs/ca.pem' })
    const ksRow = createCertificate({
      project_id: 'p1',
      kind: 'client',
      host: '*',
      source: 'keystore',
      keystore_id: 'ks-1',
      keystore_alias: 'client1',
    })

    expect(listCertificates('p1')).toHaveLength(2)

    deleteCertificate(ksRow.id)
    const left = listCertificates('p1')
    expect(left).toHaveLength(1)
    expect(left[0].id).toBe(fileRow.id)
    expect(left[0].source).toBe('file')
  })
})
