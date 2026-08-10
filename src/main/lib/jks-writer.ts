import { createHash, randomBytes } from 'node:crypto'

/**
 * Pure-TypeScript writer for the Sun/Oracle JKS keystore format
 * (magic 0xFEEDFEED, version 2). This is the symmetric ENCRYPT direction of the
 * DECRYPT/parse path implemented by the `jks-js` dependency, which the engine
 * uses for reading. keytool (OpenJDK) is the ground-truth oracle for this output.
 *
 * Private keys are wrapped with the Sun proprietary 'JavaKeyStore' key protector
 * (OID 1.3.6.1.4.1.42.2.17.1.1): a 20-byte-salt-seeded iterated-SHA1 keystream
 * XORed over the PKCS#8 plaintext, plus a trailing SHA1 integrity digest, all
 * wrapped in an EncryptedPrivateKeyInfo DER structure. The whole store is sealed
 * with a keyed SHA1 hash appended after the last entry.
 *
 * NOTE (byte-KAT, verified against keytool-produced client.jks): the
 * AlgorithmIdentifier is encoded as SEQUENCE { OID } with NO parameters — not
 * SEQUENCE { OID, NULL }. See tests/fixtures/certs/client.jks offset 0x2b:
 *   30 0c 06 0a 2b 06 01 04 01 2a 02 11 01 01  (SEQ len 12 = OID only).
 */

export interface JksKeyEntry {
  alias: string
  type: 'key'
  privateKeyPkcs8Der: Buffer
  entryPassword: string
  certChainDer: Buffer[]
}

export interface JksCertEntry {
  alias: string
  type: 'cert'
  certDer: Buffer
}

export type JksEntry = JksKeyEntry | JksCertEntry

const MAGIC = 0xfeedfeed
const VERSION = 2
const PRIVATE_KEY_TAG = 1
const TRUSTED_CERT_TAG = 2
const CERT_TYPE = 'X.509'
const WHITENER = 'Mighty Aphrodite'
const SALT_LEN = 20
const DIGEST_LEN = 20

// 1.3.6.1.4.1.42.2.17.1.1 — Sun 'JavaKeyStore' key protector OID (DER content bytes).
const KEY_PROTECTOR_OID_BYTES = Buffer.from([
  0x2b, 0x06, 0x01, 0x04, 0x01, 0x2a, 0x02, 0x11, 0x01, 0x01,
])

/** Java DataOutput.writeUTF encoding of a password: UTF-16BE code units. */
function passwordToUtf16Be(password: string): Buffer {
  const out = Buffer.alloc(password.length * 2)
  for (let i = 0, j = 0; i < password.length; i++) {
    const code = password.charCodeAt(i)
    out[j++] = code >> 8
    out[j++] = code & 0xff
  }
  return out
}

/** Java modified-UTF-8 encoding of the string body (without the u2 length prefix). */
function modifiedUtf8Bytes(str: string): Buffer {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c >= 0x0001 && c <= 0x007f) {
      bytes.push(c)
    } else if (c === 0x0000 || (c >= 0x0080 && c <= 0x07ff)) {
      bytes.push(0xc0 | (c >> 6))
      bytes.push(0x80 | (c & 0x3f))
    } else {
      bytes.push(0xe0 | (c >> 12))
      bytes.push(0x80 | ((c >> 6) & 0x3f))
      bytes.push(0x80 | (c & 0x3f))
    }
  }
  return Buffer.from(bytes)
}

/** u2 length-prefixed modified-UTF-8, matching Java DataOutput.writeUTF. */
function writeUtf(str: string): Buffer {
  const body = modifiedUtf8Bytes(str)
  if (body.length > 0xffff) {
    throw new Error(`writeUTF: encoded string too long (${body.length} bytes)`)
  }
  const len = Buffer.alloc(2)
  len.writeUInt16BE(body.length, 0)
  return Buffer.concat([len, body])
}

function u4(value: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(value >>> 0, 0)
  return b
}

function u8(value: bigint): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(value, 0)
  return b
}

/** DER length octets (definite form; short form < 0x80, else long form). */
function derLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len])
  }
  const parts: number[] = []
  let v = len
  while (v > 0) {
    parts.unshift(v & 0xff)
    v = Math.floor(v / 256)
  }
  return Buffer.from([0x80 | parts.length, ...parts])
}

function derTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content])
}

/**
 * Sun 'JavaKeyStore' key-protector encryption of a PKCS#8 private key.
 * Returns EncryptedPrivateKeyInfo DER: SEQUENCE { SEQUENCE { OID }, OCTET STRING }
 * where OCTET STRING = salt(20) || (plaintext XOR keystream) || SHA1(pw||plaintext).
 */
function protectKey(pkcs8Der: Buffer, password: string): Buffer {
  const passwdBytes = passwordToUtf16Be(password)
  const salt = randomBytes(SALT_LEN)
  const keyLen = pkcs8Der.length
  const numRounds = Math.ceil(keyLen / DIGEST_LEN)

  // Iterated-SHA1 keystream: digest_0 = salt; digest_i = SHA1(pw || digest_{i-1}).
  const keystream = Buffer.alloc(numRounds * DIGEST_LEN)
  let digest = salt
  for (let i = 0; i < numRounds; i++) {
    const h = createHash('sha1')
    h.update(passwdBytes)
    h.update(digest)
    digest = h.digest()
    digest.copy(keystream, i * DIGEST_LEN)
  }

  const xored = Buffer.alloc(keyLen)
  for (let i = 0; i < keyLen; i++) {
    xored[i] = pkcs8Der[i] ^ keystream[i]
  }

  // Trailing integrity digest over the PLAINTEXT key.
  const check = createHash('sha1')
  check.update(passwdBytes)
  check.update(pkcs8Der)
  const checkDigest = check.digest()

  const encryptedData = Buffer.concat([salt, xored, checkDigest])

  const algId = derTlv(0x30, derTlv(0x06, KEY_PROTECTOR_OID_BYTES))
  const octet = derTlv(0x04, encryptedData)
  return derTlv(0x30, Buffer.concat([algId, octet]))
}

function encodeCert(certDer: Buffer): Buffer {
  // version 2 stream: UTF certType, u4 length, cert DER.
  return Buffer.concat([writeUtf(CERT_TYPE), u4(certDer.length), certDer])
}

function encodeKeyEntry(entry: JksKeyEntry, now: bigint): Buffer {
  const epki = protectKey(entry.privateKeyPkcs8Der, entry.entryPassword)
  const chain = Buffer.concat([
    u4(entry.certChainDer.length),
    ...entry.certChainDer.map(encodeCert),
  ])
  return Buffer.concat([
    u4(PRIVATE_KEY_TAG),
    writeUtf(entry.alias),
    u8(now),
    u4(epki.length),
    epki,
    chain,
  ])
}

function encodeCertEntry(entry: JksCertEntry, now: bigint): Buffer {
  return Buffer.concat([
    u4(TRUSTED_CERT_TAG),
    writeUtf(entry.alias),
    u8(now),
    encodeCert(entry.certDer),
  ])
}

/**
 * Encode a JKS keystore. The store integrity hash is keyed with `storePassword`;
 * each private-key entry is protected with its own `entryPassword` (may differ,
 * matching keytool's `-keypass` vs `-storepass`).
 */
export function encodeJks(entries: JksEntry[], storePassword: string): Buffer {
  const now = BigInt(Date.now())

  const header = Buffer.concat([u4(MAGIC), u4(VERSION), u4(entries.length)])
  const body = Buffer.concat([
    header,
    ...entries.map((entry) =>
      entry.type === 'key' ? encodeKeyEntry(entry, now) : encodeCertEntry(entry, now),
    ),
  ])

  // Keyed store hash: SHA1( UTF-16BE(pw) || UTF-8('Mighty Aphrodite') || body ).
  const hash = createHash('sha1')
  hash.update(passwordToUtf16Be(storePassword))
  hash.update(Buffer.from(WHITENER, 'utf8'))
  hash.update(body)

  return Buffer.concat([body, hash.digest()])
}
