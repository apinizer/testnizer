/**
 * Certificate expiry classification (design §9.4). Pure + browser-safe so the
 * AliasTable coloring and its unit tests share ONE source of truth.
 *
 * The amber/expired thresholds compare the RAW millisecond diff — NOT a rounded
 * day count — so a certificate 29.6 days out is amber (warning), never rounded
 * up to 30 → green. The rounded `days` magnitude is used ONLY for the display
 * label ("in N days" / "N days ago").
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000
/** Under this many days remaining ⇒ amber (warning). */
export const AMBER_DAYS = 30

export type CertValidity = 'valid' | 'warning' | 'expired'

export interface CertValidityStatus {
  status: CertValidity
  /** Rounded magnitude of days until (valid/warning) or since (expired). */
  days: number
}

export function certValidityStatus(notAfterMs: number, nowMs: number): CertValidityStatus {
  const diffMs = notAfterMs - nowMs
  const days = Math.round(Math.abs(diffMs) / MS_PER_DAY)
  if (diffMs < 0) return { status: 'expired', days }
  if (diffMs < AMBER_DAYS * MS_PER_DAY) return { status: 'warning', days }
  return { status: 'valid', days }
}
