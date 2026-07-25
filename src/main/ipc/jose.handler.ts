import { ipcMain } from 'electron'
import {
  decodeToken,
  decryptJwe,
  encryptJwe,
  isHmacAlg,
  privateKeyFromPem,
  publicKeyFromPem,
  secretKey,
  signJws,
  signJwt,
  verifyJws,
  verifyJwt,
  verifyJwtWithJwks,
  type JoseKeyLike,
} from '../lib/jose-runtime'
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

      if (payload.jwks) {
        return verifyJwtWithJwks(payload.token, payload.jwks as never, payload.algorithms ?? [alg])
      }
      if (!payload.key) throw new Error('No key supplied to verify with.')
      const key = await resolveVerificationKey(payload.key, alg)
      return payload.mode === 'jwt'
        ? verifyJwt(payload.token, key, payload.algorithms ?? [alg])
        : verifyJws(payload.token, key, payload.algorithms ?? [alg])
    }),
  )

  ipcMain.handle('jose:encrypt', (_e, payload: JwePayload) =>
    ipcResult(async () => {
      if (!payload.plaintext) throw new Error('Nothing to encrypt.')
      const key = await resolveVerificationKey(payload.key, payload.alg)
      return encryptJwe(payload.plaintext, key, payload.alg, payload.enc)
    }),
  )

  ipcMain.handle('jose:decrypt', (_e, payload: JwePayload) =>
    ipcResult(async () => {
      if (!payload.jwe) throw new Error('Nothing to decrypt.')
      const key = await resolveSigningKey(payload.key, payload.alg)
      return decryptJwe(payload.jwe, key)
    }),
  )

  /** Decode WITHOUT verifying — a debugger view, never a trust decision. */
  ipcMain.handle('jose:decode', (_e, token: string) => ipcResult(async () => decodeToken(token)))
}
