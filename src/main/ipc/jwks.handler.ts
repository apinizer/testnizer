import { ipcMain } from 'electron'
import { buildJwks, serializeJwks, PRIVATE_JWK_MEMBERS, type JwksDocument } from '../lib/jwks'
import { resolveKeyMaterial, type MaterialSource } from '../lib/keystore-bridge'
import { ipcResult } from '../lib/ipc-helpers'

/**
 * JWKS build (#61 / Faz D1) — turn key material into the STATIC document a
 * mock endpoint serves.
 *
 * ── Why this exists in MAIN, and why it returns a STRING ────────────────────
 *
 * D1-2: the mock response script sandbox (`mock/script.ts`) has no `require`,
 * no `node:crypto` and no `jose`, so a JWKS can never be generated at request
 * time. It is pre-computed HERE — at configure time — and stored verbatim in
 * `mock_responses.body` through the EXISTING `mock:response:create/update` IPC.
 * Rotation is "call this again + `mock:response:update`" (which hot-reloads a
 * running server); there is nothing to regenerate per request.
 *
 * D1-1: serving that body needs ZERO new mock primitives — one ordinary
 * `mock_endpoints` row (`GET /.well-known/jwks.json`, `path_mode:'exact'`) plus
 * one ordinary `mock_responses` row. This handler therefore knows nothing about
 * mock servers: it only builds the text.
 *
 * ── Invariants ──────────────────────────────────────────────────────────────
 *
 * PUBLIC-JWK-ONLY (D1-4, HARD). Only `resolveKeyMaterial(…,'jwk').publicJwk` is
 * ever read — `privateJwk` is not touched on any branch. `buildJwks` strips
 * every private member again, and `assertPublishable` below checks the finished
 * text one last time before it leaves the process. Three independent gates for
 * one reason: this string is served over a localhost HTTP port to any caller,
 * and a leak here is a private key on the wire.
 *
 * NO-LEAK. Nothing else about the resolved material crosses back: no PEM, no
 * passphrase, no `privateJwk`. The renderer sends an OPAQUE `MaterialSource`
 * (ids/aliases/paths, plus write-only passwords that ride this one payload) and
 * gets back publishable public keys it could have derived from the certificate
 * anyway.
 *
 * ADDITIVE. This is a NEW channel; no existing mock channel changes shape. A
 * hand-authored response body is unaffected — the renderer's "Fill from
 * Security" button writes this result into the SAME body field the user types
 * in, and never runs unless clicked.
 */

interface BuildJwksPayload {
  /** Opaque key-material references. Each contributes its PUBLIC half. */
  sources?: MaterialSource[]
  /**
   * Public JWKs the caller already holds — in practice the keys parsed out of
   * the body being edited, so a second pick ADDS a rotation key instead of
   * replacing the set. Freshly resolved sources come first (the newest signing
   * key leads the document); `buildJwks` de-duplicates by `kid`, first wins.
   *
   * These are renderer-supplied, so they are sanitized exactly like everything
   * else — a private JWK a user pasted into the body by hand does not become a
   * published private JWK.
   */
  extraKeys?: JsonWebKey[]
}

interface BuildJwksResult {
  /** Exactly the text to store in `mock_responses.body`. */
  body: string
  /** RFC 7638 thumbprints, in document order — for a "2 keys: ab…, cd…" hint. */
  kids: string[]
  count: number
}

/**
 * Last gate before the document leaves main (D1-4 "strip defensively even when
 * the producer should already have").
 *
 * Deliberately checks the SERIALIZED text's parsed form rather than the objects
 * `buildJwks` returned: what gets served is the string, so the string is what
 * must be proven clean. Throws instead of stripping — reaching here means an
 * upstream invariant broke, and silently publishing a "fixed" document would
 * hide that.
 */
function assertPublishable(body: string): void {
  const parsed = JSON.parse(body) as JwksDocument
  parsed.keys.forEach((key, i) => {
    for (const member of PRIVATE_JWK_MEMBERS) {
      if (member in (key as Record<string, unknown>)) {
        throw new Error(
          `Refusing to publish JWKS key #${i}: it still carries the private member "${member}".`,
        )
      }
    }
  })
}

export function registerJwksHandlers(): void {
  /**
   * Build the JWKS document for a set of key sources.
   *
   * Fails loud: a source with no readable public half, or a symmetric key
   * (whose whole value IS the secret), throws rather than quietly producing a
   * short document that would make verification fail far from the cause.
   */
  ipcMain.handle('jwks:build', (_e, payload: BuildJwksPayload) =>
    ipcResult<BuildJwksResult>(() => {
      const sources = payload?.sources ?? []
      const extraKeys = payload?.extraKeys ?? []
      if (sources.length === 0 && extraKeys.length === 0) {
        throw new Error('Pick at least one key to publish in the JWKS.')
      }

      const resolved: JsonWebKey[] = sources.map((source, i) => {
        // PUBLIC ONLY — `privateJwk` is deliberately never read here.
        const material = resolveKeyMaterial(source, 'jwk')
        if (!material.publicJwk) {
          throw new Error(`Key #${i + 1} has no readable public key to publish.`)
        }
        return material.publicJwk
      })

      const jwks = buildJwks({ keys: [...resolved, ...extraKeys] })
      const body = serializeJwks(jwks)
      assertPublishable(body)

      return {
        body,
        kids: jwks.keys.map((k) => (typeof k.kid === 'string' ? k.kid : '')),
        count: jwks.keys.length,
      }
    }),
  )
}
