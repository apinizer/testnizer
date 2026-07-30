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
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify,
  webcrypto,
  X509Certificate,
  type KeyObject,
} from 'node:crypto'
import forge from 'node-forge'
import * as x509 from '@peculiar/x509'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — jks-js ships no type declarations
import * as jksjs from 'jks-js'
import { encodeJks, type JksEntry } from './jks-writer'
import { safeFileName } from './filename-safe'

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
  /** Unsaved-changes flag (design §9.7 dirty-guard). Set by any mutation,
   * cleared by `saveAs`. Absent on the read-only viewer projections is fine —
   * callers treat `undefined` as `false`. */
  dirty?: boolean
}

/** Certificate export encodings (design §4.14 / §6.12). */
export type ExportFormat = 'DER' | 'PEM' | 'PKCS7' | 'PKIPATH'

/**
 * Result of `exportCertificate` — PUBLIC certificate bytes only (never a private
 * key, design invariant 1). The handler writes `bytes` to a user-picked path via
 * a save dialog; the renderer only ever learns the resulting `{path}`.
 */
export interface ExportCertificateResult {
  bytes: Buffer
  fileName: string
  contentType: string
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

export interface GenerateSecretKeyOptions {
  alias: string
  /** Only `AES` is supported (design §4.9). Defaults to `AES`. */
  keyAlgorithm?: string
  /** AES key size in bits — 128 | 192 | 256. Defaults to 256. */
  keySize?: number
  entryPassword?: string
}

/** Import a PKCS12 source keystore via `copyEntry` semantics (spec §4.4 / §6.10). */
export interface ImportPkcs12Options {
  /** Source keystore bytes — read in MAIN (never surfaced to the renderer). */
  sourceBytes: Buffer
  sourcePassword?: string
  /** Copy just this source alias; omitted ⇒ copy ALL importable entries. */
  sourceAlias?: string
  /** Rename the copied entry (only meaningful for a single-entry copy). */
  targetAlias?: string
}

/** Import a raw private key + certificate chain (spec §4.5 / §6.7 / §6.11). */
export interface ImportKeyMaterialOptions {
  alias: string
  privateKeyPem: string
  certificatePem: string
}

/** Import a pasted PEM block (key+cert ⇒ key entry, cert-only ⇒ trusted) (spec §4.6). */
export interface ImportPemOptions {
  alias: string
  pemContent: string
}

/** Import a trusted certificate from PEM or base64 DER (spec §4.7). */
export interface ImportTrustedCertificateOptions {
  alias: string
  certificateContent: string
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

/** A symmetric (secret) key entry — PKCS12-only (JKS cannot hold secret keys). */
interface SecretEntryModel {
  alias: string
  kind: 'secret'
  /** Symmetric algorithm — only `AES` in scope (design §4.9). */
  keyAlgorithm: string
  /** Raw symmetric key bytes — stays in main, NEVER surfaced to the renderer. */
  secretKeyRaw: Buffer
  entryPassword: string
}

type EntryModel = KeyEntryModel | CertEntryModel | SecretEntryModel

interface KeystoreSession {
  id: string
  type: KeystoreType
  storePassword: string
  entries: EntryModel[]
  /** alias → per-entry key password (JKS entry pw may differ from store pw). */
  aliasEntryPasswords: Map<string, string>
  /** Last serialized bytes — kept ONLY in main (design §3.4). */
  bytes: Buffer
  /** Unsaved-changes flag (design §9.7). Any mutation sets it; `saveAs` clears. */
  dirty: boolean
  /** Epoch ms of the last access — drives idle eviction (design R8). */
  lastAccess: number
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
    // Canonical minimal lowercase hex (spec §8/KS-F2-23..25): no leading zero,
    // no even-length pad. Node's X509 serialNumber getter keeps the DER pad
    // (e.g. 0A1B2C3D / 075BCD15); normalize it back to the integer's hex form.
    serialNumber: BigInt('0x' + nx.serialNumber).toString(16),
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

// Secret (symmetric) key bags — PKCS12 SecretBag holding a pkcs8ShroudedKeyBag
// whose EncryptedPrivateKeyInfo wraps a PKCS#8 PrivateKeyInfo carrying the raw
// symmetric key. This is byte-for-byte the shape Oracle keytool writes for
// `-genseckey` (verified via `openssl asn1parse` on a keytool secret.p12), so
// `keytool -list` reports the alias as a SecretKeyEntry.
//   SafeBag { bagId=secretBag,
//             [0] SecretBag { secretTypeId=pkcs8ShroudedKeyBag,
//                             [0] OCTETSTRING(EncryptedPrivateKeyInfo) },
//             attrs }
// AES parent OID — matches keytool's PrivateKeyInfo algorithm for AES secrets.
const AES_ALGORITHM_OID = '2.16.840.1.101.3.4.1'

/** Build the inner PKCS#8 PrivateKeyInfo that wraps a raw symmetric key. */
function secretKeyPkcs8(secretRaw: Buffer, algorithmOid: string): Buffer {
  const pki = seq([
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(0).getBytes()),
    seq([oid(algorithmOid)]),
    octet(secretRaw.toString('binary')),
  ])
  return Buffer.from(asn1.toDer(pki).getBytes(), 'binary')
}

function secretBag(
  secretRaw: Buffer,
  algorithmOid: string,
  password: string,
  bagAttrs: Asn1,
): Asn1 {
  const pkcs8Der = secretKeyPkcs8(secretRaw, algorithmOid)
  const encPki = forge.pki.encryptPrivateKeyInfo(
    asn1.fromDer(pkcs8Der.toString('binary')),
    password,
    {
      algorithm: 'aes256',
      count: 2048,
      saltSize: 8,
    },
  )
  const inner = seq([
    oid(pkiOids.pkcs8ShroudedKeyBag),
    ctx0([octet(asn1.toDer(encPki).getBytes())]),
  ])
  return seq([oid(pkiOids.secretBag), ctx0([inner]), bagAttrs])
}

/** Serialize the normalized model to multi-alias PKCS12 DER bytes. */
export function serializePkcs12(entries: EntryModel[], storePassword: string): Buffer {
  const certBags: Asn1[] = []
  const keyBags: Asn1[] = []

  for (const e of entries) {
    if (e.kind === 'secret') {
      const localKeyId = sha1Bytes(Buffer.from(e.alias, 'utf8'))
      const attrs = set([attrFriendlyName(e.alias), attrLocalKeyId(localKeyId)])
      keyBags.push(
        secretBag(e.secretKeyRaw, AES_ALGORITHM_OID, e.entryPassword || storePassword, attrs),
      )
    } else if (e.kind === 'key') {
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

/** Big-endian DER INTEGER content bytes → number (iteration counts only). */
function derContentToInt(bin: string): number {
  let n = 0
  for (let i = 0; i < bin.length; i++) n = n * 256 + bin.charCodeAt(i)
  return n
}

/**
 * node-forge's PKCS12 parser hard-throws on `secretBag` SafeBags, so before we
 * hand the PFX to forge we walk it, lift out any secret keys into the normalized
 * model, and rebuild a forge-parseable PFX with the secret bags removed and the
 * store MAC recomputed over the filtered AuthenticatedSafe. When there are no
 * secret bags the original bytes are returned untouched (forge sees the exact
 * same input as before — existing key/cert-only keystores are unaffected).
 */
function stripSecretBags(
  bytes: Buffer,
  password: string,
): { secretEntries: SecretEntryModel[]; filtered: Buffer } {
  const noChange = { secretEntries: [] as SecretEntryModel[], filtered: bytes }
  let pfx: Asn1
  try {
    pfx = asn1.fromDer(bytes.toString('binary'))
  } catch {
    return noChange
  }
  const pfxChildren = pfx.value as Asn1[]
  const authSafeCi = pfxChildren[1]
  if (!authSafeCi || !Array.isArray(authSafeCi.value)) return noChange
  const authSafeContent = (authSafeCi.value as Asn1[])[1]
  const authSafeOctet = authSafeContent && (authSafeContent.value as Asn1[])[0]
  if (!authSafeOctet || typeof authSafeOctet.value !== 'string') return noChange

  let authSafe: Asn1
  try {
    authSafe = asn1.fromDer(authSafeOctet.value)
  } catch {
    return noChange
  }
  const contentInfos = authSafe.value as Asn1[]
  const secretEntries: SecretEntryModel[] = []
  let mutated = false

  const rebuiltContentInfos = contentInfos.map((ci) => {
    const ciChildren = ci.value as Asn1[]
    const ciTypeNode = ciChildren[0]
    if (!ciTypeNode || typeof ciTypeNode.value !== 'string') return ci
    if (asn1.derToOid(ciTypeNode.value) !== pkiOids.data) return ci // encrypted / non-plain
    const ctx = ciChildren[1]
    const scOctet = ctx && (ctx.value as Asn1[])[0]
    if (!scOctet || typeof scOctet.value !== 'string') return ci
    let safeContents: Asn1
    try {
      safeContents = asn1.fromDer(scOctet.value)
    } catch {
      return ci
    }
    const bags = safeContents.value as Asn1[]
    const keptBags: Asn1[] = []
    for (const bag of bags) {
      const bagChildren = bag.value as Asn1[]
      const bagId = bagChildren[0]
      if (
        bagId &&
        typeof bagId.value === 'string' &&
        asn1.derToOid(bagId.value) === pkiOids.secretBag
      ) {
        const entry = decodeSecretBag(bag, password)
        if (entry) {
          secretEntries.push(entry)
          mutated = true
          continue
        }
      }
      keptBags.push(bag)
    }
    if (!mutated || keptBags.length === bags.length) return ci
    const newSc = octet(asn1.toDer(seq(keptBags)).getBytes())
    return seq([oid(pkiOids.data), ctx0([newSc])])
  })

  if (!mutated) return noChange

  const newAuthSafeBytes = asn1.toDer(seq(rebuiltContentInfos)).getBytes()
  const newAuthSafeCi = seq([oid(pkiOids.data), ctx0([octet(newAuthSafeBytes)])])

  // Recompute the store MAC over the filtered AuthenticatedSafe, reusing the
  // original salt + iteration count so forge's verification passes.
  const macData = pfxChildren[2]
  const newChildren: Asn1[] = [pfxChildren[0], newAuthSafeCi]
  if (macData && Array.isArray(macData.value)) {
    const macChildren = macData.value as Asn1[]
    const macSaltNode = macChildren[1]
    const iterNode = macChildren[2]
    const macSaltBin = typeof macSaltNode?.value === 'string' ? macSaltNode.value : ''
    const iterations =
      iterNode && typeof iterNode.value === 'string' ? derContentToInt(iterNode.value) : 2048
    const macSaltBuf = forge.util.createBuffer(macSaltBin)
    const macKey = forge.pkcs12.generateKey(password, macSaltBuf, 3, iterations, 20)
    const hmac = forge.hmac.create()
    hmac.start(forge.md.sha1.create(), macKey)
    hmac.update(newAuthSafeBytes)
    const macValue = hmac.getMac()
    newChildren.push(
      seq([
        seq([
          seq([oid(pkiOids.sha1), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')]),
          octet(macValue.getBytes()),
        ]),
        octet(macSaltBin),
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.INTEGER,
          false,
          asn1.integerToDer(iterations).getBytes(),
        ),
      ]),
    )
  }
  const filtered = Buffer.from(asn1.toDer(seq(newChildren)).getBytes(), 'binary')
  return { secretEntries, filtered }
}

/** Decode one `secretBag` SafeBag into a SecretEntryModel (null if undecryptable). */
function decodeSecretBag(bag: Asn1, password: string): SecretEntryModel | null {
  try {
    const children = bag.value as Asn1[]
    const secretBagSeq = (children[1].value as Asn1[])[0]
    const sbChildren = secretBagSeq.value as Asn1[]
    const epkiOctet = (sbChildren[1].value as Asn1[])[0]
    if (typeof epkiOctet.value !== 'string') return null
    const epki = asn1.fromDer(epkiOctet.value)
    const pkcs8 = forge.pki.decryptPrivateKeyInfo(epki, password)
    if (!pkcs8) return null
    const pkChildren = pkcs8.value as Asn1[]
    const rawNode = pkChildren[2]
    if (typeof rawNode.value !== 'string') return null
    const secretKeyRaw = Buffer.from(rawNode.value, 'binary')

    // friendlyName from bag attributes (SET of {oid, SET{value}}).
    let alias = ''
    const attrsSet = children[2]
    if (attrsSet && Array.isArray(attrsSet.value)) {
      for (const attr of attrsSet.value as Asn1[]) {
        const ac = attr.value as Asn1[]
        if (
          typeof ac[0].value === 'string' &&
          asn1.derToOid(ac[0].value) === pkiOids.friendlyName
        ) {
          // forge's asn1 parser already decodes BMPSTRING content into a JS string.
          const v = (ac[1].value as Asn1[])[0]
          if (typeof v.value === 'string') alias = v.value
        }
      }
    }
    return {
      alias: alias || 'secret',
      kind: 'secret',
      keyAlgorithm: 'AES',
      secretKeyRaw,
      entryPassword: password,
    }
  } catch {
    return null
  }
}

/** SPKI DER of the public half of a PKCS#8 private key, or null if it can't be
 * derived (used to pair a key to its cert when localKeyId is absent). */
function spkiFromPkcs8Der(pkcs8Der: Buffer): Buffer | null {
  try {
    const priv = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' })
    return createPublicKey(priv).export({ type: 'spki', format: 'der' }) as Buffer
  } catch {
    return null
  }
}

/** SPKI DER of a certificate's public key, or null if it can't be read. */
function spkiFromCertDer(certDer: Buffer): Buffer | null {
  try {
    return new X509Certificate(certDer).publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  } catch {
    return null
  }
}

/** Parse PKCS12 DER into the normalized model (RSA + EC, using raw DER — forge
 * can't parse EC cert/key objects, so we read `bag.asn1` fallbacks). Secret keys
 * are lifted out first (forge throws on `secretBag`) and merged back in. */
export function parsePkcs12(
  bytes: Buffer,
  password: string,
  // Accepted for signature parity with parseJks / parseKeyStore (design §3.1).
  // PKCS12 protects every bag + the MAC with the ONE store password (design §4;
  // "PKCS12 uses one password"), so node-forge decrypts all bags with `password`;
  // the per-alias map is a no-op here and every distinct-entry-password scenario
  // is exercised on JKS instead.
  _aliasEntryPasswords?: Map<string, string>,
): EntryModel[] {
  const { secretEntries, filtered } = stripSecretBags(bytes, password)
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1.fromDer(filtered.toString('binary')), password)
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
    // Pair the key to its leaf by localKeyId (the common case). A P12 that omits
    // localKeyId attributes (some Windows CryptoAPI / manual exports) leaves the
    // key with no match — fall back to the cert whose SPKI equals the key's
    // derived SPKI (authoritative), then to the sole unclaimed non-trusted cert.
    // localKeyId is only ever a hint here.
    let leaf = k.localKeyId
      ? certs.find((c) => c.localKeyId === k.localKeyId && !c.trusted && !usedCerts.has(c))
      : undefined
    if (!leaf) {
      const keySpki = spkiFromPkcs8Der(k.pkcs8Der)
      const unclaimed = certs.filter((c) => !usedCerts.has(c) && !c.trusted)
      if (keySpki) {
        leaf = unclaimed.find((c) => {
          const cs = spkiFromCertDer(c.certDer)
          return cs !== null && cs.equals(keySpki)
        })
      }
      if (!leaf && unclaimed.length === 1) leaf = unclaimed[0]
    }
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

  entries.push(...secretEntries)
  return entries
}

/**
 * Canonical §8 recovery-failure string, shared by every op that must read a key
 * entry protected with a password different from the store password (open/reopen,
 * renameAlias, setEntryPassword, changeStorePassword, convert). Never interpolate
 * any password — only the alias.
 */
export function recoveryMessage(alias: string): string {
  return (
    `Cannot recover key entry '${alias}'. The entry password differs from the ` +
    `store password — please provide the entry password.`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// JKS read (jks-js) + write (jks-writer)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal shape of the entries `jks-js`'s `parseJks` returns (it ships no types).
 * A key entry carries the raw EncryptedPrivateKeyInfo bytes + the cert chain; a
 * trusted entry carries a single certificate. We decrypt each key ourselves with
 * its per-alias password so JKS entry passwords that differ from the store
 * password are honoured (design §3.1). */
interface JksJsCert {
  value: Buffer
}
interface JksJsKeyEntry {
  alias: string
  protectedPrivateKey: Buffer
  chain: JksJsCert[]
}
interface JksJsTrustedEntry {
  alias: string
  cert: JksJsCert
}
type JksJsEntry = JksJsKeyEntry | JksJsTrustedEntry

// TODO(follow-up): lazy JKS parse — defer key decryption to the first key-op
// (like `keytool -list`) so open+inspect works without ANY key password. The
// `aliasEntryPasswords` threading below already restores correctness (a store
// whose key pw ≠ store pw is openable by supplying the entry password); lazy
// parse is a future ergonomics enhancement, not a correctness gap.
function parseJks(
  bytes: Buffer,
  password: string,
  aliasEntryPasswords?: Map<string, string>,
): EntryModel[] {
  let jksEntries: JksJsEntry[]
  try {
    // Validates the store integrity hash with the store password; does NOT yet
    // decrypt the individual key blobs (that is deferred to `decrypt` below so
    // each entry can be recovered with its own password).
    jksEntries = jksjs.parseJks(bytes, password) as JksJsEntry[]
  } catch (e) {
    throw new KeystoreEngineException(
      'Password is wrong or the file is corrupt' + (e instanceof Error ? ` (${e.message})` : ''),
    )
  }
  const entries: EntryModel[] = []
  for (const je of jksEntries) {
    if ('protectedPrivateKey' in je) {
      // Per-alias entry password, falling back to the store password (design §3.1).
      const entryPassword = aliasEntryPasswords?.get(je.alias) ?? password
      let keyPem: string
      try {
        keyPem = jksjs.decrypt(je.protectedPrivateKey, entryPassword) as string
      } catch {
        // jks-js throws "Cannot recover key" when the protector integrity digest
        // fails — i.e. the supplied entry/store password is wrong for this key.
        throw new KeystoreValidationException(recoveryMessage(je.alias))
      }
      const keyDer = firstPemDer(keyPem, 'PRIVATE KEY')
      if (!keyDer) {
        throw new KeystoreEngineException(`Could not decode private key for alias: ${je.alias}`)
      }
      entries.push({
        alias: je.alias,
        kind: 'key',
        privateKeyPkcs8Der: keyDer,
        entryPassword,
        certChainDer: je.chain.map((c) => Buffer.from(c.value)),
      })
    } else {
      const certDer = je.cert?.value ? Buffer.from(je.cert.value) : undefined
      if (!certDer) continue
      entries.push({ alias: je.alias, kind: 'cert', certDer })
    }
  }
  return entries
}

function serializeJks(entries: EntryModel[], storePassword: string): Buffer {
  const jksEntries: JksEntry[] = entries.map((e) => {
    if (e.kind === 'secret') {
      // Unreachable via generateSecretKey (which rejects JKS up front); guard so
      // a secret entry can never be silently mis-serialized as a cert.
      throw new KeystoreValidationException('Secret keys can only be stored in a PKCS12 keystore')
    }
    return e.kind === 'key'
      ? {
          alias: e.alias,
          type: 'key',
          privateKeyPkcs8Der: e.privateKeyPkcs8Der,
          entryPassword: e.entryPassword || storePassword,
          certChainDer: e.certChainDer,
        }
      : { alias: e.alias, type: 'cert', certDer: e.certDer }
  })
  return encodeJks(jksEntries, storePassword)
}

// ─────────────────────────────────────────────────────────────────────────────
// loadKeyStore / serialize (spec §6.2, §6.4)
// ─────────────────────────────────────────────────────────────────────────────

/** Parse keystore bytes into the normalized model. `aliasEntryPasswords` supplies
 * per-alias key passwords for reopening a store whose entries were protected with
 * passwords different from the store password (design §3.1). */
export function parseKeyStore(
  bytes: Buffer,
  password: string,
  type: KeystoreType,
  aliasEntryPasswords?: Map<string, string>,
): EntryModel[] {
  if (!bytes || bytes.length === 0) {
    throw new KeystoreValidationException('Keystore content cannot be empty')
  }
  return type === 'JKS'
    ? parseJks(bytes, password, aliasEntryPasswords)
    : parsePkcs12(bytes, password, aliasEntryPasswords)
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
// exportAliasPem (Key Material Provider #60, design §2.2) — THE private-key
// extraction door.
//
// This is the ONLY function that turns a keystore alias into private-key PEM.
// It deliberately lives INSIDE the engine (rather than exporting `EntryModel`)
// so private-key material is materialized in exactly one place; the
// keystore-bridge resolver consumes PEM strings and never sees the internal
// model. `node:crypto` only — no ESM dependency is dragged into the
// externalized main bundle (CLAUDE.md ERR_REQUIRE_ESM gotcha).
// ─────────────────────────────────────────────────────────────────────────────

export interface AliasPemMaterial {
  /** Leaf certificate PEM (chain position 0). */
  certPem: string
  /** Unencrypted PKCS#8 private-key PEM. MAIN-ONLY — never crosses to the renderer. */
  keyPem: string
  /** Intermediates/root, leaf-first order (chain positions 1..n). May be empty. */
  chainPem: string[]
}

/**
 * Materialize one keystore alias as PEM.
 *
 * R11 double-password: `storePassword` opens the store; `keyPassword` is the
 * per-alias ENTRY password for a JKS whose entry pw ≠ store pw. It is threaded
 * through the same `aliasEntryPasswords` map the Faz-B4 reopen path already
 * uses, so JKS entry passwords are honoured TODAY. PKCS12 readers still open
 * with a single password (`parsePkcs12` ignores the map), so for PKCS12 the
 * parameter is currently inert — a wrong-password PKCS12 alias fails loud
 * rather than silently returning nothing.
 *
 * Throws (never returns empty) when: the store will not open, the alias is
 * missing, the alias holds no private key, or the entry password is wrong.
 */
export function exportAliasPem(
  bytes: Buffer,
  storePassword: string,
  type: KeystoreType,
  alias: string,
  keyPassword?: string,
): AliasPemMaterial {
  const aliasEntryPasswords = keyPassword
    ? new Map<string, string>([[alias, keyPassword]])
    : undefined
  const entries = parseKeyStore(bytes, storePassword, type, aliasEntryPasswords)
  // keytool lower-cases aliases on write; accept a case-insensitive match so a
  // stored `keystore_alias` typed by the user still resolves.
  const entry =
    entries.find((e) => e.alias === alias) ??
    entries.find((e) => e.alias.toLowerCase() === alias.toLowerCase())
  if (!entry) {
    throw new KeystoreValidationException(`Alias not found in keystore: ${alias}`)
  }
  if (entry.kind !== 'key') {
    throw new KeystoreValidationException(
      `Alias '${alias}' holds no private key (it is a ${entry.kind === 'cert' ? 'trusted certificate' : 'secret key'} entry).`,
    )
  }
  if (entry.certChainDer.length === 0) {
    throw new KeystoreEngineException(`Alias '${alias}' has no certificate chain.`)
  }
  const keyPem = createPrivateKey({
    key: entry.privateKeyPkcs8Der,
    format: 'der',
    type: 'pkcs8',
  })
    .export({ format: 'pem', type: 'pkcs8' })
    .toString()
  const certPem = new X509Certificate(entry.certChainDer[0]).toString()
  const chainPem = entry.certChainDer.slice(1).map((d) => new X509Certificate(d).toString())
  return { certPem, keyPem, chainPem }
}

/**
 * Aliases of the PRIVATE-KEY entries in a keystore, in file order. Public
 * metadata only — lets the keystore-bridge resolve an ad-hoc container file
 * without ever touching the internal (un-exported) entry model.
 */
export function listKeyAliases(bytes: Buffer, storePassword: string, type: KeystoreType): string[] {
  return parseKeyStore(bytes, storePassword, type)
    .filter((e) => e.kind === 'key')
    .map((e) => e.alias)
}

// ─────────────────────────────────────────────────────────────────────────────
// Certificate export encoders (spec §4.14 / §6.12) — Faz B4. PUBLIC cert bytes
// only: DER (raw leaf), PEM (leaf), PKCS7 (full chain, forge-degenerate
// SignedData), PkiPath (root-first SEQUENCE OF Certificate). Each parses a cert
// DER through forge's generic ASN.1 reader (round-trips ANY cert incl. EC, which
// forge's cert-specific parser cannot).
// ─────────────────────────────────────────────────────────────────────────────

// PKCS#7 signedData / data content-type OIDs (RFC 2315).
const PKCS7_SIGNED_DATA_OID = '1.2.840.113549.1.7.2'

function intAsn1(value: number): Asn1 {
  return asn1.create(
    asn1.Class.UNIVERSAL,
    asn1.Type.INTEGER,
    false,
    asn1.integerToDer(value).getBytes(),
  )
}

/** Raw DER leaf certificate (design §4.14 DER row — `.cer`). */
function exportDer(leafDer: Buffer): Buffer {
  return leafDer
}

/** 64-column PEM of the leaf certificate (design §4.14 PEM row — `.pem`). */
function exportPem(leafDer: Buffer): Buffer {
  // Node's X509 toString() emits a BEGIN/END CERTIFICATE PEM block.
  return Buffer.from(new X509Certificate(leafDer).toString(), 'utf8')
}

/**
 * Degenerate PKCS#7 SignedData carrying the WHOLE chain and no signers — the
 * classic `.p7b` cert bundle (design §4.14 PKCS7 row). Built directly from raw
 * cert DER so EC certs pass through unchanged.
 */
function exportPkcs7(chainDer: Buffer[]): Buffer {
  const certNodes = chainDer.map((d) => asn1.fromDer(d.toString('binary')))
  const signedData = seq([
    intAsn1(1), // version
    set([]), // digestAlgorithms — empty
    seq([oid(pkiOids.data)]), // encapContentInfo (id-data), no content
    ctx0(certNodes), // [0] IMPLICIT certificates
    set([]), // signerInfos — empty
  ])
  const contentInfo = seq([oid(PKCS7_SIGNED_DATA_OID), ctx0([signedData])])
  return Buffer.from(asn1.toDer(contentInfo).getBytes(), 'binary')
}

/**
 * PkiPath: a bare DER `SEQUENCE OF Certificate` in ROOT-FIRST order (design
 * §4.14 — the reverse of the leaf-first chain / of PKCS7), `.pkipath`.
 */
function exportPkiPath(chainDer: Buffer[]): Buffer {
  const rootFirst = [...chainDer].reverse()
  const certNodes = rootFirst.map((d) => asn1.fromDer(d.toString('binary')))
  return Buffer.from(asn1.toDer(seq(certNodes)).getBytes(), 'binary')
}

interface ExportFormatSpec {
  ext: string
  contentType: string
  encode: (leafDer: Buffer, chainDer: Buffer[]) => Buffer
}

const EXPORT_FORMATS: Record<ExportFormat, ExportFormatSpec> = {
  DER: { ext: '.cer', contentType: 'application/pkix-cert', encode: (leaf) => exportDer(leaf) },
  PEM: { ext: '.pem', contentType: 'application/x-pem-file', encode: (leaf) => exportPem(leaf) },
  PKCS7: {
    ext: '.p7b',
    contentType: 'application/x-pkcs7-certificates',
    encode: (_leaf, chain) => exportPkcs7(chain),
  },
  PKIPATH: {
    ext: '.pkipath',
    contentType: 'application/pkix-pkipath',
    encode: (_leaf, chain) => exportPkiPath(chain),
  },
}

/**
 * Filesystem-safe name for an exported entry (design §6.13).
 *
 * Delegates to the shared sanitiser: the old ASCII whitelist here mangled a
 * Turkish (or any non-Latin) alias into underscores on its way to the save
 * dialog — the same defect issue #71 reported for project/folder exports.
 */
export function sanitizeFileName(name: string): string {
  return safeFileName(name, 'entry')
}

// ─────────────────────────────────────────────────────────────────────────────
// Import parsing + key-cert match (spec §6.7, §6.11) — Faz B3.
//
// parsePrivateKey / parseCertificates read EXTERNAL material in ANY algorithm
// Node can decode (RSA PKCS#1/PKCS#8, EC SEC1/PKCS#8, Ed25519, …) — deliberately
// NOT limited to the curve set the generate path emits.
// ─────────────────────────────────────────────────────────────────────────────

/** True if the text carries a `-----BEGIN … PRIVATE KEY-----` block of any flavour. */
function hasPrivateKeyBlock(pem: string): boolean {
  return /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(pem)
}

/**
 * Parse a private key from PEM into a Node `KeyObject`. Recognises PKCS#8
 * (`BEGIN PRIVATE KEY`), traditional OpenSSL/PKCS#1 (`BEGIN RSA PRIVATE KEY`)
 * and SEC1 EC (`BEGIN EC PRIVATE KEY`) — Node auto-detects the encoding.
 */
export function parsePrivateKey(pem: string): KeyObject {
  const trimmed = (pem ?? '').trim()
  if (!trimmed) throw new KeystoreValidationException('Private key (PEM) cannot be empty')
  if (!hasPrivateKeyBlock(trimmed)) {
    throw new KeystoreValidationException('No private key found in the provided PEM')
  }
  try {
    return createPrivateKey(trimmed)
  } catch (e) {
    throw new KeystoreValidationException(
      `Could not parse private key from PEM: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

/** Collect every `CERTIFICATE` PEM block as DER, in document order (leaf-first). */
export function parseCertificates(pem: string): Buffer[] {
  return pemBlocksToDer(pem ?? '', 'CERTIFICATE')
}

/** Upper bound on pasted/parsed trusted-cert input (mirrors the cert picker +
 * TLS-inspect file reader). A real cert is a few KiB; anything past this is junk. */
const MAX_TRUSTED_CERT_BYTES = 1024 * 1024

/** Parse a trusted certificate from PEM OR base64 DER; null if none decodes. */
function parseCertificateFromContent(content: string): Buffer | null {
  const trimmed = (content ?? '').trim()
  if (!trimmed) return null
  if (trimmed.includes('-----BEGIN')) {
    const ders = pemBlocksToDer(trimmed, 'CERTIFICATE')
    if (ders.length === 0) return null
    try {
      new X509Certificate(ders[0])
      return ders[0]
    } catch {
      return null
    }
  }
  // No PEM armour ⇒ treat as base64-encoded DER (spec §6.11 fallback branch).
  try {
    const der = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64')
    if (der.length === 0) return null
    new X509Certificate(der) // throws unless it is a real certificate
    return der
  } catch {
    return null
  }
}

/**
 * US-ASCII probe signed then verified to confirm a private key belongs to a
 * certificate's public key (spec §6.7 secondary check). Ported from Apinizer.
 */
const KEY_MATCH_PROBE = Buffer.from('apinizer-keystore-studio-key-match-probe', 'ascii')

/** Outcome of the secondary sign/verify probe. */
type ProbeResult = 'verified' | 'mismatch' | 'unverifiable'

/**
 * Secondary sign/verify probe. Returns whether it could POSITIVELY confirm the
 * pair. Key types it cannot name (Ed25519/Ed448/X25519) or a crypto error yield
 * `'unverifiable'` — the caller decides (we fail closed). It never accepts on
 * its own.
 */
function signVerifyProbe(privateKey: KeyObject, publicKey: KeyObject): ProbeResult {
  const t = privateKey.asymmetricKeyType
  let algorithm: string | null
  if (t === 'rsa' || t === 'rsa-pss')
    algorithm = 'RSA-SHA256' // SHA256withRSA
  else if (t === 'ec')
    algorithm = 'SHA256' // SHA256withECDSA
  else algorithm = null
  if (algorithm === null) return 'unverifiable'
  try {
    const signature = cryptoSign(algorithm, KEY_MATCH_PROBE, privateKey)
    return cryptoVerify(algorithm, KEY_MATCH_PROBE, publicKey, signature) ? 'verified' : 'mismatch'
  } catch {
    return 'unverifiable'
  }
}

/**
 * Verify a private key matches a certificate's public key (spec §6.7).
 *
 * PRIMARY = deterministic: derive the SPKI DER from the private key and
 * byte-compare it to the certificate's SPKI DER (correct for RSA / EC / Ed, no
 * algorithm selection). A byte-equal SPKI is authoritative and accepts.
 *
 * When SPKI differs (e.g. an RSASSA-PSS-restricted cert vs a plain rsaEncryption
 * key of the same modulus) or cannot be exported, the sign/verify probe is the
 * tiebreaker — and we **fail closed**: ONLY a positive `'verified'` admits the
 * pair; `'mismatch'` and `'unverifiable'` both throw. A wrong OR unverifiable
 * key+cert pair can never enter the keystore.
 */
export function verifyKeyMatchesCertificate(privateKey: KeyObject, publicKey: KeyObject): void {
  let derivedSpki: Buffer | null = null
  let certSpki: Buffer | null = null
  try {
    derivedSpki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }) as Buffer
    certSpki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  } catch {
    // SPKI export failed — the probe is the only remaining evidence.
  }
  if (derivedSpki && certSpki && derivedSpki.equals(certSpki)) return
  if (signVerifyProbe(privateKey, publicKey) !== 'verified') {
    throw new KeystoreValidationException('Private key does not match the provided certificate')
  }
}

/**
 * Locate the leaf in a parsed certificate chain and return the chain reordered
 * so the leaf sits at position 0 (spec §6.7 / §6.11). Callers may hand the chain
 * in ANY order — some exports put the CA root first — so we do NOT assume the
 * leaf is `certChainDer[0]`: we search the WHOLE chain for the cert whose public
 * key matches `privateKey` via the §6.7 gate. Throws the canonical §8 string if
 * NO certificate in the chain matches the key.
 */
function matchAndOrderChain(privateKey: KeyObject, certChainDer: Buffer[]): Buffer[] {
  let leafIndex = -1
  for (let i = 0; i < certChainDer.length; i += 1) {
    try {
      verifyKeyMatchesCertificate(privateKey, new X509Certificate(certChainDer[i]).publicKey)
      leafIndex = i
      break
    } catch {
      // Not this certificate — keep searching the chain.
    }
  }
  if (leafIndex === -1) {
    throw new KeystoreValidationException('Private key does not match the provided certificate')
  }
  if (leafIndex === 0) return certChainDer
  return [
    certChainDer[leafIndex],
    ...certChainDer.slice(0, leafIndex),
    ...certChainDer.slice(leafIndex + 1),
  ]
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

/**
 * Refuse to protect a key with nothing.
 *
 * `createEmpty` now allows an empty PKCS#12 store password so a passwordless
 * TRUSTSTORE (certificates only) can be created. That is safe precisely because
 * an empty store holds no key material — but the store password is also the
 * FALLBACK entry password everywhere a key is added
 * (`e.entryPassword || storePassword`), and the renderer deliberately drops the
 * entry-password field when generating (`keystore.store.ts`), so without this
 * guard "create a passwordless store, then generate a key pair" would silently
 * write an unprotected private key.
 *
 * So: a blank-password store stays a truststore. Adding key material to one
 * requires an explicit entry password.
 */
function assertKeyProtectable(effectivePassword: string, what: string): void {
  if (effectivePassword.trim()) return
  throw new KeystoreValidationException(
    `Cannot add ${what} without a password: this keystore has no store password, so give the entry its own password (or set a store password first).`,
  )
}

function summarize(entry: EntryModel): AliasSummary {
  if (entry.kind === 'secret') {
    // A secret (symmetric) key has no certificate and is not a *private* key —
    // entryType KEY, hasPrivateKey false, empty chain distinguishes it in the UI.
    return {
      alias: entry.alias,
      entryType: 'KEY',
      hasPrivateKey: false,
      chainLength: 0,
    }
  }
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

/** Sessions untouched for this long are evicted (design R8 — frees in-main
 * bytes/passwords that would otherwise linger if the renderer never closes). */
const SESSION_IDLE_MS = 30 * 60 * 1000
/** Hard cap on concurrent open sessions — the oldest is evicted past this. */
const MAX_OPEN_SESSIONS = 32
/** How often the background sweep disposes idle sessions on a wall-clock basis
 * (in addition to the on-register sweep — a session left open with no further
 * IPC would otherwise linger until the next register). */
const IDLE_SWEEP_INTERVAL_MS = 3 * 60 * 1000

export class KeystoreEngine {
  private readonly sessions = new Map<string, KeystoreSession>()
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.startIdleSweep()
  }

  /** Start the wall-clock idle sweep exactly once. `.unref()` keeps this
   * housekeeping timer from holding the Node event loop / process open. */
  private startIdleSweep(): void {
    if (this.sweepTimer) return
    const timer = setInterval(() => this.evictIdle(), IDLE_SWEEP_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    this.sweepTimer = timer
  }

  private getSession(sessionId: string): KeystoreSession {
    const s = this.sessions.get(sessionId)
    // Fixed message — never interpolate the sessionId (a UUID) into a
    // user-facing string (design §8.1 KS-F3-08/KS-F4-12 canonical string).
    if (!s) throw new KeystoreValidationException('Keystore session not found')
    s.lastAccess = Date.now()
    return s
  }

  /** Drop sessions idle past {@link SESSION_IDLE_MS}; runs on every register
   * and on the periodic {@link startIdleSweep} wall-clock timer. */
  private evictIdle(): void {
    const cutoff = Date.now() - SESSION_IDLE_MS
    for (const [id, s] of this.sessions) {
      if (s.lastAccess < cutoff) this.sessions.delete(id)
    }
  }

  /** Register a fresh session, first sweeping idle ones and enforcing the cap. */
  private register(session: KeystoreSession): void {
    this.evictIdle()
    while (this.sessions.size >= MAX_OPEN_SESSIONS) {
      // Map preserves insertion order; the first key is the oldest by creation.
      const oldest = this.sessions.keys().next().value
      if (oldest === undefined) break
      this.sessions.delete(oldest)
    }
    this.sessions.set(session.id, session)
  }

  private meta(session: KeystoreSession): KeystoreMeta {
    return {
      type: session.type,
      aliasCount: session.entries.length,
      aliases: session.entries.map(summarize),
      dirty: session.dirty,
    }
  }

  /** Persist a session's current model to bytes and return them. */
  serialize(sessionId: string): Buffer {
    const s = this.getSession(sessionId)
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return s.bytes
  }

  /**
   * MAIN-ONLY snapshot used by the Model-B library save path. Returns the
   * serialized bytes together with the store password so the handler can
   * `encryptSecret`-wrap them for persistence. NEVER surface the returned
   * `storePassword`/`bytes` to the renderer (design §10, invariant 1).
   */
  exportForLibrary(sessionId: string): {
    bytes: Buffer
    type: KeystoreType
    storePassword: string
    aliasCount: number
  } {
    const s = this.getSession(sessionId)
    const bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    s.bytes = bytes
    return { bytes, type: s.type, storePassword: s.storePassword, aliasCount: s.entries.length }
  }

  /**
   * Create an empty keystore (spec §4.1).
   *
   * The store password may be EMPTY for PKCS#12 — the Create dialog labels the
   * field "optional" and a passwordless truststore is ordinary practice
   * (`openssl pkcs12 -passout pass:`). `open` has always accepted an empty
   * password, so refusing it here was an asymmetry, and it broke the one flow
   * that most needs it: "Add as trusted" from the TLS Inspector, which creates a
   * cert-only store.
   *
   * JKS is different and stays strict. Its key protector derives its keystream
   * from the password plus a salt that is written into the file in plaintext
   * (`jks-writer.ts`), so an empty password is not weak encryption — it is
   * none — and the store MAC becomes forgeable. Refusing it is a correctness
   * statement, not a policy preference.
   *
   * The complementary guard lives at the key-adding boundary
   * (`assertKeyProtectable`): a blank-password store may hold certificates, but
   * a private or secret key must carry its own entry password.
   */
  createEmpty(type: string, storePassword: string): { sessionId: string; meta: KeystoreMeta } {
    const resolved = resolveType(type)
    if (resolved === 'JKS') {
      requireNonBlank(
        storePassword,
        'A JKS keystore requires a store password: with an empty one the key protector derives its keystream from a salt stored in the file, so the key would not actually be encrypted.',
      )
    }
    const session: KeystoreSession = {
      id: randomUUID(),
      type: resolved,
      storePassword,
      entries: [],
      aliasEntryPasswords: new Map(),
      bytes: Buffer.alloc(0),
      dirty: false,
      lastAccess: Date.now(),
    }
    session.bytes = serializeKeyStore(session.entries, session.type, session.storePassword)
    this.register(session)
    return { sessionId: session.id, meta: this.meta(session) }
  }

  /**
   * Open existing keystore bytes (spec §4.2 / §6.2). `aliasEntryPasswords`
   * supplies per-alias key passwords so a store whose entries were protected with
   * distinct passwords can be reopened (design §3.1) — the map is both threaded
   * into the parse AND retained on the session so subsequent mutations know each
   * entry's password.
   */
  open(
    bytes: Buffer,
    password: string,
    type?: string,
    aliasEntryPasswords?: Record<string, string> | Map<string, string>,
  ): { sessionId: string; meta: KeystoreMeta } {
    const resolved = resolveType(type)
    const pwMap =
      aliasEntryPasswords instanceof Map
        ? new Map(aliasEntryPasswords)
        : new Map(Object.entries(aliasEntryPasswords ?? {}))
    const entries = parseKeyStore(bytes, password ?? '', resolved, pwMap)
    const session: KeystoreSession = {
      id: randomUUID(),
      type: resolved,
      storePassword: password ?? '',
      entries,
      aliasEntryPasswords: pwMap,
      bytes,
      dirty: false,
      lastAccess: Date.now(),
    }
    this.register(session)
    return { sessionId: session.id, meta: this.meta(session) }
  }

  /** loadOrCreate (spec §6.3): open bytes if present, else start empty. */
  loadOrCreate(
    bytes: Buffer | null | undefined,
    password: string,
    type?: string,
    aliasEntryPasswords?: Record<string, string> | Map<string, string>,
  ): { sessionId: string; meta: KeystoreMeta } {
    if (bytes && bytes.length > 0) return this.open(bytes, password, type, aliasEntryPasswords)
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
    if (entry.kind === 'secret') {
      // Secret keys carry no X.509 chain (design §6.5 — leaf is null).
      return { alias, entryType: 'KEY', hasPrivateKey: false, chain: [] }
    }
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
    assertKeyProtectable(entryPassword, 'a key pair')
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
    s.dirty = true
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  /**
   * Generate an AES secret key and add it as a SecretKeyEntry (spec §4.9).
   * PKCS12-only — JKS cannot hold secret keys. Synchronous (Node
   * `randomBytes`), but returns immediately-serialized safe meta like its
   * key-pair sibling.
   */
  generateSecretKey(sessionId: string, opts: GenerateSecretKeyOptions): KeystoreMeta {
    const s = this.getSession(sessionId)
    const alias = requireNonBlank(opts.alias, 'Alias cannot be empty')
    if (s.type !== 'PKCS12') {
      throw new KeystoreValidationException('Secret keys can only be stored in a PKCS12 keystore')
    }
    if (s.entries.some((e) => e.alias === alias)) {
      throw new KeystoreValidationException(`Alias already exists: ${alias}`)
    }
    const algo = (opts.keyAlgorithm ?? 'AES').trim().toUpperCase()
    if (algo !== 'AES') {
      throw new KeystoreValidationException(
        `Unsupported secret key algorithm: ${opts.keyAlgorithm}`,
      )
    }
    const size = opts.keySize ?? 256
    if (![128, 192, 256].includes(size)) {
      throw new KeystoreValidationException(`Unsupported AES key size: ${size}`)
    }
    const entryPassword =
      opts.entryPassword && opts.entryPassword.trim() ? opts.entryPassword : s.storePassword
    assertKeyProtectable(entryPassword, 'a secret key')
    s.entries.push({
      alias,
      kind: 'secret',
      keyAlgorithm: 'AES',
      secretKeyRaw: randomBytes(size / 8),
      entryPassword,
    })
    if (opts.entryPassword && opts.entryPassword.trim()) {
      s.aliasEntryPasswords.set(alias, opts.entryPassword)
    }
    s.dirty = true
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  // ── Import (Faz B3, spec §4.4–4.7 / §6.7 / §6.10 / §6.11) ─────────────────

  /**
   * Validate a NEW alias for the key/pem/trusted-cert import paths: non-blank
   * and not already present (spec §6.13 `requireNewAlias`). Imports NEVER
   * silently replace an existing alias.
   */
  private requireNewImportAlias(session: KeystoreSession, alias: string): string {
    const a = requireNonBlank(alias, 'Alias cannot be empty')
    if (session.entries.some((e) => e.alias === a)) {
      throw new KeystoreValidationException(`Alias already exists: ${a}`)
    }
    return a
  }

  /**
   * Import entries from a source PKCS12 keystore via `copyEntry` (spec §6.10).
   * `sourceAlias` copies a single entry; omitted ⇒ copies ALL importable
   * entries. Secret keys are copied only into a PKCS12 target (skipped for JKS).
   * Errors if nothing was copied or a target alias collides.
   */
  importPkcs12(sessionId: string, opts: ImportPkcs12Options): KeystoreMeta {
    const s = this.getSession(sessionId)
    if (!opts.sourceBytes || opts.sourceBytes.length === 0) {
      throw new KeystoreValidationException('Source keystore content cannot be empty')
    }
    // parsePkcs12 throws KeystoreEngineException on a wrong password / corrupt
    // bytes — no key material appears in that message.
    const sourceEntries = parsePkcs12(opts.sourceBytes, opts.sourcePassword ?? '')

    let candidates: EntryModel[]
    if (opts.sourceAlias && opts.sourceAlias.trim()) {
      const wanted = opts.sourceAlias.trim()
      const found = sourceEntries.find((e) => e.alias === wanted)
      if (!found) {
        throw new KeystoreValidationException(`Source alias not found: ${wanted}`)
      }
      candidates = [found]
    } else {
      candidates = sourceEntries
    }

    const single = candidates.length === 1
    const override =
      single && opts.targetAlias && opts.targetAlias.trim() ? opts.targetAlias.trim() : null
    const toAdd: EntryModel[] = []

    for (const src of candidates) {
      // A secret key can only live in a PKCS12 target — silently skip it for a
      // JKS target (spec §6.10: copyEntry returns 0 for the skipped entry).
      if (src.kind === 'secret' && s.type !== 'PKCS12') continue

      const alias = override ?? src.alias
      if (s.entries.some((e) => e.alias === alias) || toAdd.some((e) => e.alias === alias)) {
        throw new KeystoreValidationException(`Target alias already exists: ${alias}`)
      }
      // Copied entries are protected with the store password (per-entry
      // passwords land in Faz B4; reopen only decrypts with the store password).
      const entryPassword = s.storePassword
      if (src.kind === 'key' || src.kind === 'secret') {
        assertKeyProtectable(entryPassword, `the key entry "${alias}"`)
      }
      if (src.kind === 'key') {
        if (src.certChainDer.length === 0) {
          throw new KeystoreValidationException(`Key entry has no certificate chain: ${alias}`)
        }
        // §6.7 gate on the COPY path too (not just importKeyMaterial/importPem):
        // a crafted/corrupt source P12 whose localKeyId links a key to the wrong
        // certificate must not seat a mismatched key+cert pair into the store.
        verifyKeyMatchesCertificate(
          createPrivateKey({ key: src.privateKeyPkcs8Der, format: 'der', type: 'pkcs8' }),
          new X509Certificate(src.certChainDer[0]).publicKey,
        )
        toAdd.push({
          alias,
          kind: 'key',
          privateKeyPkcs8Der: src.privateKeyPkcs8Der,
          certChainDer: src.certChainDer,
          entryPassword,
        })
      } else if (src.kind === 'secret') {
        toAdd.push({
          alias,
          kind: 'secret',
          keyAlgorithm: src.keyAlgorithm,
          secretKeyRaw: src.secretKeyRaw,
          entryPassword,
        })
      } else {
        toAdd.push({ alias, kind: 'cert', certDer: src.certDer })
      }
    }

    if (toAdd.length === 0) {
      throw new KeystoreValidationException('No importable entries found in the source keystore')
    }

    for (const e of toAdd) {
      s.entries.push(e)
    }
    s.dirty = true
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  /**
   * Import a raw private key + certificate chain as a key entry (spec §4.5).
   * The key-cert match gate (§6.7) blocks a wrong pair BEFORE any mutation.
   */
  importKeyMaterial(sessionId: string, opts: ImportKeyMaterialOptions): KeystoreMeta {
    const s = this.getSession(sessionId)
    const alias = this.requireNewImportAlias(s, opts.alias)
    const privateKey = parsePrivateKey(opts.privateKeyPem)
    const certChainDer = parseCertificates(opts.certificatePem)
    if (certChainDer.length === 0) {
      throw new KeystoreValidationException('At least one certificate (PEM) is required')
    }
    // The leaf may not be certChainDer[0] (some exports are root-first): find the
    // cert that matches the key anywhere in the chain and reorder it to the leaf.
    const orderedChain = matchAndOrderChain(privateKey, certChainDer)
    assertKeyProtectable(s.storePassword, 'imported key material')
    s.entries.push({
      alias,
      kind: 'key',
      privateKeyPkcs8Der: privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer,
      certChainDer: orderedChain,
      // Imported entries are protected with the store password (per-entry
      // passwords land in Faz B4; the parse/open path only decrypts with the
      // store password, so a distinct entry password would be undecryptable).
      entryPassword: s.storePassword,
    })
    s.dirty = true
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  /**
   * Import a pasted PEM block (spec §4.6): a private key present ⇒ the block
   * must also carry ≥1 certificate and the pair must match ⇒ a key entry; no
   * private key ⇒ the FIRST certificate becomes a trusted certificate entry.
   */
  importPem(sessionId: string, opts: ImportPemOptions): KeystoreMeta {
    const s = this.getSession(sessionId)
    const alias = this.requireNewImportAlias(s, opts.alias)
    const content = opts.pemContent ?? ''
    const certChainDer = parseCertificates(content)
    if (hasPrivateKeyBlock(content)) {
      if (certChainDer.length === 0) {
        throw new KeystoreValidationException('A certificate is required to import a private key')
      }
      const privateKey = createPrivateKey(content)
      // Locate the leaf anywhere in the block (root-first order is legal) and
      // reorder it to position 0; throws if no cert matches the key.
      const orderedChain = matchAndOrderChain(privateKey, certChainDer)
      assertKeyProtectable(s.storePassword, 'an imported private key')
      s.entries.push({
        alias,
        kind: 'key',
        privateKeyPkcs8Der: privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer,
        certChainDer: orderedChain,
        // Store-password protected (per-entry passwords land in Faz B4).
        entryPassword: s.storePassword,
      })
    } else if (certChainDer.length > 0) {
      // Cert-only: import ONLY the first certificate as a trusted entry.
      s.entries.push({ alias, kind: 'cert', certDer: certChainDer[0] })
    } else {
      throw new KeystoreValidationException(
        'No private key or certificate found in the provided PEM',
      )
    }
    s.dirty = true
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  /** Import a trusted certificate from PEM or base64 DER (spec §4.7). */
  importTrustedCertificate(sessionId: string, opts: ImportTrustedCertificateOptions): KeystoreMeta {
    const s = this.getSession(sessionId)
    const alias = this.requireNewImportAlias(s, opts.alias)
    // Bound the arbitrary pasted/parsed input (mirrors the 1 MiB cap the cert
    // picker + TLS-inspect file reader enforce) — a valid cert PEM padded with
    // megabytes of junk must be rejected, not scanned.
    if (Buffer.byteLength(opts.certificateContent ?? '', 'utf8') > MAX_TRUSTED_CERT_BYTES) {
      throw new KeystoreValidationException(
        'Certificate content is larger than 1 MiB — that does not look like a certificate.',
      )
    }
    const certDer = parseCertificateFromContent(opts.certificateContent)
    if (!certDer) {
      throw new KeystoreValidationException('No certificate found in the provided content')
    }
    s.entries.push({ alias, kind: 'cert', certDer })
    s.dirty = true
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  /** Confirm a private key matches a certificate's public key (spec §6.7). */
  verifyKeyMatchesCertificate(privateKey: KeyObject, publicKey: KeyObject): void {
    verifyKeyMatchesCertificate(privateKey, publicKey)
  }

  // ── Edit / Export / Persist (Faz B4, spec §4.10–4.16) ─────────────────────

  /**
   * Resolve the password used to recover a key/secret entry: the supplied
   * `entryPassword` when non-blank, else the store password (design §6.13
   * `resolveEntryPassword`). Because the session keeps decrypted key material,
   * "recover" reduces to verifying the resolved password equals the password the
   * entry is currently protected with (`entry.entryPassword`) — a mismatch is the
   * §8 UnrecoverableKey case.
   */
  private assertRecoverable(
    entry: KeyEntryModel | SecretEntryModel,
    entryPassword: string | undefined,
    storePassword: string,
  ): void {
    const current = entryPassword && entryPassword.trim() ? entryPassword : storePassword
    if (current !== entry.entryPassword) {
      throw new KeystoreValidationException(recoveryMessage(entry.alias))
    }
  }

  /**
   * Rename an alias (spec §4.10). A key/secret entry is re-keyed under the same
   * (verified) entry password; a certificate entry needs no password. Validation
   * order matches §8: blank source alias → not found → blank new alias → key
   * recovery → target-collision.
   */
  renameAlias(
    sessionId: string,
    alias: string,
    newAlias: string,
    entryPassword?: string,
  ): KeystoreMeta {
    const s = this.getSession(sessionId)
    requireNonBlank(alias, 'Alias cannot be empty')
    const entry = s.entries.find((e) => e.alias === alias)
    if (!entry) throw new KeystoreValidationException(`Alias not found: ${alias}`)
    if (!newAlias || !newAlias.trim()) {
      throw new KeystoreValidationException('New alias cannot be empty')
    }
    if (entry.kind === 'key' || entry.kind === 'secret') {
      this.assertRecoverable(entry, entryPassword, s.storePassword)
    }
    // A collision (including renaming to the SAME name — the entry itself matches)
    // is rejected, mirroring keytool's `requireNewAlias` (design §8 KS-F4-08).
    if (s.entries.some((e) => e.alias === newAlias)) {
      throw new KeystoreValidationException(`Alias already exists: ${newAlias}`)
    }
    entry.alias = newAlias
    const tracked = s.aliasEntryPasswords.get(alias)
    if (tracked !== undefined) {
      s.aliasEntryPasswords.delete(alias)
      s.aliasEntryPasswords.set(newAlias, tracked)
    }
    s.dirty = true
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  /**
   * Rotate the store password (spec §4.11). Every key/secret entry is first
   * verified recoverable (using `aliasEntryPasswords[alias]` or the OLD store
   * password) BEFORE any mutation — an unrecoverable entry aborts atomically,
   * leaving the session on its original store password. On success every key
   * entry is re-protected under `newPassword`, the working store password becomes
   * `newPassword`, and the per-alias password map is reset (all entries now share
   * the new store password).
   */
  changeStorePassword(
    sessionId: string,
    newPassword: string,
    aliasEntryPasswords?: Record<string, string>,
  ): KeystoreMeta {
    const s = this.getSession(sessionId)
    if (!newPassword || !newPassword.trim()) {
      throw new KeystoreValidationException('New password cannot be empty')
    }
    // Phase 1 — verify ALL key/secret entries recoverable (atomic; no mutation).
    for (const e of s.entries) {
      if (e.kind === 'key' || e.kind === 'secret') {
        this.assertRecoverable(e, aliasEntryPasswords?.[e.alias], s.storePassword)
      }
    }
    // Phase 2 — re-protect every key/secret entry under the new store password.
    for (const e of s.entries) {
      if (e.kind === 'key' || e.kind === 'secret') e.entryPassword = newPassword
    }
    s.storePassword = newPassword
    s.aliasEntryPasswords = new Map()
    s.dirty = true
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  /**
   * Set (rotate) a single key entry's password (spec §4.12). Key entries only —
   * certificate entries are rejected. The current password (supplied, else store
   * password) is verified before the new one is applied; the new password is
   * tracked in the per-alias map so the entry can be reopened with it.
   */
  setEntryPassword(
    sessionId: string,
    alias: string,
    newEntryPassword: string,
    entryPassword?: string,
  ): KeystoreMeta {
    const s = this.getSession(sessionId)
    requireNonBlank(alias, 'Alias cannot be empty')
    const entry = s.entries.find((e) => e.alias === alias)
    if (!entry) throw new KeystoreValidationException(`Alias not found: ${alias}`)
    if (entry.kind !== 'key' && entry.kind !== 'secret') {
      throw new KeystoreValidationException(
        `Entry password can only be set on a key entry: ${alias}`,
      )
    }
    if (!newEntryPassword || !newEntryPassword.trim()) {
      throw new KeystoreValidationException('New entry password cannot be empty')
    }
    this.assertRecoverable(entry, entryPassword, s.storePassword)
    entry.entryPassword = newEntryPassword
    s.aliasEntryPasswords.set(alias, newEntryPassword)
    s.dirty = true
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  /** Delete an entry by alias (spec §4.13). */
  deleteEntry(sessionId: string, alias: string): KeystoreMeta {
    const s = this.getSession(sessionId)
    requireNonBlank(alias, 'Alias cannot be empty')
    const idx = s.entries.findIndex((e) => e.alias === alias)
    if (idx === -1) throw new KeystoreValidationException(`Alias not found: ${alias}`)
    s.entries.splice(idx, 1)
    s.aliasEntryPasswords.delete(alias)
    s.dirty = true
    s.bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    return this.meta(s)
  }

  /**
   * Export the PUBLIC certificate(s) of an alias (spec §4.14 / §6.12). DER/PEM
   * emit the leaf only; PKCS7/PKIPATH emit the whole chain. NEVER returns a
   * private key. The format defaults to PEM; an unknown format is rejected with
   * the raw (pre-normalization) input echoed in the §8 message.
   */
  exportCertificate(sessionId: string, alias: string, format?: string): ExportCertificateResult {
    const s = this.getSession(sessionId)
    requireNonBlank(alias, 'Alias cannot be empty')
    const entry = s.entries.find((e) => e.alias === alias)
    if (!entry) throw new KeystoreValidationException(`Alias not found: ${alias}`)

    let leafDer: Buffer
    let chainDer: Buffer[]
    if (entry.kind === 'key') {
      if (entry.certChainDer.length === 0) {
        throw new KeystoreValidationException(`Key entry has no certificate chain: ${alias}`)
      }
      leafDer = entry.certChainDer[0]
      chainDer = entry.certChainDer
    } else if (entry.kind === 'cert') {
      leafDer = entry.certDer
      chainDer = [entry.certDer]
    } else {
      throw new KeystoreValidationException(`Secret key has no certificate to export: ${alias}`)
    }

    const raw = (format ?? 'PEM').trim()
    const key = raw.toUpperCase()
    const spec = (EXPORT_FORMATS as Record<string, ExportFormatSpec | undefined>)[key]
    if (!spec) {
      throw new KeystoreValidationException(`Unsupported export format: ${format}`)
    }
    return {
      bytes: spec.encode(leafDer, chainDer),
      fileName: sanitizeFileName(alias) + spec.ext,
      contentType: spec.contentType,
    }
  }

  /**
   * Convert the keystore to another type into a NEW session, leaving the original
   * untouched (spec §4.15). Every entry is preserved: key/secret entries are
   * re-protected under `newPassword` (each first verified recoverable with
   * `entryPassword` or the current store password), certificate entries are copied
   * verbatim. Secret keys are silently dropped when the target is JKS (which
   * cannot hold them). Fails atomically — no new session on any unrecoverable key.
   */
  convert(
    sessionId: string,
    targetType: string,
    newPassword: string,
    entryPassword?: string,
    aliasEntryPasswords?: Record<string, string>,
  ): { sessionId: string; meta: KeystoreMeta; skipped: string[] } {
    const s = this.getSession(sessionId)
    const target = resolveType(targetType)
    if (!newPassword || !newPassword.trim()) {
      throw new KeystoreValidationException('New store password is required for convert format')
    }
    const newEntries: EntryModel[] = []
    /** Aliases the target format cannot carry. Reported, never hidden. */
    const skipped: string[] = []
    for (const e of s.entries) {
      // Per-alias current password wins over the scalar fallback (symmetric with
      // changeStorePassword) so entries under DIFFERENT passwords are convertible.
      const currentPw = aliasEntryPasswords?.[e.alias] ?? entryPassword
      if (e.kind === 'key') {
        this.assertRecoverable(e, currentPw, s.storePassword)
        newEntries.push({
          alias: e.alias,
          kind: 'key',
          privateKeyPkcs8Der: e.privateKeyPkcs8Der,
          certChainDer: [...e.certChainDer],
          entryPassword: newPassword,
        })
      } else if (e.kind === 'secret') {
        if (target !== 'PKCS12') {
          // JKS cannot hold secret keys (§6.10). The entry is still DROPPED —
          // that is the format's constraint, not a policy we can relax — but it
          // is no longer dropped in silence: testers watched the alias count go
          // 4 → 3 with nothing saying which entry left or why.
          skipped.push(e.alias)
          continue
        }
        this.assertRecoverable(e, currentPw, s.storePassword)
        newEntries.push({
          alias: e.alias,
          kind: 'secret',
          keyAlgorithm: e.keyAlgorithm,
          secretKeyRaw: e.secretKeyRaw,
          entryPassword: newPassword,
        })
      } else {
        newEntries.push({ alias: e.alias, kind: 'cert', certDer: e.certDer })
      }
    }
    const session: KeystoreSession = {
      id: randomUUID(),
      type: target,
      storePassword: newPassword,
      entries: newEntries,
      aliasEntryPasswords: new Map(),
      bytes: Buffer.alloc(0),
      dirty: true,
      lastAccess: Date.now(),
    }
    session.bytes = serializeKeyStore(session.entries, session.type, session.storePassword)
    this.register(session)
    // `skipped` rides alongside `meta` rather than inside it: KeystoreMeta is
    // mirrored in three type declarations and asserted by existing tests, and
    // this is a fact about ONE conversion, not about the resulting store.
    return { sessionId: session.id, meta: this.meta(session), skipped }
  }

  /**
   * MAIN-ONLY save snapshot (spec §4.16). Serializes the current session and
   * returns the bytes + type for the handler to write to a user-picked path.
   * Does NOT clear `dirty` — the handler calls {@link markSaved} only after the
   * bytes actually reach disk (a cancelled dialog leaves the session dirty).
   * NEVER surface the returned bytes to the renderer (design invariant 1).
   */
  snapshot(sessionId: string): { bytes: Buffer; type: KeystoreType } {
    const s = this.getSession(sessionId)
    const bytes = serializeKeyStore(s.entries, s.type, s.storePassword)
    s.bytes = bytes
    return { bytes, type: s.type }
  }

  /** Clear the dirty flag after a successful Save-As write (spec §4.16). */
  markSaved(sessionId: string): KeystoreMeta {
    const s = this.getSession(sessionId)
    s.dirty = false
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
