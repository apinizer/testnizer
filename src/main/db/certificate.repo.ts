import { randomUUID } from 'crypto'
import { getDb } from './database'
import { certHostMatches } from '../lib/cert-host-match'

export type CertificateKind = 'ca' | 'client'

/**
 * How the row's key material is obtained (Key Material Provider, #60).
 *
 * - `'file'`   — the classic crt/key/pfx paths. DEFAULT for every existing row,
 *                so the pre-provider behaviour is byte-for-byte unchanged.
 * - `'keystore'` — the row points at a `keystores` library entry
 *                (`keystore_id`) + `keystore_alias`; crt/key/pfx stay NULL and
 *                the resolver materialises the PEM in main.
 */
export type CertificateSource = 'file' | 'keystore'

export interface CertificateRow {
  id: string
  project_id: string
  kind: CertificateKind
  host: string | null
  crt_path: string | null
  key_path: string | null
  pfx_path: string | null
  /**
   * PFX passphrase for the classic `source='file'` path. encryptSecret-wrapped
   * at the handler boundary; this repo is secret-agnostic.
   */
  passphrase: string | null
  enabled: number
  created_at: number
  source: CertificateSource
  keystore_id: string | null
  keystore_alias: string | null
  /**
   * R11 double-password — the per-alias ENTRY password for `source='keystore'`
   * rows. Its own column ON PURPOSE: sharing `passphrase` with the file path
   * would mean that merely trying the added keystore option overwrites (and
   * destroys) the PFX passphrase of a working file-backed row. The STORE
   * password lives on the `keystores` row.
   */
  keystore_key_password: string | null
}

export interface CreateCertificateInput {
  project_id: string
  kind: CertificateKind
  host?: string | null
  crt_path?: string | null
  key_path?: string | null
  pfx_path?: string | null
  passphrase?: string | null
  enabled?: boolean
  source?: CertificateSource
  keystore_id?: string | null
  keystore_alias?: string | null
  keystore_key_password?: string | null
}

export function listCertificates(projectId: string): CertificateRow[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM certificates WHERE project_id = ? ORDER BY kind ASC, created_at ASC')
    .all(projectId) as CertificateRow[]
}

export function listCertificatesForHost(projectId: string, host: string): CertificateRow[] {
  const db = getDb()
  // Host matching happens in JS, NOT in SQL: a strict `host = ?` equality
  // silently missed the common cases where the stored host carries a scheme
  // ("https://sandbox.api.visa.com"), a port, a path, or different case — so the
  // client cert was never attached and the request went out unauthenticated.
  // `certHostMatches` normalises both sides (and supports '*'/'*.domain'/empty).
  const rows = db
    .prepare(
      `SELECT * FROM certificates
       WHERE project_id = ? AND enabled = 1
       ORDER BY kind ASC, created_at ASC`,
    )
    .all(projectId) as CertificateRow[]
  // CA certs are trust anchors applied to the whole project (their host is
  // advisory); client certs are matched to the request host.
  return rows.filter((r) => r.kind === 'ca' || certHostMatches(host, r.host))
}

/** Single-row fetch (the resolver's `certRow` branch needs the full row). */
export function getCertificate(id: string): CertificateRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM certificates WHERE id = ?').get(id) as CertificateRow | undefined
}

export function createCertificate(input: CreateCertificateInput): CertificateRow {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `
    INSERT INTO certificates (id, project_id, kind, host, crt_path, key_path, pfx_path, passphrase, enabled, created_at, source, keystore_id, keystore_alias, keystore_key_password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    input.project_id,
    input.kind,
    input.host ?? null,
    input.crt_path ?? null,
    input.key_path ?? null,
    input.pfx_path ?? null,
    input.passphrase ?? null,
    input.enabled === false ? 0 : 1,
    now,
    // Omitted `source` = 'file' — the additive default keeps every existing
    // caller (and every pre-provider row) on the classic path.
    input.source ?? 'file',
    input.keystore_id ?? null,
    input.keystore_alias ?? null,
    input.keystore_key_password ?? null,
  )
  return db.prepare('SELECT * FROM certificates WHERE id = ?').get(id) as CertificateRow
}

export function updateCertificate(
  id: string,
  patch: Partial<CreateCertificateInput>,
): CertificateRow | undefined {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM certificates WHERE id = ?').get(id) as
    | CertificateRow
    | undefined
  if (!existing) return undefined
  const next = {
    host: patch.host !== undefined ? patch.host : existing.host,
    crt_path: patch.crt_path !== undefined ? patch.crt_path : existing.crt_path,
    key_path: patch.key_path !== undefined ? patch.key_path : existing.key_path,
    pfx_path: patch.pfx_path !== undefined ? patch.pfx_path : existing.pfx_path,
    passphrase: patch.passphrase !== undefined ? patch.passphrase : existing.passphrase,
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
    // Undefined = "leave as-is": an old-shape patch from the existing cert
    // handler can never silently flip a row's source or drop its keystore link.
    source: patch.source !== undefined ? patch.source : (existing.source ?? 'file'),
    keystore_id: patch.keystore_id !== undefined ? patch.keystore_id : existing.keystore_id,
    keystore_alias:
      patch.keystore_alias !== undefined ? patch.keystore_alias : existing.keystore_alias,
    keystore_key_password:
      patch.keystore_key_password !== undefined
        ? patch.keystore_key_password
        : existing.keystore_key_password,
  }
  db.prepare(
    `
    UPDATE certificates
       SET host = ?, crt_path = ?, key_path = ?, pfx_path = ?, passphrase = ?, enabled = ?,
           source = ?, keystore_id = ?, keystore_alias = ?, keystore_key_password = ?
     WHERE id = ?
  `,
  ).run(
    next.host,
    next.crt_path,
    next.key_path,
    next.pfx_path,
    next.passphrase,
    next.enabled,
    next.source,
    next.keystore_id,
    next.keystore_alias,
    next.keystore_key_password,
    id,
  )
  return db.prepare('SELECT * FROM certificates WHERE id = ?').get(id) as CertificateRow
}

export function deleteCertificate(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM certificates WHERE id = ?').run(id)
}
