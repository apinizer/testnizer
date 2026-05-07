/**
 * TLS cipher suite presets, modelled on Mozilla's Server Side TLS guidelines
 * (<https://wiki.mozilla.org/Security/Server_Side_TLS>).
 *
 * `MODERN`        — TLS 1.3 only / AEAD ciphers — the safest default.
 * `INTERMEDIATE`  — TLS 1.2 + 1.3, broad but still-strong cipher list — used
 *                   for general purpose servers that must serve older clients.
 * `LEGACY`        — Includes RC4 / 3DES / DES / NULL / weak DH cipher names so
 *                   Testnizer can intentionally negotiate against deliberately-
 *                   broken endpoints (BadSSL `rc4`, `threedes`, `nullcipher`,
 *                   `dh480`, `dh512`). DO NOT USE against real servers.
 *
 * Cipher strings are OpenSSL syntax; Node forwards them verbatim to the
 * underlying TLS stack via `https.Agent({ ciphers })`.
 */

export const MODERN_CIPHERS =
  'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256'

export const INTERMEDIATE_CIPHERS = [
  // TLS 1.3 suites (Node negotiates these even though they're not in the
  // OpenSSL "ciphers" string in older releases — keeping them is a no-op).
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'TLS_AES_128_GCM_SHA256',
  // TLS 1.2 suites — ECDHE forward secrecy + AEAD only.
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'DHE-RSA-AES128-GCM-SHA256',
  'DHE-RSA-AES256-GCM-SHA384',
].join(':')

/**
 * Legacy cipher list — explicitly enables broken algorithms (RC4, 3DES, DES,
 * NULL, anonymous DH, export-grade) so the user can connect to BadSSL-style
 * "intentionally broken" endpoints to validate their security posture
 * detectors. The `@SECLEVEL=0` directive lowers OpenSSL's minimum-strength
 * gate so the weak ciphers are actually negotiable.
 */
export const LEGACY_CIPHERS = [
  // Modern suites first so well-behaved servers still negotiate something safe.
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  // Legacy / broken — required for BadSSL `rc4`, `threedes`, `nullcipher`,
  // `dh480`, `dh512` scenarios.
  'AES128-SHA',
  'AES256-SHA',
  'DES-CBC3-SHA',
  'RC4-SHA',
  'RC4-MD5',
  'NULL-MD5',
  'NULL-SHA',
  'EXP-RC4-MD5',
  'EXP-DES-CBC-SHA',
  // Weak Diffie-Hellman — needed to actually shake hands with `dh512`/`dh1024`
  // servers under modern OpenSSL (which otherwise rejects DH < 2048).
  'DHE-RSA-AES128-SHA',
  'DHE-RSA-AES256-SHA',
  'ADH-AES128-SHA',
  'ADH-AES256-SHA',
  // Lower OpenSSL security level so the legacy suites above are actually
  // negotiable; without this, OpenSSL @SECLEVEL=2 (default in many builds)
  // rejects RC4 / 3DES / DH < 2048 regardless of the cipher list.
  '@SECLEVEL=0',
].join(':')

export type CipherPresetName = 'modern' | 'intermediate' | 'legacy'

/**
 * Resolve a preset name to its OpenSSL cipher string. Unknown names fall
 * through to MODERN (defensive: never hand the agent an invalid string).
 */
export function getCipherPreset(name: CipherPresetName | string): string {
  switch (name) {
    case 'modern':
      return MODERN_CIPHERS
    case 'intermediate':
      return INTERMEDIATE_CIPHERS
    case 'legacy':
      return LEGACY_CIPHERS
    default:
      return MODERN_CIPHERS
  }
}

export type TlsVersion = 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3'

export const TLS_VERSIONS: TlsVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']

/**
 * Validate / normalise a string from the renderer. Returns `undefined` for
 * unknown values so callers can fall back to Node's defaults (currently
 * TLSv1.2 minimum / TLSv1.3 maximum).
 */
export function normaliseTlsVersion(v: string | undefined): TlsVersion | undefined {
  if (!v) return undefined
  return (TLS_VERSIONS as string[]).includes(v) ? (v as TlsVersion) : undefined
}

/**
 * TLS configuration shared between HTTP and SOAP engines. All fields are
 * optional — when omitted, the engine relies on Node's TLS defaults.
 */
export interface TlsOptions {
  /** Lowest acceptable protocol version (e.g. 'TLSv1' to talk to legacy boxes). */
  minVersion?: TlsVersion
  /** Highest acceptable protocol version. */
  maxVersion?: TlsVersion
  /** OpenSSL cipher string. Resolved from a preset or supplied verbatim. */
  ciphers?: string
}
