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
