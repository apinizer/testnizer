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
 *
 * ── The one other door (#73) ────────────────────────────────────────────────
 *
 * `src/shared/script/jose.ts` also imports jose: it is the SHARED script
 * runtime's jose door, and the shared runtime is compiled into BOTH bundles
 * (main via runner.handler.ts, renderer via test-runner.ts) — so it cannot
 * import a `src/main/` module. Both doors are protected by the SAME lever
 * (`exclude: ['uuid', 'jose']`), and `tests/main/shared/jose.test.ts` asserts
 * that the whole main graph still has exactly these two `from 'jose'` imports.
 * Anything else in main goes through THIS file.
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
  createRemoteJWKSet,
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

/**
 * JWE key-management algorithms whose "key" is a SHARED SECRET rather than a
 * public/private pair: direct encryption, the AES key-wrap families and the
 * password-based PBES2 family.
 *
 * `isHmacAlg` cannot answer this — it only knows the JWS HS* family — and a JWE
 * handler that asked it would demand a certificate PEM for `alg:'dir'`. Kept
 * here next to the jose import so the algorithm taxonomy has one home.
 */
export function isSymmetricJweAlg(alg: string): boolean {
  return alg === 'dir' || /^A\d{3}(GCM)?KW$/.test(alg) || alg.startsWith('PBES2-')
}

/**
 * Claim checks a caller may pin on top of the signature check.
 *
 * All of them are OPT-IN: jose does not validate `aud`/`iss`/`sub` unless asked,
 * and this module deliberately does not invent defaults — a tool that silently
 * enforced an audience would report failures the user never asked for. `exp`
 * and `nbf` ARE always enforced by jose itself.
 *
 * `currentDate` is epoch MILLISECONDS (an IPC payload cannot carry a `Date`);
 * it makes "would this token verify at time T?" answerable, and makes every
 * expiry test deterministic instead of racing the wall clock.
 */
export interface JwtClaimChecks {
  audience?: string | string[]
  issuer?: string | string[]
  subject?: string
  /** Seconds (number) or a jose duration string like '60s' / '2 minutes'. */
  clockTolerance?: string | number
  /** Rejects a token whose `iat` is older than this, e.g. '1h'. */
  maxTokenAge?: string | number
  /** Epoch milliseconds to evaluate exp/nbf/iat against. */
  currentDate?: number
}

/** Build the jose verify options from an allowlist + the opt-in claim checks. */
function verifyOptions(
  algorithms: string[] | undefined,
  checks: JwtClaimChecks | undefined,
): Record<string, unknown> {
  const opts: Record<string, unknown> = {}
  if (algorithms?.length) opts.algorithms = algorithms
  if (!checks) return opts
  if (checks.audience !== undefined) opts.audience = checks.audience
  if (checks.issuer !== undefined) opts.issuer = checks.issuer
  if (checks.subject !== undefined) opts.subject = checks.subject
  if (checks.clockTolerance !== undefined) opts.clockTolerance = checks.clockTolerance
  if (checks.maxTokenAge !== undefined) opts.maxTokenAge = checks.maxTokenAge
  if (typeof checks.currentDate === 'number') opts.currentDate = new Date(checks.currentDate)
  return opts
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
  checks?: JwtClaimChecks,
): Promise<{ payload: JWTPayload; header: Record<string, unknown> }> {
  const res = await jwtVerify(token, key as never, verifyOptions(algorithms, checks))
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

/**
 * Decrypt a compact JWE.
 *
 * `keyManagementAlgorithms` pins which `alg` the recipient will accept. Passing
 * it is not optional politeness: jose REFUSES the PBES2 family unless it is
 * explicitly allowed (an attacker-chosen `p2c` iteration count is a DoS vector),
 * and pinning is also what stops algorithm substitution — the token's own header
 * must never be the thing that decides how it gets decrypted.
 */
export async function decryptJwe(
  jwe: string,
  key: JoseKeyLike,
  keyManagementAlgorithms?: string[],
): Promise<{ plaintext: string; header: Record<string, unknown> }> {
  const res = await compactDecrypt(jwe, key as never, {
    ...(keyManagementAlgorithms?.length ? { keyManagementAlgorithms } : {}),
  })
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
  checks?: JwtClaimChecks,
): Promise<{ payload: JWTPayload; header: Record<string, unknown> }> {
  const keySet = createLocalJWKSet(jwks)
  const res = await jwtVerify(token, keySet, verifyOptions(algorithms, checks))
  return { payload: res.payload, header: res.protectedHeader as Record<string, unknown> }
}

/**
 * Verify against a JWKS served over HTTP(S) — the #61→#63 bridge.
 *
 * The fetch happens HERE, in main. The renderer cannot do it: `index.html`'s CSP
 * pins `connect-src 'self'`, so an identity provider's `/.well-known/jwks.json`
 * is unreachable from the UI by design. jose picks the key by the token's `kid`
 * and throws `JWKSNoMatchingKey` when the set has none — there is deliberately
 * no fallback to "the only key in the set".
 */
export async function verifyJwtWithJwksUri(
  token: string,
  jwksUri: string,
  algorithms?: string[],
  checks?: JwtClaimChecks,
): Promise<{ payload: JWTPayload; header: Record<string, unknown> }> {
  const keySet = createRemoteJWKSet(new URL(jwksUri))
  const res = await jwtVerify(token, keySet, verifyOptions(algorithms, checks))
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
