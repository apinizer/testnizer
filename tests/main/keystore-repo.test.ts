/**
 * keystore.repo CRUD — Model B persistence (secret-agnostic; encryption happens
 * at the handler boundary in Faz 1, not here). Runs against the in-memory
 * createTestDb() whose SCHEMA_SQL mirrors the production `keystores` table.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb } from './handlers/helpers'

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const {
  listKeystores,
  getKeystore,
  createKeystore,
  updateKeystore,
  deleteKeystore,
} = await import('../../src/main/db/keystore.repo')

beforeEach(() => {
  testDb = createTestDb()
})

describe('keystore.repo', () => {
  it('creates and reads back a keystore row', () => {
    const row = createKeystore({
      name: 'My JKS',
      type: 'JKS',
      blob: 'enc:v1:BLOBDATA',
      store_password: 'enc:v1:PW',
      alias_count: 3,
      size_bytes: 1234,
    })
    expect(row.id).toBeTruthy()
    expect(row.name).toBe('My JKS')
    expect(row.type).toBe('JKS')
    expect(row.alias_count).toBe(3)
    expect(row.size_bytes).toBe(1234)

    const fetched = getKeystore(row.id)
    expect(fetched?.blob).toBe('enc:v1:BLOBDATA')
    expect(fetched?.store_password).toBe('enc:v1:PW')
  })

  it('defaults counts and allows a NULL store_password (remember disabled)', () => {
    const row = createKeystore({ name: 'no-pw', type: 'PKCS12', blob: 'enc:v1:X' })
    expect(row.alias_count).toBe(0)
    expect(row.size_bytes).toBe(0)
    expect(row.store_password).toBeNull()
  })

  it('lists metadata only (no blob/password columns)', () => {
    createKeystore({ name: 'a', type: 'JKS', blob: 'enc:v1:1' })
    createKeystore({ name: 'b', type: 'PKCS12', blob: 'enc:v1:2', store_password: 'enc:v1:pw' })
    const rows = listKeystores()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.name).sort()).toEqual(['a', 'b'])
    for (const r of rows) {
      expect(r).not.toHaveProperty('blob')
      expect(r).not.toHaveProperty('store_password')
    }
  })

  it('updates fields and bumps updated_at', () => {
    const row = createKeystore({ name: 'orig', type: 'JKS', blob: 'enc:v1:old', alias_count: 1 })
    const updated = updateKeystore(row.id, { name: 'renamed', blob: 'enc:v1:new', alias_count: 5 })
    expect(updated?.name).toBe('renamed')
    expect(updated?.blob).toBe('enc:v1:new')
    expect(updated?.alias_count).toBe(5)
    expect(updated?.type).toBe('JKS') // unchanged
    expect(updated!.updated_at).toBeGreaterThanOrEqual(row.updated_at)
  })

  it('can clear store_password back to NULL', () => {
    const row = createKeystore({ name: 'k', type: 'JKS', blob: 'enc:v1:1', store_password: 'enc:v1:pw' })
    const updated = updateKeystore(row.id, { store_password: null })
    expect(updated?.store_password).toBeNull()
  })

  it('returns undefined updating a missing id', () => {
    expect(updateKeystore('nope', { name: 'x' })).toBeUndefined()
  })

  it('deletes a keystore', () => {
    const row = createKeystore({ name: 'del', type: 'JKS', blob: 'enc:v1:1' })
    deleteKeystore(row.id)
    expect(getKeystore(row.id)).toBeUndefined()
    expect(listKeystores()).toHaveLength(0)
  })
})
