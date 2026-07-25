/**
 * JWKS builder (#61 / Faz D1) — the ONE place a publishable `{keys:[…]}`
 * document is assembled.
 *
 * ── Why this is a pure helper ────────────────────────────────────────────────
 *
 * D1-2: the mock response script sandbox (`mock/script.ts`, `vm.runInNewContext`)
 * exposes only `request/state/response/console/setJson/setStatus/setHeader` —
 * no `require`, no `node:crypto`, no `jose`. A JWKS therefore CANNOT be produced
 * at request time; it is built HERE, in main, at configure time, serialized, and
 * written into `mock_responses.body` as a STATIC string. Key rotation =
 * rebuild + `mock:response:update` (which hot-reloads a running server).
 *
 * Consequently this module does no I/O, touches no DB, imports no `jose`
 * (ESM-only — the v1.4.19 launch-crash class, see `jose-runtime.ts`) and no
 * `node:crypto`. It is a data transform: JWKs in, publishable document out.
 *
 * ── Invariants this module owns ─────────────────────────────────────────────
 *
 * PUBLIC-JWK-ONLY (D1-4, HARD). Every private member is stripped from every key
 * — `d,p,q,dp,dq,qi,k` plus RSA multi-prime `oth` — even though the intended
 * producer (`resolveKeyMaterial(…, 'jwk').publicJwk`) already strips them. The
 * body this builds is served over a localhost HTTP port to any caller, so the
 * publishable shape must not depend on an upstream promise. A symmetric (`oct`)
 * key is REFUSED outright: its entire value is the private `k` member, so a
 * "public oct JWK" is a contradiction, not something to publish stripped.
 *
 * STABLE. De-duplicated by `kid` (first occurrence wins) and emitted with a
 * deterministic member order, so rebuilding an unchanged key set produces a
 * byte-identical body — a rewritten mock response then does not churn.
 *
 * FAIL LOUD. A malformed key throws `JwksError` rather than silently dropping a
 * key and serving an incomplete set that would make verification fail later,
 * far from the cause.
 */

/**
 * Private JWK members. `d,p,q,dp,dq,qi,k` are the mandated set (RFC 7517/7518);
 * `oth` is stripped too because RSA multi-prime "other primes info" is defined
 * only for private keys and carries `r,d,t` factors.
 */
export const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth'] as const

/** A JWK that has been through `toPublicJwk` — carries no private member. */
export type PublicJwk = JsonWebKey & { kid?: string }

/** A serialisable JWK Set — exactly what a `/.well-known/jwks.json` body holds. */
export interface JwksDocument {
  keys: PublicJwk[]
}

export class JwksError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JwksError'
  }
}

/**
 * Drop every private member and emit the remaining members in a deterministic
 * (lexicographic) order.
 *
 * Member order matters because the result is `JSON.stringify`d into a stored
 * mock body: `{"kty":…,"n":…}` vs `{"n":…,"kty":…}` are semantically identical
 * but textually different, and a churning body means a spurious DB write plus a
 * spurious server hot-reload on every rebuild.
 */
function toPublicJwk(jwk: JsonWebKey, index: number): PublicJwk {
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) {
    throw new JwksError(`JWKS key #${index} is not a JWK object.`)
  }
  const kty = (jwk as Record<string, unknown>).kty
  if (typeof kty !== 'string' || kty.length === 0) {
    throw new JwksError(`JWKS key #${index} has no "kty" — it is not a usable JWK.`)
  }
  if (kty === 'oct') {
    throw new JwksError(
      `JWKS key #${index} is a symmetric ("oct") key — a shared secret has no public half and must never be published.`,
    )
  }

  const source = jwk as Record<string, unknown>
  const clean: Record<string, unknown> = {}
  for (const member of Object.keys(source).sort()) {
    if ((PRIVATE_JWK_MEMBERS as readonly string[]).includes(member)) continue
    const value = source[member]
    if (value === undefined) continue
    clean[member] = value
  }
  return clean as PublicJwk
}

/**
 * Build a publishable JWK Set.
 *
 * Input keys are typically `resolveKeyMaterial(source, 'jwk').publicJwk`, but a
 * private JWK passed by mistake is sanitized rather than trusted (D1-4).
 *
 * - Private members are stripped from every key.
 * - Keys are de-duplicated by `kid`; the FIRST occurrence wins, so an explicit
 *   ordering by the caller survives.
 * - Keys with no `kid` are de-duplicated by their canonical content instead, so
 *   the same key added twice never appears twice.
 * - Input order is preserved (verifiers try keys in document order, and a
 *   stable order keeps the serialized body byte-identical between rebuilds).
 * - An empty set is valid: `{keys: []}` is a well-formed JWKS document and is
 *   what a server with no keys configured should serve.
 */
export function buildJwks(input: { keys: readonly JsonWebKey[] }): JwksDocument {
  if (!input || typeof input !== 'object' || !Array.isArray(input.keys)) {
    throw new JwksError('buildJwks expects { keys: JsonWebKey[] }.')
  }

  const keys: PublicJwk[] = []
  const seen = new Set<string>()

  input.keys.forEach((jwk, index) => {
    const clean = toPublicJwk(jwk, index)
    const kid = typeof clean.kid === 'string' && clean.kid.length > 0 ? clean.kid : null
    // No kid → fall back to the canonical content so an identical key added
    // twice still collapses to one entry.
    const dedupeKey = kid !== null ? `kid:${kid}` : `jwk:${JSON.stringify(clean)}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    keys.push(clean)
  })

  return { keys }
}

/**
 * The exact string to store in `mock_responses.body`.
 *
 * Pretty-printed on purpose: the body is user-visible and user-editable in the
 * mock response editor (the auto-fill is ONE added button writing into the same
 * field a hand-authored body uses), and JSON.stringify's key order is already
 * pinned by `buildJwks`, so the text is stable across rebuilds.
 */
export function serializeJwks(jwks: JwksDocument): string {
  return JSON.stringify(jwks, null, 2)
}
