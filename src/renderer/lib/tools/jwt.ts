import {
  decodeJwt as joseDecodePayload,
  decodeProtectedHeader,
  jwtVerify,
  importSPKI,
  importPKCS8,
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
