/**
 * WSSE key-material orchestration (#60, Faz C — design §2.5 EDIT 3 / reconcile
 * C-2 + C-4).
 *
 * `applyWsSecurity` / `applySignature` (`protocols/wsse.engine.ts`) are a
 * deliberately PURE, IPC-free engine shared verbatim by TWO entrypoints:
 *
 *   1. the standalone WS-Security tool  → ipc `wsse:apply`  (`ipc/wsse.handler.ts`)
 *   2. a saved SOAP request             → `executeSoap`     (`protocols/soap.engine.ts`)
 *
 * A `keySource` resolved at only one of them would make the other silently
 * ignore "Use from keystore" — the Send-vs-Tool parity class CLAUDE.md already
 * flags for runner-verdict / header-assertion / env-vars. So the resolution
 * lives HERE, in one shared helper, and BOTH junctions call it immediately
 * before `applyWsSecurity`. The engine itself never learns about the keystore
 * bridge (it type-imports `MaterialSource` only).
 *
 * ── Invariants ──────────────────────────────────────────────────────────────
 *
 * ADDITIVE (C-3). WSSE's only existing key input is PEM-PASTE (two components,
 * two stores; there is no file/PFX path in WSSE today — that is mTLS/EDIT 1).
 * With no `keySource`, this helper returns the caller's config UNTOUCHED, so
 * every pasted-PEM surface behaves byte-for-byte as before.
 *
 * FAIL LOUD. Sign mode with neither a resolvable `keySource` nor pasted PEM
 * throws a clear, actionable error so the tool AND the SOAP request fail
 * visibly rather than shipping an unsigned envelope.
 *
 * NO-LEAK. The resolved PEM is written into the config passed onward to the
 * engine and NEVER returned to the renderer. The write-only `keySource` (which
 * may carry a store/key password the user typed) is STRIPPED from the config
 * that continues downstream.
 */

import { createPrivateKey } from 'node:crypto'
import { KeyMaterialError, resolveKeyMaterial } from './keystore-bridge'
import type { WsSecurityConfig } from '../protocols/wsse.engine'

function hasText(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Normalise a possibly-encrypted private key to a plain PKCS#8 PEM.
 * `xml-crypto` takes the key as an opaque PEM string with no passphrase slot,
 * so an encrypted key must be unwrapped here (node:crypto only — no new deps).
 */
function toUnencryptedPkcs8(keyPem: string, passphrase: string | undefined): string {
  if (!hasText(passphrase)) return keyPem
  try {
    return createPrivateKey({ key: keyPem, passphrase })
      .export({ format: 'pem', type: 'pkcs8' })
      .toString()
  } catch {
    // Never surface the raw OpenSSL text — it can quote key/passphrase-adjacent
    // material (design §6 "no-leak: error scrubbing").
    throw new KeyMaterialError(
      'The selected private key could not be decrypted — check the key passphrase.',
    )
  }
}

/**
 * Resolve `config.sign.keySource` (if any) into `privateKeyPem`/`certPem` and
 * return the config to hand to `applyWsSecurity`.
 *
 * Returns the SAME object reference when there is nothing to resolve, so the
 * pasted-PEM path stays literally unchanged.
 */
export function resolveWsseKeyMaterial(config: WsSecurityConfig): WsSecurityConfig {
  if (!config || typeof config !== 'object') return config
  if (!config.enabled) return config

  const modes = Array.isArray(config.modes) ? config.modes : []
  if (!modes.includes('sign')) return config

  // Guard (C-4): `sign` may be absent even with 'sign' in modes — `applyWsSecurity`
  // already treats that as "nothing to sign", so keep that behaviour identical.
  const sign = config.sign
  if (!sign) return config

  const keySource = sign.keySource
  if (!keySource) {
    // ADDITIVE default path — pasted PEM, untouched.
    if (hasText(sign.privateKeyPem) && hasText(sign.certPem)) return config
    // FAIL LOUD — neither a keySource nor pasted PEM.
    throw new KeyMaterialError(
      'WS-Security signing has no key material: paste a certificate + private key PEM, or select key material from the keystore.',
    )
  }

  const resolved = resolveKeyMaterial(keySource, 'pem')
  if (!hasText(resolved.keyPem)) {
    throw new KeyMaterialError(
      'The selected key material has no private key — WS-Security signing requires one.',
    )
  }

  // Drop the write-only `keySource` (it may hold a store/key password) from the
  // config that travels on to the engine.
  const { keySource: _writeOnly, ...restOfSign } = sign
  return {
    ...config,
    sign: {
      ...restOfSign,
      certPem: resolved.certPem,
      privateKeyPem: toUnencryptedPkcs8(resolved.keyPem as string, resolved.passphrase),
    },
  }
}
