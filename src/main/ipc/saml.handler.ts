/**
 * `saml:*` IPC handlers (#65, Faz E) — the renderer-facing contract for SAML.
 *
 * The SAML work runs in MAIN for two reasons: `xml-crypto` + `node:crypto` do
 * not exist in the browser, and a keystore-backed private key must never be
 * handed to the renderer to sign with.
 *
 * ── Invariants this file owns ───────────────────────────────────────────────
 *
 * ADDITIVE. Inline PEM paste is the DEFAULT and only mandatory path:
 * `saml:sign` succeeds with `{ key: { inline: { certPem, privateKeyPem } } }`
 * and no `source` anywhere. `{ source: MaterialSource }` is ONE added arm of a
 * discriminated union, resolved HERE — never inside the pure engine
 * (`protocols/saml.engine.ts` only type-imports `MaterialSource` and
 * deliberately ignores it, exactly like `wsse.engine.ts`).
 *
 * NO-LEAK. A resolved PEM / private key / passphrase lives only inside a single
 * handler call. What crosses back to the renderer is the built XML, the signed
 * XML, or a verification report — never key bytes. The write-only `keySource`
 * (which may carry a store/entry password the user typed) is STRIPPED: the
 * config handed to the engine is constructed field-by-field from resolved
 * material, so there is no object to accidentally persist or echo.
 *
 * FAIL LOUD. Neither arm resolvable → a clear `{ success:false, error }`.
 * Nothing here ever degrades to "unsigned but successful" or "valid by
 * default"; `verifySaml` itself never throws and reports WHICH check failed.
 *
 * DTD/XXE (E-5). Every entry point that accepts XML goes through the engine's
 * `assertNoDoctype` pre-parse guard — including the payloads produced by
 * `saml:decode`, which are attacker-controlled bytes.
 */

import { ipcMain } from 'electron'
import { createPrivateKey } from 'node:crypto'
import { ipcResult, type IpcResult } from '../lib/ipc-helpers'
import { KeyMaterialError, resolveKeyMaterial, type MaterialSource } from '../lib/keystore-bridge'
import {
  buildAssertion,
  buildAuthnRequest,
  buildResponse,
  DEFAULT_MAX_INFLATED_BYTES,
  decodePost,
  decodeRedirect,
  encodePost,
  encodeRedirect,
  encodeRedirectUrlParam,
  signSaml,
  verifySaml,
  type SamlAssertionConfig,
  type SamlAuthnRequestConfig,
  type SamlDocument,
  type SamlResponseConfig,
  type SamlSignAlgorithm,
  type SamlSignatureTarget,
  type SamlVerifyOptions,
  type SamlVerifyResult,
} from '../protocols/saml.engine'

// ─────────────────────────────────────────────────────────────────────────────
// Payload contracts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ONE key-material shape every key-bearing SAML payload uses, from day one.
 *
 * `inline` = what the user pasted (the default path). `source` = an opaque
 * provider reference (ids / aliases / paths + write-only passwords) resolved
 * here through `resolveKeyMaterial`.
 */
export type SamlKeyInput =
  | { inline: { certPem?: string; privateKeyPem?: string; passphrase?: string } }
  | { source: MaterialSource }

export type SamlBuildPayload =
  | { kind: 'authnRequest'; config: SamlAuthnRequestConfig }
  | { kind: 'assertion'; config: SamlAssertionConfig }
  | { kind: 'response'; config: SamlResponseConfig }

export interface SamlSignPayload {
  xml: string
  algorithm: SamlSignAlgorithm
  signatureTarget?: SamlSignatureTarget
  referenceId?: string
  key: SamlKeyInput
}

export interface SamlVerifyPayload {
  xml: string
  /** The TRUST ANCHOR. Never the certificate embedded in the document KeyInfo. */
  key: SamlKeyInput
  options?: SamlVerifyOptions
}

export type SamlBinding = 'redirect' | 'post'

export interface SamlEncodePayload {
  xml: string
  binding: SamlBinding
  /** Redirect only — additionally percent-encode for a query string. */
  urlEncode?: boolean
}

export interface SamlDecodePayload {
  value: string
  binding: SamlBinding
  /** Redirect only — inflate cap (decompression bomb). Engine default otherwise. */
  maxInflatedBytes?: number
}

export interface SamlSignResult {
  xml: string
}

export interface SamlEncodeResult {
  value: string
}

export interface SamlDecodeResult {
  xml: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Key-material orchestration (the WSSE `wsse-key-material.ts` pattern)
// ─────────────────────────────────────────────────────────────────────────────

function hasText(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Normalise a possibly-encrypted private key to a plain PKCS#8 PEM.
 * `xml-crypto` takes the key as an opaque PEM string with no passphrase slot,
 * so an encrypted key must be unwrapped here (node:crypto only — no new deps,
 * see E-6: do NOT introduce a non-CJS dependency into main).
 */
function toUnencryptedPkcs8(keyPem: string, passphrase: string | undefined): string {
  if (!hasText(passphrase)) return keyPem
  try {
    return createPrivateKey({ key: keyPem, passphrase })
      .export({ format: 'pem', type: 'pkcs8' })
      .toString()
  } catch {
    // Never surface raw OpenSSL text — it can quote key/passphrase-adjacent
    // material. NO-LEAK extends to error strings.
    throw new KeyMaterialError('The private key could not be decrypted — check the key passphrase.')
  }
}

function assertKnownArm(key: SamlKeyInput | undefined): asserts key is SamlKeyInput {
  if (!key || typeof key !== 'object' || (!('inline' in key) && !('source' in key))) {
    throw new KeyMaterialError(
      'No key material was supplied: paste a certificate (and private key) PEM, or select key material from the keystore.',
    )
  }
}

/**
 * SIGNING material. Returns ONLY what `signSaml` needs; the caller never gets
 * the `MaterialSource` back, so the write-only password it may carry cannot be
 * persisted or echoed.
 */
function resolveSigningMaterial(key: SamlKeyInput): { certPem: string; privateKeyPem: string } {
  assertKnownArm(key)

  if ('inline' in key) {
    // ── The DEFAULT path. Pasted PEM, byte-for-byte what the user typed. ──
    const { certPem, privateKeyPem, passphrase } = key.inline ?? {}
    if (!hasText(certPem) || !hasText(privateKeyPem)) {
      throw new KeyMaterialError(
        'SAML signing needs both a certificate PEM and a private key PEM — paste both, or select key material from the keystore.',
      )
    }
    return { certPem, privateKeyPem: toUnencryptedPkcs8(privateKeyPem, passphrase) }
  }

  // ── The ADDED arm. Resolved HERE, in the orchestration layer. ──
  const material = resolveKeyMaterial(key.source, 'pem')
  if (!hasText(material.keyPem)) {
    throw new KeyMaterialError(
      'The selected key material has no private key — SAML signing requires one.',
    )
  }
  if (!hasText(material.certPem)) {
    throw new KeyMaterialError('The selected key material has no certificate.')
  }
  return {
    certPem: material.certPem,
    privateKeyPem: toUnencryptedPkcs8(material.keyPem, material.passphrase),
  }
}

/**
 * TRUST-ANCHOR material for verification (E-2). Only the certificate — a
 * verifier never needs the private half, so we never materialise it.
 */
function resolveTrustAnchor(key: SamlKeyInput): string {
  assertKnownArm(key)

  if ('inline' in key) {
    const certPem = key.inline?.certPem
    if (!hasText(certPem)) {
      throw new KeyMaterialError(
        'SAML verification needs the certificate to trust — paste its PEM, or select it from the keystore.',
      )
    }
    return certPem
  }

  const material = resolveKeyMaterial(key.source, 'pem')
  if (!hasText(material.certPem)) {
    throw new KeyMaterialError('The selected key material has no certificate to verify against.')
  }
  return material.certPem
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

export function registerSamlHandlers(): void {
  /**
   * Build an AuthnRequest / Assertion / Response. Pure string building — no key
   * material is involved by construction, so there is no arm to resolve here.
   */
  ipcMain.handle(
    'saml:build',
    async (_event, payload: SamlBuildPayload): Promise<IpcResult<SamlDocument>> =>
      ipcResult(() => {
        if (!payload || typeof payload !== 'object') {
          throw new Error('saml:build needs a { kind, config } payload')
        }
        switch (payload.kind) {
          case 'authnRequest':
            return buildAuthnRequest(payload.config)
          case 'assertion':
            return buildAssertion(payload.config)
          case 'response':
            return buildResponse(payload.config)
          default:
            throw new Error(
              `saml:build: unknown document kind "${String((payload as { kind?: unknown }).kind)}"`,
            )
        }
      }),
  )

  /**
   * Enveloped XML-DSig over an Assertion / Response.
   *
   * The engine stays PURE: it is handed resolved PEMs and never a
   * `MaterialSource`. Only the signed XML travels back.
   */
  ipcMain.handle(
    'saml:sign',
    async (_event, payload: SamlSignPayload): Promise<IpcResult<SamlSignResult>> =>
      ipcResult(() => {
        if (!payload || typeof payload !== 'object') {
          throw new Error('saml:sign needs a { xml, algorithm, key } payload')
        }
        const { certPem, privateKeyPem } = resolveSigningMaterial(payload.key)
        // Constructed field-by-field on purpose: `keySource` is never carried
        // into the engine config, so it cannot be persisted or echoed back.
        const xml = signSaml(payload.xml, {
          certPem,
          privateKeyPem,
          algorithm: payload.algorithm,
          signatureTarget: payload.signatureTarget,
          referenceId: payload.referenceId,
        })
        return { xml }
      }),
  )

  /**
   * Verify an enveloped SAML signature against the CALLER's certificate.
   *
   * `verifySaml` never throws — a rejection comes back as
   * `{ valid:false, reason, checks[] }` inside a SUCCESSFUL envelope, so the UI
   * can show WHICH guarantee failed (XSW, wrong algorithm, DOCTYPE, …). Only a
   * key-material failure produces `success:false`.
   */
  ipcMain.handle(
    'saml:verify',
    async (_event, payload: SamlVerifyPayload): Promise<IpcResult<SamlVerifyResult>> =>
      ipcResult(() => {
        if (!payload || typeof payload !== 'object') {
          throw new Error('saml:verify needs a { xml, key } payload')
        }
        const certPem = resolveTrustAnchor(payload.key)
        return verifySaml(payload.xml, certPem, payload.options ?? {})
      }),
  )

  /** HTTP-Redirect (raw DEFLATE + base64) / HTTP-POST (base64) encoding. */
  ipcMain.handle(
    'saml:encode',
    async (_event, payload: SamlEncodePayload): Promise<IpcResult<SamlEncodeResult>> =>
      ipcResult(() => {
        if (!payload || typeof payload !== 'object') {
          throw new Error('saml:encode needs a { xml, binding } payload')
        }
        if (payload.binding === 'post') return { value: encodePost(payload.xml) }
        if (payload.binding === 'redirect') {
          return {
            value: payload.urlEncode
              ? encodeRedirectUrlParam(payload.xml)
              : encodeRedirect(payload.xml),
          }
        }
        throw new Error(`saml:encode: unknown binding "${String(payload.binding)}"`)
      }),
  )

  /**
   * Reverse of `saml:encode`. The decoded bytes are attacker-controlled, so the
   * engine re-applies the DOCTYPE guard to the OUTPUT (E-5) and caps the
   * inflated size for the Redirect binding.
   */
  ipcMain.handle(
    'saml:decode',
    async (_event, payload: SamlDecodePayload): Promise<IpcResult<SamlDecodeResult>> =>
      ipcResult(() => {
        if (!payload || typeof payload !== 'object') {
          throw new Error('saml:decode needs a { value, binding } payload')
        }
        if (payload.binding === 'post') return { xml: decodePost(payload.value) }
        if (payload.binding === 'redirect') {
          return {
            xml: decodeRedirect(payload.value, {
              // The renderer may LOWER the decompression-bomb cap, never raise
              // it: forwarding the value unclamped let a caller opt out of the
              // very limit the engine defines.
              maxInflatedBytes: Math.min(
                Number(payload.maxInflatedBytes) > 0
                  ? Number(payload.maxInflatedBytes)
                  : DEFAULT_MAX_INFLATED_BYTES,
                DEFAULT_MAX_INFLATED_BYTES,
              ),
            }),
          }
        }
        throw new Error(`saml:decode: unknown binding "${String(payload.binding)}"`)
      }),
  )
}
