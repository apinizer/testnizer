/**
 * Renderer-side SAML tool logic (#65, Faz E).
 *
 * Two jobs, both deliberately DOM-free so they can be unit-tested in the node
 * `|tools|` vitest project:
 *
 *  1. a thin IPC wrapper over `window.api.saml.*` — the build/sign/verify work
 *     itself lives in MAIN (`protocols/saml.engine.ts`), because `xml-crypto` +
 *     `node:crypto` do not exist in the browser and because a keystore-backed
 *     private key must never be handed to the renderer;
 *  2. pure form→payload mapping.
 *
 * ADDITIVE invariant, pinned by `buildKeyInput`: with the "Use from keystore /
 * Security" picker untouched the payload is exactly the inline shape
 * `{ inline: { certPem, privateKeyPem } }`. Picking a source swaps in the ONE
 * added arm `{ source }` and leaves the pasted PEM state alone, so clearing the
 * picker returns to the default path with the textareas still filled.
 */

import type {
  MaterialSource,
  SamlAssertionConfig,
  SamlAttributeInput,
  SamlAuthnRequestConfig,
  SamlBinding,
  SamlDocument,
  SamlKeyInput,
  SamlResponseConfig,
  SamlSignAlgorithm,
  SamlSignatureTarget,
  SamlVerifyOptions,
  SamlVerifyResult,
} from '../../types'

export type SamlToolMode = 'build' | 'sign' | 'verify' | 'binding'
export type SamlBuildKind = 'authnRequest' | 'assertion' | 'response'

export const SAML_MODES: SamlToolMode[] = ['build', 'sign', 'verify', 'binding']
export const SAML_BUILD_KINDS: SamlBuildKind[] = ['authnRequest', 'assertion', 'response']
export const SAML_SIGN_ALGORITHMS: SamlSignAlgorithm[] = [
  'RSA-SHA256',
  'RSA-SHA512',
  'ECDSA-SHA256',
  'ECDSA-SHA512',
]
export const SAML_SIGNATURE_TARGETS: SamlSignatureTarget[] = ['assertion', 'response', 'root']
export const SAML_BINDINGS: SamlBinding[] = ['redirect', 'post']

export const NAMEID_FORMATS = [
  'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:entity',
]

// ─── Form state ─────────────────────────────────────────────

export interface SamlAttributeRow {
  name: string
  value: string
}

export interface SamlBuildFormState {
  kind: SamlBuildKind
  issuer: string
  destination: string
  acsUrl: string
  nameId: string
  nameIdFormat: string
  audience: string
  inResponseTo: string
  sessionIndex: string
  notBeforeSkewSeconds: number
  notOnOrAfterSeconds: number
  includeAuthnStatement: boolean
  attributes: SamlAttributeRow[]
  /** Response only — embed the XML currently in the editor as the assertion. */
  embedEditorAssertion: boolean
}

export interface SamlSignFormState {
  algorithm: SamlSignAlgorithm
  signatureTarget: SamlSignatureTarget
  /** Pasted PEM — the DEFAULT path. */
  certPem: string
  /** Pasted PEM — the DEFAULT path. */
  privateKeyPem: string
  passphrase: string
  /** The ONE added arm. `null` → the pasted PEMs above are used. */
  keySource: MaterialSource | null
  keySourceLabel: string | null
}

export interface SamlVerifyFormState {
  /** Pasted trust anchor — the DEFAULT path. */
  certPem: string
  keySource: MaterialSource | null
  keySourceLabel: string | null
  expectedAudience: string
  expectedInResponseTo: string
  requireAssertionSigned: boolean
  validateConditions: boolean
  clockSkewSeconds: number
}

export interface SamlBindingFormState {
  binding: SamlBinding
  urlEncode: boolean
  encoded: string
}

export function emptyBuildForm(): SamlBuildFormState {
  return {
    kind: 'assertion',
    issuer: 'https://idp.example.com/metadata',
    destination: '',
    acsUrl: 'https://sp.example.com/acs',
    nameId: 'alice@example.com',
    nameIdFormat: NAMEID_FORMATS[0],
    audience: 'https://sp.example.com/metadata',
    inResponseTo: '',
    sessionIndex: '',
    notBeforeSkewSeconds: 60,
    notOnOrAfterSeconds: 300,
    includeAuthnStatement: true,
    attributes: [{ name: 'email', value: 'alice@example.com' }],
    embedEditorAssertion: false,
  }
}

export function emptySignForm(): SamlSignFormState {
  return {
    algorithm: 'RSA-SHA256',
    signatureTarget: 'assertion',
    certPem: '',
    privateKeyPem: '',
    passphrase: '',
    keySource: null,
    keySourceLabel: null,
  }
}

export function emptyVerifyForm(): SamlVerifyFormState {
  return {
    certPem: '',
    keySource: null,
    keySourceLabel: null,
    expectedAudience: '',
    expectedInResponseTo: '',
    requireAssertionSigned: false,
    validateConditions: true,
    clockSkewSeconds: 60,
  }
}

export function emptyBindingForm(): SamlBindingFormState {
  return { binding: 'redirect', urlEncode: false, encoded: '' }
}

// ─── Pure form → payload mapping ────────────────────────────

function trimmed(value: string): string | undefined {
  const v = value.trim()
  return v.length > 0 ? v : undefined
}

function toAttributes(rows: SamlAttributeRow[]): SamlAttributeInput[] | undefined {
  const kept = rows.filter((r) => r.name.trim().length > 0)
  if (kept.length === 0) return undefined
  return kept.map((r) => ({ name: r.name.trim(), values: [r.value] }))
}

export function toAssertionConfig(form: SamlBuildFormState): SamlAssertionConfig {
  return {
    issuer: form.issuer.trim(),
    subject: {
      nameId: form.nameId.trim(),
      nameIdFormat: trimmed(form.nameIdFormat),
      recipient: trimmed(form.acsUrl),
      inResponseTo: trimmed(form.inResponseTo),
    },
    audience: trimmed(form.audience),
    notBeforeSkewSeconds: form.notBeforeSkewSeconds,
    notOnOrAfterSeconds: form.notOnOrAfterSeconds,
    sessionIndex: trimmed(form.sessionIndex),
    includeAuthnStatement: form.includeAuthnStatement,
    attributes: toAttributes(form.attributes),
  }
}

export type SamlBuildRequest =
  | { kind: 'authnRequest'; config: SamlAuthnRequestConfig }
  | { kind: 'assertion'; config: SamlAssertionConfig }
  | { kind: 'response'; config: SamlResponseConfig }

/**
 * `editorXml` is the XML currently in the editor — a Response can embed an
 * ALREADY SIGNED assertion verbatim (its digest survives), which is exactly the
 * sign-assertion-then-wrap flow a real IdP performs.
 */
export function buildRequestFromForm(form: SamlBuildFormState, editorXml = ''): SamlBuildRequest {
  if (form.kind === 'authnRequest') {
    return {
      kind: 'authnRequest',
      config: {
        issuer: form.issuer.trim(),
        destination: trimmed(form.destination),
        assertionConsumerServiceURL: trimmed(form.acsUrl),
        nameIdFormat: trimmed(form.nameIdFormat),
      },
    }
  }
  if (form.kind === 'assertion') {
    return { kind: 'assertion', config: toAssertionConfig(form) }
  }
  const embedded = form.embedEditorAssertion ? editorXml.trim() : ''
  return {
    kind: 'response',
    config: {
      issuer: form.issuer.trim(),
      destination: trimmed(form.destination),
      inResponseTo: trimmed(form.inResponseTo),
      ...(embedded.length > 0
        ? { assertionXml: embedded }
        : { assertion: toAssertionConfig(form) }),
    },
  }
}

/**
 * The ADDITIVE invariant in one function.
 *
 * No source picked → the inline arm, byte-for-byte what the user pasted.
 * A source picked → the single added `{ source }` arm. The pasted PEM state is
 * never read in that case and never cleared, so removing the source restores
 * the default path untouched.
 */
export function buildKeyInput(form: {
  certPem: string
  privateKeyPem?: string
  passphrase?: string
  keySource: MaterialSource | null
}): SamlKeyInput {
  if (form.keySource) return { source: form.keySource }
  const inline: { certPem?: string; privateKeyPem?: string; passphrase?: string } = {
    certPem: form.certPem,
  }
  if (form.privateKeyPem !== undefined) inline.privateKeyPem = form.privateKeyPem
  if (form.passphrase !== undefined && form.passphrase.length > 0) {
    inline.passphrase = form.passphrase
  }
  return { inline }
}

export function verifyOptionsFromForm(form: SamlVerifyFormState): SamlVerifyOptions {
  return {
    requireAssertionSigned: form.requireAssertionSigned,
    validateConditions: form.validateConditions,
    clockSkewSeconds: form.clockSkewSeconds,
    expectedAudience: trimmed(form.expectedAudience),
    expectedInResponseTo: trimmed(form.expectedInResponseTo),
  }
}

// ─── Verification failure classification ────────────────────

export type SamlFailureCategory =
  | 'xsw'
  | 'algorithm'
  | 'doctype'
  | 'trust'
  | 'signature'
  | 'expired'
  | 'audience'
  | 'malformed'
  | 'other'

/**
 * XML Signature Wrapping is the failure that MUST NOT read as a generic
 * "invalid". Every check in this set means the same thing to a user: the
 * document carries a signature, it may even verify cryptographically, but it
 * does not cover the element the caller is about to trust.
 */
const XSW_CHECKS = new Set([
  'unique-ids',
  'single-signature',
  'single-reference',
  'reference-uri',
  'reference-target',
  'signed-element-scope',
  'required-signed-id',
  'assertion-signed',
  'transforms',
])

const CATEGORY_BY_CHECK: Record<string, SamlFailureCategory> = {
  'trust-anchor': 'trust',
  doctype: 'doctype',
  'well-formed': 'malformed',
  'signature-present': 'signature',
  'signature-method': 'algorithm',
  'canonicalization-method': 'algorithm',
  'signature-value': 'signature',
  'conditions-not-before': 'expired',
  'conditions-not-on-or-after': 'expired',
  audience: 'audience',
  'in-response-to': 'audience',
}

export interface SamlFailureInfo {
  category: SamlFailureCategory
  /** The check that failed, when the report names one. */
  check?: string
  detail?: string
}

/** First failing check in the ordered report — that is the reason it stopped. */
export function firstFailedCheck(
  result: SamlVerifyResult,
): { name: string; detail?: string } | undefined {
  const failed = (result.checks ?? []).find((c) => !c.ok)
  return failed ? { name: failed.name, detail: failed.detail } : undefined
}

export function classifyFailure(result: SamlVerifyResult): SamlFailureInfo {
  const failed = firstFailedCheck(result)
  if (!failed) {
    return { category: 'other', detail: result.reason }
  }
  const category: SamlFailureCategory = XSW_CHECKS.has(failed.name)
    ? 'xsw'
    : (CATEGORY_BY_CHECK[failed.name] ?? 'other')
  return { category, check: failed.name, detail: failed.detail ?? result.reason }
}

export function isWrappingFailure(result: SamlVerifyResult): boolean {
  return !result.valid && classifyFailure(result).category === 'xsw'
}

// ─── IPC wrappers ───────────────────────────────────────────

function bridge(): Window['api']['saml'] {
  const api = window.api?.saml
  if (!api) {
    throw new Error('SAML IPC bridge unavailable (renderer not connected to main process)')
  }
  return api
}

function unwrap<T>(result: { success: boolean; data?: T; error?: string }, what: string): T {
  if (!result.success || result.data === undefined) {
    throw new Error(result.error ?? `${what} failed`)
  }
  return result.data
}

export async function buildSaml(request: SamlBuildRequest): Promise<SamlDocument> {
  return unwrap(await bridge().build(request), 'saml:build')
}

export async function signSamlDocument(payload: {
  xml: string
  algorithm: SamlSignAlgorithm
  signatureTarget?: SamlSignatureTarget
  referenceId?: string
  key: SamlKeyInput
}): Promise<string> {
  return unwrap(await bridge().sign(payload), 'saml:sign').xml
}

export async function verifySamlDocument(payload: {
  xml: string
  key: SamlKeyInput
  options?: SamlVerifyOptions
}): Promise<SamlVerifyResult> {
  return unwrap(await bridge().verify(payload), 'saml:verify')
}

export async function encodeSaml(payload: {
  xml: string
  binding: SamlBinding
  urlEncode?: boolean
}): Promise<string> {
  return unwrap(await bridge().encode(payload), 'saml:encode').value
}

export async function decodeSaml(payload: {
  value: string
  binding: SamlBinding
}): Promise<string> {
  return unwrap(await bridge().decode(payload), 'saml:decode').xml
}
