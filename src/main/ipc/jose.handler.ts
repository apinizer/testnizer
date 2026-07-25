import { ipcMain } from 'electron'
import {
  decodeToken,
  decryptJwe,
  encryptJwe,
  isHmacAlg,
  isSymmetricJweAlg,
  privateKeyFromPem,
  publicKeyFromPem,
  secretKey,
  signJws,
  signJwt,
  verifyJws,
  verifyJwt,
  verifyJwtWithJwks,
  verifyJwtWithJwksUri,
  type JoseKeyLike,
  type JwtClaimChecks,
} from '../lib/jose-runtime'
import { PRIVATE_JWK_MEMBERS } from '../lib/jwks'
import { resolveKeyMaterial, type MaterialSource } from '../lib/keystore-bridge'
import { ipcResult } from '../lib/ipc-helpers'

/**
 * JWT / JOSE operations that need a PRIVATE key (#63).
 *
 * They run in MAIN for one reason: a keystore-backed key must never be handed
 * to the renderer to sign with. The pasted-secret / pasted-PEM path stays the
 * DEFAULT and is a plain inline payload — `keySource` is one added arm of the
 * union, resolved here (never inside a shared engine), exactly as WSSE does.
 */

/** Inline = what the user pasted. Source = an opaque provider reference. */
type KeyInput =
  | { inline: { secret?: string; privateKeyPem?: string; certPem?: string; passphrase?: string } }
  | { source: MaterialSource }

interface SignPayload {
  /** 'jwt' signs claims; 'jws' signs an arbitrary payload string. */
  mode: 'jwt' | 'jws'
  alg: string
  payload: Record<string, unknown> | string
  header?: Record<string, unknown>
  key: KeyInput
}

interface VerifyPayload {
  mode: 'jwt' | 'jws'
  token: string
  alg?: string
  /** Restrict acceptable algorithms — refuses a token that swapped `alg`. */
  algorithms?: string[]
  key?: KeyInput
  /** Verify against a JWKS document instead of a single key. */
  jwks?: { keys: JsonWebKey[] }
  /**
   * Verify against a JWKS served over HTTP(S). Fetched HERE — the renderer's CSP
   * (`connect-src 'self'`) makes an IdP's `/.well-known/jwks.json` unreachable
   * from the UI, which is the whole reason this arm exists.
   */
  jwksUri?: string
  /** OPT-IN claim checks (aud/iss/sub/clock skew/max age/"as of" date). */
  claims?: JwtClaimChecks
}

interface JwePayload {
  alg: string
  enc: string
  plaintext?: string
  jwe?: string
  key: KeyInput
}

/**
 * Turn a key input into jose key material.
 *
 * NO-LEAK: a resolved PEM lives only inside this call — nothing derived from it
 * is returned to the renderer beyond the token/plaintext the user asked for.
 */
async function resolveSigningKey(input: KeyInput, alg: string): Promise<JoseKeyLike> {
  if ('inline' in input) {
    const { secret, privateKeyPem } = input.inline
    if (isHmacAlg(alg)) {
      if (!secret) throw new Error(`${alg} needs a shared secret.`)
      return secretKey(secret)
    }
    if (!privateKeyPem) throw new Error(`${alg} needs a private key (PEM).`)
    return privateKeyFromPem(privateKeyPem, alg)
  }
  if (isHmacAlg(alg)) {
    throw new Error(`${alg} is a shared-secret algorithm — a keystore key cannot be used for it.`)
  }
  const material = resolveKeyMaterial(input.source, 'pem')
  if (!material.keyPem) throw new Error('That key material holds no private key.')
  return privateKeyFromPem(material.keyPem, alg)
}

async function resolveVerificationKey(input: KeyInput, alg: string): Promise<JoseKeyLike> {
  if ('inline' in input) {
    const { secret, certPem } = input.inline
    if (isHmacAlg(alg)) {
      if (!secret) throw new Error(`${alg} needs the shared secret to verify.`)
      return secretKey(secret)
    }
    if (!certPem) throw new Error(`${alg} needs a certificate or public key (PEM) to verify.`)
    return publicKeyFromPem(certPem, alg)
  }
  if (isHmacAlg(alg)) {
    throw new Error(`${alg} is a shared-secret algorithm — a keystore key cannot be used for it.`)
  }
  // Public half only: verification never needs the private key.
  const material = resolveKeyMaterial(input.source, 'pem')
  return publicKeyFromPem(material.certPem, alg)
}

/**
 * JWE key resolution.
 *
 * Split from the JWS pair because the symmetric FAMILY is different: `dir`,
 * `A*KW` and `PBES2-*` take a shared secret, and asking `isHmacAlg` (which only
 * knows HS*) would demand a certificate PEM for `alg:'dir'`. `wantPrivate`
 * selects the half — encrypt takes the recipient's PUBLIC key, decrypt the
 * PRIVATE one — which is the mirror image of the JWS sign/verify pair.
 */
async function resolveJweKey(
  input: KeyInput,
  alg: string,
  wantPrivate: boolean,
): Promise<JoseKeyLike> {
  if (isSymmetricJweAlg(alg)) {
    if (!('inline' in input)) {
      throw new Error(`${alg} is a shared-secret algorithm — a keystore key cannot be used for it.`)
    }
    const secret = input.inline.secret
    if (!secret) throw new Error(`${alg} needs a shared secret.`)
    return secretKey(secret)
  }
  if ('inline' in input) {
    const pem = wantPrivate ? input.inline.privateKeyPem : input.inline.certPem
    if (!pem) {
      throw new Error(
        wantPrivate
          ? `${alg} needs a private key (PEM) to decrypt.`
          : `${alg} needs a certificate or public key (PEM) to encrypt.`,
      )
    }
    return wantPrivate ? privateKeyFromPem(pem, alg) : publicKeyFromPem(pem, alg)
  }
  const material = resolveKeyMaterial(input.source, 'pem')
  if (!wantPrivate) return publicKeyFromPem(material.certPem, alg)
  if (!material.keyPem) throw new Error('That key material holds no private key.')
  return privateKeyFromPem(material.keyPem, alg)
}

/**
 * PUBLIC-JWK-ONLY. A JWKS fetched for the renderer is stripped of every private
 * member before it crosses the bridge. A well-behaved IdP never publishes one —
 * which is exactly why the guard cannot depend on that promise: the URL is
 * user-supplied and may point at anything, including a misconfigured internal
 * endpoint that really is serving private keys.
 */
function sanitizeJwks(doc: unknown): { keys: JsonWebKey[] } {
  const keys = (doc as { keys?: unknown })?.keys
  if (!Array.isArray(keys)) throw new Error('That URL did not return a JWKS document ({keys:[…]}).')
  return {
    keys: keys.map((k) => {
      const clean: Record<string, unknown> = { ...(k as Record<string, unknown>) }
      for (const member of PRIVATE_JWK_MEMBERS) delete clean[member]
      return clean as JsonWebKey
    }),
  }
}

/** Fetch a JWKS document from MAIN (renderer CSP forbids the cross-origin GET). */
async function fetchJwks(uri: string): Promise<{ keys: JsonWebKey[] }> {
  const url = new URL(uri)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('A JWKS URL must be http(s).')
  }
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status} ${res.statusText}`)
  return sanitizeJwks(await res.json())
}

export function registerJoseHandlers(): void {
  ipcMain.handle('jose:sign', (_e, payload: SignPayload) =>
    ipcResult(async () => {
      const key = await resolveSigningKey(payload.key, payload.alg)
      if (payload.mode === 'jwt') {
        const claims = (payload.payload ?? {}) as Record<string, unknown>
        return signJwt(claims, key, payload.alg, payload.header)
      }
      const body =
        typeof payload.payload === 'string' ? payload.payload : JSON.stringify(payload.payload)
      return signJws(body, key, payload.alg, payload.header)
    }),
  )

  ipcMain.handle('jose:verify', (_e, payload: VerifyPayload) =>
    ipcResult(async () => {
      // A token's own header names its algorithm; trusting it blindly is the
      // classic key-confusion bug, so the caller's `alg`/`algorithms` wins and
      // the header is only a fallback for choosing the key TYPE.
      const headerAlg = (() => {
        try {
          return String(decodeToken(payload.token).header.alg ?? '')
        } catch {
          return ''
        }
      })()
      const alg = payload.alg || headerAlg
      if (!alg) throw new Error('Could not determine the algorithm to verify with.')
      const allowed = payload.algorithms ?? [alg]

      if (payload.jwksUri) {
        return verifyJwtWithJwksUri(payload.token, payload.jwksUri, allowed, payload.claims)
      }
      if (payload.jwks) {
        return verifyJwtWithJwks(payload.token, payload.jwks as never, allowed, payload.claims)
      }
      if (!payload.key) throw new Error('No key supplied to verify with.')
      const key = await resolveVerificationKey(payload.key, alg)
      return payload.mode === 'jwt'
        ? verifyJwt(payload.token, key, allowed, payload.claims)
        : verifyJws(payload.token, key, allowed)
    }),
  )

  /** Fetch a JWKS document — MAIN-side because the renderer's CSP forbids it. */
  ipcMain.handle('jose:fetchJwks', (_e, uri: string) => ipcResult(() => fetchJwks(uri)))

  ipcMain.handle('jose:encrypt', (_e, payload: JwePayload) =>
    ipcResult(async () => {
      if (!payload.plaintext) throw new Error('Nothing to encrypt.')
      const key = await resolveJweKey(payload.key, payload.alg, false)
      return encryptJwe(payload.plaintext, key, payload.alg, payload.enc)
    }),
  )

  ipcMain.handle('jose:decrypt', (_e, payload: JwePayload) =>
    ipcResult(async () => {
      if (!payload.jwe) throw new Error('Nothing to decrypt.')
      const key = await resolveJweKey(payload.key, payload.alg, true)
      // Pin the key-management algorithm to what the CALLER asked for, not to
      // what the token's header claims: PBES2 is refused by jose without an
      // explicit allowlist, and the pin is what blocks algorithm substitution.
      return decryptJwe(payload.jwe, key, payload.alg ? [payload.alg] : undefined)
    }),
  )

  /** Decode WITHOUT verifying — a debugger view, never a trust decision. */
  ipcMain.handle('jose:decode', (_e, token: string) => ipcResult(async () => decodeToken(token)))
}
