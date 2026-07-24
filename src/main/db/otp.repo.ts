import { randomUUID } from 'crypto'
import { getDb } from './database'
import type { OtpAlgorithm, OtpType } from '../lib/otp'

/**
 * OTP authenticator vault — a GLOBAL list (no project_id): the vault lives in
 * the always-available Tools panel and holds account/service credentials that
 * are reused across projects. The `secret` column stores the Base32 secret
 * encrypted (`enc:v1:…`) — encryption happens at the handler boundary, so this
 * repo is secret-agnostic (mirrors certificate.repo).
 */

export interface OtpEntryRow {
  id: string
  label: string | null
  issuer: string | null
  account: string | null
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
  type: OtpType
  counter: number
  sort_order: number
  enabled: number
  created_at: number
  updated_at: number
}

export interface CreateOtpEntryInput {
  label?: string | null
  issuer?: string | null
  account?: string | null
  secret: string
  algorithm?: OtpAlgorithm
  digits?: number
  period?: number
  type?: OtpType
  counter?: number
  enabled?: boolean
}

export type UpdateOtpEntryInput = Partial<CreateOtpEntryInput>

export function listOtpEntries(): OtpEntryRow[] {
  return getDb()
    .prepare('SELECT * FROM otp_entries ORDER BY sort_order ASC, created_at ASC')
    .all() as OtpEntryRow[]
}

export function getOtpEntry(id: string): OtpEntryRow | undefined {
  return getDb().prepare('SELECT * FROM otp_entries WHERE id = ?').get(id) as
    | OtpEntryRow
    | undefined
}

export function createOtpEntry(input: CreateOtpEntryInput): OtpEntryRow {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  const maxOrder = (
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM otp_entries').get() as { m: number }
  ).m
  db.prepare(
    `INSERT INTO otp_entries
       (id, label, issuer, account, secret, algorithm, digits, period, type, counter, sort_order, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.label ?? null,
    input.issuer ?? null,
    input.account ?? null,
    input.secret,
    input.algorithm ?? 'SHA1',
    input.digits ?? 6,
    input.period ?? 30,
    input.type ?? 'totp',
    input.counter ?? 0,
    maxOrder + 1,
    input.enabled === false ? 0 : 1,
    now,
    now,
  )
  return getOtpEntry(id) as OtpEntryRow
}

export function updateOtpEntry(id: string, patch: UpdateOtpEntryInput): OtpEntryRow | undefined {
  const db = getDb()
  const existing = getOtpEntry(id)
  if (!existing) return undefined
  const next = {
    label: patch.label !== undefined ? patch.label : existing.label,
    issuer: patch.issuer !== undefined ? patch.issuer : existing.issuer,
    account: patch.account !== undefined ? patch.account : existing.account,
    secret: patch.secret !== undefined ? patch.secret : existing.secret,
    algorithm: patch.algorithm ?? existing.algorithm,
    digits: patch.digits ?? existing.digits,
    period: patch.period ?? existing.period,
    type: patch.type ?? existing.type,
    counter: patch.counter !== undefined ? patch.counter : existing.counter,
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
  }
  db.prepare(
    `UPDATE otp_entries
        SET label = ?, issuer = ?, account = ?, secret = ?, algorithm = ?, digits = ?,
            period = ?, type = ?, counter = ?, enabled = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    next.label,
    next.issuer,
    next.account,
    next.secret,
    next.algorithm,
    next.digits,
    next.period,
    next.type,
    next.counter,
    next.enabled,
    Date.now(),
    id,
  )
  return getOtpEntry(id)
}

/** Advance and persist an HOTP counter, returning the new value. */
export function incrementCounter(id: string): number | undefined {
  const db = getDb()
  const existing = getOtpEntry(id)
  if (!existing) return undefined
  const next = existing.counter + 1
  db.prepare('UPDATE otp_entries SET counter = ?, updated_at = ? WHERE id = ?').run(
    next,
    Date.now(),
    id,
  )
  return next
}

export function deleteOtpEntry(id: string): void {
  getDb().prepare('DELETE FROM otp_entries WHERE id = ?').run(id)
}
