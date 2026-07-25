/**
 * JWK tool (#61, Faz D1) — pure, browser-safe key-representation helpers.
 *
 * ── Where this runs, and why it may import `jose` ────────────────────────────
 *
 * RENDERER ONLY. `jose@6` is ESM-only; importing it into the MAIN bundle is the
 * v1.4.19 launch-crash class (electron-vite externalizes dependencies, and
 * Electron's Node 20 cannot `require(ESM)`) — main therefore has exactly one
 * jose door, `src/main/lib/jose-runtime.ts`. The renderer half has no such
 * constraint: Vite bundles jose into the renderer chunk, so this module imports
 * it directly, exactly as `lib/tools/jwt.ts` already does.
 *
 * ── Invariants this module owns ─────────────────────────────────────────────
 *
 * PASTING IS THE DEFAULT. Everything here operates on text the USER supplied —
 * their own PEM or their own JWK. It never dereferences a `MaterialSource` and
 * never talks to IPC; the "Use from keystore / Security" option is resolved in
 * MAIN and hands the renderer a PUBLIC JWK only (see `JwkTool.tsx`).
 *
 * PUBLIC-ONLY IS EXPLICIT. `toPublicJwk` / `buildPublicJwks` strip every private
 * member — `d,p,q,dp,dq,qi,k` plus RSA multi-prime `oth` — and `buildPublicJwks`
 * REFUSES to publish a symmetric (`oct`) key, whose whole value is the private
 * `k`. The member list and the oct rule mirror `src/main/lib/jwks.ts` on
 * purpose: what this tool copies as a JWKS must be what a served JWKS would be.
 *
 * DETERMINISTIC. Emitted JWKs order their members lexicographically, so the same
 * key always renders (and copies) byte-identically.
 *
 * FAIL SOFT AT THE BOUNDARY. Every entry point returns a `{ok}` discriminated
 * union rather than throwing — the Tools-panel convention (`hash.ts`, `uuid.ts`).
 */

import {
  calculateJwkThumbprint,
  calculateJwkThumbprintUri,
  createLocalJWKSet,
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importJWK,
  importPKCS8,
  importSPKI,
  importX509,
  type JWK,
} from 'jose'

/** A JSON Web Key. Re-exported so consumers need not import from `jose`. */
export type Jwk = JWK

/** A JWK Set document — `{keys:[…]}`, exactly what a JWKS URL serves. */
export interface JwkSet {
  keys: Jwk[]
}

export type JwkResult<T> = { ok: true; value: T } | { ok: false; error: string }

function ok<T>(value: T): JwkResult<T> {
  return { ok: true, value }
}

function err<T>(error: unknown): JwkResult<T> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Private members
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Members that make a JWK PRIVATE. `d,p,q,dp,dq,qi,k` are the mandated set
 * (RFC 7517/7518); `oth` (RSA multi-prime "other primes info") is stripped too
 * because it exists only on private keys and carries `r,d,t` factors.
 *
 * Kept identical to `PRIVATE_JWK_MEMBERS` in `src/main/lib/jwks.ts`.
 */
export const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth'] as const

/** True when the JWK carries any private member (or is a symmetric secret). */
export function isPrivateJwk(jwk: Jwk): boolean {
  const bag = jwk as unknown as Record<string, unknown>
  return PRIVATE_JWK_MEMBERS.some((m) => bag[m] !== undefined)
}

/** Members in lexicographic order — a stable, copy-friendly rendering. */
function orderMembers(jwk: Jwk): Jwk {
  const bag = jwk as unknown as Record<string, unknown>
  const clean: Record<string, unknown> = {}
  for (const member of Object.keys(bag).sort()) {
    if (bag[member] === undefined) continue
    clean[member] = bag[member]
  }
  return clean as Jwk
}

/**
 * Drop every private member. Rebuilds the object member-by-member from the
 * actual own-property list rather than deleting from a clone, so the strip is an
 * allow-through-a-denylist over what the key really carries.
 */
export function toPublicJwk(jwk: Jwk): Jwk {
  const bag = jwk as unknown as Record<string, unknown>
  const clean: Record<string, unknown> = {}
  for (const member of Object.keys(bag).sort()) {
    if ((PRIVATE_JWK_MEMBERS as readonly string[]).includes(member)) continue
    if (bag[member] === undefined) continue
    clean[member] = bag[member]
  }
  return clean as Jwk
}

/** Pretty-print with a stable member order — what the UI shows and copies. */
export function prettyJwk(jwk: Jwk): string {
  return JSON.stringify(orderMembers(jwk), null, 2)
}

/** Pretty-print a whole set with each key's members in a stable order. */
export function prettyJwkSet(set: JwkSet): string {
  return JSON.stringify({ keys: set.keys.map(orderMembers) }, null, 2)
}

// ─────────────────────────────────────────────────────────────────────────────
// Algorithms
// ─────────────────────────────────────────────────────────────────────────────

/** Asymmetric JWS algorithms this tool can generate / import a key for. */
export const JWK_ALGORITHMS = [
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
] as const

export type JwkAlgorithm = (typeof JWK_ALGORITHMS)[number]

/**
 * Import order used when the user did not name an algorithm. A PEM carries its
 * key TYPE but not a JOSE `alg`, and Web Crypto needs one to import — so the
 * shortest honest path is to try one representative per family and report which
 * one took. RSA first (the common case), then each EC curve, then Ed25519.
 */
const ALG_CANDIDATES: readonly string[] = ['RS256', 'ES256', 'ES384', 'ES512', 'EdDSA', 'PS256']

/** Default `alg` implied by a JWK's own members, when it declares none. */
export function inferAlg(jwk: Jwk): string | undefined {
  if (typeof jwk.alg === 'string' && jwk.alg.length > 0) return jwk.alg
  switch (jwk.kty) {
    case 'RSA':
      return 'RS256'
    case 'EC':
      if (jwk.crv === 'P-256') return 'ES256'
      if (jwk.crv === 'P-384') return 'ES384'
      if (jwk.crv === 'P-521') return 'ES512'
      return undefined
    case 'OKP':
      return 'EdDSA'
    default:
      return undefined
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PEM → JWK
// ─────────────────────────────────────────────────────────────────────────────

export type PemKind = 'certificate' | 'publicKey' | 'privateKey' | 'unsupported' | 'unknown'

export interface PemDetection {
  kind: PemKind
  /** The PEM label found, e.g. `CERTIFICATE`. Empty when nothing matched. */
  label: string
  /** Set for `unsupported` — says what to convert it to. */
  hint?: string
}

/**
 * Classify a PEM block by its label.
 *
 * Web Crypto (and therefore jose) reads SPKI, PKCS#8 and X.509 only. PKCS#1
 * (`RSA PRIVATE KEY`), SEC1 (`EC PRIVATE KEY`) and encrypted PKCS#8 are named
 * explicitly so the user gets the openssl one-liner instead of a parser error.
 */
export function detectPemKind(pem: string): PemDetection {
  const match = /-----BEGIN ([A-Z0-9 ]+)-----/.exec(pem ?? '')
  if (!match) return { kind: 'unknown', label: '' }
  const label = match[1].trim()
  switch (label) {
    case 'CERTIFICATE':
      return { kind: 'certificate', label }
    case 'PUBLIC KEY':
      return { kind: 'publicKey', label }
    case 'PRIVATE KEY':
      return { kind: 'privateKey', label }
    case 'ENCRYPTED PRIVATE KEY':
      return {
        kind: 'unsupported',
        label,
        hint: 'Decrypt it first: openssl pkcs8 -in key.pem -out key.pkcs8.pem',
      }
    case 'RSA PRIVATE KEY':
    case 'EC PRIVATE KEY':
      return {
        kind: 'unsupported',
        label,
        hint: 'Convert to PKCS#8: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pkcs8.pem',
      }
    case 'RSA PUBLIC KEY':
      return {
        kind: 'unsupported',
        label,
        hint: 'Convert to SPKI: openssl rsa -RSAPublicKey_in -in key.pem -pubout',
      }
    default:
      return { kind: 'unknown', label }
  }
}

export interface JwkConversion {
  /** The JWK, members ordered, with `kid` (RFC 7638) and `alg` filled in. */
  jwk: Jwk
  /** RFC 7638 base64url thumbprint — also written onto `jwk.kid`. */
  kid: string
  /** The algorithm the key was imported with. */
  alg: string
  /** True when the result carries private members (a PKCS#8 input). */
  isPrivate: boolean
  /** What the input PEM was. */
  source: PemKind
}

/**
 * PEM (X.509 certificate / SPKI public key / PKCS#8 private key) → JWK.
 *
 * `alg` is optional: without it each candidate family is tried and the one that
 * imports wins. The private key is imported `extractable` because exporting it
 * as a JWK is the entire point of the operation — the material never leaves the
 * renderer it was pasted into.
 */
export async function pemToJwk(pem: string, alg?: string): Promise<JwkResult<JwkConversion>> {
  const text = (pem ?? '').trim()
  if (!text) return { ok: false, error: 'Paste a PEM block first.' }

  const detected = detectPemKind(text)
  if (detected.kind === 'unsupported') {
    return {
      ok: false,
      error: `"${detected.label}" is not readable by Web Crypto. ${detected.hint ?? ''}`.trim(),
    }
  }
  if (detected.kind === 'unknown') {
    return {
      ok: false,
      error: detected.label
        ? `Unsupported PEM label "${detected.label}" — expected CERTIFICATE, PUBLIC KEY or PRIVATE KEY.`
        : 'That does not look like a PEM block (no -----BEGIN … ----- header).',
    }
  }

  const candidates = alg ? [alg] : ALG_CANDIDATES
  let lastError = 'Could not read that PEM.'
  for (const candidate of candidates) {
    try {
      const key =
        detected.kind === 'certificate'
          ? await importX509(text, candidate, { extractable: true })
          : detected.kind === 'publicKey'
            ? await importSPKI(text, candidate, { extractable: true })
            : await importPKCS8(text, candidate, { extractable: true })
      const raw = await exportJWK(key)
      const kid = await calculateJwkThumbprint(raw)
      const jwk = orderMembers({ ...raw, alg: candidate, kid })
      return ok({
        jwk,
        kid,
        alg: candidate,
        isPrivate: isPrivateJwk(jwk),
        source: detected.kind,
      })
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  return {
    ok: false,
    error: alg ? `Could not import the PEM as ${alg}: ${lastError}` : lastError,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JWK → PEM
// ─────────────────────────────────────────────────────────────────────────────

export interface PemConversion {
  pem: string
  /** `private` → PKCS#8; `public` → SPKI. */
  kind: 'public' | 'private'
  alg: string
}

/**
 * JWK → PEM. A private JWK becomes PKCS#8, a public one SPKI.
 *
 * Symmetric (`oct`) keys are refused: a shared secret has no ASN.1 key
 * structure, so there is no PEM to emit — pretending otherwise would hand the
 * user a file no tool can read.
 */
export async function jwkToPem(jwk: Jwk, alg?: string): Promise<JwkResult<PemConversion>> {
  if (!jwk || typeof jwk !== 'object') return { ok: false, error: 'Paste a JWK object first.' }
  if (jwk.kty === 'oct') {
    return {
      ok: false,
      error: 'A symmetric ("oct") key is a raw secret — it has no PEM representation.',
    }
  }
  const chosen = alg ?? inferAlg(jwk)
  if (!chosen) {
    return {
      ok: false,
      error: `Cannot tell which algorithm this key is for (kty "${String(jwk.kty)}") — pick one.`,
    }
  }
  const priv = isPrivateJwk(jwk)
  try {
    const key = await importJWK(jwk, chosen, { extractable: true })
    if (key instanceof Uint8Array) {
      return { ok: false, error: 'That JWK imported as raw bytes, not an asymmetric key.' }
    }
    const pem = priv ? await exportPKCS8(key) : await exportSPKI(key)
    return ok({ pem, kind: priv ? 'private' : 'public', alg: chosen })
  } catch (e) {
    return err(e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate
// ─────────────────────────────────────────────────────────────────────────────

export interface GeneratedKeyPair {
  publicJwk: Jwk
  /** MAIN-free: generated in this renderer, from the user's own click. */
  privateJwk: Jwk
  publicPem: string
  privatePem: string
  kid: string
  alg: string
}

/**
 * Generate an asymmetric key pair and return BOTH halves as JWK and PEM.
 *
 * `extractable: true` is required — jose defaults private keys to
 * non-extractable, and a key that cannot be exported is useless to a tool whose
 * whole job is showing you the key.
 */
export async function generateJwkPair(
  alg: string,
  options?: { modulusLength?: number; crv?: string },
): Promise<JwkResult<GeneratedKeyPair>> {
  try {
    const { publicKey, privateKey } = await generateKeyPair(alg, {
      extractable: true,
      ...(options?.modulusLength ? { modulusLength: options.modulusLength } : {}),
      ...(options?.crv ? { crv: options.crv } : {}),
    })
    const rawPublic = await exportJWK(publicKey)
    const rawPrivate = await exportJWK(privateKey)
    const kid = await calculateJwkThumbprint(rawPublic)
    return ok({
      publicJwk: orderMembers({ ...rawPublic, alg, kid, use: 'sig' }),
      privateJwk: orderMembers({ ...rawPrivate, alg, kid }),
      publicPem: await exportSPKI(publicKey),
      privatePem: await exportPKCS8(privateKey),
      kid,
      alg,
    })
  } catch (e) {
    return err(e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Thumbprint (RFC 7638 / RFC 9278)
// ─────────────────────────────────────────────────────────────────────────────

export interface ThumbprintResult {
  /** base64url SHA-256 over the REQUIRED members only — the canonical `kid`. */
  thumbprint: string
  /** RFC 9278 URI form, `urn:ietf:params:oauth:jwk-thumbprint:sha-256:…`. */
  uri: string
  digest: 'sha256' | 'sha384' | 'sha512'
}

/**
 * RFC 7638 thumbprint. Computed over the REQUIRED members only, so a private
 * JWK and its public half produce the SAME value — which is what makes it a
 * stable `kid` across a key's two representations.
 */
export async function jwkThumbprint(
  jwk: Jwk,
  digest: 'sha256' | 'sha384' | 'sha512' = 'sha256',
): Promise<JwkResult<ThumbprintResult>> {
  try {
    const thumbprint = await calculateJwkThumbprint(jwk, digest)
    const uri = await calculateJwkThumbprintUri(jwk, digest)
    return ok({ thumbprint, uri, digest })
  } catch (e) {
    return err(e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse / validate
// ─────────────────────────────────────────────────────────────────────────────

export interface JwkSummary {
  kty: string
  kid?: string
  alg?: string
  use?: string
  crv?: string
  /** Key size in bits when it can be derived (RSA modulus / EC curve). */
  bits?: number
  isPrivate: boolean
}

/** Byte length of a base64url string without decoding it. */
function b64uBytes(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return Math.floor((value.length * 3) / 4)
}

const CURVE_BITS: Record<string, number> = {
  'P-256': 256,
  'P-384': 384,
  'P-521': 521,
  Ed25519: 256,
  Ed448: 448,
  X25519: 256,
  secp256k1: 256,
}

/** Header-line facts about a key — what the UI renders next to the JSON. */
export function summarizeJwk(jwk: Jwk): JwkSummary {
  const kty = typeof jwk.kty === 'string' ? jwk.kty : '?'
  const crv = typeof jwk.crv === 'string' ? jwk.crv : undefined
  let bits: number | undefined
  if (kty === 'RSA') {
    const bytes = b64uBytes(jwk.n)
    bits = bytes ? bytes * 8 : undefined
  } else if (crv) {
    bits = CURVE_BITS[crv]
  } else if (kty === 'oct') {
    const bytes = b64uBytes(jwk.k)
    bits = bytes ? bytes * 8 : undefined
  }
  return {
    kty,
    kid: typeof jwk.kid === 'string' ? jwk.kid : undefined,
    alg: typeof jwk.alg === 'string' ? jwk.alg : undefined,
    use: typeof jwk.use === 'string' ? jwk.use : undefined,
    crv,
    bits,
    isPrivate: isPrivateJwk(jwk),
  }
}

/** Members every key type must carry to be usable. */
const REQUIRED_MEMBERS: Record<string, readonly string[]> = {
  RSA: ['n', 'e'],
  EC: ['crv', 'x', 'y'],
  OKP: ['crv', 'x'],
  oct: ['k'],
}

/** Structural validation — `kty` plus the members that `kty` mandates. */
export function validateJwk(input: unknown, label = 'JWK'): JwkResult<JwkSummary> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: `${label} is not a JSON object.` }
  }
  const bag = input as Record<string, unknown>
  const kty = bag.kty
  if (typeof kty !== 'string' || kty.length === 0) {
    return { ok: false, error: `${label} has no "kty" — it is not a JWK.` }
  }
  const required = REQUIRED_MEMBERS[kty]
  if (!required) {
    return { ok: false, error: `${label} has an unknown key type "${kty}".` }
  }
  const missing = required.filter((m) => typeof bag[m] !== 'string' || bag[m] === '')
  if (missing.length > 0) {
    return {
      ok: false,
      error: `${label} (kty "${kty}") is missing required member${
        missing.length > 1 ? 's' : ''
      }: ${missing.join(', ')}.`,
    }
  }
  return ok(summarizeJwk(input as Jwk))
}

export interface ParsedJwkInput {
  keys: Jwk[]
  /** True when the text was a `{keys:[…]}` document rather than a single JWK. */
  isSet: boolean
}

/**
 * Parse pasted text as either a single JWK or a JWK Set. Every key is validated,
 * so a malformed member is reported with its position instead of surfacing much
 * later as an import failure.
 */
export function parseJwkText(text: string): JwkResult<ParsedJwkInput> {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { ok: false, error: 'Paste a JWK or a JWK Set first.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Expected a JWK object or a JWK Set ({"keys":[…]}).' }
  }
  const bag = parsed as Record<string, unknown>
  if (Array.isArray(bag.keys)) {
    const keys: Jwk[] = []
    for (let i = 0; i < bag.keys.length; i++) {
      const check = validateJwk(bag.keys[i], `Key #${i + 1}`)
      if (!check.ok) return { ok: false, error: check.error }
      keys.push(bag.keys[i] as Jwk)
    }
    return ok({ keys, isSet: true })
  }
  const check = validateJwk(parsed)
  if (!check.ok) return { ok: false, error: check.error }
  return ok({ keys: [parsed as Jwk], isSet: false })
}

// ─────────────────────────────────────────────────────────────────────────────
// JWK Set assembly
// ─────────────────────────────────────────────────────────────────────────────

export interface PublicJwksBuild {
  jwks: JwkSet
  /** How many keys had at least one private member stripped. */
  stripped: number
  /** Symmetric keys refused outright — they have no publishable half. */
  omittedOct: number
  /** Duplicate keys collapsed (same `kid`, or identical content when no `kid`). */
  deduped: number
}

/**
 * Assemble a PUBLISHABLE JWK Set.
 *
 * Mirrors `buildJwks` in `src/main/lib/jwks.ts`: every private member is
 * stripped, `oct` keys are refused (their whole value IS the private `k`), keys
 * de-duplicate by `kid` with first-occurrence-wins, and member order is stable.
 * The difference is the failure mode — main throws because it is writing a body
 * that will be served; the tool reports counts so the user can see what the
 * "copy JWKS" button left out.
 */
export function buildPublicJwks(keys: readonly Jwk[]): PublicJwksBuild {
  const out: Jwk[] = []
  const seen = new Set<string>()
  let stripped = 0
  let omittedOct = 0
  let deduped = 0

  for (const key of keys) {
    if (!key || typeof key !== 'object') continue
    if (key.kty === 'oct') {
      omittedOct++
      continue
    }
    if (isPrivateJwk(key)) stripped++
    const clean = toPublicJwk(key)
    const kid = typeof clean.kid === 'string' && clean.kid.length > 0 ? clean.kid : null
    const dedupeKey = kid !== null ? `kid:${kid}` : `jwk:${JSON.stringify(clean)}`
    if (seen.has(dedupeKey)) {
      deduped++
      continue
    }
    seen.add(dedupeKey)
    out.push(clean)
  }

  return { jwks: { keys: out }, stripped, omittedOct, deduped }
}

/**
 * Would a JOSE verifier accept this document? `createLocalJWKSet` is the exact
 * check a relying party runs, so asking it here catches a broken set in the tool
 * instead of at the far end of somebody else's login flow.
 */
export function isJwksAcceptable(set: JwkSet): JwkResult<number> {
  try {
    createLocalJWKSet(set as Parameters<typeof createLocalJWKSet>[0])
    return ok(set.keys.length)
  } catch (e) {
    return err(e)
  }
}
