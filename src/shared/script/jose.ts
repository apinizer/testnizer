/**
 * JOSE (JWS / JWT) capability for the SHARED script sandbox — issue #73.
 *
 * ── Why this file exists (ESM containment) ──────────────────────────────────
 *
 * This is the ONE place the shared script runtime imports `jose`, exactly like
 * `src/main/lib/jose-runtime.ts` is the one place the rest of MAIN imports it.
 * Two doors, one lever: `jose@6` is ESM-only ("type":"module", no `require`
 * export condition), so electron-vite MUST bundle it rather than externalize it
 * — `externalizeDepsPlugin({ exclude: ['uuid', 'jose'] })` in
 * electron.vite.config.ts. Without that exclusion an externalized jose becomes a
 * runtime `require('jose')` in out/main, and Electron 33's Node 20 cannot
 * require() an ES module: the app dies ON LOAD with ERR_REQUIRE_ESM before a
 * window opens (the v1.4.19 launch-crash class, CLAUDE.md).
 *
 * The import below is a STATIC namespace import — never `await import()`, never
 * `require(variableName)`. That matters twice over:
 *   • Rollup (main) and Vite (renderer) can both see it statically, so jose ends
 *     up INSIDE both bundles. `sandboxRequire` then only does a lookup in a map
 *     that was populated at module-eval time — the sandbox's `require('jose')`
 *     is a plain object property read, not a module resolution, so nothing is
 *     left for a bundler to miss.
 *   • The sandbox stays synchronous-resolving, like every other library in
 *     require.ts (Postman's `require` is sync).
 *
 * Both halves of the shared runtime therefore resolve jose the same way:
 *   MAIN  → runner.handler.ts → shared/script → this file → bundled by Rollup
 *   REND. → test-runner.ts    → shared/script → this file → bundled by Vite
 * (the renderer already bundles jose today for Tools → JWT: lib/tools/jwt.ts).
 *
 * ── Security posture ────────────────────────────────────────────────────────
 *
 * `pm.jose` operates ONLY on key material the SCRIPT itself supplies (a secret,
 * a PEM, a JWK the user pasted or built). It deliberately has NO access to the
 * keystore / `MaterialSource` resolution of Faz C: the Send path runs scripts in
 * the RENDERER, so wiring keystore-backed private keys in here would round-trip
 * private key material to the renderer — exactly what the NO-LEAK invariant
 * forbids. Keystore-backed signing stays on the main-only `jose:*` IPC surface.
 */
import * as jose from 'jose'

/** The module object returned by `require('jose')` inside a script. */
export const joseModule = jose

/** Key material a script may hand to `pm.jose.*`. */
export type JoseKeyInput = string | Uint8Array | JsonWebKey

export interface JoseSignOptions {
  /** JWS algorithm. Required for PEM keys (cannot be inferred); defaults to
   *  HS256 for raw secrets and to the JWK's `alg`/`kty` otherwise. */
  alg?: string
  /** Extra protected-header members (e.g. `{ kid, typ, x5t }`). */
  header?: Record<string, unknown>
  issuer?: string
  audience?: string | string[]
  subject?: string
  jwtid?: string
  /** `setExpirationTime` input: '2h', '10m', or an absolute epoch-seconds number. */
  expiresIn?: string | number
  notBefore?: string | number
  /** `true` → now; string/number → explicit. Omitted by default so identical
   *  inputs produce identical tokens (deterministic, test-friendly). */
  issuedAt?: string | number | boolean
}

export interface JoseVerifyOptions {
  /** Algorithm of the KEY. When omitted it is read from the token's protected
   *  header (convenience); pin it — or `algorithms` — to reject alg switching. */
  alg?: string
  /** Accepted algorithms allow-list (maps to jose's `algorithms`). */
  algorithms?: string[]
  issuer?: string | string[]
  audience?: string | string[]
  subject?: string
  clockTolerance?: string | number
  maxTokenAge?: string | number
  currentDate?: Date
}

export interface JoseVerifyResult {
  payload: jose.JWTPayload
  protectedHeader: jose.JWTHeaderParameters
  /** Alias of `protectedHeader` (Postman-ish ergonomics). */
  header: jose.JWTHeaderParameters
}

export interface JoseJwsVerifyResult {
  /** UTF-8 decoded payload. */
  payload: string
  /** Raw payload bytes (for binary payloads). */
  bytes: Uint8Array
  protectedHeader: jose.JWSHeaderParameters
  header: jose.JWSHeaderParameters
}

export interface JoseDecodeResult {
  header: jose.ProtectedHeaderParameters
  payload: jose.JWTPayload
}

export interface JoseKeyPair {
  /** PKCS#8 PEM — feed straight back into `pm.jose.sign`. */
  privateKey: string
  /** SPKI PEM — feed straight back into `pm.jose.verify`. */
  publicKey: string
  /** PUBLIC JWK only (never carries `d`/`p`/`q`/`k`…). */
  publicJwk: JsonWebKey
  alg: string
}

export interface JoseHelper {
  sign(
    payload: Record<string, unknown>,
    key: JoseKeyInput,
    options?: JoseSignOptions,
  ): Promise<string>
  verify(token: string, key: JoseKeyInput, options?: JoseVerifyOptions): Promise<JoseVerifyResult>
  decode(token: string): JoseDecodeResult
  signJws(
    payload: string | Uint8Array,
    key: JoseKeyInput,
    options?: JoseSignOptions,
  ): Promise<string>
  verifyJws(
    token: string,
    key: JoseKeyInput,
    options?: JoseVerifyOptions,
  ): Promise<JoseJwsVerifyResult>
  generateKeyPair(alg: string): Promise<JoseKeyPair>
  /** Escape hatch: the full jose module, same object as `require('jose')`. */
  jose: typeof jose
}

/* ────────────────────────── key + alg resolution ────────────────────────── */

function isJwk(key: JoseKeyInput): key is JsonWebKey {
  return typeof key === 'object' && key !== null && !(key instanceof Uint8Array)
}

function isPem(key: string): boolean {
  return key.includes('-----BEGIN ')
}

/**
 * UTF-8 secret → bytes. `Uint8Array.from` re-wraps with THIS module's realm
 * constructor, which keeps `payload instanceof Uint8Array` checks inside jose
 * happy even when the host's TextEncoder comes from another realm.
 */
function secretBytes(secret: string): Uint8Array {
  return Uint8Array.from(new TextEncoder().encode(secret))
}

function algFromJwk(jwk: JsonWebKey): string | undefined {
  if (typeof jwk.alg === 'string') return jwk.alg
  switch (jwk.kty) {
    case 'oct':
      return 'HS256'
    case 'RSA':
      return 'RS256'
    case 'EC':
      return jwk.crv === 'P-384' ? 'ES384' : jwk.crv === 'P-521' ? 'ES512' : 'ES256'
    case 'OKP':
      return 'EdDSA'
    default:
      return undefined
  }
}

function resolveAlg(key: JoseKeyInput, explicit?: string): string {
  if (explicit) return explicit
  if (key instanceof Uint8Array) return 'HS256'
  if (isJwk(key)) {
    const a = algFromJwk(key)
    if (a) return a
    throw new Error(
      "pm.jose: cannot infer `alg` from this JWK — pass it explicitly, e.g. { alg: 'RS256' }.",
    )
  }
  if (!isPem(key)) return 'HS256'
  throw new Error(
    'pm.jose: `alg` is required for PEM keys — it cannot be inferred from the PEM itself. ' +
      "Pass it explicitly, e.g. pm.jose.sign(payload, pem, { alg: 'RS256' }).",
  )
}

async function importKey(key: JoseKeyInput, alg: string): Promise<jose.CryptoKey | Uint8Array> {
  // Every sign/verify path funnels through here, so one check covers them all.
  assertPortableAlg(alg)
  if (key instanceof Uint8Array) return Uint8Array.from(key)
  if (isJwk(key)) {
    return (await jose.importJWK(key as jose.JWK, alg)) as jose.CryptoKey | Uint8Array
  }
  if (typeof key !== 'string') {
    throw new Error(
      'pm.jose: unsupported key — pass a secret string, a PEM string, a JWK, or bytes.',
    )
  }
  if (!isPem(key)) return secretBytes(key)
  if (key.includes('BEGIN CERTIFICATE')) return jose.importX509(key, alg)
  if (/BEGIN (RSA|EC) PRIVATE KEY/.test(key)) {
    throw new Error(
      'pm.jose: PKCS#1/SEC1 private-key PEM is not supported — convert it to PKCS#8 ' +
        '("-----BEGIN PRIVATE KEY-----"), e.g. openssl pkcs8 -topk8 -nocrypt.',
    )
  }
  if (key.includes('PRIVATE KEY')) return jose.importPKCS8(key, alg)
  if (key.includes('PUBLIC KEY')) return jose.importSPKI(key, alg)
  throw new Error(
    'pm.jose: unrecognised PEM block — expected a PRIVATE KEY, PUBLIC KEY or CERTIFICATE.',
  )
}

/** Verify-side alg: explicit → single-entry allow-list → token header → infer. */
function resolveVerifyAlg(token: string, key: JoseKeyInput, options: JoseVerifyOptions): string {
  if (options.alg) return options.alg
  if (options.algorithms?.length === 1) return options.algorithms[0]
  try {
    const hdr = jose.decodeProtectedHeader(token)
    if (typeof hdr.alg === 'string') return hdr.alg
  } catch {
    /* fall through to inference — jose will produce the real parse error */
  }
  return resolveAlg(key)
}

function verifyOptions(options: JoseVerifyOptions): jose.JWTVerifyOptions {
  const algorithms = options.algorithms ?? (options.alg ? [options.alg] : undefined)
  const out: jose.JWTVerifyOptions = {}
  if (algorithms) out.algorithms = algorithms
  if (options.issuer) out.issuer = options.issuer
  if (options.audience) out.audience = options.audience
  if (options.subject) out.subject = options.subject
  if (options.clockTolerance !== undefined) out.clockTolerance = options.clockTolerance
  if (options.maxTokenAge !== undefined) out.maxTokenAge = options.maxTokenAge
  if (options.currentDate) out.currentDate = options.currentDate
  return out
}

/* ─────────────────────────────── the helper ─────────────────────────────── */

async function sign(
  payload: Record<string, unknown>,
  key: JoseKeyInput,
  options: JoseSignOptions = {},
): Promise<string> {
  const alg = resolveAlg(key, options.alg)
  const cryptoKey = await importKey(key, alg)
  const header = { alg, ...(options.header ?? {}) } as unknown as jose.JWTHeaderParameters
  const signer = new jose.SignJWT(payload as jose.JWTPayload).setProtectedHeader(header)
  if (options.issuer) signer.setIssuer(options.issuer)
  if (options.audience) signer.setAudience(options.audience)
  if (options.subject) signer.setSubject(options.subject)
  if (options.jwtid) signer.setJti(options.jwtid)
  if (options.expiresIn !== undefined) signer.setExpirationTime(options.expiresIn)
  if (options.notBefore !== undefined) signer.setNotBefore(options.notBefore)
  if (options.issuedAt !== undefined && options.issuedAt !== false) {
    signer.setIssuedAt(options.issuedAt === true ? undefined : options.issuedAt)
  }
  return signer.sign(cryptoKey)
}

async function verify(
  token: string,
  key: JoseKeyInput,
  options: JoseVerifyOptions = {},
): Promise<JoseVerifyResult> {
  const alg = resolveVerifyAlg(token, key, options)
  const cryptoKey = await importKey(key, alg)
  const { payload, protectedHeader } = await jose.jwtVerify(
    token,
    cryptoKey,
    verifyOptions(options),
  )
  return { payload, protectedHeader, header: protectedHeader }
}

function decode(token: string): JoseDecodeResult {
  return { header: jose.decodeProtectedHeader(token), payload: jose.decodeJwt(token) }
}

async function signJws(
  payload: string | Uint8Array,
  key: JoseKeyInput,
  options: JoseSignOptions = {},
): Promise<string> {
  const alg = resolveAlg(key, options.alg)
  const cryptoKey = await importKey(key, alg)
  const bytes = typeof payload === 'string' ? secretBytes(payload) : Uint8Array.from(payload)
  const header = { alg, ...(options.header ?? {}) } as unknown as jose.CompactJWSHeaderParameters
  return new jose.CompactSign(bytes).setProtectedHeader(header).sign(cryptoKey)
}

async function verifyJws(
  token: string,
  key: JoseKeyInput,
  options: JoseVerifyOptions = {},
): Promise<JoseJwsVerifyResult> {
  const alg = resolveVerifyAlg(token, key, options)
  const cryptoKey = await importKey(key, alg)
  const algorithms = options.algorithms ?? (options.alg ? [options.alg] : undefined)
  const { payload, protectedHeader } = await jose.compactVerify(
    token,
    cryptoKey,
    algorithms ? { algorithms } : undefined,
  )
  return {
    payload: new TextDecoder().decode(payload),
    bytes: payload,
    protectedHeader,
    header: protectedHeader,
  }
}

/**
 * Algorithms whose availability depends on the HOST's WebCrypto, not on this
 * shared module. Electron 33's Chromium (Send) has no Ed25519, Node 20 (Run)
 * does — so an EdDSA script silently worked on Run and threw on Send, the exact
 * Send≡Run divergence this file exists to prevent. Fail the SAME way on both,
 * with a message that names the reason rather than surfacing a raw
 * `NotSupportedError` from one runtime only.
 */
const HOST_DEPENDENT_ALGS = new Set(['EdDSA', 'Ed25519', 'Ed448'])

function assertPortableAlg(alg: string): void {
  if (!HOST_DEPENDENT_ALGS.has(alg)) return
  throw new Error(
    `${alg} is not available in scripts: it needs Ed25519 support in the host crypto, which the request editor (Chromium) does not provide. ` +
      'Use RS256/PS256/ES256 (or Tools → JWT for a one-off) so Send and Run behave identically.',
  )
}

async function generateKeyPair(alg: string): Promise<JoseKeyPair> {
  assertPortableAlg(alg)
  const { privateKey, publicKey } = await jose.generateKeyPair(alg, { extractable: true })
  return {
    privateKey: await jose.exportPKCS8(privateKey),
    publicKey: await jose.exportSPKI(publicKey),
    publicJwk: (await jose.exportJWK(publicKey)) as JsonWebKey,
    alg,
  }
}

/**
 * The `pm.jose` facade. Stateless, so one frozen instance is shared by both
 * paths (built once in index.ts → identical object graph on Send and Run).
 */
export function createJoseHelper(): JoseHelper {
  return Object.freeze({
    sign,
    verify,
    decode,
    signJws,
    verifyJws,
    generateKeyPair,
    jose: joseModule,
  })
}
