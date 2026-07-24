/**
 * Keystore Studio engine (Faz 0 core) — opens, inspects, and creates Java `.jks`
 * and PKCS#12 `.p12/.pfx` keystores entirely in the MAIN process. Private-key
 * and passphrase material never leaves main: the renderer holds only a
 * `sessionId` plus public alias/certificate metadata (see design §3.3–3.4).
 *
 * Crypto backing (design §4.1):
 *   - RSA key pair            → Node `crypto.generateKeyPairSync('rsa')`
 *   - RSA self-signed X.509v3 → node-forge `pki.createCertificate`
 *   - EC key pair + cert      → `@peculiar/x509` over WebCrypto (P-256/384/521)
 *   - JKS read                → `jks-js` (`toPem`)
 *   - JKS write               → pure-TS `jks-writer.ts` (`encodeJks`)
 *   - PKCS12 read/write       → node-forge (multi-alias hand-assembled, §4.1/R2)
 *   - CertificateInfo         → Node `crypto.X509Certificate` + `createHash`
 *
 * IMPORTANT — load order: `reflect-metadata` MUST be imported before
 * `@peculiar/x509` (its `tsyringe` dependency reads `Reflect.getMetadata` at
 * module-eval time; without the polyfill the import throws on Node/Electron).
 */

import 'reflect-metadata'
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  webcrypto,
  X509Certificate,
} from 'node:crypto'
import forge from 'node-forge'
import * as x509 from '@peculiar/x509'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — jks-js ships no type declarations
import * as jksjs from 'jks-js'
import { encodeJks, type JksEntry } from './jks-writer'

// Route @peculiar/x509 through Node's WebCrypto (design §4.1).
x509.cryptoProvider.set(webcrypto as unknown as Crypto)

// ─────────────────────────────────────────────────────────────────────────────
// Public types (Faz 0 owns these; the renderer DTOs in types/index.ts mirror
// them in Faz 1).
// ─────────────────────────────────────────────────────────────────────────────

export type KeystoreType = 'JKS' | 'PKCS12'
export type EntryType = 'KEY' | 'CERTIFICATE'

export interface AliasSummary {
  alias: string
  entryType: EntryType
  hasPrivateKey: boolean
  subjectDN?: string
  issuerDN?: string
  notBefore?: string
  notAfter?: string
  keyAlgorithm?: string
  chainLength: number
}

export interface CertificateInfo {
  subjectDN: string
  issuerDN: string
  serialNumber: string
  version: number
  sigAlgName: string
  notBefore: string
  notAfter: string
  publicKeyAlgorithm: string
  keySize: number
  sha1Fingerprint: string
  sha256Fingerprint: string
  subjectAlternativeNames: string[]
  pem: string
}

export interface KeystoreAliasDetail {
  alias: string
  entryType: EntryType
  hasPrivateKey: boolean
  chain: CertificateInfo[]
}

export interface KeystoreMeta {
  type: KeystoreType
  aliasCount: number
  aliases: AliasSummary[]
}

export interface GenerateKeyPairOptions {
  alias: string
  keyAlgorithm?: string
  keySize?: number
  curve?: string
  subjectDN?: string
  subjectAlternativeNames?: string[]
  validityDays?: number
  serialNumber?: string
  keyUsage?: string[]
  basicConstraintsCa?: boolean
  signatureAlgorithm?: string
  entryPassword?: string
}

/** User-fixable error — the message is surfaced verbatim (design §4.3). */
export class KeystoreValidationException extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeystoreValidationException'
  }
}

/** Parse/unexpected error — logged, shown as a friendly message (design §4.3). */
export class KeystoreEngineException extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeystoreEngineException'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal normalized model — the single source of truth a session mutates,
// serialized on demand to JKS or PKCS12 bytes.
// ─────────────────────────────────────────────────────────────────────────────

interface KeyEntryModel {
  alias: string
  kind: 'key'
  privateKeyPkcs8Der: Buffer
  certChainDer: Buffer[]
  entryPassword: string
}

interface CertEntryModel {
  alias: string
  kind: 'cert'
  certDer: Buffer
}

type EntryModel = KeyEntryModel | CertEntryModel

interface KeystoreSession {
  id: string
  type: KeystoreType
  storePassword: string
  entries: EntryModel[]
  /** alias → per-entry key password (JKS entry pw may differ from store pw). */
  aliasEntryPasswords: Map<string, string>
  /** Last serialized bytes — kept ONLY in main (design §3.4). */
  bytes: Buffer
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveType (spec §6.1)
// ─────────────────────────────────────────────────────────────────────────────

export function resolveType(type?: string | null): KeystoreType {
  if (!type || !type.trim()) return 'JKS'
  const t = type.trim().toUpperCase()
  if (t === 'JKS') return 'JKS'
  if (t === 'PKCS12' || t === 'PKCS#12') return 'PKCS12'
  throw new KeystoreValidationException(`Unsupported keystore type: ${type}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// PEM/DER helpers
// ─────────────────────────────────────────────────────────────────────────────

function pemBlocksToDer(pem: string, label: string): Buffer[] {
  const re = new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`, 'g')
  const out: Buffer[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(pem)) !== null) {
    out.push(Buffer.from(m[1].replace(/\s+/g, ''), 'base64'))
  }
  return out
}

function firstPemDer(pem: string, label: string): Buffer | undefined {
  return pemBlocksToDer(pem, label)[0]
}

// ─────────────────────────────────────────────────────────────────────────────
// CertificateInfo extraction (spec §6.6) — Node X509 for the bulk, @peculiar
// only for the signature algorithm name, createHash for fingerprints.
// ─────────────────────────────────────────────────────────────────────────────

function formatDn(dn: string): string {
  // Node's `subject`/`issuer` getters are newline-separated RDNs.
  return dn
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')
}

function isoUtc(dateStr: string): string {
  return new Date(dateStr).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function fingerprint(certDer: Buffer, algo: 'sha1' | 'sha256'): string {
  const hex = createHash(algo).update(certDer).digest('hex').toUpperCase()
  return hex.match(/../g)!.join(':')
}

/** Standalone ArrayBuffer view of a Buffer (satisfies @peculiar's BufferSource). */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const EC_CURVE_BITS: Record<string, number> = {
  prime256v1: 256,
  secp256r1: 256,
  secp384r1: 384,
  secp521r1: 521,
  secp256k1: 256,
}

function mapSigAlg(px: x509.X509Certificate): string {
  const sa = px.signatureAlgorithm as { name: string; hash?: unknown }
  const hashRaw =
    sa.hash && typeof sa.hash === 'object' && 'name' in sa.hash
      ? String((sa.hash as { name: string }).name)
      : String(sa.hash ?? '')
  const h = hashRaw.replace('-', '')
  if (sa.name === 'RSASSA-PKCS1-v1_5') return `${h}withRSA`
  if (sa.name === 'ECDSA') return `${h}withECDSA`
  if (sa.name === 'RSASSA-PSS') return `${h}withRSAandMGF1`
  return sa.name
}

export function buildCertificateInfo(certDer: Buffer): CertificateInfo {
  const nx = new X509Certificate(certDer)
  const px = new x509.X509Certificate(toArrayBuffer(certDer))
  const pub = nx.publicKey
  const keyType = pub.asymmetricKeyType ?? ''
  const details = pub.asymmetricKeyDetails ?? {}

  let keySize = 0
  let publicKeyAlgorithm = keyType.toUpperCase()
  if (keyType === 'rsa' || keyType === 'rsa-pss') {
    publicKeyAlgorithm = 'RSA'
    keySize = details.modulusLength ?? 0
  } else if (keyType === 'ec') {
    publicKeyAlgorithm = 'EC'
    keySize = EC_CURVE_BITS[details.namedCurve ?? ''] ?? 0
  }

  const san = nx.subjectAltName
    ? nx.subjectAltName.split(', ').map((e) => {
        const idx = e.indexOf(':')
        return idx === -1 ? e : e.slice(idx + 1)
      })
    : []

  return {
    subjectDN: formatDn(nx.subject),
    issuerDN: formatDn(nx.issuer),
    serialNumber: nx.serialNumber.toLowerCase(),
    version: 3,
    sigAlgName: mapSigAlg(px),
    notBefore: isoUtc(nx.validFrom),
    notAfter: isoUtc(nx.validTo),
    publicKeyAlgorithm,
    keySize,
    sha1Fingerprint: fingerprint(certDer, 'sha1'),
    sha256Fingerprint: fingerprint(certDer, 'sha256'),
    subjectAlternativeNames: san,
    pem: nx.toString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PKCS12 low-level ASN.1 (multi-alias write, R2). node-forge's high-level
// toPkcs12Asn1 is single-key+chain; we hand-assemble SafeBags/SafeContents so
// each key/cert carries friendlyName(alias) + localKeyID (design §4.1).
// ─────────────────────────────────────────────────────────────────────────────

const asn1 = forge.asn1
const pkiOids = forge.pki.oids
type Asn1 = forge.asn1.Asn1
/** node-forge cert extension bag (@types/node-forge exports no public type). */
type ForgeExt = Record<string, unknown>

// Oracle keytool proprietary trustedKeyUsage attribute — without it keytool
// -list drops cert-only PKCS12 entries (verified against keytool).
const ORACLE_TRUSTED_KEY_USAGE_OID = '2.16.840.1.113894.746875.1.1'
const ANY_EXTENDED_KEY_USAGE_OID = '2.5.29.37.0'

function ctx0(children: Asn1[]): Asn1 {
  return asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0 as forge.asn1.Type, true, children)
}

function oid(value: string): Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(value).getBytes())
}

function octet(bytes: string): Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, bytes)
}

function seq(children: Asn1[]): Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, children)
}

function set(children: Asn1[]): Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, children)
}

function bmpString(value: string): Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BMPSTRING, false, value)
}

function sha1Bytes(buf: Buffer): Buffer {
  return Buffer.from(createHash('sha1').update(buf).digest())
}

function attrLocalKeyId(localKeyId: Buffer): Asn1 {
  return seq([oid(pkiOids.localKeyId), set([octet(localKeyId.toString('binary'))])])
}

function attrFriendlyName(name: string): Asn1 {
  return seq([oid(pkiOids.friendlyName), set([bmpString(name)])])
}

function attrTrustedKeyUsage(): Asn1 {
  return seq([oid(ORACLE_TRUSTED_KEY_USAGE_OID), set([oid(ANY_EXTENDED_KEY_USAGE_OID)])])
}

function certBag(certDer: Buffer, bagAttrs?: Asn1): Asn1 {
  const children: Asn1[] = [
    oid(pkiOids.certBag),
    ctx0([seq([oid(pkiOids.x509Certificate), ctx0([octet(certDer.toString('binary'))])])]),
  ]
  if (bagAttrs) children.push(bagAttrs)
  return seq(children)
}

function shroudedKeyBag(pkcs8Der: Buffer, password: string, bagAttrs: Asn1): Asn1 {
  const pkAsn1 = asn1.fromDer(pkcs8Der.toString('binary'))
  const encPki = forge.pki.encryptPrivateKeyInfo(pkAsn1, password, {
    algorithm: 'aes256',
    count: 2048,
    saltSize: 8,
  })
  return seq([oid(pkiOids.pkcs8ShroudedKeyBag), ctx0([encPki]), bagAttrs])
}

function dataContentInfo(safeContents: Asn1): Asn1 {
  return seq([oid(pkiOids.data), ctx0([octet(asn1.toDer(safeContents).getBytes())])])
}

/** Serialize the normalized model to multi-alias PKCS12 DER bytes. */
export function serializePkcs12(entries: EntryModel[], storePassword: string): Buffer {
  const certBags: Asn1[] = []
  const keyBags: Asn1[] = []

  for (const e of entries) {
    if (e.kind === 'key') {
      if (e.certChainDer.length === 0) {
        throw new KeystoreValidationException(`Key entry has no certificate chain: ${e.alias}`)
      }
      const localKeyId = sha1Bytes(e.certChainDer[0])
      const keyAttrs = set([attrLocalKeyId(localKeyId), attrFriendlyName(e.alias)])
      keyBags.push(shroudedKeyBag(e.privateKeyPkcs8Der, e.entryPassword || storePassword, keyAttrs))
      e.certChainDer.forEach((c, i) => {
        certBags.push(
          certBag(
            c,
            i === 0 ? set([attrLocalKeyId(localKeyId), attrFriendlyName(e.alias)]) : undefined,
          ),
        )
      })
    } else {
      const localKeyId = sha1Bytes(e.certDer)
      certBags.push(
        certBag(
          e.certDer,
          set([attrFriendlyName(e.alias), attrLocalKeyId(localKeyId), attrTrustedKeyUsage()]),
        ),
      )
    }
  }

  const contents: Asn1[] = []
  if (certBags.length) contents.push(dataContentInfo(seq(certBags)))
  if (keyBags.length) contents.push(dataContentInfo(seq(keyBags)))
  const safe = seq(contents)

  // MacData — HMAC-SHA1 over the AuthenticatedSafe, keyed with the store pw.
  const macSalt = forge.util.createBuffer(forge.random.getBytesSync(8))
  const count = 2048
  const macKey = forge.pkcs12.generateKey(storePassword, macSalt, 3, count, 20)
  const mac = forge.hmac.create()
  mac.start(forge.md.sha1.create(), macKey)
  mac.update(asn1.toDer(safe).getBytes())
  const macValue = mac.getMac()
  const macData = seq([
    seq([
      seq([oid(pkiOids.sha1), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')]),
      octet(macValue.getBytes()),
    ]),
    octet(macSalt.getBytes()),
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.INTEGER,
      false,
      asn1.integerToDer(count).getBytes(),
    ),
  ])

  const pfx = seq([
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(3).getBytes()),
    seq([oid(pkiOids.data), ctx0([octet(asn1.toDer(safe).getBytes())])]),
    macData,
  ])
  return Buffer.from(asn1.toDer(pfx).getBytes(), 'binary')
}

/** Parse PKCS12 DER into the normalized model (RSA + EC, using raw DER — forge
 * can't parse EC cert/key objects, so we read `bag.asn1` fallbacks). */
export function parsePkcs12(bytes: Buffer, password: string): EntryModel[] {
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1.fromDer(bytes.toString('binary')), password)
  } catch (e) {
    throw new KeystoreEngineException(
      'Password is wrong or the file is corrupt' + (e instanceof Error ? ` (${e.message})` : ''),
    )
  }

  interface RawKey {
    alias: string
    localKeyId?: string
    pkcs8Der: Buffer
  }
  interface RawCert {
    alias?: string
    localKeyId?: string
    certDer: Buffer
    trusted: boolean
  }
  const keys: RawKey[] = []
  const certs: RawCert[] = []

  for (const sc of p12.safeContents) {
    for (const bag of sc.safeBags) {
      const attrs = bag.attributes as {
        friendlyName?: string[]
        localKeyId?: string[]
      } & Record<string, unknown>
      const friendlyName = attrs.friendlyName?.[0]
      const localKeyId = attrs.localKeyId?.[0]
        ? Buffer.from(attrs.localKeyId[0], 'binary').toString('hex')
        : undefined
      const bagAsn1 = (bag as { asn1?: Asn1 }).asn1

      if (bag.type === pkiOids.pkcs8ShroudedKeyBag || bag.type === pkiOids.keyBag) {
        let pkcs8Der: Buffer
        if (bag.key) {
          const pkAsn1 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(bag.key))
          pkcs8Der = Buffer.from(asn1.toDer(pkAsn1).getBytes(), 'binary')
        } else if (bagAsn1) {
          pkcs8Der = Buffer.from(asn1.toDer(bagAsn1).getBytes(), 'binary')
        } else {
          continue
        }
        keys.push({ alias: friendlyName ?? localKeyId ?? 'key', localKeyId, pkcs8Der })
      } else if (bag.type === pkiOids.certBag) {
        let certDer: Buffer
        if (bag.cert) {
          certDer = Buffer.from(
            asn1.toDer(forge.pki.certificateToAsn1(bag.cert)).getBytes(),
            'binary',
          )
        } else if (bagAsn1) {
          certDer = Buffer.from(asn1.toDer(bagAsn1).getBytes(), 'binary')
        } else {
          continue
        }
        const trusted = ORACLE_TRUSTED_KEY_USAGE_OID in attrs
        certs.push({ alias: friendlyName, localKeyId, certDer, trusted })
      }
      // secretBag and unsupported bag types are skipped (Faz 0 scope).
    }
  }

  const usedCerts = new Set<RawCert>()
  const entries: EntryModel[] = []

  // Intermediate chain certs carry no localKeyId and no trusted flag; only the
  // leaf carries the key's localKeyId. Rebuild each chain by following
  // issuer→subject links through the un-attributed (orphan) certs.
  const dnOf = (c: RawCert): { subject: string; issuer: string } => {
    const nx = new X509Certificate(c.certDer)
    return { subject: nx.subject, issuer: nx.issuer }
  }

  for (const k of keys) {
    const leaf = certs.find((c) => c.localKeyId && c.localKeyId === k.localKeyId && !c.trusted)
    const chain: RawCert[] = []
    if (leaf) {
      chain.push(leaf)
      usedCerts.add(leaf)
      let current = dnOf(leaf)
      // Follow the chain through orphan (no-localKeyId, non-trusted) certs.
      for (;;) {
        if (current.subject === current.issuer) break // self-signed root reached
        const next = certs.find(
          (c) =>
            !usedCerts.has(c) && !c.trusted && !c.localKeyId && dnOf(c).subject === current.issuer,
        )
        if (!next) break
        chain.push(next)
        usedCerts.add(next)
        current = dnOf(next)
      }
    }
    entries.push({
      alias: k.alias,
      kind: 'key',
      privateKeyPkcs8Der: k.pkcs8Der,
      entryPassword: password,
      certChainDer: chain.map((c) => c.certDer),
    })
  }

  for (const c of certs) {
    if (usedCerts.has(c)) continue
    entries.push({
      alias: c.alias ?? c.localKeyId ?? 'cert',
      kind: 'cert',
      certDer: c.certDer,
    })
  }

  return entries
}

// ─────────────────────────────────────────────────────────────────────────────
// JKS read (jks-js) + write (jks-writer)
// ─────────────────────────────────────────────────────────────────────────────

function parseJks(bytes: Buffer, password: string): EntryModel[] {
  let pems: Record<string, { key?: string; cert?: string; ca?: string }>
  try {
    pems = jksjs.toPem(bytes, password) as typeof pems
  } catch (e) {
    throw new KeystoreEngineException(
      'Password is wrong or the file is corrupt' + (e instanceof Error ? ` (${e.message})` : ''),
    )
  }
  const entries: EntryModel[] = []
  for (const [alias, v] of Object.entries(pems)) {
    if (v.key) {
      const keyDer = firstPemDer(v.key, 'PRIVATE KEY')
      const chain = v.cert ? pemBlocksToDer(v.cert, 'CERTIFICATE') : []
      if (!keyDer) {
        throw new KeystoreEngineException(`Could not decode private key for alias: ${alias}`)
      }
      entries.push({
        alias,
        kind: 'key',
        privateKeyPkcs8Der: keyDer,
        entryPassword: password,
        certChainDer: chain,
      })
    } else {
      const certPem = v.ca ?? v.cert ?? ''
      const certDer = firstPemDer(certPem, 'CERTIFICATE')
      if (!certDer) continue
      entries.push({ alias, kind: 'cert', certDer })
    }
  }
  return entries
}

function serializeJks(entries: EntryModel[], storePassword: string): Buffer {
  const jksEntries: JksEntry[] = entries.map((e) =>
    e.kind === 'key'
      ? {
          alias: e.alias,
          type: 'key',
          privateKeyPkcs8Der: e.privateKeyPkcs8Der,
          entryPassword: e.entryPassword || storePassword,
          certChainDer: e.certChainDer,
        }
      : { alias: e.alias, type: 'cert', certDer: e.certDer },
  )
  return encodeJks(jksEntries, storePassword)
}

// ─────────────────────────────────────────────────────────────────────────────
// loadKeyStore / serialize (spec §6.2, §6.4)
// ─────────────────────────────────────────────────────────────────────────────

/** Parse keystore bytes into the normalized model. */
export function parseKeyStore(bytes: Buffer, password: string, type: KeystoreType): EntryModel[] {
  if (!bytes || bytes.length === 0) {
    throw new KeystoreValidationException('Keystore content cannot be empty')
  }
  return type === 'JKS' ? parseJks(bytes, password) : parsePkcs12(bytes, password)
}

/** Serialize the normalized model to keystore bytes. */
export function serializeKeyStore(
  entries: EntryModel[],
  type: KeystoreType,
  storePassword: string,
): Buffer {
  return type === 'JKS'
    ? serializeJks(entries, storePassword)
    : serializePkcs12(entries, storePassword)
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-signed key-pair generation (spec §6.8) — MINIMAL (Faz 0).
// ─────────────────────────────────────────────────────────────────────────────

function resolveSerialHex(serialNumber?: string): string {
  const s = (serialNumber ?? '').trim()
  let value: bigint
  if (!s) {
    value = BigInt(Date.now())
  } else if (/^0x/i.test(s)) {
    try {
      value = BigInt(s)
    } catch {
      throw new KeystoreValidationException(`Invalid serial number: ${serialNumber}`)
    }
  } else {
    try {
      value = BigInt(s)
    } catch {
      throw new KeystoreValidationException(`Invalid serial number: ${serialNumber}`)
    }
  }
  let hex = value.toString(16)
  if (hex.length % 2 !== 0) hex = '0' + hex
  return hex
}

function parseDnToForgeAttrs(dn: string): forge.pki.CertificateField[] {
  return dn
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const key = pair.slice(0, eq).trim().toUpperCase()
      const value = pair.slice(eq + 1).trim()
      const nameMap: Record<string, string> = {
        CN: 'commonName',
        O: 'organizationName',
        OU: 'organizationalUnitName',
        C: 'countryName',
        L: 'localityName',
        ST: 'stateOrProvinceName',
        E: 'emailAddress',
        EMAILADDRESS: 'emailAddress',
      }
      const name = nameMap[key]
      return name ? { name, value } : { shortName: key, value }
    })
}

const FORGE_KEY_USAGE = new Set([
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
])

function normalizeKeyUsage(usage: string): string {
  if (usage === 'contentCommitment') return 'nonRepudiation'
  return usage
}

function forgeMdFor(sigAlg: string): forge.md.MessageDigest {
  if (/512/.test(sigAlg)) return forge.md.sha512.create()
  if (/384/.test(sigAlg)) return forge.md.sha384.create()
  return forge.md.sha256.create()
}

function sanExtension(sans: string[]): ForgeExt {
  const altNames = sans.map((s) => {
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(':')
    return isIp ? { type: 7, ip: s } : { type: 2, value: s }
  })
  return { name: 'subjectAltName', altNames }
}

function generateRsaSelfSigned(opts: GenerateKeyPairOptions): {
  privateKeyPkcs8Der: Buffer
  certDer: Buffer
} {
  const bits = opts.keySize ?? 2048
  if (![1024, 2048, 3072, 4096].includes(bits)) {
    throw new KeystoreValidationException(`Unsupported RSA key size: ${bits}`)
  }
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: bits })
  const pkcs8Pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const pkcs8Der = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer
  const forgePriv = forge.pki.privateKeyFromPem(pkcs8Pem)
  const forgePub = forge.pki.setRsaPublicKey(forgePriv.n, forgePriv.e)

  const cert = forge.pki.createCertificate()
  cert.publicKey = forgePub
  cert.serialNumber = resolveSerialHex(opts.serialNumber)
  const now = new Date()
  const days = Math.max(1, opts.validityDays ?? 365)
  cert.validity.notBefore = now
  cert.validity.notAfter = new Date(now.getTime() + days * 86400000)
  const subject = parseDnToForgeAttrs(opts.subjectDN?.trim() || `CN=${opts.alias}`)
  cert.setSubject(subject)
  cert.setIssuer(subject)

  const extensions: ForgeExt[] = [
    { name: 'basicConstraints', cA: !!opts.basicConstraintsCa, critical: true },
  ]
  if (opts.keyUsage && opts.keyUsage.length) {
    const usageExt: ForgeExt = { name: 'keyUsage', critical: true }
    for (const raw of opts.keyUsage) {
      const u = normalizeKeyUsage(raw)
      if (!FORGE_KEY_USAGE.has(u))
        throw new KeystoreValidationException(`Unsupported key usage: ${raw}`)
      usageExt[u] = true
    }
    extensions.push(usageExt)
  }
  if (opts.subjectAlternativeNames && opts.subjectAlternativeNames.length) {
    extensions.push(sanExtension(opts.subjectAlternativeNames))
  }
  cert.setExtensions(extensions as unknown as Parameters<typeof cert.setExtensions>[0])
  cert.sign(forgePriv, forgeMdFor(opts.signatureAlgorithm ?? 'SHA256withRSA'))

  const certDer = Buffer.from(asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary')
  return { privateKeyPkcs8Der: pkcs8Der, certDer }
}

const EC_CURVE_WEB: Record<string, 'P-256' | 'P-384' | 'P-521'> = {
  'P-256': 'P-256',
  SECP256R1: 'P-256',
  PRIME256V1: 'P-256',
  'P-384': 'P-384',
  SECP384R1: 'P-384',
  'P-521': 'P-521',
  SECP521R1: 'P-521',
}

async function generateEcSelfSigned(opts: GenerateKeyPairOptions): Promise<{
  privateKeyPkcs8Der: Buffer
  certDer: Buffer
}> {
  const rawCurve = (opts.curve ?? 'P-256').trim()
  const key = rawCurve.toUpperCase()
  if (key === 'SECP256K1') {
    throw new KeystoreValidationException('Unsupported EC curve: secp256k1')
  }
  const namedCurve = EC_CURVE_WEB[key]
  if (!namedCurve) {
    throw new KeystoreValidationException(`Unsupported EC curve: ${opts.curve}`)
  }
  const hash = /384/.test(opts.signatureAlgorithm ?? '')
    ? 'SHA-384'
    : /512/.test(opts.signatureAlgorithm ?? '')
      ? 'SHA-512'
      : 'SHA-256'

  const keys = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair

  const now = new Date()
  const days = Math.max(1, opts.validityDays ?? 365)
  const extensions: x509.Extension[] = [
    new x509.BasicConstraintsExtension(!!opts.basicConstraintsCa, undefined, true),
  ]
  if (opts.keyUsage && opts.keyUsage.length) {
    extensions.push(new x509.KeyUsagesExtension(mapKeyUsageFlags(opts.keyUsage), true))
  }
  if (opts.subjectAlternativeNames && opts.subjectAlternativeNames.length) {
    const generalNames: x509.JsonGeneralName[] = opts.subjectAlternativeNames.map((s) => {
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(':')
      return { type: isIp ? 'ip' : 'dns', value: s }
    })
    extensions.push(new x509.SubjectAlternativeNameExtension(generalNames))
  }

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: resolveSerialHex(opts.serialNumber),
    name: opts.subjectDN?.trim() || `CN=${opts.alias}`,
    notBefore: now,
    notAfter: new Date(now.getTime() + days * 86400000),
    signingAlgorithm: { name: 'ECDSA', hash },
    keys,
    extensions,
  })

  const pkcs8Der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey))
  return { privateKeyPkcs8Der: pkcs8Der, certDer: Buffer.from(cert.rawData) }
}

function mapKeyUsageFlags(usages: string[]): number {
  const F = x509.KeyUsageFlags
  const map: Record<string, number> = {
    digitalSignature: F.digitalSignature,
    nonRepudiation: F.nonRepudiation,
    contentCommitment: F.nonRepudiation,
    keyEncipherment: F.keyEncipherment,
    dataEncipherment: F.dataEncipherment,
    keyAgreement: F.keyAgreement,
    keyCertSign: F.keyCertSign,
    cRLSign: F.cRLSign,
    encipherOnly: F.encipherOnly,
    decipherOnly: F.decipherOnly,
  }
  let flags = 0
  for (const u of usages) {
    if (!(u in map)) throw new KeystoreValidationException(`Unsupported key usage: ${u}`)
    flags |= map[u]
  }
  return flags
}

// ─────────────────────────────────────────────────────────────────────────────
// KeystoreEngine — owns the session Map (design §3.3–3.4).
// ─────────────────────────────────────────────────────────────────────────────

function requireNonBlank(value: string | undefined | null, message: string): string {
  if (!value || !value.trim()) throw new KeystoreValidationException(message)
  return value
}

function summarize(entry: EntryModel): AliasSummary {
  if (entry.kind === 'key') {
    const leaf = entry.certChainDer[0]
    const base: AliasSummary = {
      alias: entry.alias,
      entryType: 'KEY',
      hasPrivateKey: true,
      chainLength: entry.certChainDer.length,
    }
    if (leaf) {
      const info = buildCertificateInfo(leaf)
      base.subjectDN = info.subjectDN
      base.issuerDN = info.issuerDN
      base.notBefore = info.notBefore
      base.notAfter = info.notAfter
      base.keyAlgorithm = info.publicKeyAlgorithm
    }
    return base
  }
  const info = buildCertificateInfo(entry.certDer)
  return {
    alias: entry.alias,
    entryType: 'CERTIFICATE',
    hasPrivateKey: false,
    chainLength: 1,
    subjectDN: info.subjectDN,
    issuerDN: info.issuerDN,
    notBefore: info.notBefore,
    notAfter: info.notAfter,
    keyAlgorithm: info.publicKeyAlgorithm,
  }
}

export class KeystoreEngine {
  private readonly sessions = new Map<string, KeystoreSession>()

  private getSession(sessionId: string): KeystoreSession {
    const s = this.sessions.get(sessionId)
    if (!s) throw new KeystoreValidationException(`Unknown keystore session: ${sessionId}`)
    return s
  }

  private meta(session: KeystoreSession): KeystoreMeta {
    return {
      type: session.type,
      aliasCount: session.entries.length,
      aliases: session.entries.map(summarize),
    }
  }

  /** Persist a session's current model to bytes and return them. */
  serialize(sessionId: string): Buffer {
    const s = this.getSession(sessionId)
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return s.bytes
  }

  /** Create an empty keystore (spec §4.1). */
  createEmpty(type: string, storePassword: string): { sessionId: string; meta: KeystoreMeta } {
    requireNonBlank(storePassword, 'Store password cannot be empty')
    const resolved = resolveType(type)
    const session: KeystoreSession = {
      id: randomUUID(),
      type: resolved,
      storePassword,
      entries: [],
      aliasEntryPasswords: new Map(),
      bytes: Buffer.alloc(0),
    }
    session.bytes = serializeKeyStore(session.entries, session.type, session.storePassword)
    this.sessions.set(session.id, session)
    return { sessionId: session.id, meta: this.meta(session) }
  }

  /** Open existing keystore bytes (spec §4.2 / §6.2). */
  open(bytes: Buffer, password: string, type?: string): { sessionId: string; meta: KeystoreMeta } {
    const resolved = resolveType(type)
    const entries = parseKeyStore(bytes, password ?? '', resolved)
    const aliasEntryPasswords = new Map<string, string>()
    const session: KeystoreSession = {
      id: randomUUID(),
      type: resolved,
      storePassword: password ?? '',
      entries,
      aliasEntryPasswords,
      bytes,
    }
    this.sessions.set(session.id, session)
    return { sessionId: session.id, meta: this.meta(session) }
  }

  /** loadOrCreate (spec §6.3): open bytes if present, else start empty. */
  loadOrCreate(
    bytes: Buffer | null | undefined,
    password: string,
    type?: string,
  ): { sessionId: string; meta: KeystoreMeta } {
    if (bytes && bytes.length > 0) return this.open(bytes, password, type)
    return this.createEmpty(type ?? 'JKS', password)
  }

  /** Inspect — alias summaries only (spec §4.2 / §6.5). */
  inspect(sessionId: string): KeystoreMeta {
    return this.meta(this.getSession(sessionId))
  }

  /** Alias detail — full CertificateInfo chain (spec §4.3 / §6.6). */
  aliasDetail(sessionId: string, alias: string): KeystoreAliasDetail {
    const s = this.getSession(sessionId)
    requireNonBlank(alias, 'Alias cannot be empty')
    const entry = s.entries.find((e) => e.alias === alias)
    if (!entry) throw new KeystoreValidationException(`Alias not found: ${alias}`)
    const chain =
      entry.kind === 'key'
        ? entry.certChainDer.map(buildCertificateInfo)
        : [buildCertificateInfo(entry.certDer)]
    return {
      alias,
      entryType: entry.kind === 'key' ? 'KEY' : 'CERTIFICATE',
      hasPrivateKey: entry.kind === 'key',
      chain,
    }
  }

  /** Generate a key pair + self-signed cert and add it (spec §4.8 / §6.8). */
  async generateKeyPair(sessionId: string, opts: GenerateKeyPairOptions): Promise<KeystoreMeta> {
    const s = this.getSession(sessionId)
    const alias = requireNonBlank(opts.alias, 'Alias cannot be empty')
    if (s.entries.some((e) => e.alias === alias)) {
      throw new KeystoreValidationException(`Alias already exists: ${alias}`)
    }
    const algo = (opts.keyAlgorithm ?? 'RSA').trim().toUpperCase()
    let material: { privateKeyPkcs8Der: Buffer; certDer: Buffer }
    if (algo === 'RSA') {
      material = generateRsaSelfSigned(opts)
    } else if (algo === 'EC') {
      material = await generateEcSelfSigned(opts)
    } else {
      throw new KeystoreValidationException(`Unsupported key algorithm: ${opts.keyAlgorithm}`)
    }
    const entryPassword =
      opts.entryPassword && opts.entryPassword.trim() ? opts.entryPassword : s.storePassword
    s.entries.push({
      alias,
      kind: 'key',
      privateKeyPkcs8Der: material.privateKeyPkcs8Der,
      entryPassword,
      certChainDer: [material.certDer],
    })
    if (opts.entryPassword && opts.entryPassword.trim()) {
      s.aliasEntryPasswords.set(alias, opts.entryPassword)
    }
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  /** Dispose a session (frees bytes/passwords held in main). */
  close(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /** Test/introspection helper — number of live sessions. */
  get sessionCount(): number {
    return this.sessions.size
  }
}

/** Process-wide singleton (the IPC handler will use this in Faz 1). */
export const keystoreEngine = new KeystoreEngine()
