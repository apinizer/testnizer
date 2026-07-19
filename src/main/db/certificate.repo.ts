import { randomUUID } from 'crypto'
import { getDb } from './database'
import { certHostMatches } from '../lib/cert-host-match'

export type CertificateKind = 'ca' | 'client'

export interface CertificateRow {
  id: string
  project_id: string
  kind: CertificateKind
  host: string | null
  crt_path: string | null
  key_path: string | null
  pfx_path: string | null
  passphrase: string | null
  enabled: number
  created_at: number
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

export function createCertificate(input: CreateCertificateInput): CertificateRow {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `
    INSERT INTO certificates (id, project_id, kind, host, crt_path, key_path, pfx_path, passphrase, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  }
  db.prepare(
    `
    UPDATE certificates
       SET host = ?, crt_path = ?, key_path = ?, pfx_path = ?, passphrase = ?, enabled = ?
     WHERE id = ?
  `,
  ).run(next.host, next.crt_path, next.key_path, next.pfx_path, next.passphrase, next.enabled, id)
  return db.prepare('SELECT * FROM certificates WHERE id = ?').get(id) as CertificateRow
}

export function deleteCertificate(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM certificates WHERE id = ?').run(id)
}
