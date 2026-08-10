/**
 * SAML 2.0 Engine (#65, Faz E)
 *
 * PURE main-process engine — no DB, no IPC, no keystore bridge. Mirrors
 * `wsse.engine.ts`: the orchestration layer resolves a `keySource` into PEMs
 * BEFORE calling in here (see `lib/wsse-key-material.ts` for the pattern), so
 * this module never learns about the keystore.
 *
 * ── What is reused from WSSE, and what is NOT (reconcile E-1) ───────────────
 *
 * SAML reuses WSSE's xml-crypto MECHANICS (the `SignedXml` ctor shape, the
 * explicit `SIGN_ALGO_URI`/`HASH_ALGO_URI` maps so the RSA-SHA1 default is never
 * relied upon, exclusive-c14n, the PEM helpers) — but NOT its detached-signature
 * OPTIONS. SAML signatures are ENVELOPED, so:
 *   • `idMode` is OMITTED (xml-crypto's default `idAttributes ['Id','ID','id']`
 *     already matches SAML's plain `ID`; `'wssecurity'` would look for `wsu:Id`);
 *   • references carry `uri: '#<ID>'` + the enveloped-signature transform;
 *   • `getKeyInfoContent` emits `<X509Data><X509Certificate>` — NOT WSSE's
 *     `SecurityTokenReference`/BST;
 *   • `computeSignature` inserts the `ds:Signature` immediately AFTER
 *     `saml:Issuer` of the signed element.
 *
 * ── Security posture ────────────────────────────────────────────────────────
 *
 * E-2 TRUST ANCHOR (inherited structurally). `verifySaml` builds
 * `new SignedXml({ publicCert: certPem })` and NEVER passes `getCertFromKeyInfo`
 * — xml-crypto then falls back to `publicCert`, so the caller's certificate is
 * the only trust anchor and a KeyInfo-embedded certificate is decorative.
 *
 * E-3 XSW (additive — WSSE has none). After a cryptographically valid
 * signature we still assert WHICH element was signed: exactly one Reference,
 * whose `#ID` resolves BY ID to the element enclosing the signature, which must
 * itself be the document's active Response/Assertion. Documents with more than
 * one `ds:Signature`, or with duplicate ID values, are rejected outright. The
 * signature is located through the DOM (scoped to its parent element), never by
 * a first-match regex.
 *
 * E-4 ALGORITHM ALLOWLIST (new — no WSSE precedent). `SignedInfo/SignatureMethod`
 * is read from the parsed document and rejected unless it is RSA or ECDSA,
 * BEFORE `checkSignature` runs. HMAC above all: an HMAC algorithm turns the
 * caller's PUBLIC certificate into a shared secret (key confusion).
 * Canonicalization + transform allowlists reject `#WithComments`, XSLT and XPath.
 *
 * E-5 DTD/XXE (caller-side). xml-crypto 6.1.2 parses with a plain xmldom
 * `DOMParser` and exposes no knob, so any input carrying a DOCTYPE/DTD is
 * rejected as a STRING before it reaches xml-crypto or our own parser — and the
 * same guard is re-applied to decoded Redirect/POST payloads.
 *
 * E-6 No ESM-in-main risk: `xml-crypto`, `@xmldom/xmldom`, `node:crypto` and
 * `node:zlib` are CJS/builtin. Do not add a non-CJS dependency here.
 *
 * FAIL LOUD everywhere: builders/sign/encode throw with an actionable message;
 * `verifySaml` NEVER throws — it returns `{ valid: false, reason, checks }` so
 * the caller can report exactly which check failed.
 */

import * as crypto from 'node:crypto'
import * as zlib from 'node:zlib'
import { SignedXml } from 'xml-crypto'
import { DOMParser } from '@xmldom/xmldom'
import type {
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom'
// TYPE-ONLY (erased at build): the engine stays pure — no keystore bridge, no
// DB, no IPC in this module's runtime graph.
import type { MaterialSource } from '../lib/keystore-bridge'

// ─── Namespaces & well-known URIs ───────────────────────────

export const SAML_NS = 'urn:oasis:names:tc:SAML:2.0:assertion'
export const SAMLP_NS = 'urn:oasis:names:tc:SAML:2.0:protocol'
export const DS_NS = 'http://www.w3.org/2000/09/xmldsig#'
export const XS_NS = 'http://www.w3.org/2001/XMLSchema'
export const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance'

export const STATUS_SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success'
export const CONFIRMATION_BEARER = 'urn:oasis:names:tc:SAML:2.0:cm:bearer'
export const AUTHN_CTX_PASSWORD_PROTECTED =
  'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport'
export const BINDING_HTTP_POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST'
export const BINDING_HTTP_REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect'

export const NAMEID_FORMAT = {
  unspecified: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
  emailAddress: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  persistent: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  transient: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
  entity: 'urn:oasis:names:tc:SAML:2.0:nameid-format:entity',
} as const

const ENVELOPED_SIGNATURE_TRANSFORM = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const INCLUSIVE_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'

// ─── Algorithm maps (never rely on xml-crypto's RSA-SHA1 default) ───────────

export type SamlSignAlgorithm = 'RSA-SHA256' | 'RSA-SHA512' | 'ECDSA-SHA256' | 'ECDSA-SHA512'

export const SIGN_ALGO_URI: Record<SamlSignAlgorithm, string> = {
  'RSA-SHA256': 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  'RSA-SHA512': 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
  'ECDSA-SHA256': 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256',
  'ECDSA-SHA512': 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512',
}

export const HASH_ALGO_URI: Record<SamlSignAlgorithm, string> = {
  'RSA-SHA256': 'http://www.w3.org/2001/04/xmlenc#sha256',
  'RSA-SHA512': 'http://www.w3.org/2001/04/xmlenc#sha512',
  'ECDSA-SHA256': 'http://www.w3.org/2001/04/xmlenc#sha256',
  'ECDSA-SHA512': 'http://www.w3.org/2001/04/xmlenc#sha512',
}

/**
 * E-4 — the ONLY SignatureMethod URIs `verifySaml` will act on. RSA + ECDSA
 * only. HMAC is deliberately absent: xml-crypto would happily key an HMAC with
 * the caller's public certificate, turning "trusted cert" into "shared secret".
 * DSA is absent too (SHA-1-bound, no consumer).
 */
export const ALLOWED_SIGNATURE_METHODS: ReadonlySet<string> = new Set<string>([
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256',
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512',
])

/**
 * DigestMethod allowlist. Without this the digest algorithm was READ into the
 * report and never checked, so a SHA-1 digest sailed through under an RS256
 * signature — the collision-prone half of the pair going unnoticed because only
 * the signature URI was inspected. Same SHA-1 reasoning as above.
 *
 * NOTE on the sha384 URIs that used to sit in the signature list: xml-crypto
 * ships no RsaSha384 implementation and no SHA-384 hash, so advertising them
 * produced a misleading "signature-value" failure instead of a clean algorithm
 * rejection. They are out until the implementation exists.
 */
export const ALLOWED_DIGEST_METHODS: ReadonlySet<string> = new Set<string>([
  'http://www.w3.org/2001/04/xmlenc#sha256',
  'http://www.w3.org/2001/04/xmldsig-more#sha384',
  'http://www.w3.org/2001/04/xmlenc#sha512',
])

/** Canonicalization allowlist — `#WithComments` variants are rejected. */
export const ALLOWED_CANONICALIZATION: ReadonlySet<string> = new Set<string>([
  EXC_C14N,
  INCLUSIVE_C14N,
])

/** Reference transform allowlist — no XSLT, no XPath, no `#WithComments`. */
export const ALLOWED_TRANSFORMS: ReadonlySet<string> = new Set<string>([
  ENVELOPED_SIGNATURE_TRANSFORM,
  EXC_C14N,
  INCLUSIVE_C14N,
])

// ─── Extra signature algorithms (xml-crypto ships RSA-SHA1/256/512 only) ────

interface SignatureAlgorithmLike {
  getSignature(signedInfo: crypto.BinaryLike, privateKey: crypto.KeyLike): string
  verifySignature(material: string, key: crypto.KeyLike, signatureValue: string): boolean
  getAlgorithmName(): string
}

/**
 * XML-DSig ECDSA signature values are raw R‖S (IEEE-P1363), NOT DER — hence the
 * explicit `dsaEncoding`. Without it we would emit DER blobs no other SAML
 * implementation could verify.
 */
function toPrivateKeyObject(key: crypto.KeyLike): crypto.KeyObject {
  if (typeof key === 'string' || Buffer.isBuffer(key)) return crypto.createPrivateKey(key)
  return key
}

function toPublicKeyObject(key: crypto.KeyLike): crypto.KeyObject {
  if (typeof key === 'string' || Buffer.isBuffer(key)) {
    const text = typeof key === 'string' ? key : key.toString('utf8')
    if (text.includes('BEGIN CERTIFICATE')) return new crypto.X509Certificate(text).publicKey
    return crypto.createPublicKey(key)
  }
  return key.type === 'private' ? crypto.createPublicKey(key) : key
}

function makeEcdsaAlgorithm(nodeHash: string, uri: string): new () => SignatureAlgorithmLike {
  return class EcdsaAlgorithm implements SignatureAlgorithmLike {
    getSignature(signedInfo: crypto.BinaryLike, privateKey: crypto.KeyLike): string {
      const signer = crypto.createSign(nodeHash)
      signer.update(signedInfo)
      return signer.sign(
        { key: toPrivateKeyObject(privateKey), dsaEncoding: 'ieee-p1363' },
        'base64',
      )
    }
    verifySignature(material: string, key: crypto.KeyLike, signatureValue: string): boolean {
      const verifier = crypto.createVerify(nodeHash)
      verifier.update(material)
      return verifier.verify(
        { key: toPublicKeyObject(key), dsaEncoding: 'ieee-p1363' },
        signatureValue,
        'base64',
      )
    }
    getAlgorithmName(): string {
      return uri
    }
  }
}

const EXTRA_SIGNATURE_ALGORITHMS: Record<string, new () => SignatureAlgorithmLike> = {
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256': makeEcdsaAlgorithm(
    'SHA256',
    'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256',
  ),
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384': makeEcdsaAlgorithm(
    'SHA384',
    'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384',
  ),
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512': makeEcdsaAlgorithm(
    'SHA512',
    'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512',
  ),
}

/**
 * Register ECDSA on a `SignedXml` instance. HMAC is NEVER registered — the
 * default registry omits it for key-confusion reasons and we keep it that way.
 */
function registerExtraAlgorithms(sig: SignedXml): void {
  const registry = sig.SignatureAlgorithms as unknown as Record<
    string,
    new () => SignatureAlgorithmLike
  >
  for (const [uri, ctor] of Object.entries(EXTRA_SIGNATURE_ALGORITHMS)) {
    registry[uri] = ctor
  }
}

// ─── Types ──────────────────────────────────────────────────

export type SamlAttributeValue = string | number | boolean | Date

export interface SamlAttribute {
  name: string
  nameFormat?: string
  friendlyName?: string
  values: SamlAttributeValue[]
  /** Explicit `xsi:type` (e.g. `xs:string`). Inferred from the value otherwise. */
  valueType?: string
}

/** Deterministic-output knobs shared by every builder (byte-exact tests). */
interface DeterministicBuildFields {
  /** Injectable document ID. Generated (`_<32 hex>`) when absent. */
  id?: string
  /** Injectable IssueInstant. `now` (or the current clock) when absent. */
  issueInstant?: string | Date
  /** Injectable clock used for every derived timestamp. */
  now?: string | Date
}

export interface SamlAuthnRequestConfig extends DeterministicBuildFields {
  issuer: string
  destination?: string
  assertionConsumerServiceURL?: string
  protocolBinding?: string
  nameIdFormat?: string
  allowCreate?: boolean
  forceAuthn?: boolean
  isPassive?: boolean
  authnContextClassRef?: string
  comparison?: 'exact' | 'minimum' | 'maximum' | 'better'
}

export interface SamlSubjectConfig {
  nameId: string
  nameIdFormat?: string
  nameQualifier?: string
  spNameQualifier?: string
  /** SubjectConfirmationData/@Recipient — usually the SP ACS URL. */
  recipient?: string
  /** SubjectConfirmationData/@InResponseTo. */
  inResponseTo?: string
  confirmationMethod?: string
  /** Seconds after `now` for SubjectConfirmationData/@NotOnOrAfter (default 300). */
  confirmationNotOnOrAfterSeconds?: number
}

export interface SamlAssertionConfig extends DeterministicBuildFields {
  issuer: string
  subject: SamlSubjectConfig
  audience?: string | string[]
  /** Seconds BEFORE `now` for Conditions/@NotBefore (clock-skew tolerance, default 60). */
  notBeforeSkewSeconds?: number
  /** Seconds AFTER `now` for Conditions/@NotOnOrAfter (default 300). */
  notOnOrAfterSeconds?: number
  sessionIndex?: string
  authnInstant?: string | Date
  authnContextClassRef?: string
  /** Omit the AuthnStatement entirely (attribute-only assertions). */
  includeAuthnStatement?: boolean
  attributes?: SamlAttribute[]
}

export interface SamlResponseConfig extends DeterministicBuildFields {
  issuer: string
  destination?: string
  inResponseTo?: string
  statusCode?: string
  statusSubCode?: string
  statusMessage?: string
  /** Pre-built (possibly already signed) assertion XML. Takes precedence. */
  assertionXml?: string
  /** Build the assertion inline instead. */
  assertion?: SamlAssertionConfig
}

export interface SamlDocument {
  xml: string
  id: string
  issueInstant: string
  /** Present on `buildResponse` when the assertion was built inline. */
  assertionId?: string
}

export type SamlSignatureTarget = 'assertion' | 'response' | 'root'

export interface SamlSignConfig {
  /**
   * PEM private key. OPTIONAL because a `keySource` may stand in for it — the
   * ORCHESTRATION layer resolves that BEFORE calling `signSaml`. This engine
   * stays pure and never resolves a `keySource` itself.
   */
  privateKeyPem?: string
  /** PEM certificate. OPTIONAL for the same reason as `privateKeyPem`. */
  certPem?: string
  algorithm: SamlSignAlgorithm
  /** Which element gets the enveloped signature. Default `'root'`. */
  signatureTarget?: SamlSignatureTarget
  /** Explicit ID of the element to sign. Defaults to the target's `ID`. */
  referenceId?: string
  /**
   * Opaque key-material reference (#60) — ids / paths / pasted PEM only, never
   * key bytes. Resolved in MAIN by the orchestration layer; this pure engine
   * deliberately ignores it.
   */
  keySource?: MaterialSource
}

export interface SamlVerifyOptions {
  /** The signature MUST cover exactly this element ID. */
  requireSignedId?: string
  /** The document's active Assertion must itself be the signed element. */
  requireAssertionSigned?: boolean
  /** Clock for the temporal checks. Defaults to the current time. */
  now?: string | Date
  /** Tolerance applied to NotBefore/NotOnOrAfter, in seconds (default 60). */
  clockSkewSeconds?: number
  /** Validate Conditions NotBefore/NotOnOrAfter when present (default true). */
  validateConditions?: boolean
  /** When set, an AudienceRestriction must list this audience. */
  expectedAudience?: string
  /** When set, Response/@InResponseTo (or SubjectConfirmationData) must match. */
  expectedInResponseTo?: string
}

export interface SamlVerifyCheck {
  name: string
  ok: boolean
  detail?: string
}

export interface SamlVerifyResult {
  valid: boolean
  reason?: string
  /** Element IDs the signature cryptographically covers. */
  signedReferences: string[]
  /** Canonical XML of each validated reference — the ONLY trustworthy content. */
  signedContent: string[]
  signedElement?: { id: string; localName: string }
  signatureMethod?: string
  digestMethod?: string
  canonicalizationMethod?: string
  certInfo?: {
    subject?: string
    issuer?: string
    notBefore?: string
    notAfter?: string
  }
  conditions?: { notBefore?: string; notOnOrAfter?: string; audiences: string[] }
  subject?: { nameId?: string; format?: string }
  /** Every check that ran, in order — the "why did it fail" report. */
  checks: SamlVerifyCheck[]
}

// ─── Small utilities ────────────────────────────────────────

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function hasText(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** `_` + 32 hex chars — a valid xs:ID/NCName that never starts with a digit. */
export function generateSamlId(): string {
  return `_${crypto.randomBytes(16).toString('hex')}`
}

/** SAML IDs must be NCNames; this also makes the signing XPaths injection-proof. */
const NCNAME_RE = /^[A-Za-z_][A-Za-z0-9._-]*$/

export function isValidSamlId(id: string): boolean {
  return typeof id === 'string' && NCNAME_RE.test(id)
}

function toDate(value: string | Date | undefined, fallback: Date): Date {
  if (value instanceof Date) return value
  if (hasText(value)) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
    throw new Error(`Invalid SAML timestamp: ${value}`)
  }
  return fallback
}

/** `2026-01-01T00:00:00Z` — UTC, no fractional seconds (deterministic). */
export function toSamlInstant(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function pemToBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
}

function extractCertInfo(certPem: string): SamlVerifyResult['certInfo'] {
  try {
    const cert = new crypto.X509Certificate(certPem)
    return {
      subject: cert.subject,
      issuer: cert.issuer,
      notBefore: cert.validFrom,
      notAfter: cert.validTo,
    }
  } catch {
    return undefined
  }
}

/**
 * E-5 — DOCTYPE/DTD rejection. xml-crypto 6.1.2 parses with a bare xmldom
 * `DOMParser`; there is NO option to disable DTD processing, so the only place
 * to stop an XXE / billion-laughs payload is BEFORE parsing, as a string.
 */
export function assertNoDoctype(xml: string, label = 'SAML document'): void {
  if (typeof xml !== 'string' || xml.trim().length === 0) {
    throw new Error(`${label} is empty`)
  }
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error(
      `${label} contains a DOCTYPE/DTD declaration and was rejected before parsing (XXE / entity-expansion defense)`,
    )
  }
}

// ─── XML builders ───────────────────────────────────────────

function attr(name: string, value: string | undefined): string {
  return hasText(value) ? ` ${name}="${escapeXml(value)}"` : ''
}

function requireText(value: string | undefined, field: string): string {
  if (!hasText(value)) throw new Error(`SAML build: "${field}" is required`)
  return value
}

function resolveId(id: string | undefined): string {
  if (id === undefined) return generateSamlId()
  if (!isValidSamlId(id)) {
    throw new Error(`SAML build: "${id}" is not a valid ID (must be an XML NCName)`)
  }
  return id
}

function inferValueType(value: SamlAttributeValue): string {
  if (typeof value === 'boolean') return 'xs:boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'xs:integer' : 'xs:decimal'
  if (value instanceof Date) return 'xs:dateTime'
  return 'xs:string'
}

function renderValue(value: SamlAttributeValue): string {
  if (value instanceof Date) return toSamlInstant(value)
  return escapeXml(String(value))
}

function buildAttributeStatement(attributes: SamlAttribute[]): string {
  const items = attributes.map((a) => {
    const name = requireText(a.name, 'attribute.name')
    const values = (a.values ?? [])
      .map(
        (v) =>
          `<saml:AttributeValue xsi:type="${escapeXml(a.valueType ?? inferValueType(v))}">${renderValue(v)}</saml:AttributeValue>`,
      )
      .join('')
    return (
      `<saml:Attribute${attr('Name', name)}${attr('NameFormat', a.nameFormat)}${attr('FriendlyName', a.friendlyName)}>` +
      `${values}</saml:Attribute>`
    )
  })
  return (
    `<saml:AttributeStatement xmlns:xs="${XS_NS}" xmlns:xsi="${XSI_NS}">` +
    `${items.join('')}</saml:AttributeStatement>`
  )
}

/** `<samlp:AuthnRequest>` — the SP→IdP request. */
export function buildAuthnRequest(config: SamlAuthnRequestConfig): SamlDocument {
  const issuer = requireText(config.issuer, 'issuer')
  const id = resolveId(config.id)
  const now = toDate(config.now, new Date())
  const issueInstant = toSamlInstant(toDate(config.issueInstant, now))

  const nameIdPolicy = hasText(config.nameIdFormat)
    ? `<samlp:NameIDPolicy${attr('Format', config.nameIdFormat)}` +
      `${config.allowCreate === undefined ? '' : ` AllowCreate="${config.allowCreate ? 'true' : 'false'}"`}/>`
    : ''

  const requestedContext = hasText(config.authnContextClassRef)
    ? `<samlp:RequestedAuthnContext Comparison="${escapeXml(config.comparison ?? 'exact')}">` +
      `<saml:AuthnContextClassRef>${escapeXml(config.authnContextClassRef)}</saml:AuthnContextClassRef>` +
      `</samlp:RequestedAuthnContext>`
    : ''

  const xml =
    `<samlp:AuthnRequest xmlns:samlp="${SAMLP_NS}" xmlns:saml="${SAML_NS}"` +
    ` ID="${id}" Version="2.0" IssueInstant="${issueInstant}"` +
    `${attr('Destination', config.destination)}` +
    `${attr('AssertionConsumerServiceURL', config.assertionConsumerServiceURL)}` +
    `${attr('ProtocolBinding', config.protocolBinding)}` +
    `${config.forceAuthn === undefined ? '' : ` ForceAuthn="${config.forceAuthn ? 'true' : 'false'}"`}` +
    `${config.isPassive === undefined ? '' : ` IsPassive="${config.isPassive ? 'true' : 'false'}"`}>` +
    `<saml:Issuer>${escapeXml(issuer)}</saml:Issuer>` +
    nameIdPolicy +
    requestedContext +
    `</samlp:AuthnRequest>`

  return { xml, id, issueInstant }
}

/** `<saml:Assertion>` — Subject + Conditions + AuthnStatement + Attributes. */
export function buildAssertion(config: SamlAssertionConfig): SamlDocument {
  const issuer = requireText(config.issuer, 'issuer')
  if (!config.subject || !hasText(config.subject.nameId)) {
    throw new Error('SAML build: "subject.nameId" is required')
  }
  const id = resolveId(config.id)
  const now = toDate(config.now, new Date())
  const issueInstant = toSamlInstant(toDate(config.issueInstant, now))

  const notBefore = toSamlInstant(
    new Date(now.getTime() - (config.notBeforeSkewSeconds ?? 60) * 1000),
  )
  const notOnOrAfter = toSamlInstant(
    new Date(now.getTime() + (config.notOnOrAfterSeconds ?? 300) * 1000),
  )
  const confirmationNotOnOrAfter = toSamlInstant(
    new Date(now.getTime() + (config.subject.confirmationNotOnOrAfterSeconds ?? 300) * 1000),
  )

  const subject =
    `<saml:Subject>` +
    `<saml:NameID${attr('Format', config.subject.nameIdFormat)}` +
    `${attr('NameQualifier', config.subject.nameQualifier)}` +
    `${attr('SPNameQualifier', config.subject.spNameQualifier)}>` +
    `${escapeXml(config.subject.nameId)}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="${escapeXml(config.subject.confirmationMethod ?? CONFIRMATION_BEARER)}">` +
    `<saml:SubjectConfirmationData NotOnOrAfter="${confirmationNotOnOrAfter}"` +
    `${attr('Recipient', config.subject.recipient)}` +
    `${attr('InResponseTo', config.subject.inResponseTo)}/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>`

  const audiences = config.audience
    ? Array.isArray(config.audience)
      ? config.audience
      : [config.audience]
    : []
  const audienceRestriction =
    audiences.length > 0
      ? `<saml:AudienceRestriction>${audiences
          .map((a) => `<saml:Audience>${escapeXml(a)}</saml:Audience>`)
          .join('')}</saml:AudienceRestriction>`
      : ''

  const conditions =
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
    `${audienceRestriction}</saml:Conditions>`

  const authnStatement =
    config.includeAuthnStatement === false
      ? ''
      : `<saml:AuthnStatement AuthnInstant="${toSamlInstant(toDate(config.authnInstant, now))}"` +
        `${attr('SessionIndex', config.sessionIndex)}>` +
        `<saml:AuthnContext><saml:AuthnContextClassRef>` +
        `${escapeXml(config.authnContextClassRef ?? AUTHN_CTX_PASSWORD_PROTECTED)}` +
        `</saml:AuthnContextClassRef></saml:AuthnContext>` +
        `</saml:AuthnStatement>`

  const attributeStatement =
    config.attributes && config.attributes.length > 0
      ? buildAttributeStatement(config.attributes)
      : ''

  const xml =
    `<saml:Assertion xmlns:saml="${SAML_NS}" ID="${id}" Version="2.0" IssueInstant="${issueInstant}">` +
    `<saml:Issuer>${escapeXml(issuer)}</saml:Issuer>` +
    subject +
    conditions +
    authnStatement +
    attributeStatement +
    `</saml:Assertion>`

  return { xml, id, issueInstant }
}

/**
 * `<samlp:Response>` (AuthnResponse) wrapping an Assertion.
 *
 * `assertionXml` is embedded VERBATIM — that is how a response carries an
 * already-signed assertion without disturbing its digest.
 */
export function buildResponse(config: SamlResponseConfig): SamlDocument {
  const issuer = requireText(config.issuer, 'issuer')
  const id = resolveId(config.id)
  const now = toDate(config.now, new Date())
  const issueInstant = toSamlInstant(toDate(config.issueInstant, now))

  let assertionXml = ''
  let assertionId: string | undefined
  if (hasText(config.assertionXml)) {
    assertNoDoctype(config.assertionXml, 'SAML assertion')
    assertionXml = config.assertionXml.trim()
  } else if (config.assertion) {
    const built = buildAssertion({ now, ...config.assertion })
    assertionXml = built.xml
    assertionId = built.id
  }
  // A nested assertion keeps its own xmlns:saml declaration, so the Response
  // only needs the protocol namespace plus saml for its own Issuer.

  const status =
    `<samlp:Status><samlp:StatusCode Value="${escapeXml(config.statusCode ?? STATUS_SUCCESS)}">` +
    `${hasText(config.statusSubCode) ? `<samlp:StatusCode Value="${escapeXml(config.statusSubCode)}"/>` : ''}` +
    `</samlp:StatusCode>` +
    `${hasText(config.statusMessage) ? `<samlp:StatusMessage>${escapeXml(config.statusMessage)}</samlp:StatusMessage>` : ''}` +
    `</samlp:Status>`

  const xml =
    `<samlp:Response xmlns:samlp="${SAMLP_NS}" xmlns:saml="${SAML_NS}"` +
    ` ID="${id}" Version="2.0" IssueInstant="${issueInstant}"` +
    `${attr('Destination', config.destination)}` +
    `${attr('InResponseTo', config.inResponseTo)}>` +
    `<saml:Issuer>${escapeXml(issuer)}</saml:Issuer>` +
    status +
    assertionXml +
    `</samlp:Response>`

  return { xml, id, issueInstant, assertionId }
}

// ─── DOM helpers (no XPath — exact, injection-free traversal) ───────────────

function parseXml(xml: string): XmlDocument {
  const errors: string[] = []
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level === 'error' || level === 'fatalError') errors.push(message)
    },
  })
  let doc: XmlDocument
  try {
    doc = parser.parseFromString(xml, 'text/xml')
  } catch (e) {
    throw new Error(`XML is not well-formed: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!doc.documentElement) throw new Error('XML is not well-formed: no document element')
  if (errors.length > 0) throw new Error(`XML is not well-formed: ${errors[0]}`)
  return doc
}

const ELEMENT_NODE = 1

function isElement(node: XmlNode | null | undefined): node is XmlElement {
  return !!node && node.nodeType === ELEMENT_NODE
}

function elementChildren(parent: XmlElement | XmlDocument): XmlElement[] {
  const out: XmlElement[] = []
  const kids = parent.childNodes
  for (let i = 0; i < kids.length; i++) {
    const kid = kids.item(i)
    if (isElement(kid)) out.push(kid)
  }
  return out
}

function walkElements(root: XmlElement): XmlElement[] {
  const out: XmlElement[] = []
  const stack: XmlElement[] = [root]
  while (stack.length > 0) {
    const current = stack.pop() as XmlElement
    out.push(current)
    const kids = elementChildren(current)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
  return out
}

/** xml-crypto's default `idAttributes` — mirror them exactly for the ID checks. */
const ID_ATTRIBUTES = ['Id', 'ID', 'id'] as const

function idOf(el: XmlElement): string | null {
  for (const name of ID_ATTRIBUTES) {
    const value = el.getAttribute(name)
    if (hasText(value)) return value
  }
  return null
}

function localName(el: XmlElement): string {
  return el.localName ?? el.nodeName.replace(/^.*:/, '')
}

function isNamed(el: XmlElement, ns: string, name: string): boolean {
  return el.namespaceURI === ns && localName(el) === name
}

function firstChildNamed(parent: XmlElement, ns: string, name: string): XmlElement | undefined {
  return elementChildren(parent).find((c) => isNamed(c, ns, name))
}

/** Direct children with this qualified name — siblings, not descendants. */
function childrenNamed(parent: XmlElement, ns: string, name: string): XmlElement[] {
  return elementChildren(parent).filter((c) => isNamed(c, ns, name))
}

function firstDescendantNamed(root: XmlElement, ns: string, name: string): XmlElement | undefined {
  return walkElements(root).find((c) => isNamed(c, ns, name))
}

function textOf(el: XmlElement | undefined): string | undefined {
  if (!el) return undefined
  const text = el.textContent
  return typeof text === 'string' ? text.trim() : undefined
}

// ─── Signing ────────────────────────────────────────────────

function findSignTarget(doc: XmlDocument, target: SamlSignatureTarget): XmlElement {
  const root = doc.documentElement
  if (!root) throw new Error('SAML sign: document has no root element')
  if (target === 'root') return root
  if (target === 'assertion') {
    const assertion = isNamed(root, SAML_NS, 'Assertion')
      ? root
      : firstDescendantNamed(root, SAML_NS, 'Assertion')
    if (!assertion) throw new Error('SAML sign: no <saml:Assertion> found to sign')
    return assertion
  }
  const response = isNamed(root, SAMLP_NS, 'Response')
    ? root
    : firstDescendantNamed(root, SAMLP_NS, 'Response')
  if (!response) throw new Error('SAML sign: no <samlp:Response> found to sign')
  return response
}

/**
 * Enveloped XML-DSig over a SAML element (E-1).
 *
 * The `ds:Signature` lands immediately AFTER the target's `saml:Issuer`, which
 * is where the SAML 2.0 schema requires it.
 */
export function signSaml(xml: string, config: SamlSignConfig): string {
  assertNoDoctype(xml, 'SAML document to sign')

  // FAIL LOUD. `privateKeyPem`/`certPem` are optional so a `keySource` can stand
  // in for them, but the orchestration layer must have resolved it before we get
  // here. Reaching this point with neither is a config gap, not a reason to emit
  // a silently unsigned document.
  const certPem = config.certPem
  const privateKeyPem = config.privateKeyPem
  if (!hasText(certPem) || !hasText(privateKeyPem)) {
    throw new Error(
      'SAML signing requires a certificate and a private key — paste both PEMs or select key material from the keystore.',
    )
  }

  const signatureAlgorithm = SIGN_ALGO_URI[config.algorithm]
  const digestAlgorithm = HASH_ALGO_URI[config.algorithm]
  if (!signatureAlgorithm || !digestAlgorithm) {
    throw new Error(`SAML signing: unsupported algorithm "${String(config.algorithm)}"`)
  }

  const doc = parseXml(xml)
  const root = doc.documentElement
  if (!root) throw new Error('SAML sign: document has no root element')
  const target = findSignTarget(doc, config.signatureTarget ?? 'root')

  const referenceId = config.referenceId ?? idOf(target) ?? undefined
  if (referenceId === undefined) {
    throw new Error(
      `SAML signing: the ${localName(target)} element has no ID attribute — provide config.referenceId`,
    )
  }
  if (!isValidSamlId(referenceId)) {
    throw new Error(`SAML signing: "${referenceId}" is not a valid ID (must be an XML NCName)`)
  }
  const targetId = idOf(target)
  if (targetId !== null && targetId !== referenceId) {
    throw new Error(
      `SAML signing: referenceId "${referenceId}" does not match the ${localName(target)} ID "${targetId}"`,
    )
  }
  // Refuse to sign an ambiguous document: two elements sharing the ID would make
  // "what was signed" undecidable for every verifier downstream.
  const duplicates = walkElements(root).filter((el) => idOf(el) === referenceId)
  if (duplicates.length > 1) {
    throw new Error(
      `SAML signing: document contains ${duplicates.length} elements with ID "${referenceId}"`,
    )
  }

  const certBase64 = pemToBase64(certPem)
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
    signatureAlgorithm,
    canonicalizationAlgorithm: EXC_C14N,
    // NO `idMode` — xml-crypto's default idAttributes already cover SAML's `ID`.
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`,
  })
  registerExtraAlgorithms(sig)

  sig.addReference({
    xpath: `//*[@ID='${referenceId}']`,
    uri: `#${referenceId}`,
    transforms: [ENVELOPED_SIGNATURE_TRANSFORM, EXC_C14N],
    digestAlgorithm,
  })

  // Scope the insertion point to the SIGNED element's own Issuer — a bare
  // `//*[local-name(.)='Issuer']` would hit the Response's Issuer when signing
  // an Assertion nested inside a Response.
  const hasIssuer = !!firstChildNamed(target, SAML_NS, 'Issuer')
  const location = hasIssuer
    ? {
        reference: `(//*[@ID='${referenceId}']/*[local-name(.)='Issuer'])[1]`,
        action: 'after' as const,
      }
    : { reference: `//*[@ID='${referenceId}']`, action: 'prepend' as const }

  sig.computeSignature(xml, { location, prefix: 'ds' })
  return sig.getSignedXml()
}

// ─── Verification ───────────────────────────────────────────

/** The node type `SignedXml.loadSignature` accepts (lib.dom `Node` upstream). */
type SignatureNodeArg = Parameters<SignedXml['loadSignature']>[0]

class CheckLog {
  readonly checks: SamlVerifyCheck[] = []

  pass(name: string, detail?: string): void {
    this.checks.push({ name, ok: true, detail })
  }

  fail(name: string, detail: string): SamlVerifyCheck {
    const check: SamlVerifyCheck = { name, ok: false, detail }
    this.checks.push(check)
    return check
  }
}

function failure(
  log: CheckLog,
  name: string,
  detail: string,
  extra: Partial<SamlVerifyResult> = {},
): SamlVerifyResult {
  log.fail(name, detail)
  return {
    valid: false,
    reason: detail,
    signedReferences: [],
    signedContent: [],
    checks: log.checks,
    ...extra,
  }
}

interface SignedInfoFacts {
  canonicalizationMethod?: string
  signatureMethod?: string
  digestMethod?: string
  referenceUris: string[]
  transforms: string[]
}

function readSignedInfo(signature: XmlElement): SignedInfoFacts {
  const signedInfo = firstChildNamed(signature, DS_NS, 'SignedInfo')
  const facts: SignedInfoFacts = { referenceUris: [], transforms: [] }
  if (!signedInfo) return facts
  const c14n = firstChildNamed(signedInfo, DS_NS, 'CanonicalizationMethod')
  facts.canonicalizationMethod = c14n?.getAttribute('Algorithm') ?? undefined
  const method = firstChildNamed(signedInfo, DS_NS, 'SignatureMethod')
  facts.signatureMethod = method?.getAttribute('Algorithm') ?? undefined
  for (const ref of elementChildren(signedInfo).filter((c) => isNamed(c, DS_NS, 'Reference'))) {
    facts.referenceUris.push(ref.getAttribute('URI') ?? '')
    const digest = firstChildNamed(ref, DS_NS, 'DigestMethod')
    if (facts.digestMethod === undefined) {
      facts.digestMethod = digest?.getAttribute('Algorithm') ?? undefined
    }
    const transforms = firstChildNamed(ref, DS_NS, 'Transforms')
    if (transforms) {
      for (const t of elementChildren(transforms).filter((c) => isNamed(c, DS_NS, 'Transform'))) {
        facts.transforms.push(t.getAttribute('Algorithm') ?? '')
      }
    }
  }
  return facts
}

/**
 * The elements a signature is ALLOWED to cover: the document root, and (for a
 * `samlp:Response`) the response's ACTIVE assertion — the first direct-child
 * `saml:Assertion`, i.e. the one a consumer would actually read. A signature
 * over anything else (an assertion tucked inside `<Extensions>`, a wrapper, an
 * old copy) is XML Signature Wrapping.
 */
function trustableElements(root: XmlElement): {
  allowed: XmlElement[]
  activeAssertion?: XmlElement
} {
  if (isNamed(root, SAMLP_NS, 'Response')) {
    const activeAssertion = firstChildNamed(root, SAML_NS, 'Assertion')
    return { allowed: activeAssertion ? [root, activeAssertion] : [root], activeAssertion }
  }
  if (isNamed(root, SAML_NS, 'Assertion')) {
    return { allowed: [root], activeAssertion: root }
  }
  return { allowed: [root] }
}

function collectConditions(assertion: XmlElement | undefined): {
  element?: XmlElement
  notBefore?: string
  notOnOrAfter?: string
  audiences: string[]
} {
  if (!assertion) return { audiences: [] }
  const conditions = firstChildNamed(assertion, SAML_NS, 'Conditions')
  if (!conditions) return { audiences: [] }
  const audiences: string[] = []
  for (const restriction of elementChildren(conditions).filter((c) =>
    isNamed(c, SAML_NS, 'AudienceRestriction'),
  )) {
    for (const audience of elementChildren(restriction).filter((c) =>
      isNamed(c, SAML_NS, 'Audience'),
    )) {
      const value = textOf(audience)
      if (value !== undefined) audiences.push(value)
    }
  }
  return {
    element: conditions,
    notBefore: conditions.getAttribute('NotBefore') ?? undefined,
    notOnOrAfter: conditions.getAttribute('NotOnOrAfter') ?? undefined,
    audiences,
  }
}

/**
 * Verify an enveloped SAML signature.
 *
 * NEVER throws — every rejection comes back as `{ valid: false, reason, checks }`
 * so the caller can say exactly WHICH guarantee failed.
 */
export function verifySaml(
  xml: string,
  certPem: string,
  options: SamlVerifyOptions = {},
): SamlVerifyResult {
  const log = new CheckLog()
  const certInfo = extractCertInfo(certPem)

  if (!hasText(certPem)) {
    return failure(log, 'trust-anchor', 'No verification certificate was supplied')
  }
  if (!certInfo) {
    return failure(
      log,
      'trust-anchor',
      'The verification certificate is not a valid PEM X.509 certificate',
    )
  }
  log.pass('trust-anchor', 'Trust anchor is the caller-supplied certificate (KeyInfo is ignored)')

  // E-5 — DOCTYPE rejected as a string, before ANY parser sees it.
  try {
    assertNoDoctype(xml, 'SAML document')
    log.pass('doctype')
  } catch (e) {
    return failure(log, 'doctype', e instanceof Error ? e.message : String(e), { certInfo })
  }

  let doc: XmlDocument
  try {
    doc = parseXml(xml)
    log.pass('well-formed')
  } catch (e) {
    return failure(log, 'well-formed', e instanceof Error ? e.message : String(e), { certInfo })
  }

  const root = doc.documentElement
  if (!root) {
    return failure(log, 'well-formed', 'XML is not well-formed: no document element', { certInfo })
  }
  const allElements = walkElements(root)

  // E-3a — duplicate IDs make "which element was signed" undecidable.
  const idCounts = new Map<string, number>()
  for (const el of allElements) {
    const id = idOf(el)
    if (id !== null) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }
  const duplicated = [...idCounts.entries()].filter(([, count]) => count > 1)
  if (duplicated.length > 0) {
    return failure(
      log,
      'unique-ids',
      `Document contains duplicate ID ${duplicated
        .map(([id, count]) => `"${id}" (${count} elements)`)
        .join(', ')} — rejected as an XML Signature Wrapping attempt`,
      { certInfo },
    )
  }
  log.pass('unique-ids')

  // E-3b — DOM-scoped signature discovery. No first-match regex: we need the
  // COUNT and the exact parent element, both of which a regex cannot give.
  const signatures = allElements.filter((el) => isNamed(el, DS_NS, 'Signature'))
  if (signatures.length === 0) {
    return failure(
      log,
      'signature-present',
      'No ds:Signature element found — the document is unsigned',
      {
        certInfo,
      },
    )
  }
  if (signatures.length > 1) {
    return failure(
      log,
      'single-signature',
      `Document contains ${signatures.length} ds:Signature elements — rejected as an XML Signature Wrapping attempt`,
      { certInfo },
    )
  }
  log.pass('signature-present')

  // E-3g — the INTERIOR of ds:Signature is structure, not a container. XML-DSig
  // allows a `ds:Object` child, and nothing about signing constrains what goes
  // in it: an attacker can append a whole `<saml:Assertion>` (or a decoy
  // SubjectConfirmationData) inside the signature element AFTER it was signed,
  // the signature still verifies, and any code that searches the document by
  // name then reads attacker-authored data. Every downstream lookup in this
  // engine is scoped, but the smuggling primitive itself is what makes those
  // scopes load-bearing — so refuse the shape outright.
  const SIGNATURE_CHILDREN = new Set(['SignedInfo', 'SignatureValue', 'KeyInfo'])
  const foreignChild = elementChildren(signatures[0]).find(
    (child) => child.namespaceURI !== DS_NS || !SIGNATURE_CHILDREN.has(localName(child)),
  )
  if (foreignChild) {
    return failure(
      log,
      'signature-structure',
      `ds:Signature contains an unexpected <${localName(foreignChild)}> child — only SignedInfo, SignatureValue and KeyInfo are accepted (a ds:Object can smuggle unsigned content past verification)`,
      { certInfo },
    )
  }
  log.pass('signature-structure')
  log.pass('single-signature')

  const signature = signatures[0]
  const facts = readSignedInfo(signature)
  const base: Partial<SamlVerifyResult> = {
    certInfo,
    signatureMethod: facts.signatureMethod,
    digestMethod: facts.digestMethod,
    canonicalizationMethod: facts.canonicalizationMethod,
  }

  // E-4 — algorithm allowlist BEFORE checkSignature. An HMAC SignatureMethod
  // would let xml-crypto key an HMAC with the caller's public certificate.
  if (!hasText(facts.signatureMethod)) {
    return failure(log, 'signature-method', 'SignedInfo has no SignatureMethod/@Algorithm', base)
  }
  if (!ALLOWED_SIGNATURE_METHODS.has(facts.signatureMethod)) {
    return failure(
      log,
      'signature-method',
      `Disallowed signature algorithm "${facts.signatureMethod}" — only RSA and ECDSA are accepted (HMAC would turn the trusted certificate into a shared secret)`,
      base,
    )
  }
  log.pass('signature-method', facts.signatureMethod)

  if (!hasText(facts.canonicalizationMethod)) {
    return failure(
      log,
      'canonicalization-method',
      'SignedInfo has no CanonicalizationMethod/@Algorithm',
      base,
    )
  }
  if (!ALLOWED_CANONICALIZATION.has(facts.canonicalizationMethod)) {
    return failure(
      log,
      'canonicalization-method',
      `Disallowed canonicalization algorithm "${facts.canonicalizationMethod}" — #WithComments and custom canonicalizations are rejected`,
      base,
    )
  }
  log.pass('canonicalization-method', facts.canonicalizationMethod)

  if (!hasText(facts.digestMethod) || !ALLOWED_DIGEST_METHODS.has(facts.digestMethod)) {
    return failure(
      log,
      'digest-method',
      `Disallowed digest algorithm "${facts.digestMethod || '(none)'}" — SHA-256 or stronger is required`,
      base,
    )
  }
  log.pass('digest-method', facts.digestMethod)

  // E-3c — exactly ONE Reference. Multiple references let an attacker pair a
  // real one with a decoy.
  if (facts.referenceUris.length !== 1) {
    return failure(
      log,
      'single-reference',
      `SignedInfo declares ${facts.referenceUris.length} Reference elements — exactly one is required`,
      base,
    )
  }
  log.pass('single-reference')

  const badTransform = facts.transforms.find((t) => !ALLOWED_TRANSFORMS.has(t))
  if (badTransform !== undefined) {
    return failure(
      log,
      'transforms',
      `Disallowed Reference transform "${badTransform}" — only enveloped-signature and c14n transforms are accepted`,
      base,
    )
  }
  if (!facts.transforms.includes(ENVELOPED_SIGNATURE_TRANSFORM)) {
    return failure(
      log,
      'transforms',
      'Reference is missing the enveloped-signature transform — the signature does not cover its own enclosing element',
      base,
    )
  }
  log.pass('transforms', facts.transforms.join(' '))

  // E-3d — the Reference URI must resolve BY ID to the element enclosing the
  // signature (that is what "enveloped" means).
  const uri = facts.referenceUris[0]
  if (!uri.startsWith('#') || uri.length < 2) {
    return failure(
      log,
      'reference-uri',
      `Reference URI "${uri}" is not a same-document "#ID" reference — empty/external URIs are rejected`,
      base,
    )
  }
  const referencedId = uri.slice(1)
  const referencedElements = allElements.filter((el) => idOf(el) === referencedId)
  if (referencedElements.length !== 1) {
    return failure(
      log,
      'reference-uri',
      `Reference URI "${uri}" resolves to ${referencedElements.length} elements — exactly one is required`,
      base,
    )
  }
  const referenced = referencedElements[0]
  const enclosing = isElement(signature.parentNode) ? signature.parentNode : undefined
  if (!enclosing || enclosing !== referenced) {
    return failure(
      log,
      'reference-target',
      `The signature is enclosed by <${enclosing ? localName(enclosing) : 'document'}> but references "${uri}" — a signature must cover its own enclosing element (XML Signature Wrapping)`,
      base,
    )
  }
  log.pass('reference-uri', uri)
  log.pass('reference-target', `${localName(referenced)}#${referencedId}`)

  // E-3e — is the signed element the one a consumer would actually TRUST?
  const { allowed, activeAssertion } = trustableElements(root)
  if (!allowed.includes(referenced)) {
    return failure(
      log,
      'signed-element-scope',
      `The signature covers <${localName(referenced)} ID="${referencedId}">, which is neither the document root nor the active Assertion — rejected as an XML Signature Wrapping attempt`,
      base,
    )
  }
  log.pass('signed-element-scope')

  // E-3f — a Response carries AT MOST ONE assertion. The scope check above
  // proves the signature covers the ACTIVE assertion, but says nothing about
  // extra siblings: a Response holding the signed assertion PLUS an unsigned
  // one still reported valid, and any consumer that iterates assertions (rather
  // than reading only the first) would trust attacker-authored content. There
  // is no legitimate reason for a signed single-assertion Response to carry a
  // second one, so refuse the document rather than hope the reader is careful.
  if (isNamed(root, SAMLP_NS, 'Response')) {
    const assertions = childrenNamed(root, SAML_NS, 'Assertion')
    if (assertions.length > 1) {
      return failure(
        log,
        'single-assertion',
        `The Response carries ${assertions.length} Assertion elements but only one is signed — rejected as an XML Signature Wrapping attempt`,
        base,
      )
    }
    log.pass('single-assertion')
  }

  if (hasText(options.requireSignedId) && options.requireSignedId !== referencedId) {
    return failure(
      log,
      'required-signed-id',
      `The signature covers "${referencedId}" but "${options.requireSignedId}" was required — rejected as an XML Signature Wrapping attempt`,
      base,
    )
  }
  if (hasText(options.requireSignedId)) log.pass('required-signed-id', options.requireSignedId)

  if (options.requireAssertionSigned === true) {
    const assertionId = activeAssertion ? idOf(activeAssertion) : null
    if (!activeAssertion) {
      return failure(
        log,
        'assertion-signed',
        'requireAssertionSigned: the document contains no Assertion',
        base,
      )
    }
    if (activeAssertion !== referenced) {
      return failure(
        log,
        'assertion-signed',
        `requireAssertionSigned: the Assertion "${assertionId ?? '(no ID)'}" is not among the signed references (only "${referencedId}" is signed)`,
        base,
      )
    }
    log.pass('assertion-signed', assertionId ?? undefined)
  }

  // E-2 — trust anchor: `publicCert` ONLY, `getCertFromKeyInfo` deliberately
  // NOT passed, so xml-crypto falls back to the caller's certificate.
  const verifier = new SignedXml({ publicCert: certPem })
  registerExtraAlgorithms(verifier)
  let cryptoValid = false
  try {
    // xml-crypto types the argument as a lib.dom `Node`; the main tsconfig has
    // no DOM lib, so derive the parameter type instead of naming it.
    verifier.loadSignature(signature as unknown as SignatureNodeArg)

    // E-4 (enforced on the RESOLVED values). Reading the algorithm off a
    // hand-picked DOM node proves nothing about what xml-crypto will actually
    // run: the two can be made to disagree, and an HMAC document then reached
    // `checkSignature` despite the allowlist above. These are the values the
    // library resolved for ITSELF, so agreeing with them is the only check
    // that binds.
    const resolvedSig = String(
      (verifier as unknown as { signatureAlgorithm?: string }).signatureAlgorithm ?? '',
    )
    const resolvedC14n = String(
      (verifier as unknown as { canonicalizationAlgorithm?: string }).canonicalizationAlgorithm ??
        '',
    )
    if (!ALLOWED_SIGNATURE_METHODS.has(resolvedSig)) {
      return failure(
        log,
        'signature-method',
        `Disallowed signature algorithm "${resolvedSig}" resolved by the verifier — only RSA and ECDSA are accepted (HMAC would turn the public certificate into a shared secret)`,
        base,
      )
    }
    if (resolvedSig !== facts.signatureMethod) {
      return failure(
        log,
        'signature-method',
        `SignedInfo declares "${facts.signatureMethod}" but the verifier resolved "${resolvedSig}" — refusing an ambiguous document`,
        base,
      )
    }
    if (resolvedC14n && !ALLOWED_CANONICALIZATION.has(resolvedC14n)) {
      return failure(
        log,
        'canonicalization-method',
        `Disallowed canonicalization "${resolvedC14n}" resolved by the verifier`,
        base,
      )
    }

    cryptoValid = verifier.checkSignature(xml)
  } catch (e) {
    return failure(
      log,
      'signature-value',
      `Signature validation failed: ${e instanceof Error ? e.message : String(e)}`,
      base,
    )
  }
  if (!cryptoValid) {
    return failure(
      log,
      'signature-value',
      'Signature validation failed: the digest or signature value does not match the document',
      base,
    )
  }
  const signedContent = verifier.getSignedReferences()
  if (signedContent.length !== 1) {
    return failure(
      log,
      'signature-value',
      `Signature validation produced ${signedContent.length} validated references — exactly one is required`,
      base,
    )
  }
  log.pass('signature-value')

  const withCrypto: Partial<SamlVerifyResult> = {
    ...base,
    signedReferences: [referencedId],
    signedContent,
    signedElement: { id: referencedId, localName: localName(referenced) },
  }

  // ── Temporal + audience conditions ────────────────────────
  const assertionForConditions =
    activeAssertion ?? (isNamed(referenced, SAML_NS, 'Assertion') ? referenced : undefined)
  const conditions = collectConditions(assertionForConditions)
  const subjectEl = assertionForConditions
    ? firstChildNamed(assertionForConditions, SAML_NS, 'Subject')
    : undefined
  const nameIdEl = subjectEl ? firstChildNamed(subjectEl, SAML_NS, 'NameID') : undefined
  const detail: Partial<SamlVerifyResult> = {
    ...withCrypto,
    conditions: conditions.element
      ? {
          notBefore: conditions.notBefore,
          notOnOrAfter: conditions.notOnOrAfter,
          audiences: conditions.audiences,
        }
      : undefined,
    subject: nameIdEl
      ? { nameId: textOf(nameIdEl), format: nameIdEl.getAttribute('Format') ?? undefined }
      : undefined,
  }

  const now = toDate(options.now, new Date()).getTime()
  const skewMs = Math.max(0, options.clockSkewSeconds ?? 60) * 1000

  if (options.validateConditions !== false && assertionForConditions) {
    // FAIL CLOSED — but only where a validity window is meaningful. An
    // Assertion with no <Conditions>, or one carrying no NotOnOrAfter, used to
    // skip temporal validation ENTIRELY and emit no check row: a uniformly
    // green report for a credential that never expires. (An AuthnRequest has no
    // Conditions by design and is not a credential, so it is not subject to
    // this.)
    if (!conditions.element) {
      return failure(
        log,
        'conditions-present',
        'The assertion carries no <saml:Conditions> element, so it has no validity window — rejected (pass validateConditions:false to inspect such a document deliberately)',
        detail,
      )
    }
    if (!hasText(conditions.notOnOrAfter)) {
      return failure(
        log,
        'conditions-present',
        'The assertion carries <saml:Conditions> without @NotOnOrAfter, so it never expires — rejected',
        detail,
      )
    }
    log.pass('conditions-present')

    if (hasText(conditions.notBefore)) {
      const notBefore = Date.parse(conditions.notBefore)
      if (Number.isNaN(notBefore)) {
        return failure(
          log,
          'conditions-not-before',
          `Conditions/@NotBefore is not a valid instant: "${conditions.notBefore}"`,
          detail,
        )
      }
      if (now + skewMs < notBefore) {
        return failure(
          log,
          'conditions-not-before',
          `Assertion is not yet valid: NotBefore=${conditions.notBefore} is after the current time (clock skew ${skewMs / 1000}s)`,
          detail,
        )
      }
      log.pass('conditions-not-before', conditions.notBefore)
    }
    if (hasText(conditions.notOnOrAfter)) {
      const notOnOrAfter = Date.parse(conditions.notOnOrAfter)
      if (Number.isNaN(notOnOrAfter)) {
        return failure(
          log,
          'conditions-not-on-or-after',
          `Conditions/@NotOnOrAfter is not a valid instant: "${conditions.notOnOrAfter}"`,
          detail,
        )
      }
      if (now - skewMs >= notOnOrAfter) {
        return failure(
          log,
          'conditions-not-on-or-after',
          `Assertion has expired: NotOnOrAfter=${conditions.notOnOrAfter} is at or before the current time (clock skew ${skewMs / 1000}s)`,
          detail,
        )
      }
      log.pass('conditions-not-on-or-after', conditions.notOnOrAfter)
    }
  }

  // SAML 2.0 Web SSO makes the bearer confirmation window MANDATORY, and it is
  // a DIFFERENT window from Conditions: a stolen bearer assertion whose
  // confirmation expired yesterday used to pass as long as Conditions was
  // fresh. Same clock and skew as above.
  if (options.validateConditions !== false && assertionForConditions) {
    const subjectEl = firstChildNamed(assertionForConditions, SAML_NS, 'Subject')
    const confirmationEl = subjectEl
      ? firstChildNamed(subjectEl, SAML_NS, 'SubjectConfirmation')
      : undefined
    const dataEl = confirmationEl
      ? firstChildNamed(confirmationEl, SAML_NS, 'SubjectConfirmationData')
      : undefined
    const confirmationExpiry = dataEl?.getAttribute('NotOnOrAfter') ?? undefined
    if (hasText(confirmationExpiry)) {
      const expiresAt = Date.parse(confirmationExpiry)
      if (Number.isNaN(expiresAt)) {
        return failure(
          log,
          'subject-confirmation-expiry',
          `SubjectConfirmationData/@NotOnOrAfter is not a valid instant: "${confirmationExpiry}"`,
          detail,
        )
      }
      if (now - skewMs >= expiresAt) {
        return failure(
          log,
          'subject-confirmation-expiry',
          `The bearer confirmation window closed: SubjectConfirmationData/@NotOnOrAfter=${confirmationExpiry} (clock skew ${skewMs / 1000}s)`,
          detail,
        )
      }
      log.pass('subject-confirmation-expiry', confirmationExpiry)
    }
  }

  if (hasText(options.expectedAudience)) {
    if (!conditions.audiences.includes(options.expectedAudience)) {
      return failure(
        log,
        'audience',
        `Audience mismatch: expected "${options.expectedAudience}" but the assertion restricts to [${conditions.audiences.join(', ')}]`,
        detail,
      )
    }
    log.pass('audience', options.expectedAudience)
  }

  if (hasText(options.expectedInResponseTo)) {
    // Only SIGNED structure may satisfy this check. Two ways it was forgeable:
    //   (a) `firstDescendantNamed` searched the whole subtree, so a decoy
    //       SubjectConfirmationData appended inside ds:Object answered for the
    //       real one (that shape is now refused outright, but the lookup must
    //       not depend on that);
    //   (b) the Response's @InResponseTo counted even when only the ASSERTION
    //       was signed — an attacker wrapping a stolen assertion in their own
    //       Response just writes the expected request id there.
    const responseInResponseTo =
      isNamed(root, SAMLP_NS, 'Response') && referenced === root
        ? (root.getAttribute('InResponseTo') ?? undefined)
        : undefined
    // Schema path only: Assertion → Subject → SubjectConfirmation → Data.
    const subject = assertionForConditions
      ? firstChildNamed(assertionForConditions, SAML_NS, 'Subject')
      : undefined
    const confirmation = subject
      ? firstChildNamed(subject, SAML_NS, 'SubjectConfirmation')
      : undefined
    const confirmationData = confirmation
      ? firstChildNamed(confirmation, SAML_NS, 'SubjectConfirmationData')
      : undefined
    const assertionIsSigned =
      assertionForConditions !== undefined && referenced === assertionForConditions
    const subjectInResponseTo = assertionIsSigned
      ? (confirmationData?.getAttribute('InResponseTo') ?? undefined)
      : undefined
    const seen = [responseInResponseTo, subjectInResponseTo].filter(hasText)
    if (!seen.includes(options.expectedInResponseTo)) {
      return failure(
        log,
        'in-response-to',
        `InResponseTo mismatch: expected "${options.expectedInResponseTo}" but the document carries [${seen.join(', ')}]`,
        detail,
      )
    }
    log.pass('in-response-to', options.expectedInResponseTo)
  }

  return {
    valid: true,
    signedReferences: [referencedId],
    signedContent,
    signedElement: { id: referencedId, localName: localName(referenced) },
    signatureMethod: facts.signatureMethod,
    digestMethod: facts.digestMethod,
    canonicalizationMethod: facts.canonicalizationMethod,
    certInfo,
    conditions: detail.conditions,
    subject: detail.subject,
    checks: log.checks,
  }
}

// ─── Binding encode / decode ────────────────────────────────

/** Default inflate cap for the Redirect binding — a DEFLATE bomb stops here. */
export const DEFAULT_MAX_INFLATED_BYTES = 5 * 1024 * 1024

export interface RedirectDecodeOptions {
  maxInflatedBytes?: number
}

function normaliseBase64(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}: input is empty`)
  }
  let candidate = value.trim()
  if (/%[0-9a-fA-F]{2}/.test(candidate)) {
    try {
      candidate = decodeURIComponent(candidate)
    } catch {
      throw new Error(`${label}: input is not valid URL-encoded text`)
    }
  }
  candidate = candidate.replace(/\s+/g, '')
  if (/[-_]/.test(candidate) && /^[A-Za-z0-9\-_]+={0,2}$/.test(candidate)) {
    candidate = candidate.replace(/-/g, '+').replace(/_/g, '/')
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(candidate)) {
    throw new Error(`${label}: input is not valid base64`)
  }
  return candidate
}

/** HTTP-Redirect binding: raw DEFLATE → base64 (no zlib header, per spec). */
export function encodeRedirect(xml: string): string {
  assertNoDoctype(xml, 'SAML document to encode')
  return zlib.deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64')
}

/** HTTP-Redirect binding, ready to drop into a query string. */
export function encodeRedirectUrlParam(xml: string): string {
  return encodeURIComponent(encodeRedirect(xml))
}

/**
 * HTTP-Redirect binding, reverse. Accepts raw or URL-encoded base64.
 * Enforces an inflated-size cap (decompression bomb) and re-applies the DOCTYPE
 * guard to the decoded payload — decoded bytes are attacker-controlled input.
 */
export function decodeRedirect(value: string, options: RedirectDecodeOptions = {}): string {
  const max = options.maxInflatedBytes ?? DEFAULT_MAX_INFLATED_BYTES
  const base64 = normaliseBase64(value, 'SAML Redirect payload')
  const deflated = Buffer.from(base64, 'base64')
  let inflated: Buffer
  try {
    inflated = zlib.inflateRawSync(deflated, { maxOutputLength: max })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : ''
    if (code === 'ERR_BUFFER_TOO_LARGE' || /buffer|too large|maxOutputLength/i.test(message)) {
      throw new Error(
        `SAML Redirect payload too large: inflated output exceeds the ${max} byte limit (possible decompression bomb)`,
      )
    }
    throw new Error(`SAML Redirect payload is not a valid raw-DEFLATE stream: ${message}`)
  }
  const xml = inflated.toString('utf8')
  assertNoDoctype(xml, 'Decoded SAML Redirect payload')
  return xml
}

/** HTTP-POST binding: base64 only, never deflated. */
export function encodePost(xml: string): string {
  assertNoDoctype(xml, 'SAML document to encode')
  return Buffer.from(xml, 'utf8').toString('base64')
}

/** HTTP-POST binding, reverse. The DOCTYPE guard applies to the decoded payload. */
export function decodePost(value: string): string {
  const base64 = normaliseBase64(value, 'SAML POST payload')
  const xml = Buffer.from(base64, 'base64').toString('utf8')
  if (!xml.trimStart().startsWith('<')) {
    throw new Error('SAML POST payload did not decode to XML')
  }
  assertNoDoctype(xml, 'Decoded SAML POST payload')
  return xml
}
