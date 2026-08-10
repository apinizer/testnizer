import type { MaterialSource } from '../../types'

/**
 * Renderer → MAIN bridge for the JOSE lifecycle (#63).
 *
 * ── Why anything crosses at all ─────────────────────────────────────────────
 *
 * The JWT Debugger's DEFAULT path is unchanged and stays in the renderer: what
 * the user pasted is theirs, `src/renderer/lib/tools/jwt.ts` signs and verifies
 * with it locally, and nothing leaves the process. Two things cannot work that
 * way:
 *
 *   1. A KEYSTORE-backed key. The renderer must never hold it, so the sign /
 *      decrypt happens in main and only the token / plaintext comes back.
 *   2. A JWKS URL. `index.html` pins `connect-src 'self'`, so the renderer
 *      cannot GET an identity provider's `/.well-known/jwks.json` at all.
 *
 * Everything here is therefore a thin, typed call over `window.api.jose` that
 * unwraps the `{success,data?,error?}` envelope into a discriminated result.
 * No key material is ever an OUTPUT of these calls.
 */

export type JoseCall<T> = { ok: true; value: T } | { ok: false; error: string }

/** The key a JOSE op runs with — pasted material, or an opaque provider ref. */
export type JoseKeyInput =
  | {
      inline: {
        secret?: string
        privateKeyPem?: string
        certPem?: string
        passphrase?: string
      }
    }
  | { source: MaterialSource }

export interface JoseClaimChecks {
  audience?: string | string[]
  issuer?: string | string[]
  subject?: string
  clockTolerance?: string | number
  maxTokenAge?: string | number
  /** Epoch MILLISECONDS — "would this verify as of…". */
  currentDate?: number
}

export interface JoseVerifyOutcome {
  payload: Record<string, unknown> | string
  header: Record<string, unknown>
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * `window.api` is absent in a plain jsdom/unit context and in any surface that
 * renders outside Electron, so every call degrades to a readable failure rather
 * than a TypeError.
 */
function bridge(): NonNullable<Window['api']>['jose'] | null {
  return (window as Window & typeof globalThis).api?.jose ?? null
}

async function call<T>(
  op: (api: NonNullable<ReturnType<typeof bridge>>) => Promise<Envelope<T>>,
): Promise<JoseCall<T>> {
  const api = bridge()
  if (!api) return { ok: false, error: 'JOSE operations are only available inside the app.' }
  try {
    const res = await op(api)
    if (res?.success && res.data !== undefined) return { ok: true, value: res.data }
    return { ok: false, error: res?.error ?? 'The operation failed.' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Sign in MAIN. Returns the compact token — never the key it was signed with. */
export function signInMain(payload: {
  mode: 'jwt' | 'jws'
  alg: string
  payload: Record<string, unknown> | string
  header?: Record<string, unknown>
  key: JoseKeyInput
}): Promise<JoseCall<string>> {
  return call<string>((api) => api.sign(payload as never) as Promise<Envelope<string>>)
}

/** Verify in MAIN — against a single key, a pasted JWKS, or a JWKS URL. */
export function verifyInMain(payload: {
  mode: 'jwt' | 'jws'
  token: string
  alg?: string
  algorithms?: string[]
  key?: JoseKeyInput
  jwks?: { keys: JsonWebKey[] }
  jwksUri?: string
  claims?: JoseClaimChecks
}): Promise<JoseCall<JoseVerifyOutcome>> {
  return call<JoseVerifyOutcome>(
    (api) => api.verify(payload as never) as Promise<Envelope<JoseVerifyOutcome>>,
  )
}

export function encryptInMain(payload: {
  alg: string
  enc: string
  plaintext: string
  key: JoseKeyInput
}): Promise<JoseCall<string>> {
  return call<string>((api) => api.encrypt(payload as never) as Promise<Envelope<string>>)
}

export function decryptInMain(payload: {
  alg: string
  enc: string
  jwe: string
  key: JoseKeyInput
}): Promise<JoseCall<{ plaintext: string; header: Record<string, unknown> }>> {
  return call<{ plaintext: string; header: Record<string, unknown> }>(
    (api) =>
      api.decrypt(payload as never) as Promise<
        Envelope<{ plaintext: string; header: Record<string, unknown> }>
      >,
  )
}

/**
 * GET a JWKS document through MAIN. The renderer's CSP forbids the request, and
 * what returns has already had every private JWK member stripped in main.
 */
export function fetchJwksViaMain(uri: string): Promise<JoseCall<{ keys: JsonWebKey[] }>> {
  return call<{ keys: JsonWebKey[] }>(
    (api) => api.fetchJwks(uri) as Promise<Envelope<{ keys: JsonWebKey[] }>>,
  )
}
