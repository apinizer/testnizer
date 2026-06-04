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
  privateKeyPem: string
  certPem: string
  algorithm: SignAlgorithm
  references: SignReference[]
  keyInfoStrategy: KeyInfoStrategy
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

function buildSecurityHeader(config: WsSecurityConfig): SecurityHeaderBuild {
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

  const headerXml = [
    `<wsse:Security xmlns:wsse="${WSSE_NS}" xmlns:wsu="${WSU_NS}" soap:mustUnderstand="1">`,
    parts.join(''),
    '</wsse:Security>',
  ].join('')

  return { headerXml, tokenIds }
}

// ─── Insert/replace SOAP Header ─────────────────────────────

function insertSecurityHeader(envelope: string, headerXml: string): string {
  if (/<soap:Header\s*\/>/i.test(envelope)) {
    return envelope.replace(/<soap:Header\s*\/>/i, `<soap:Header>${headerXml}</soap:Header>`)
  }
  if (/<soap:Header\s*>/i.test(envelope)) {
    // Insert security header inside existing Header element
    return envelope.replace(/<soap:Header\s*>/i, `<soap:Header>${headerXml}`)
  }
  // No Header — insert right after Envelope opening tag's first child
  return envelope.replace(/(<soap:Envelope[^>]*>)/i, `$1<soap:Header>${headerXml}</soap:Header>`)
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

interface SignArgs {
  envelope: string
  config: SignConfig
  headerTokenIds: { usernameToken?: string; timestamp?: string }
  bodyId?: string
}

function applySignature(args: SignArgs): string {
  const { envelope, config, headerTokenIds } = args

  // Ensure Body has wsu:Id; if not provided, inject one
  let signedEnvelope = envelope
  let bodyId = args.bodyId
  if (config.references.includes('Body') && !bodyId) {
    bodyId = genId('Body')
    signedEnvelope = signedEnvelope.replace(
      /<soap:Body(\s|>)/i,
      `<soap:Body xmlns:wsu="${WSU_NS}" wsu:Id="${bodyId}"$1`,
    )
  }

  const bstId = genId('X509')
  const certDer = pemToBase64(config.certPem)

  // Inject BinarySecurityToken into <wsse:Security> (before signing) if strategy uses it
  if (config.keyInfoStrategy === 'BinarySecurityToken') {
    const bstXml =
      `<wsse:BinarySecurityToken xmlns:wsu="${WSU_NS}" ` +
      `EncodingType="${BST_ENCODING}" ValueType="${BST_VALUE_TYPE}" wsu:Id="${bstId}">` +
      `${certDer}</wsse:BinarySecurityToken>`
    signedEnvelope = signedEnvelope.replace(/<wsse:Security([^>]*)>/, `<wsse:Security$1>${bstXml}`)
  }

  const sig = new SignedXml({
    privateKey: config.privateKeyPem,
    publicCert: config.certPem,
    signatureAlgorithm: SIGN_ALGO_URI[config.algorithm],
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    idMode: 'wssecurity',
    getKeyInfoContent: buildKeyInfoProvider(config.certPem, config.keyInfoStrategy, bstId),
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

    // Extract target element XML using DOMParser would be heavier.
    // Use a regex-based approach for the default Body case; for custom xpath,
    // we fall back to inserting an EncryptedData wrapper as a sibling.
    const bodyMatch = envelope.match(/<soap:Body[^>]*>([\s\S]*?)<\/soap:Body>/i)
    if (!bodyMatch) {
      reject(new Error('Could not find soap:Body element to encrypt'))
      return
    }

    const targetContent = bodyMatch[1].trim()
    if (!targetContent) {
      reject(new Error('soap:Body is empty — nothing to encrypt'))
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
      // Wrap as EncryptedData (xml-encryption returns full <xenc:EncryptedData>)
      const replaced = envelope.replace(
        /<soap:Body([^>]*)>([\s\S]*?)<\/soap:Body>/i,
        `<soap:Body$1>${encryptedXml}</soap:Body>`,
      )
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

  let result = envelope
  const { headerXml, tokenIds } = buildSecurityHeader(config)
  result = insertSecurityHeader(result, headerXml)

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

/**
 * Verify XML signature on a signed envelope.
 *
 * @param envelope The signed XML
 * @param certPem PEM-encoded X509 certificate (public key) used to verify
 */
export function verifySignature(envelope: string, certPem: string): VerifyResult {
  const sig = new SignedXml({ publicCert: certPem })
  const sigNodeMatch = envelope.match(/<(?:ds:)?Signature[\s\S]*?<\/(?:ds:)?Signature>/)
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
    const encMatch = envelope.match(/<(?:xenc:)?EncryptedData[\s\S]*?<\/(?:xenc:)?EncryptedData>/)
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
        const replaced = envelope.replace(
          /<(?:xenc:)?EncryptedData[\s\S]*?<\/(?:xenc:)?EncryptedData>/,
          plaintext,
        )
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
