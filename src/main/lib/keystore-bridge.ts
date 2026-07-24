/**
 * Key Material Provider (#60) — the ONE main-process resolver.
 *
 * `resolveKeyMaterial(source, need)` is the single place any private key is
 * materialized outside the keystore engine. Every consumer (mTLS Send, Runner,
 * WSSE sign, later JOSE/SAML/TLS-inspect) calls it and asks for the SHAPE it
 * needs, so the five parallel key-loading implementations that would otherwise
 * exist collapse into one — the same parity-bug class this codebase eliminates
 * for runner-verdict / script-runtime / header-assertion / env-vars.
 *
 * ── Invariants this module owns ─────────────────────────────────────────────
 *
 * NO-LEAK. Runs in MAIN ONLY. The return value NEVER crosses back to the
 * renderer. The renderer only ever holds an opaque `MaterialSource` (ids /
 * paths / pasted PEM). Password fields on a `MaterialSource` are write-only
 * from the renderer's perspective. Errors thrown here never interpolate a
 * password, a key, or PEM bytes — only ids/aliases/paths.
 *
 * ADDITIVE. Every source arm is one more OPTION. `kind:'inline'` (pasted PEM)
 * and `kind:'file'` (crt/key/pfx paths) reproduce exactly what consumers do
 * today; `kind:'keystore'` / `kind:'certRow'` are the new arms. A consumer that
 * passes no `MaterialSource` at all keeps its old code path byte-for-byte.
 *
 * FAIL LOUD. Nothing resolvable → throw. An unopenable alias, a wrong store
 * password, a NULL `keystores.store_password` with no `source.storePassword`,
 * an oversized/untrusted blob or file — all throw a clear, actionable message
 * so Send AND Run fail visibly rather than going out silently unauthenticated.
 * No branch returns "silent empty".
 *
 * BLOCKER (design §6). A CLIENT certificate's chain intermediates are NOT CA
 * trust anchors. Node's `ca` option REPLACES the default root store used to
 * validate the SERVER certificate — routing the client chain there breaks or
 * silently narrows server validation. Therefore this module emits the client
 * leaf + intermediates as ONE concatenated PEM bundle (`certPem` / `certBuffer`)
 * and deliberately exposes NO field named `ca` / `caCerts` / `caCertBuffers`.
 * The separate `chainBuffers` is informational only and must never be assigned
 * to `certificates.caCerts` or to `https.Agent({ ca })`.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, resolve as resolvePath } from 'node:path'
import { getKeystore } from '../db/keystore.repo'
import { getCertificate } from '../db/certificate.repo'
import { decryptSecret } from './secure-storage'
import { exportAliasPem, listKeyAliases, type KeystoreType } from './keystore'

// ─────────────────────────────────────────────────────────────────────────────
// Public contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where key material comes from. OPAQUE by construction: ids, filesystem paths
 * and user-pasted PEM only — no resolved key bytes ever live in this shape, so
 * it is safe for the renderer to hold and persist (the password fields excepted:
 * they are write-only and must never be persisted or echoed back).
 */
export type MaterialSource =
  | {
      kind: 'inline'
      certPem: string
      keyPem?: string
      chainPem?: string[]
      passphrase?: string
    }
  | {
      kind: 'file'
      certPath?: string
      keyPath?: string
      pfxPath?: string
      passphrase?: string
    }
  | {
      kind: 'keystore'
      keystoreId: string
      alias: string
      /** Per-alias ENTRY password (R11). */
      keyPassword?: string
      /** STORE password — REQUIRED when the row's `store_password` is NULL. */
      storePassword?: string
    }
  | { kind: 'certRow'; certificateId: string }

/** The SHAPE a consumer needs. `keyObject` lands with #63 (JOSE). */
export type MaterialNeed = 'pem' | 'buffer' | 'jwk'

export interface ResolvedKeyMaterial {
  // ── canonical PEM emitter (always populated) ──
  /** Leaf certificate PEM. */
  certPem: string
  /** Private-key PEM. `undefined` for public-only material. MAIN-ONLY. */
  keyPem?: string
  /** Intermediates/root, leaf-first. NOT trust anchors — see BLOCKER. */
  chainPem?: string[]
  /** Decrypted key passphrase, if the material needs one. MAIN-ONLY. */
  passphrase?: string

  // ── need === 'buffer' adds ──
  /**
   * The client certificate BUNDLE: leaf followed by every chain member,
   * concatenated as PEM. This is what a TLS peer consumes for client auth and
   * what belongs in `clientCert.cert`.
   */
  certBuffer?: Buffer
  /** Private-key PEM as bytes. `undefined` for public-only material. */
  keyBuffer?: Buffer
  /**
   * Chain members individually, as PEM bytes. INFORMATIONAL ONLY.
   * NEVER assign these to `certificates.caCerts` / `https.Agent({ca})` — see
   * the BLOCKER note in this file's header. There is intentionally no
   * `caCertBuffers` field: CA trust anchors are an orthogonal, user-supplied
   * concept and this resolver does not produce them.
   */
  chainBuffers?: Buffer[]
}

/** Thrown for every resolution failure. Message is safe to surface as `{error}`. */
export class KeyMaterialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyMaterialError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// R12 safety rails (design §2.7)
//
// Keystore-backed rows bypass `request.handler.ts#readCertFile`'s rails
// entirely (realpath symlink-resolve, extension whitelist, 1 MiB cap). The
// resolver re-imposes equivalents, with a keystore-AWARE extension set.
// ─────────────────────────────────────────────────────────────────────────────

/** PEM/DER cert + key material — same whitelist `readCertFile` uses. */
const PEM_EXTS = new Set(['.crt', '.cer', '.pem', '.key'])
/** Keystore containers — the ADDITION the current whitelist omits. */
const KEYSTORE_EXTS = new Set(['.pfx', '.p12', '.jks', '.keystore', '.jceks'])

/** 1 MiB — mirrors `MAX_CERT_BYTES` in request.handler.ts. */
const MAX_PEM_BYTES = 1024 * 1024
/** 5 MiB — mirrors `MAX_KEYSTORE_BYTES` in keystore.handler.ts. */
const MAX_KEYSTORE_BYTES = 5 * 1024 * 1024

/** JKS magic number (`0xFEEDFEED`) — cheap shape check before a full parse. */
const JKS_MAGIC = 0xfeedfeed

/**
 * Read one file with the rails re-imposed: symlinks resolved FIRST (so
 * `attack.pem -> /etc/passwd` cannot bypass the whitelist), extension
 * whitelisted, size capped, regular-file enforced.
 */
function readMaterialFile(filePath: string): { bytes: Buffer; ext: string } {
  let abs: string
  try {
    abs = realpathSync(resolvePath(filePath))
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') throw new KeyMaterialError(`file not found: ${filePath}`)
    throw new KeyMaterialError(`cannot read ${filePath}: ${err?.message ?? String(e)}`)
  }
  const ext = extname(abs).toLowerCase()
  const isKeystore = KEYSTORE_EXTS.has(ext)
  if (!isKeystore && !PEM_EXTS.has(ext)) {
    const allowed = [...PEM_EXTS, ...KEYSTORE_EXTS].join(', ')
    throw new KeyMaterialError(
      `unsupported file type "${ext || '(none)'}" — expected one of ${allowed} (${filePath})`,
    )
  }
  const cap = isKeystore ? MAX_KEYSTORE_BYTES : MAX_PEM_BYTES
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(abs)
  } catch (e) {
    throw new KeyMaterialError(`cannot read ${filePath}: ${(e as Error).message}`)
  }
  if (!st.isFile()) throw new KeyMaterialError(`not a regular file: ${filePath}`)
  if (st.size > cap) {
    throw new KeyMaterialError(
      `key material file is larger than the ${cap}-byte limit: ${filePath}`,
    )
  }
  if (st.size === 0) throw new KeyMaterialError(`key material file is empty: ${filePath}`)
  try {
    return { bytes: readFileSync(abs), ext }
  } catch (e) {
    throw new KeyMaterialError(`cannot read ${filePath}: ${(e as Error).message}`)
  }
}

/**
 * Cap the encoded blob BEFORE decoding it (a base64 string decodes to ~3/4 its
 * length, so an oversized blob must be rejected on the string, not after a
 * multi-hundred-MiB `Buffer.from`).
 */
function decodeKeystoreBlob(base64: string, label: string): Buffer {
  const maxBase64Chars = Math.ceil(MAX_KEYSTORE_BYTES / 3) * 4 + 4
  if (base64.length > maxBase64Chars) {
    throw new KeyMaterialError(
      `stored keystore ${label} exceeds the ${MAX_KEYSTORE_BYTES}-byte limit — refusing to decode it.`,
    )
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0) throw new KeyMaterialError(`stored keystore ${label} is empty.`)
  if (bytes.length > MAX_KEYSTORE_BYTES) {
    throw new KeyMaterialError(
      `stored keystore ${label} exceeds the ${MAX_KEYSTORE_BYTES}-byte limit — refusing to open it.`,
    )
  }
  return bytes
}

/**
 * Validate the bytes actually LOOK like the declared keystore container before
 * handing them to a parser. Cheap magic-byte check; the real parse (which is
 * the authoritative validation) still runs in `exportAliasPem` and throws.
 */
function assertKeystoreShape(bytes: Buffer, type: KeystoreType, label: string): void {
  if (bytes.length < 4) throw new KeyMaterialError(`${label} is too small to be a keystore.`)
  if (type === 'JKS') {
    if (bytes.readUInt32BE(0) !== JKS_MAGIC) {
      throw new KeyMaterialError(`${label} is not a JKS keystore (bad magic number).`)
    }
  } else if (bytes[0] !== 0x30) {
    // PKCS#12 is DER — it must start with a SEQUENCE tag.
    throw new KeyMaterialError(`${label} is not a PKCS#12 keystore (not DER-encoded).`)
  }
}

/** Keystore container type implied by a file extension. */
function keystoreTypeForExt(ext: string): KeystoreType {
  return ext === '.p12' || ext === '.pfx' ? 'PKCS12' : 'JKS'
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical PEM emitter — every source arm funnels into this shape
// ─────────────────────────────────────────────────────────────────────────────

interface CanonicalPem {
  certPem: string
  keyPem?: string
  chainPem?: string[]
  passphrase?: string
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const v = (value ?? '').trim()
  return v.length > 0 ? v : undefined
}

// ── inline ──────────────────────────────────────────────────────────────────

function fromInline(source: Extract<MaterialSource, { kind: 'inline' }>): CanonicalPem {
  const certPem = nonEmpty(source.certPem)
  if (!certPem) {
    throw new KeyMaterialError(
      'No key material: the pasted certificate PEM is empty. Paste a certificate or pick one from the keystore.',
    )
  }
  const chainPem = (source.chainPem ?? []).map((c) => nonEmpty(c)).filter((c): c is string => !!c)
  return {
    certPem,
    keyPem: nonEmpty(source.keyPem),
    chainPem: chainPem.length ? chainPem : undefined,
    passphrase: nonEmpty(source.passphrase),
  }
}

// ── file ────────────────────────────────────────────────────────────────────

/**
 * PKCS#12/JKS container picked ad-hoc (no alias in the `file` arm). Exactly one
 * private-key entry may be present; more than one is ambiguous and fails loud
 * with a pointer at the explicit `kind:'keystore'` arm.
 */
function fromContainerFile(path: string, passphrase: string | undefined): CanonicalPem {
  const { bytes, ext } = readMaterialFile(path)
  const type = keystoreTypeForExt(ext)
  assertKeystoreShape(bytes, type, `"${path}"`)
  let aliases: string[]
  try {
    aliases = listKeyAliases(bytes, passphrase ?? '', type)
  } catch (e) {
    throw new KeyMaterialError(`could not open "${path}": ${(e as Error).message}`)
  }
  if (aliases.length === 0) {
    throw new KeyMaterialError(`"${path}" contains no private-key entry.`)
  }
  if (aliases.length > 1) {
    throw new KeyMaterialError(
      `"${path}" contains ${aliases.length} private-key entries — pick one explicitly (aliases: ${aliases.join(', ')}).`,
    )
  }
  const pem = exportAliasPem(bytes, passphrase ?? '', type, aliases[0])
  return {
    certPem: pem.certPem,
    keyPem: pem.keyPem,
    chainPem: pem.chainPem.length ? pem.chainPem : undefined,
  }
}

function fromFile(source: Extract<MaterialSource, { kind: 'file' }>): CanonicalPem {
  const passphrase = nonEmpty(source.passphrase)
  const pfxPath = nonEmpty(source.pfxPath)
  if (pfxPath) return fromContainerFile(pfxPath, passphrase)

  const certPath = nonEmpty(source.certPath)
  if (!certPath) {
    throw new KeyMaterialError(
      'No key material: neither a certificate file nor a PFX/keystore file was supplied.',
    )
  }
  const certPem = readMaterialFile(certPath).bytes.toString('utf8')
  const keyPath = nonEmpty(source.keyPath)
  const keyPem = keyPath ? readMaterialFile(keyPath).bytes.toString('utf8') : undefined
  return { certPem, keyPem, passphrase }
}

// ── keystore ────────────────────────────────────────────────────────────────

function fromKeystore(source: Extract<MaterialSource, { kind: 'keystore' }>): CanonicalPem {
  const row = getKeystore(source.keystoreId)
  if (!row) {
    throw new KeyMaterialError(`Keystore not found in the library (id: ${source.keystoreId}).`)
  }
  const b64 = decryptSecret(row.blob)
  if (!b64) {
    throw new KeyMaterialError(
      `The stored keystore '${row.name}' is unavailable (OS encryption is locked or missing).`,
    )
  }
  const bytes = decodeKeystoreBlob(b64, `'${row.name}'`)
  assertKeystoreShape(bytes, row.type, `Stored keystore '${row.name}'`)

  // R11 — STORE password. NULL column = "remember password" is OFF, so the
  // caller MUST supply it. Fail with a DISTINCT, actionable message rather
  // than letting the parser report a generic wrong-password error.
  let storePassword: string
  if (row.store_password) {
    const remembered = decryptSecret(row.store_password)
    if (remembered === null) {
      throw new KeyMaterialError(
        `The stored password for keystore '${row.name}' is unavailable (OS encryption is locked or missing).`,
      )
    }
    storePassword = remembered
  } else {
    const supplied = source.storePassword
    if (supplied === undefined || supplied === null) {
      throw new KeyMaterialError(
        `Keystore store password required — remember-password is off for '${row.name}'.`,
      )
    }
    storePassword = supplied
  }

  const pem = exportAliasPem(bytes, storePassword, row.type, source.alias, source.keyPassword)
  return {
    certPem: pem.certPem,
    keyPem: pem.keyPem,
    chainPem: pem.chainPem.length ? pem.chainPem : undefined,
  }
}

// ── certRow ─────────────────────────────────────────────────────────────────

function fromCertRow(source: Extract<MaterialSource, { kind: 'certRow' }>): CanonicalPem {
  const row = getCertificate(source.certificateId)
  if (!row) {
    throw new KeyMaterialError(`Certificate row not found (id: ${source.certificateId}).`)
  }
  // R11 — the row's `passphrase` is the per-alias KEY password for a
  // keystore-backed row (and the PFX passphrase for a file-backed one).
  const passphrase = decryptSecret(row.passphrase) ?? undefined

  if (row.source === 'keystore') {
    if (!row.keystore_id || !row.keystore_alias) {
      throw new KeyMaterialError(
        `Certificate row ${row.id} is keystore-backed but has no keystore/alias link.`,
      )
    }
    return fromKeystore({
      kind: 'keystore',
      keystoreId: row.keystore_id,
      alias: row.keystore_alias,
      keyPassword: passphrase,
    })
  }
  if (!row.crt_path && !row.key_path && !row.pfx_path) {
    throw new KeyMaterialError(`Certificate row ${row.id} has no certificate/key/PFX path.`)
  }
  return fromFile({
    kind: 'file',
    certPath: row.crt_path ?? undefined,
    keyPath: row.key_path ?? undefined,
    pfxPath: row.pfx_path ?? undefined,
    passphrase,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapters — one canonical emitter, N shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize a PEM block so blocks concatenate cleanly. */
function pemBlock(pem: string): string {
  const t = pem.trim()
  return t.endsWith('\n') ? t : `${t}\n`
}

/**
 * BLOCKER-safe buffer adapter. The client leaf and its chain go out as ONE
 * concatenated PEM bundle in `certBuffer` (what the TLS peer consumes for
 * client auth). Nothing here is a CA trust anchor and no `ca`-shaped field is
 * emitted.
 */
function toBuffers(pem: CanonicalPem): ResolvedKeyMaterial {
  const chain = pem.chainPem ?? []
  const bundle = [pem.certPem, ...chain].map(pemBlock).join('')
  return {
    ...pem,
    certBuffer: Buffer.from(bundle, 'utf8'),
    keyBuffer: pem.keyPem ? Buffer.from(pem.keyPem, 'utf8') : undefined,
    chainBuffers: chain.length ? chain.map((c) => Buffer.from(pemBlock(c), 'utf8')) : undefined,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dereference a `MaterialSource` in MAIN and return the shape the consumer
 * asked for. Throws `KeyMaterialError` on every failure — never silent-empty,
 * never interactive (a non-interactive path returns a clear error rather than
 * hanging).
 */
export function resolveKeyMaterial(
  source: MaterialSource,
  need: MaterialNeed,
): ResolvedKeyMaterial {
  if (!source || typeof source !== 'object' || !('kind' in source)) {
    throw new KeyMaterialError('No key material source supplied.')
  }

  let pem: CanonicalPem
  switch (source.kind) {
    case 'inline':
      pem = fromInline(source)
      break
    case 'file':
      pem = fromFile(source)
      break
    case 'keystore':
      pem = fromKeystore(source)
      break
    case 'certRow':
      pem = fromCertRow(source)
      break
    default: {
      const unknown = source as { kind?: string }
      throw new KeyMaterialError(`Unsupported key material source: ${String(unknown.kind)}`)
    }
  }

  if (!nonEmpty(pem.certPem)) {
    throw new KeyMaterialError('No key material could be resolved (empty certificate).')
  }

  switch (need) {
    case 'pem':
      return { ...pem }
    case 'buffer':
      return toBuffers(pem)
    case 'jwk':
      // Faz D1 (#61) turns this into a `jose` importPKCS8/importX509 → exportJWK
      // branch. `jose` is ESM-only, so it must be imported ONLY on this branch
      // (ESM-in-main containment, CLAUDE.md ERR_REQUIRE_ESM gotcha).
      throw new KeyMaterialError('JWK key material is not available until Faz D (#61).')
    default:
      throw new KeyMaterialError(`Unsupported key material need: ${String(need)}`)
  }
}
