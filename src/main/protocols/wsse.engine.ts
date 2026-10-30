/**
 * WS-Security Engine
 *
 * Saf-fn (pure function) WS-Security operations: UsernameToken, Timestamp,
 * XML Signature (sign/verify), XML Encryption (encrypt/decrypt).
 *
 * Renderer process'ten IPC üzerinden çağrılır (`window.api.wsse`).
 * SOAP request engine'i de aynı motoru kullanır.
 */

import * as crypto from 'node:crypto'
import { SignedXml } from 'xml-crypto'
// TYPE-ONLY (erased at build): the engine stays pure — no keystore bridge, no
// DB, no IPC in this module's runtime graph.
import type { MaterialSource } from '../lib/keystore-bridge'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const xmlenc = require('xml-encryption') as {
  encrypt: (
    content: string,
    options: XmlEncOptions,
    callback: (err: Error | null, result?: string) => void,
  ) => void
  decrypt: (
    xml: string,
    options: { key: Buffer | string; disallowDecryptionWithInsecureAlgorithm?: boolean },
    callback: (err: Error | null, result?: string) => void,
  ) => void
}

// ─── Constants ──────────────────────────────────────────────

export const WSSE_NS =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
export const WSU_NS =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
export const PASSWORD_TEXT_TYPE =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText'
export const PASSWORD_DIGEST_TYPE =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest'
export const BST_VALUE_TYPE =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3'
export const BST_ENCODING =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary'

const SIGN_ALGO_URI: Record<SignAlgorithm, string> = {
  'RSA-SHA1': 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  'RSA-SHA256': 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  'RSA-SHA512': 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
}

const HASH_ALGO_URI: Record<SignAlgorithm, string> = {
  'RSA-SHA1': 'http://www.w3.org/2000/09/xmldsig#sha1',
  'RSA-SHA256': 'http://www.w3.org/2001/04/xmlenc#sha256',
  'RSA-SHA512': 'http://www.w3.org/2001/04/xmlenc#sha512',
}

const ENCRYPT_ALGO_URI: Record<EncryptAlgorithm, string> = {
  'AES-128-CBC': 'http://www.w3.org/2001/04/xmlenc#aes128-cbc',
  'AES-256-CBC': 'http://www.w3.org/2001/04/xmlenc#aes256-cbc',
  'AES-128-GCM': 'http://www.w3.org/2009/xmlenc11#aes128-gcm',
  'AES-256-GCM': 'http://www.w3.org/2009/xmlenc11#aes256-gcm',
}

const KEY_WRAP_URI: Record<KeyWrapAlgorithm, string> = {
  'RSA-OAEP': 'http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p',
  'RSA-1.5': 'http://www.w3.org/2001/04/xmlenc#rsa-1_5',
}

// ─── Types ──────────────────────────────────────────────────

export type WsSecurityMode = 'username-token' | 'timestamp' | 'sign' | 'encrypt'
export type SignAlgorithm = 'RSA-SHA1' | 'RSA-SHA256' | 'RSA-SHA512'
export type EncryptAlgorithm = 'AES-128-CBC' | 'AES-256-CBC' | 'AES-128-GCM' | 'AES-256-GCM'
export type KeyWrapAlgorithm = 'RSA-OAEP' | 'RSA-1.5'
export type KeyInfoStrategy = 'BinarySecurityToken' | 'IssuerSerial'
export type SignReference = 'Body' | 'Timestamp' | 'UsernameToken' | { xpath: string; id?: string }

export interface UsernameTokenConfig {
  username: string
  password: string
  passwordType: 'PasswordText' | 'PasswordDigest'
  nonce: boolean
  created: boolean
}

export interface TimestampConfig {
  ttlSeconds: number
}

export interface SignConfig {
  /**
   * PEM private key. OPTIONAL since the Key Material Provider (#60): when the
   * user picks `keySource` instead of pasting, the ORCHESTRATION layer
   * (`resolveWsseKeyMaterial` in `lib/wsse-key-material.ts`, called from
   * `wsse.handler` and `executeSoap`) populates this BEFORE `applyWsSecurity`.
   * This engine stays pure — it never resolves a `keySource` itself.
   */
  privateKeyPem?: string
  /** PEM certificate. OPTIONAL for the same reason as `privateKeyPem`. */
  certPem?: string
  algorithm: SignAlgorithm
  references: SignReference[]
  keyInfoStrategy: KeyInfoStrategy
  /**
   * Opaque key-material reference (#60) — ids / paths / pasted PEM only, never
   * key bytes. Resolved in MAIN by the orchestration layer; this shared engine
   * deliberately ignores it (keeping the keystore bridge out of pure code).
   */
  keySource?: MaterialSource
}

export interface EncryptConfig {
  recipientCertPem: string
  algorithm: EncryptAlgorithm
  keyWrap: KeyWrapAlgorithm
  /** Default '//*[local-name()="Body"]/*' (SOAP body inner element) */
  targetXpath?: string
}

export interface WsSecurityConfig {
  enabled: boolean
  modes: WsSecurityMode[]
  /** Sign-then-encrypt vs encrypt-then-sign. Default sign-then-encrypt per WSS profile recommendation. */
  signFirst?: boolean
  usernameToken?: UsernameTokenConfig
  timestamp?: TimestampConfig
  sign?: SignConfig
  encrypt?: EncryptConfig
}

export interface VerifyResult {
  valid: boolean
  reason?: string
  signedReferences: string[]
  certInfo?: {
    subject?: string
    issuer?: string
    notAfter?: string
    notBefore?: string
  }
}

interface XmlEncOptions {
  rsa_pub: Buffer | string
  pem: Buffer | string
  encryptionAlgorithm: string
  keyEncryptionAlgorithm: string
  disallowEncryptionWithInsecureAlgorithm?: boolean
}

// ─── Utility helpers ────────────────────────────────────────

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function isoTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`
}

function pemToBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
}

function extractCertInfo(certPem: string): VerifyResult['certInfo'] {
  try {
    const cert = new crypto.X509Certificate(certPem)
    return {
      subject: cert.subject,
      issuer: cert.issuer,
      notAfter: cert.validTo,
      notBefore: cert.validFrom,
    }
  } catch {
    return undefined
  }
}

// ─── UsernameToken builder ──────────────────────────────────

function buildUsernameToken(cfg: UsernameTokenConfig): string {
  const tokenId = genId('UsernameToken')
  const passwordTypeUri =
    cfg.passwordType === 'PasswordDigest' ? PASSWORD_DIGEST_TYPE : PASSWORD_TEXT_TYPE

  let nonceXml = ''
  let createdXml = ''
  let passwordValue = cfg.password

  if (cfg.passwordType === 'PasswordDigest') {
    // Digest = Base64(SHA1(nonce + created + password))
    const nonceBytes = crypto.randomBytes(16)
    const created = isoTimestamp()
    const digest = crypto
      .createHash('sha1')
      .update(
        Buffer.concat([
          nonceBytes,
          Buffer.from(created, 'utf8'),
          Buffer.from(cfg.password, 'utf8'),
        ]),
      )
      .digest('base64')
    passwordValue = digest
    nonceXml = `<wsse:Nonce EncodingType="${BST_ENCODING}">${nonceBytes.toString('base64')}</wsse:Nonce>`
    createdXml = `<wsu:Created>${created}</wsu:Created>`
  } else {
    if (cfg.nonce) {
      const nonceBytes = crypto.randomBytes(16)
      nonceXml = `<wsse:Nonce EncodingType="${BST_ENCODING}">${nonceBytes.toString('base64')}</wsse:Nonce>`
    }
    if (cfg.created) {
      createdXml = `<wsu:Created>${isoTimestamp()}</wsu:Created>`
    }
  }

  return [
    `<wsse:UsernameToken xmlns:wsu="${WSU_NS}" wsu:Id="${tokenId}">`,
    `<wsse:Username>${escapeXml(cfg.username)}</wsse:Username>`,
    `<wsse:Password Type="${passwordTypeUri}">${escapeXml(passwordValue)}</wsse:Password>`,
    nonceXml,
    createdXml,
    '</wsse:UsernameToken>',
  ]
    .filter(Boolean)
    .join('')
}

function buildTimestamp(cfg: TimestampConfig): string {
  const tsId = genId('TS')
  const ttl = Math.max(1, cfg.ttlSeconds | 0) * 1000
  return [
    `<wsu:Timestamp xmlns:wsu="${WSU_NS}" wsu:Id="${tsId}">`,
    `<wsu:Created>${isoTimestamp()}</wsu:Created>`,
    `<wsu:Expires>${isoTimestamp(ttl)}</wsu:Expires>`,
    '</wsu:Timestamp>',
  ].join('')
}

// ─── Build the <wsse:Security> header (without signature/encryption mutations) ──

interface SecurityHeaderBuild {
  headerXml: string
  /** Map of token labels to wsu:Id values for downstream signing */
  tokenIds: { usernameToken?: string; timestamp?: string }
}

function buildSecurityHeader(
  config: WsSecurityConfig,
  layout: EnvelopeLayout,
): SecurityHeaderBuild {
  const tokenIds: SecurityHeaderBuild['tokenIds'] = {}
  const parts: string[] = []

  if (config.modes.includes('username-token') && config.usernameToken) {
    const ut = buildUsernameToken(config.usernameToken)
    parts.push(ut)
    const m = ut.match(/wsu:Id="([^"]+)"/)
    if (m) tokenIds.usernameToken = m[1]
  }

  if (config.modes.includes('timestamp') && config.timestamp) {
    const ts = buildTimestamp(config.timestamp)
    parts.push(ts)
    const m = ts.match(/wsu:Id="([^"]+)"/)
    if (m) tokenIds.timestamp = m[1]
  }

  // `mustUnderstand` is an attribute in the ENVELOPE's namespace. With a
  // prefixed envelope that prefix is already in scope (it is declared on the
  // root); a default-namespace envelope has no prefix to borrow — an
  // unprefixed attribute is in no namespace at all — so one is declared here,
  // on the Security element itself. The same happens when the envelope's own
  // prefix is `wsse` / `wsu`: Security rebinds both to the WS-Security
  // namespaces, so a borrowed `wsse:mustUnderstand` would land in the wrong
  // namespace (peer review of issue #298 / issue #299). `soapenv` is always
  // free on Security — only this engine's own tokens sit inside it.
  const borrow = layout.prefix && !SECURITY_PREFIXES.has(layout.prefix)
  const mustUnderstand = borrow
    ? `${layout.prefix}:mustUnderstand="1"`
    : `xmlns:${DEFAULT_NS_ENV_PREFIX}="${layout.ns}" ${DEFAULT_NS_ENV_PREFIX}:mustUnderstand="1"`

  const headerXml = [
    `<wsse:Security xmlns:wsse="${WSSE_NS}" xmlns:wsu="${WSU_NS}" ${mustUnderstand}>`,
    parts.join(''),
    '</wsse:Security>',
  ].join('')

  return { headerXml, tokenIds }
}

// ─── Locate the SOAP Envelope / Header / Body ───────────────

export const SOAP11_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/'
export const SOAP12_ENV_NS = 'http://www.w3.org/2003/05/soap-envelope'

/**
 * Prefix declared on wsse:Security for `mustUnderstand` when the envelope's
 * own prefix cannot be borrowed (none, or one Security rebinds).
 */
const DEFAULT_NS_ENV_PREFIX = 'soapenv'

/** The prefixes `<wsse:Security>` declares on itself — never borrowable from the envelope. */
const SECURITY_PREFIXES = new Set(['wsse', 'wsu'])

/** One element tag found by the scanner. */
interface TagInfo {
  /** Index of `<`. */
  start: number
  /** Index just past `>`. */
  end: number
  /** Qualified name as written (`soapenv:Body`, `Body`). */
  qname: string
  prefix: string
  local: string
  /** Raw attribute text (everything between the name and `>` / `/>`). */
  attrs: string
  kind: 'open' | 'close' | 'empty'
}

/** An Envelope child (Header / Body) with its content span. */
interface ChildSpan {
  open: TagInfo
  /** Index where the content starts (= `open.end`). */
  contentStart: number
  /** Index of the closing tag's `<` (= `open.end` for `<x/>`). */
  contentEnd: number
  /** Index just past the closing tag (= `open.end` for `<x/>`). */
  end: number
}

/**
 * Where the SOAP parts sit in the envelope TEXT. WS-Security edits the user's
 * envelope in place (formatting kept, nothing re-serialised), so positions are
 * found by a small tag scanner rather than a DOM round-trip.
 */
export interface EnvelopeLayout {
  /** The Envelope's prefix as written — `''` for a default-namespace envelope. */
  prefix: string
  /** SOAP 1.1 or 1.2 envelope namespace. */
  ns: string
  envelope: TagInfo
  header?: ChildSpan
  body?: ChildSpan
}

/**
 * Comments, CDATA, processing instructions, DOCTYPE, and element tags. An
 * attribute value may contain `>`, so element tags consume quoted values whole.
 */
const XML_TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g

function nextTag(xml: string, from: number): TagInfo | null {
  XML_TOKEN.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = XML_TOKEN.exec(xml))) {
    if (!m[2]) continue // comment / CDATA / PI / DOCTYPE
    const qname = m[2]
    const colon = qname.indexOf(':')
    return {
      start: m.index,
      end: m.index + m[0].length,
      qname,
      prefix: colon >= 0 ? qname.slice(0, colon) : '',
      local: colon >= 0 ? qname.slice(colon + 1) : qname,
      attrs: m[3] ?? '',
      kind: m[1] ? 'close' : m[4] ? 'empty' : 'open',
    }
  }
  return null
}

const XML_ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

function attributesOf(tag: TagInfo): Map<string, string> {
  const out = new Map<string, string>()
  XML_ATTR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = XML_ATTR.exec(tag.attrs))) out.set(m[1], m[2] ?? m[3] ?? '')
  return out
}

/** The namespace a prefix (`''` = default) resolves to on `tag`, given the root's declarations. */
function namespaceOf(
  prefix: string,
  tag: TagInfo,
  rootDecls: Map<string, string>,
): string | undefined {
  const name = prefix ? `xmlns:${prefix}` : 'xmlns'
  return attributesOf(tag).get(name) ?? rootDecls.get(name)
}

/** Walk one element child of the Envelope (from its open tag) to its end. */
function spanOf(xml: string, open: TagInfo): ChildSpan {
  if (open.kind === 'empty') {
    return { open, contentStart: open.end, contentEnd: open.end, end: open.end }
  }
  let depth = 1
  let pos = open.end
  for (;;) {
    const t = nextTag(xml, pos)
    if (!t) throw new Error(`Malformed SOAP Envelope: <${open.qname}> is never closed`)
    if (t.kind === 'open') depth++
    else if (t.kind === 'close') depth--
    pos = t.end
    if (depth === 0) {
      return { open, contentStart: open.end, contentEnd: t.start, end: t.end }
    }
  }
}

const NOT_AN_ENVELOPE =
  'WS-Security needs a SOAP Envelope: the document element must be an Envelope in the SOAP 1.1 ' +
  `(${SOAP11_ENV_NS}) or SOAP 1.2 (${SOAP12_ENV_NS}) namespace`

/**
 * Find the SOAP Envelope and its Header / Body, whatever prefix the envelope
 * uses (`soap:`, SoapUI's `soapenv:`, `env:`, …) or none (default namespace).
 * Throws on anything that is not a SOAP 1.1 / 1.2 envelope — WS-Security on a
 * non-envelope must fail visibly, never come back unchanged as a "success".
 */
export function locateEnvelope(xml: string): EnvelopeLayout {
  const envelope = nextTag(xml, 0)
  if (!envelope || envelope.kind !== 'open' || envelope.local !== 'Envelope') {
    throw new Error(`${NOT_AN_ENVELOPE}.`)
  }
  // The Envelope is the document element, so its own prefix can only be
  // declared on this very tag.
  const rootDecls = attributesOf(envelope)
  const ns = rootDecls.get(envelope.prefix ? `xmlns:${envelope.prefix}` : 'xmlns')
  if (ns !== SOAP11_ENV_NS && ns !== SOAP12_ENV_NS) {
    throw new Error(
      `${NOT_AN_ENVELOPE}; <${envelope.qname}> is ` +
        (ns ? `in namespace "${ns}".` : `in no declared namespace.`),
    )
  }

  const layout: EnvelopeLayout = { prefix: envelope.prefix, ns, envelope }
  // Only DIRECT children of the Envelope count — a payload element that
  // happens to be called Header / Body (likely with a default namespace)
  // must never be mistaken for the SOAP one.
  let pos = envelope.end
  for (;;) {
    const t = nextTag(xml, pos)
    if (!t) throw new Error(`Malformed SOAP Envelope: <${envelope.qname}> is never closed`)
    if (t.kind === 'close') break // </Envelope>
    const span = spanOf(xml, t)
    pos = span.end
    if (namespaceOf(t.prefix, t, rootDecls) !== ns) continue
    if (t.local === 'Header' && !layout.header && !layout.body) layout.header = span
    else if (t.local === 'Body' && !layout.body) layout.body = span
  }
  return layout
}

/** `<p:Local` / `</p:Local>` for this envelope's prefix. */
function envQName(layout: EnvelopeLayout, local: string): string {
  return layout.prefix ? `${layout.prefix}:${local}` : local
}

// ─── Insert/replace SOAP Header ─────────────────────────────

function insertSecurityHeader(envelope: string, layout: EnvelopeLayout, headerXml: string): string {
  const header = layout.header
  if (header && header.open.kind === 'empty') {
    // `<p:Header/>` / `<p:Header a="1" />` → open it, keeping its attributes.
    const q = header.open.qname
    return (
      envelope.slice(0, header.open.start) +
      `<${q}${header.open.attrs}>${headerXml}</${q}>` +
      envelope.slice(header.end)
    )
  }
  if (header) {
    // Existing Header: Security goes first, the rest of its content is kept.
    return envelope.slice(0, header.contentStart) + headerXml + envelope.slice(header.contentStart)
  }
  // No Header: create one as the Envelope's first child, in its namespace.
  const q = envQName(layout, 'Header')
  const at = layout.envelope.end
  return envelope.slice(0, at) + `<${q}>${headerXml}</${q}>` + envelope.slice(at)
}

// ─── XML Signature (xml-crypto) ─────────────────────────────

function buildKeyInfoProvider(certPem: string, strategy: KeyInfoStrategy, bstId: string) {
  if (strategy === 'BinarySecurityToken') {
    return () =>
      `<wsse:SecurityTokenReference xmlns:wsse="${WSSE_NS}">` +
      `<wsse:Reference URI="#${bstId}" ValueType="${BST_VALUE_TYPE}"/>` +
      `</wsse:SecurityTokenReference>`
  }
  // IssuerSerial
  let issuer = ''
  let serial = ''
  try {
    const cert = new crypto.X509Certificate(certPem)
    issuer = cert.issuer.replace(/\n/g, ',')
    serial = BigInt('0x' + cert.serialNumber).toString(10)
  } catch {
    // ignore
  }
  return () =>
    `<X509Data><X509IssuerSerial>` +
    `<X509IssuerName>${escapeXml(issuer)}</X509IssuerName>` +
    `<X509SerialNumber>${serial}</X509SerialNumber>` +
    `</X509IssuerSerial></X509Data>`
}

function referenceToXpath(
  ref: SignReference,
  ids: { body?: string; usernameToken?: string; timestamp?: string },
): string | null {
  if (typeof ref === 'object') {
    return ref.xpath
  }
  if (ref === 'Body') {
    return `//*[local-name(.)='Body' and namespace-uri(.)='http://schemas.xmlsoap.org/soap/envelope/' or local-name(.)='Body' and namespace-uri(.)='http://www.w3.org/2003/05/soap-envelope']`
  }
  if (ref === 'Timestamp' && ids.timestamp) {
    return `//*[@*[local-name()='Id']='${ids.timestamp}']`
  }
  if (ref === 'UsernameToken' && ids.usernameToken) {
    return `//*[@*[local-name()='Id']='${ids.usernameToken}']`
  }
  return null
}

/**
 * Give the SOAP Body a `wsu:Id` (the WS-Security reference id). An Id the Body
 * already carries is reused — a second `wsu:Id` / `xmlns:wsu` on the same
 * element would be a duplicate attribute, i.e. malformed XML.
 */
function ensureBodyWsuId(
  envelope: string,
  layout: EnvelopeLayout,
): { envelope: string; bodyId: string } {
  const body = layout.body
  if (!body) throw new Error(`Could not find the SOAP ${envQName(layout, 'Body')} element to sign`)
  const rootDecls = attributesOf(layout.envelope)
  const attrs = attributesOf(body.open)
  for (const [name, value] of attrs) {
    const colon = name.indexOf(':')
    if (colon < 0 || name.slice(colon + 1) !== 'Id') continue
    if (namespaceOf(name.slice(0, colon), body.open, rootDecls) === WSU_NS) {
      return { envelope, bodyId: value }
    }
  }
  const bodyId = genId('Body')
  const wsuInScope = namespaceOf('wsu', body.open, rootDecls)
  // `wsu` bound to anything else — on this tag or on the root, e.g. a
  // `<wsu:Envelope>` whose SOAP prefix is `wsu` — must not be rebound here: on
  // `<wsu:Body>` that would move the Body element itself out of the SOAP
  // namespace. A fresh prefix is used instead.
  const insert =
    wsuInScope === WSU_NS
      ? ` wsu:Id="${bodyId}"`
      : wsuInScope !== undefined || attrs.has('xmlns:wsu')
        ? ` xmlns:wsuid="${WSU_NS}" wsuid:Id="${bodyId}"`
        : ` xmlns:wsu="${WSU_NS}" wsu:Id="${bodyId}"`
  const at = body.open.start + 1 + body.open.qname.length
  return { envelope: envelope.slice(0, at) + insert + envelope.slice(at), bodyId }
}

interface SignArgs {
  envelope: string
  config: SignConfig
  headerTokenIds: { usernameToken?: string; timestamp?: string }
  bodyId?: string
}

function applySignature(args: SignArgs): string {
  const { envelope, config, headerTokenIds } = args

  // FAIL LOUD (#60). `privateKeyPem`/`certPem` became optional so a `keySource`
  // can stand in for them, but the ORCHESTRATION layer must have resolved it
  // before we get here. Reaching this point with neither is a config gap, not a
  // reason to emit a silently unsigned envelope.
  const certPem = config.certPem
  const privateKeyPem = config.privateKeyPem
  if (!certPem || !certPem.trim() || !privateKeyPem || !privateKeyPem.trim()) {
    throw new Error(
      'WS-Security signing requires a certificate and a private key — paste both PEMs or select key material from the keystore.',
    )
  }

  // Ensure Body has wsu:Id; if not provided, inject one
  let signedEnvelope = envelope
  let bodyId = args.bodyId
  if (config.references.includes('Body') && !bodyId) {
    const injected = ensureBodyWsuId(signedEnvelope, locateEnvelope(signedEnvelope))
    signedEnvelope = injected.envelope
    bodyId = injected.bodyId
  }

  const bstId = genId('X509')
  const certDer = pemToBase64(certPem)

  // Inject BinarySecurityToken into <wsse:Security> (before signing) if strategy uses it
  if (config.keyInfoStrategy === 'BinarySecurityToken') {
    const bstXml =
      `<wsse:BinarySecurityToken xmlns:wsu="${WSU_NS}" ` +
      `EncodingType="${BST_ENCODING}" ValueType="${BST_VALUE_TYPE}" wsu:Id="${bstId}">` +
      `${certDer}</wsse:BinarySecurityToken>`
    signedEnvelope = signedEnvelope.replace(/<wsse:Security([^>]*)>/, `<wsse:Security$1>${bstXml}`)
  }

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
    signatureAlgorithm: SIGN_ALGO_URI[config.algorithm],
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    idMode: 'wssecurity',
    getKeyInfoContent: buildKeyInfoProvider(certPem, config.keyInfoStrategy, bstId),
  })

  const ids = { body: bodyId, ...headerTokenIds }
  for (const ref of config.references) {
    const xpath = referenceToXpath(ref, ids)
    if (!xpath) continue
    sig.addReference({
      xpath,
      transforms: ['http://www.w3.org/2001/10/xml-exc-c14n#'],
      digestAlgorithm: HASH_ALGO_URI[config.algorithm],
      uri: '',
      isEmptyUri: false,
      inclusiveNamespacesPrefixList: [],
    })
  }

  sig.computeSignature(signedEnvelope, {
    location: { reference: "//*[local-name(.)='Security']", action: 'append' },
    prefix: 'ds',
  })

  return sig.getSignedXml()
}

// ─── XML Encryption (xml-encryption) ────────────────────────

function applyEncryptionToBody(envelope: string, config: EncryptConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    const targetXpath = config.targetXpath ?? '//*[local-name()="Body"]/*'

    // The SOAP Body is located by the envelope's own prefix (or none). A
    // custom target xpath is not implemented yet: the Body content is the
    // target.
    let layout: EnvelopeLayout
    try {
      layout = locateEnvelope(envelope)
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    const body = layout.body
    const bodyName = envQName(layout, 'Body')
    if (!body) {
      reject(new Error(`Could not find the SOAP ${bodyName} element to encrypt`))
      return
    }

    // The EXACT Body content — whitespace text nodes included. A signature
    // computed before encryption covers those bytes; trimming them here meant
    // the decrypted Body no longer matched its digest (peer review of issue
    // #298). Trim only to decide whether there is anything to encrypt.
    const targetContent = envelope.slice(body.contentStart, body.contentEnd)
    if (!targetContent.trim()) {
      reject(new Error(`${bodyName} is empty — nothing to encrypt`))
      return
    }

    // xml-encryption needs PEM-format public key (extracted from cert) for rsa_pub.
    // Extracting via X509Certificate gives a SubjectPublicKeyInfo PEM that
    // crypto.publicEncrypt accepts.
    let publicKeyPem: string
    try {
      const x509 = new crypto.X509Certificate(config.recipientCertPem)
      publicKeyPem = x509.publicKey.export({ type: 'spki', format: 'pem' }) as string
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }

    const options: XmlEncOptions = {
      rsa_pub: Buffer.from(publicKeyPem, 'utf8'),
      pem: Buffer.from(config.recipientCertPem, 'utf8'),
      encryptionAlgorithm: ENCRYPT_ALGO_URI[config.algorithm],
      keyEncryptionAlgorithm: KEY_WRAP_URI[config.keyWrap],
      disallowEncryptionWithInsecureAlgorithm: false,
    }

    xmlenc.encrypt(targetContent, options, (err, encryptedXml) => {
      if (err || !encryptedXml) {
        reject(err ?? new Error('xml-encryption returned empty result'))
        return
      }
      // Wrap as EncryptedData (xml-encryption returns full <xenc:EncryptedData>).
      // Spliced in without surrounding text: whatever sits outside the
      // EncryptedData element survives decryption and would end up in the
      // restored Body next to the signed bytes.
      const replaced =
        envelope.slice(0, body.contentStart) + encryptedXml.trim() + envelope.slice(body.contentEnd)
      resolve(replaced)
      // suppress unused targetXpath warning while custom-xpath encryption is unimplemented
      void targetXpath
    })
  })
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Apply WS-Security to a SOAP envelope. Returns the modified envelope.
 *
 * Order of operations:
 *   1. Build Security header (UsernameToken + Timestamp)
 *   2. Insert into envelope
 *   3. If sign mode: compute signature over selected references
 *   4. If encrypt mode: encrypt target element (default body inner)
 *
 * Default order is sign-then-encrypt; set `config.signFirst = false` to flip.
 */
export async function applyWsSecurity(envelope: string, config: WsSecurityConfig): Promise<string> {
  if (!config.enabled || config.modes.length === 0) {
    return envelope
  }

  // Throws on a non-envelope (or an envelope in a foreign namespace): that
  // must fail visibly, never come back unchanged as if it had been secured.
  const layout = locateEnvelope(envelope)
  const { headerXml, tokenIds } = buildSecurityHeader(config, layout)
  let result = insertSecurityHeader(envelope, layout, headerXml)

  const wantsSign = config.modes.includes('sign') && config.sign
  const wantsEncrypt = config.modes.includes('encrypt') && config.encrypt
  const signFirst = config.signFirst !== false

  if (wantsSign && signFirst) {
    result = applySignature({
      envelope: result,
      config: config.sign!,
      headerTokenIds: tokenIds,
    })
  }

  if (wantsEncrypt) {
    result = await applyEncryptionToBody(result, config.encrypt!)
  }

  if (wantsSign && !signFirst) {
    result = applySignature({
      envelope: result,
      config: config.sign!,
      headerTokenIds: tokenIds,
    })
  }

  return result
}

/** `<p:Signature …>…</p:Signature>` with the same (optional) prefix on both tags. */
const SIGNATURE_ELEMENT = /<((?:[\w.-]+:)?)Signature(?=[\s>])[\s\S]*?<\/\1Signature\s*>/
/** `<p:EncryptedData …>…</p:EncryptedData>` with the same (optional) prefix on both tags. */
const ENCRYPTED_DATA_ELEMENT =
  /<((?:[\w.-]+:)?)EncryptedData(?=[\s>])[\s\S]*?<\/\1EncryptedData\s*>/

/**
 * Verify XML signature on a signed envelope.
 *
 * @param envelope The signed XML
 * @param certPem PEM-encoded X509 certificate (public key) used to verify
 */
export function verifySignature(envelope: string, certPem: string): VerifyResult {
  const sig = new SignedXml({ publicCert: certPem })
  // Any prefix (`ds:`, `dsig:`, none) — the closing tag must use the same one.
  const sigNodeMatch = envelope.match(SIGNATURE_ELEMENT)
  if (!sigNodeMatch) {
    return { valid: false, reason: 'No signature element found', signedReferences: [] }
  }

  try {
    sig.loadSignature(sigNodeMatch[0])
    const valid = sig.checkSignature(envelope)
    if (!valid) {
      return {
        valid: false,
        reason: 'Signature validation failed',
        signedReferences: [],
        certInfo: extractCertInfo(certPem),
      }
    }
    return {
      valid: true,
      signedReferences: sig.getSignedReferences(),
      certInfo: extractCertInfo(certPem),
    }
  } catch (e) {
    return {
      valid: false,
      reason: e instanceof Error ? e.message : String(e),
      signedReferences: [],
      certInfo: extractCertInfo(certPem),
    }
  }
}

/**
 * Decrypt EncryptedData inside a SOAP envelope using the recipient's private key.
 * Returns the modified envelope with EncryptedData replaced by the plaintext.
 */
export function decryptEnvelope(
  envelope: string,
  privateKeyPem: string,
  passphrase?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Any prefix (`xenc:`, `enc:`, none) — the closing tag must use the same one.
    const encMatch = envelope.match(ENCRYPTED_DATA_ELEMENT)
    if (!encMatch) {
      resolve(envelope) // nothing encrypted
      return
    }

    let key: Buffer | string = privateKeyPem
    if (passphrase) {
      // Convert encrypted PEM to a usable key by re-exporting
      try {
        const decryptedKey = crypto.createPrivateKey({ key: privateKeyPem, passphrase })
        key = decryptedKey.export({ type: 'pkcs8', format: 'pem' }) as string
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
        return
      }
    }

    xmlenc.decrypt(
      encMatch[0],
      { key, disallowDecryptionWithInsecureAlgorithm: false },
      (err, plaintext) => {
        if (err || plaintext == null) {
          reject(err ?? new Error('xml-encryption returned empty result'))
          return
        }
        const replaced =
          envelope.slice(0, encMatch.index) +
          plaintext +
          envelope.slice((encMatch.index ?? 0) + encMatch[0].length)
        resolve(replaced)
      },
    )
  })
}

// ─── Backward-compat helpers ────────────────────────────────

/**
 * Migrate the legacy single-mode WsSecurityConfig
 * (`{ type: 'username-token'|'timestamp', username, password, ... }`)
 * to the new multi-mode shape. Idempotent when input already has `modes`.
 */
export function migrateLegacyConfig(legacy: unknown): WsSecurityConfig {
  if (!legacy || typeof legacy !== 'object') {
    return { enabled: false, modes: [] }
  }
  const obj = legacy as Record<string, unknown>
  if (Array.isArray(obj.modes)) {
    return obj as unknown as WsSecurityConfig
  }
  const enabled = !!obj.enabled
  const modes: WsSecurityMode[] = []
  const result: WsSecurityConfig = { enabled, modes }

  if (obj.type === 'username-token' && obj.username) {
    modes.push('username-token')
    result.usernameToken = {
      username: String(obj.username ?? ''),
      password: String(obj.password ?? ''),
      passwordType: obj.passwordType === 'PasswordDigest' ? 'PasswordDigest' : 'PasswordText',
      nonce: false,
      created: false,
    }
  }
  if (obj.type === 'timestamp' || obj.addTimestamp) {
    if (!modes.includes('timestamp')) modes.push('timestamp')
    result.timestamp = { ttlSeconds: 300 }
  }
  return result
}
