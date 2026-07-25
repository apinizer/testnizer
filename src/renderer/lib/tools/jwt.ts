import {
  decodeJwt as joseDecodePayload,
  decodeProtectedHeader,
  jwtVerify,
  importSPKI,
  importPKCS8,
  generateKeyPair,
  exportPKCS8,
  exportSPKI,
} from 'jose'

export type JwtAlgorithm =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'EdDSA'
  | 'none'

export const JWT_ALGORITHMS: JwtAlgorithm[] = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
  'none',
]

export type DecodedJwt = {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: string
  raw: { header: string; payload: string; signature: string }
}

export type DecodeResult = { ok: true; jwt: DecodedJwt } | { ok: false; error: string }

export type VerifyResult =
  | { ok: true; valid: true; jwt: DecodedJwt }
  | { ok: true; valid: false; jwt: DecodedJwt; reason: string }
  | { ok: false; error: string }

/**
 * Decode a JWT without verifying the signature.
 * Returns parsed header + payload, plus the raw base64 segments.
 */
export function decodeJwt(token: string): DecodeResult {
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'Token is empty' }
  }
  const trimmed = token.trim()
  const parts = trimmed.split('.')
  if (parts.length !== 3) {
    return {
      ok: false,
      error: `JWT must have 3 dot-separated parts, got ${parts.length}`,
    }
  }
  try {
    const header = decodeProtectedHeader(trimmed) as Record<string, unknown>
    const payload = joseDecodePayload(trimmed) as Record<string, unknown>
    return {
      ok: true,
      jwt: {
        header,
        payload,
        signature: parts[2],
        raw: { header: parts[0], payload: parts[1], signature: parts[2] },
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Verify a JWT signature.
 * For HMAC algos (HS256/384/512), `secret` is a UTF-8 string.
 * For RSA/EC/EdDSA, `secret` is a PEM-encoded SPKI public key.
 */
export async function verifyJwt(
  token: string,
  secret: string,
  algorithm: JwtAlgorithm,
): Promise<VerifyResult> {
  const decoded = decodeJwt(token)
  if (!decoded.ok) return { ok: false, error: decoded.error }

  if (algorithm === 'none') {
    if (decoded.jwt.header.alg !== 'none') {
      return {
        ok: true,
        valid: false,
        jwt: decoded.jwt,
        reason: `Header alg is "${decoded.jwt.header.alg}", expected "none"`,
      }
    }
    if (decoded.jwt.raw.signature !== '') {
      return {
        ok: true,
        valid: false,
        jwt: decoded.jwt,
        reason: 'alg=none but signature is non-empty',
      }
    }
    return { ok: true, valid: true, jwt: decoded.jwt }
  }

  try {
    let key: Uint8Array | CryptoKey
    if (algorithm.startsWith('HS')) {
      key = new TextEncoder().encode(secret)
    } else {
      key = await importSPKI(secret, algorithm)
    }
    await jwtVerify(token, key, { algorithms: [algorithm] })
    return { ok: true, valid: true, jwt: decoded.jwt }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return { ok: true, valid: false, jwt: decoded.jwt, reason }
  }
}

/**
 * Sign payload + header with the given secret/key.
 * Returns the encoded JWT string. For HMAC, secret is a UTF-8 string;
 * for RSA/EC/EdDSA, key is a PEM-encoded PKCS8 private key.
 */
export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  algorithm: JwtAlgorithm,
  header: Record<string, unknown> = {},
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (algorithm === 'none') {
    const fullHeader = { ...header, alg: 'none', typ: 'JWT' }
    const encHeader = base64UrlEncodeJson(fullHeader)
    const encPayload = base64UrlEncodeJson(payload)
    return { ok: true, token: `${encHeader}.${encPayload}.` }
  }
  try {
    const { SignJWT } = await import('jose')
    let key: Uint8Array | CryptoKey
    if (algorithm.startsWith('HS')) {
      key = new TextEncoder().encode(secret)
    } else {
      key = await importPKCS8(secret, algorithm)
    }
    const typ = typeof header.typ === 'string' ? header.typ : 'JWT'
    const token = await new SignJWT(payload)
      .setProtectedHeader({ ...header, alg: algorithm, typ })
      .sign(key)
    return { ok: true, token }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Returns true if `exp` claim is in the past.
 * Returns false if `exp` is missing (no expiry) or in the future.
 */
export function isExpired(
  payload: Record<string, unknown>,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const exp = payload.exp
  if (typeof exp !== 'number') return false
  return exp < nowSeconds
}

/**
 * Seconds until `exp`. Negative if expired. null if no `exp` claim.
 */
export function secondsUntilExpiry(
  payload: Record<string, unknown>,
  nowSeconds = Math.floor(Date.now() / 1000),
): number | null {
  const exp = payload.exp
  if (typeof exp !== 'number') return null
  return exp - nowSeconds
}

/**
 * Returns true if `nbf` claim is in the future (not-yet-valid).
 */
export function isNotYetValid(
  payload: Record<string, unknown>,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const nbf = payload.nbf
  if (typeof nbf !== 'number') return false
  return nbf > nowSeconds
}

/**
 * Convert numeric date claims to ISO 8601 strings for human-readable display.
 * Standard claims: exp, iat, nbf, auth_time. Returns a new object — original unchanged.
 */
export function humanReadableClaims(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload }
  for (const key of ['exp', 'iat', 'nbf', 'auth_time']) {
    const v = out[key]
    if (typeof v === 'number') {
      out[`${key}_iso`] = new Date(v * 1000).toISOString()
    }
  }
  return out
}

function base64UrlEncodeJson(obj: unknown): string {
  const json = JSON.stringify(obj)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64url')
  }
  // Browser fallback
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Whether an algorithm uses an asymmetric key pair (private/public PEM)
 * vs a shared HMAC secret string.
 */
export function isAsymmetric(algorithm: JwtAlgorithm): boolean {
  return (
    algorithm.startsWith('RS') ||
    algorithm.startsWith('PS') ||
    algorithm.startsWith('ES') ||
    algorithm === 'EdDSA'
  )
}

export type SampleMaterial = {
  token: string
  algorithm: JwtAlgorithm
  /** Shared HMAC secret (HS*) */
  secret?: string
  /** PEM-encoded private key (asymmetric algos) */
  privateKey?: string
  /** PEM-encoded public key (asymmetric algos) */
  publicKey?: string
}

/**
 * Generate a runnable sample JWT for the given algorithm.
 * For HMAC algos, also returns the shared secret used.
 * For asymmetric algos, returns a freshly generated PEM key pair.
 * For `none`, returns an unsigned token.
 */
export async function generateSampleJwt(
  algorithm: JwtAlgorithm,
): Promise<{ ok: true; sample: SampleMaterial } | { ok: false; error: string }> {
  const payload: Record<string, unknown> = {
    sub: '1234567890',
    name: 'John Doe',
    admin: true,
    iat: Math.floor(Date.now() / 1000),
  }
  try {
    if (algorithm === 'none') {
      const signed = await signJwt(payload, '', 'none')
      if (!signed.ok) return { ok: false, error: signed.error }
      return { ok: true, sample: { token: signed.token, algorithm } }
    }
    if (algorithm.startsWith('HS')) {
      const secret = `${algorithm.toLowerCase()}-sample-secret-key-at-least-256-bits-long-${Math.random()
        .toString(36)
        .slice(2, 10)}`
      const signed = await signJwt(payload, secret, algorithm)
      if (!signed.ok) return { ok: false, error: signed.error }
      return { ok: true, sample: { token: signed.token, algorithm, secret } }
    }

    const { privateKey, publicKey } = await generateKeyPair(algorithm, { extractable: true })
    const privatePem = await exportPKCS8(privateKey)
    const publicPem = await exportSPKI(publicKey)
    const signed = await signJwt(payload, privatePem, algorithm)
    if (!signed.ok) return { ok: false, error: signed.error }
    return {
      ok: true,
      sample: {
        token: signed.token,
        algorithm,
        privateKey: privatePem,
        publicKey: publicPem,
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// #63 — full JOSE lifecycle helpers
//
// Everything below is ADDITIVE and PURE. The decode/verify/sign exports above
// are untouched: pasted secret/PEM remains the default path and the renderer
// still owns it. What is added here is (a) the vocabulary the JWE screen needs,
// (b) structural token inspection that works without any key, and (c) the claim
// editor's arithmetic. Key-touching operations that must not happen in the
// renderer (a keystore-backed sign) go over IPC instead — see `jose-bridge.ts`.
// ═══════════════════════════════════════════════════════════════════════════

/** JWE key-management algorithms offered by the tool (jose v6 supported set). */
export const JWE_KEY_ALGORITHMS = [
  'RSA-OAEP',
  'RSA-OAEP-256',
  'RSA-OAEP-384',
  'RSA-OAEP-512',
  'ECDH-ES',
  'ECDH-ES+A128KW',
  'ECDH-ES+A192KW',
  'ECDH-ES+A256KW',
  'A128KW',
  'A192KW',
  'A256KW',
  'A128GCMKW',
  'A192GCMKW',
  'A256GCMKW',
  'PBES2-HS256+A128KW',
  'PBES2-HS384+A192KW',
  'PBES2-HS512+A256KW',
  'dir',
] as const

export type JweKeyAlgorithm = (typeof JWE_KEY_ALGORITHMS)[number]

/** JWE content-encryption algorithms. */
export const JWE_CONTENT_ENCRYPTIONS = [
  'A128GCM',
  'A192GCM',
  'A256GCM',
  'A128CBC-HS256',
  'A192CBC-HS384',
  'A256CBC-HS512',
] as const

export type JweContentEncryption = (typeof JWE_CONTENT_ENCRYPTIONS)[number]

/**
 * Whether a JWE key-management algorithm takes a SHARED SECRET rather than a
 * key pair. Mirrors `isSymmetricJweAlg` in `src/main/lib/jose-runtime.ts` — the
 * renderer needs it only to label the input ("Secret" vs "Recipient public
 * key"); main re-decides it authoritatively before touching any key.
 */
export function isSymmetricJweAlgorithm(alg: string): boolean {
  return alg === 'dir' || /^A\d{3}(GCM)?KW$/.test(alg) || alg.startsWith('PBES2-')
}

export type JoseTokenKind = 'jws' | 'jwe' | 'unknown'

export type JoseHeaderInfo =
  | { kind: 'jws' | 'jwe'; segments: number; header: Record<string, unknown> }
  | { kind: 'unknown'; segments: number; error: string }

/**
 * Read a compact token's PROTECTED HEADER without any key and without
 * decrypting anything.
 *
 * Segment count is the discriminator RFC 7516 gives us: 3 = JWS, 5 = JWE. This
 * is what lets the UI say "this is an encrypted token, you need a decryption
 * key" instead of the decoder's misleading "JWT must have 3 parts".
 */
export function parseJoseHeader(token: string): JoseHeaderInfo {
  const trimmed = (token ?? '').trim()
  const parts = trimmed === '' ? [] : trimmed.split('.')
  const kind: JoseTokenKind = parts.length === 3 ? 'jws' : parts.length === 5 ? 'jwe' : 'unknown'
  if (kind === 'unknown') {
    return {
      kind,
      segments: parts.length,
      error: `Expected 3 segments (JWS) or 5 (JWE), got ${parts.length}`,
    }
  }
  try {
    const header = JSON.parse(base64UrlDecode(parts[0])) as Record<string, unknown>
    if (typeof header !== 'object' || header === null || Array.isArray(header)) {
      throw new Error('Protected header is not a JSON object')
    }
    return { kind, segments: parts.length, header }
  } catch (e) {
    return {
      kind: 'unknown',
      segments: parts.length,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  if (typeof Buffer !== 'undefined') return Buffer.from(padded, 'base64').toString('utf8')
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/**
 * Parse a relative-time spec into seconds: `90`, `'90'`, `'45s'`, `'15m'`,
 * `'2h'`, `'7d'`, `'1w'`. Returns null when it cannot be read — the caller then
 * leaves the claim alone rather than writing a NaN into the token.
 */
export function parseDurationToSeconds(spec: string | number): number | null {
  if (typeof spec === 'number') return Number.isFinite(spec) ? Math.floor(spec) : null
  const raw = (spec ?? '').trim()
  if (raw === '') return null
  const m = /^(-?\d+(?:\.\d+)?)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|w|wk|weeks?)?$/i.exec(
    raw,
  )
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value)) return null
  const unit = (m[2] ?? 's').toLowerCase()
  const factor = unit.startsWith('w')
    ? 604800
    : unit.startsWith('d')
      ? 86400
      : unit.startsWith('h')
        ? 3600
        : unit.startsWith('m')
          ? 60
          : 1
  return Math.floor(value * factor)
}

/** `3725` → `'1h 2m'`. Coarse on purpose: two units are enough to read at a glance. */
export function formatDuration(seconds: number): string {
  const abs = Math.abs(Math.floor(seconds))
  if (abs < 60) return `${abs}s`
  const units: [number, string][] = [
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
    [1, 's'],
  ]
  const parts: string[] = []
  let rest = abs
  for (const [size, label] of units) {
    const n = Math.floor(rest / size)
    if (n > 0) {
      parts.push(`${n}${label}`)
      rest -= n * size
    }
    if (parts.length === 2) break
  }
  return parts.join(' ')
}

export type ExpiryDescription = {
  state: 'none' | 'valid' | 'expired'
  /** Human sentence, e.g. `expires in 1h 2m` / `expired 3d 4h ago`. */
  text: string
  /** ISO 8601 rendering of `exp`, when the claim exists. */
  iso?: string
  secondsRemaining?: number
}

/**
 * Human-readable expiry for the claim editor and the decoder badge.
 *
 * `now` is injectable so the UI can render "as of" a chosen instant and so the
 * tests never race the wall clock.
 */
export function describeExpiry(
  payload: Record<string, unknown>,
  nowSeconds = Math.floor(Date.now() / 1000),
): ExpiryDescription {
  const exp = payload.exp
  if (typeof exp !== 'number') return { state: 'none', text: 'no expiry (exp claim absent)' }
  const remaining = exp - nowSeconds
  const iso = new Date(exp * 1000).toISOString()
  return remaining >= 0
    ? {
        state: 'valid',
        text: `expires in ${formatDuration(remaining)}`,
        iso,
        secondsRemaining: remaining,
      }
    : {
        state: 'expired',
        text: `expired ${formatDuration(remaining)} ago`,
        iso,
        secondsRemaining: remaining,
      }
}

/**
 * The registered claims the editor drives (RFC 7519 §4.1).
 *
 * `exp`/`nbf` are edited as RELATIVE offsets because that is how a tester thinks
 * ("give me a token good for 15 minutes"); absolute epochs are what lands in
 * the token. An empty string means "do not set / remove this claim" so the
 * editor can also produce a payload with no `exp` at all.
 */
export interface ClaimEdits {
  iss?: string
  sub?: string
  aud?: string
  jti?: string
  /** Set `iat` to `now`. */
  issuedAt?: boolean
  /** Relative offset from `now` for `exp`, e.g. '15m'. Empty ⇒ no exp. */
  expiresIn?: string
  /** Relative offset from `now` for `nbf`. Empty ⇒ no nbf. */
  notBeforeIn?: string
}

/**
 * Apply claim edits to a payload, returning a NEW object.
 *
 * Non-registered claims in `payload` are preserved untouched — the editor is a
 * convenience over the JSON, never a replacement for it, so a user who typed
 * custom claims into the payload editor does not lose them by touching `exp`.
 * A blank edit REMOVES the corresponding claim, which is the only way to
 * produce "a token with no expiry" from the form.
 */
export function applyClaimEdits(
  payload: Record<string, unknown>,
  edits: ClaimEdits,
  nowSeconds = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload }

  const text = (key: 'iss' | 'sub' | 'aud' | 'jti', value: string | undefined): void => {
    if (value === undefined) return
    if (value.trim() === '') delete out[key]
    else out[key] = value.trim()
  }
  text('iss', edits.iss)
  text('sub', edits.sub)
  text('aud', edits.aud)
  text('jti', edits.jti)

  if (edits.issuedAt !== undefined) {
    if (edits.issuedAt) out.iat = nowSeconds
    else delete out.iat
  }

  const relative = (key: 'exp' | 'nbf', spec: string | undefined): void => {
    if (spec === undefined) return
    if (spec.trim() === '') {
      delete out[key]
      return
    }
    const seconds = parseDurationToSeconds(spec)
    if (seconds === null) return // unreadable → leave the existing claim alone
    out[key] = nowSeconds + seconds
  }
  relative('exp', edits.expiresIn)
  relative('nbf', edits.notBeforeIn)

  return out
}

/** Seed the claim editor from an existing payload (offsets relative to `now`). */
export function claimEditsFromPayload(
  payload: Record<string, unknown>,
  nowSeconds = Math.floor(Date.now() / 1000),
): ClaimEdits {
  const str = (v: unknown): string =>
    typeof v === 'string' ? v : Array.isArray(v) ? v.join(',') : v === undefined ? '' : String(v)
  const offset = (v: unknown): string => (typeof v === 'number' ? `${v - nowSeconds}s` : '')
  return {
    iss: str(payload.iss),
    sub: str(payload.sub),
    aud: str(payload.aud),
    jti: str(payload.jti),
    issuedAt: typeof payload.iat === 'number',
    expiresIn: offset(payload.exp),
    notBeforeIn: offset(payload.nbf),
  }
}

/** Standard registered JWT claim descriptions (RFC 7519 §4.1 + common public claims). */
export const STANDARD_CLAIMS: Record<string, string> = {
  iss: 'Issuer — who created the token',
  sub: 'Subject — who/what the token is about',
  aud: 'Audience — intended recipient(s)',
  exp: 'Expiration time (seconds since epoch)',
  nbf: 'Not before (seconds since epoch)',
  iat: 'Issued at (seconds since epoch)',
  jti: 'JWT ID — unique identifier',
  typ: 'Token type',
  alg: 'Signing algorithm',
  kid: 'Key ID',
  cty: 'Content type',
  name: 'Full name',
  email: 'Email address',
  email_verified: 'Email verification status',
  preferred_username: 'Preferred username',
  given_name: 'First name',
  family_name: 'Last name',
  locale: 'Locale',
  zoneinfo: 'Time zone',
  azp: 'Authorized party',
  auth_time: 'Authentication time',
  nonce: 'Replay-protection nonce',
  scope: 'Granted scopes',
  scp: 'Granted scopes',
  roles: 'Granted roles',
  groups: 'Group memberships',
  admin: 'Administrator flag',
}

export type ClaimRow = {
  key: string
  /** Stringified value for display. */
  value: string
  /** Original raw value. */
  raw: unknown
  /** Human-readable date for numeric date claims (exp/iat/nbf/auth_time). */
  iso?: string
  description?: string
}

/** Flatten a JWT payload (or header) into table rows for the table view. */
export function claimsToTable(obj: Record<string, unknown>): ClaimRow[] {
  const rows: ClaimRow[] = []
  for (const [key, raw] of Object.entries(obj)) {
    const row: ClaimRow = {
      key,
      raw,
      value: typeof raw === 'string' ? raw : JSON.stringify(raw),
      description: STANDARD_CLAIMS[key],
    }
    if (
      typeof raw === 'number' &&
      (key === 'exp' || key === 'iat' || key === 'nbf' || key === 'auth_time')
    ) {
      row.iso = new Date(raw * 1000).toISOString()
    }
    rows.push(row)
  }
  return rows
}
