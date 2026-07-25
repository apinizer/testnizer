/**
 * The ONE door through which `jose` enters the MAIN process.
 *
 * ── Why a door at all ───────────────────────────────────────────────────────
 *
 * `jose@6` is ESM-only: its package.json is `"type": "module"` and its exports
 * map offers only a `default` (ESM) condition — no `require`. electron-vite's
 * `externalizeDepsPlugin` leaves every dependency as a runtime `require()`, and
 * Electron 33's Node 20 cannot `require()` an ES module, so an externalized
 * jose kills the app ON LOAD with ERR_REQUIRE_ESM — before a window ever opens.
 * That is exactly the v1.4.19 launch-crash regression (CLAUDE.md).
 *
 * The fix is `externalizeDepsPlugin({ exclude: [..., 'jose'] })`, which makes
 * Rollup BUNDLE jose (ESM→CJS) into out/main. Keeping every main-side import in
 * this module means that decision has one place to live and one place to check:
 * if a future module imports 'jose' directly and someone later drops the
 * exclusion, the crash comes back silently.
 *
 * NOTE: a bare `node -e "require('jose')"` on system Node ≥22 SUCCEEDS (Node 22
 * supports require(ESM)) while the packaged Electron app still dies. Verify
 * containment with a production build + the smoke test, never with bare node.
 *
 * ── What belongs here ───────────────────────────────────────────────────────
 *
 * Narrow, typed wrappers only. No DB access, no IPC, no policy: callers own
 * key resolution (`resolveKeyMaterial`) and error surfacing. Note that JWK
 * export for the key provider deliberately does NOT live here — node:crypto
 * does that synchronously and dependency-free (see keystore-bridge `toJwk`).
 */
import {
  SignJWT,
  jwtVerify,
  CompactSign,
  compactVerify,
  CompactEncrypt,
  compactDecrypt,
  importPKCS8,
  importSPKI,
  importX509,
  importJWK,
  exportSPKI,
  exportPKCS8,
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  type JWTPayload,
  type JSONWebKeySet,
  type CryptoKey,
} from 'jose'

export type JoseKeyLike = CryptoKey | Uint8Array

/** HMAC algorithms take a shared secret; everything else takes a key. */
export function isHmacAlg(alg: string): boolean {
  return alg.startsWith('HS')
}

/** Secret → key material for the HS* family. */
export function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

/** PKCS#8 private-key PEM → signing key. */
export function privateKeyFromPem(pem: string, alg: string): Promise<CryptoKey> {
  return importPKCS8(pem, alg)
}

/**
 * Verification key from either an SPKI public-key PEM or a full X.509
 * certificate PEM — callers routinely have whichever the user pasted.
 */
export function publicKeyFromPem(pem: string, alg: string): Promise<CryptoKey> {
  return pem.includes('BEGIN CERTIFICATE') ? importX509(pem, alg) : importSPKI(pem, alg)
}

export function keyFromJwk(jwk: JsonWebKey, alg?: string): Promise<CryptoKey | Uint8Array> {
  return importJWK(jwk as Parameters<typeof importJWK>[0], alg) as Promise<CryptoKey | Uint8Array>
}

export function pemFromJwk(jwk: JsonWebKey, isPrivate: boolean): Promise<string> {
  return keyFromJwk(jwk).then((key) =>
    isPrivate ? exportPKCS8(key as CryptoKey) : exportSPKI(key as CryptoKey),
  )
}

/** Sign a JWT (claims) — the JOSE tool's "sign" and the script bridge share it. */
export function signJwt(
  payload: JWTPayload,
  key: JoseKeyLike,
  alg: string,
  header?: Record<string, unknown>,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ ...(header ?? {}), alg })
    .sign(key as Parameters<SignJWT['sign']>[0])
}

/** Verify a JWT and return its claims + header. */
export async function verifyJwt(
  token: string,
  key: JoseKeyLike,
  algorithms?: string[],
): Promise<{ payload: JWTPayload; header: Record<string, unknown> }> {
  const res = await jwtVerify(token, key as never, {
    ...(algorithms?.length ? { algorithms } : {}),
  })
  return { payload: res.payload, header: res.protectedHeader as Record<string, unknown> }
}

/** Sign an arbitrary payload as a compact JWS (not necessarily a JWT). */
export function signJws(
  payload: string | Uint8Array,
  key: JoseKeyLike,
  alg: string,
  header?: Record<string, unknown>,
): Promise<string> {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
  return new CompactSign(bytes)
    .setProtectedHeader({ ...(header ?? {}), alg })
    .sign(key as Parameters<CompactSign['sign']>[0])
}

export async function verifyJws(
  jws: string,
  key: JoseKeyLike,
  algorithms?: string[],
): Promise<{ payload: string; header: Record<string, unknown> }> {
  const res = await compactVerify(jws, key as never, {
    ...(algorithms?.length ? { algorithms } : {}),
  })
  return {
    payload: new TextDecoder().decode(res.payload),
    header: res.protectedHeader as Record<string, unknown>,
  }
}

/** JWE compact encryption / decryption. */
export function encryptJwe(
  plaintext: string,
  key: JoseKeyLike,
  alg: string,
  enc: string,
): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(plaintext))
    .setProtectedHeader({ alg, enc })
    .encrypt(key as Parameters<CompactEncrypt['encrypt']>[0])
}

export async function decryptJwe(
  jwe: string,
  key: JoseKeyLike,
): Promise<{ plaintext: string; header: Record<string, unknown> }> {
  const res = await compactDecrypt(jwe, key as never)
  return {
    plaintext: new TextDecoder().decode(res.plaintext),
    header: res.protectedHeader as Record<string, unknown>,
  }
}

/** Verify against a JWKS document (a pasted set or one fetched by MAIN). */
export async function verifyJwtWithJwks(
  token: string,
  jwks: JSONWebKeySet,
  algorithms?: string[],
): Promise<{ payload: JWTPayload; header: Record<string, unknown> }> {
  const keySet = createLocalJWKSet(jwks)
  const res = await jwtVerify(token, keySet, {
    ...(algorithms?.length ? { algorithms } : {}),
  })
  return { payload: res.payload, header: res.protectedHeader as Record<string, unknown> }
}

/** Decode without verifying — for a debugger view, never for trust decisions. */
export function decodeToken(token: string): {
  header: Record<string, unknown>
  payload: JWTPayload
} {
  return {
    header: decodeProtectedHeader(token) as Record<string, unknown>,
    payload: decodeJwt(token),
  }
}
