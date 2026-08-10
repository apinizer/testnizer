import { randomUUID } from 'crypto'
import { getDb } from './database'
import type { KeystoreType } from '../lib/keystore'

/**
 * Keystore library (Model B) — a GLOBAL list (no project_id): persisted
 * keystores the user chooses to keep in the always-available Tools panel.
 *
 * Secret-agnostic (mirrors otp.repo / certificate.repo): the `blob`
 * (base64 keystore bytes) and `store_password` columns are stored
 * `encryptSecret`-wrapped (`enc:v1:…`) — encryption/decryption happens at the
 * HANDLER boundary in Faz 1, never here. `store_password` NULL means the user
 * disabled "remember password", so the open flow must prompt for it.
 */

export interface KeystoreRow {
  id: string
  name: string
  type: KeystoreType
  blob: string
  store_password: string | null
  alias_count: number
  size_bytes: number
  created_at: number
  updated_at: number
}

/** Metadata projection (no blob/password) — for library listing. */
export interface KeystoreMetaRow {
  id: string
  name: string
  type: KeystoreType
  alias_count: number
  size_bytes: number
  created_at: number
  updated_at: number
  /** `store_password != null` — the boolean only; never the password value. */
  remembered: boolean
}

export interface CreateKeystoreInput {
  name: string
  type: KeystoreType
  blob: string
  store_password?: string | null
  alias_count?: number
  size_bytes?: number
}

export interface UpdateKeystoreInput {
  name?: string
  type?: KeystoreType
  blob?: string
  store_password?: string | null
  alias_count?: number
  size_bytes?: number
}

/** List keystore metadata only (never returns blob/password). */
export function listKeystores(): KeystoreMetaRow[] {
  // `remembered` is derived from whether a store_password is persisted — the
  // computed column yields only 0/1, never the (encrypted) password value.
  const rows = getDb()
    .prepare(
      `SELECT id, name, type, alias_count, size_bytes, created_at, updated_at,
              (store_password IS NOT NULL) AS remembered
         FROM keystores
        ORDER BY created_at ASC`,
    )
    .all() as Array<Omit<KeystoreMetaRow, 'remembered'> & { remembered: number }>
  return rows.map((r) => ({ ...r, remembered: r.remembered === 1 }))
}

/** Fetch a full keystore row (blob + wrapped password included). */
export function getKeystore(id: string): KeystoreRow | undefined {
  return getDb().prepare('SELECT * FROM keystores WHERE id = ?').get(id) as KeystoreRow | undefined
}

export function createKeystore(input: CreateKeystoreInput): KeystoreRow {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO keystores
       (id, name, type, blob, store_password, alias_count, size_bytes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.type,
    input.blob,
    input.store_password ?? null,
    input.alias_count ?? 0,
    input.size_bytes ?? 0,
    now,
    now,
  )
  return getKeystore(id) as KeystoreRow
}

export function updateKeystore(id: string, patch: UpdateKeystoreInput): KeystoreRow | undefined {
  const db = getDb()
  const existing = getKeystore(id)
  if (!existing) return undefined
  const next = {
    name: patch.name ?? existing.name,
    type: patch.type ?? existing.type,
    blob: patch.blob ?? existing.blob,
    store_password:
      patch.store_password !== undefined ? patch.store_password : existing.store_password,
    alias_count: patch.alias_count ?? existing.alias_count,
    size_bytes: patch.size_bytes ?? existing.size_bytes,
  }
  db.prepare(
    `UPDATE keystores
        SET name = ?, type = ?, blob = ?, store_password = ?,
            alias_count = ?, size_bytes = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    next.name,
    next.type,
    next.blob,
    next.store_password,
    next.alias_count,
    next.size_bytes,
    Date.now(),
    id,
  )
  return getKeystore(id)
}

export function deleteKeystore(id: string): void {
  getDb().prepare('DELETE FROM keystores WHERE id = ?').run(id)
}
