/**
 * Browser-side hash + HMAC calculator using SubtleCrypto (SHA-1/256/384/512)
 * with a tiny pure-JS MD5 fallback for MD5 (SubtleCrypto does not implement MD5).
 *
 * All algorithms run synchronously-from-the-caller's-perspective via async/await.
 * No IPC is required — these are pure CPU operations on the renderer.
 */

export type HashAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'

export const HASH_ALGORITHMS: HashAlgorithm[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']

/** HMAC variants. MD5 not supported here (SubtleCrypto restriction). */
export type HmacAlgorithm = 'HMAC-SHA1' | 'HMAC-SHA256' | 'HMAC-SHA384' | 'HMAC-SHA512'

export const HMAC_ALGORITHMS: HmacAlgorithm[] = [
  'HMAC-SHA1',
  'HMAC-SHA256',
  'HMAC-SHA384',
  'HMAC-SHA512',
]

/** Hex encode a Uint8Array. */
function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let out = ''
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i]
    out += (b < 16 ? '0' : '') + b.toString(16)
  }
  return out
}

/** Hash a string with the given algorithm; returns lowercase hex. */
export async function hashString(message: string, algorithm: HashAlgorithm): Promise<string> {
  if (algorithm === 'MD5') return md5Hex(message)
  const data = new TextEncoder().encode(message)
  const digest = await crypto.subtle.digest(algorithm, data)
  return toHex(digest)
}

/** Compute all standard hashes for the same input — useful for the calculator UI. */
export async function hashAll(message: string): Promise<Record<HashAlgorithm, string>> {
  const out: Partial<Record<HashAlgorithm, string>> = {}
  for (const alg of HASH_ALGORITHMS) {
    out[alg] = await hashString(message, alg)
  }
  return out as Record<HashAlgorithm, string>
}

/** HMAC a message with the given key using SubtleCrypto (SHA-1/256/384/512). */
export async function hmacString(
  message: string,
  key: string,
  algorithm: HmacAlgorithm,
): Promise<string> {
  const subtleHash = subtleHashFromHmac(algorithm)
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: subtleHash },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))
  return toHex(sig)
}

/** Compute all HMAC variants for the same (message, key) pair. */
export async function hmacAll(
  message: string,
  key: string,
): Promise<Record<HmacAlgorithm, string>> {
  const out: Partial<Record<HmacAlgorithm, string>> = {}
  for (const alg of HMAC_ALGORITHMS) {
    out[alg] = await hmacString(message, key, alg)
  }
  return out as Record<HmacAlgorithm, string>
}

function subtleHashFromHmac(alg: HmacAlgorithm): string {
  switch (alg) {
    case 'HMAC-SHA1':
      return 'SHA-1'
    case 'HMAC-SHA256':
      return 'SHA-256'
    case 'HMAC-SHA384':
      return 'SHA-384'
    case 'HMAC-SHA512':
      return 'SHA-512'
  }
}

// ───────────────────────────────────────────────────────────────────
// MD5 — pure-JS implementation (RFC 1321). Browser SubtleCrypto does
// not provide MD5; we ship a small hand-rolled hasher since md5 is
// commonly requested for legacy interop and checksum scenarios.
// ───────────────────────────────────────────────────────────────────

function md5Hex(s: string): string {
  const bytes = new TextEncoder().encode(s)
  return md5BytesHex(bytes)
}

function md5BytesHex(bytes: Uint8Array): string {
  // Convert byte array to a 32-bit little-endian word array padded per RFC 1321.
  const len = bytes.length
  const totalLen = (((len + 8) >>> 6) + 1) << 6 // multiple of 64
  const padded = new Uint8Array(totalLen)
  padded.set(bytes)
  padded[len] = 0x80
  // 64-bit length in bits, little-endian (we only fill low 32 bits).
  const bitLen = len * 8
  padded[totalLen - 8] = bitLen & 0xff
  padded[totalLen - 7] = (bitLen >>> 8) & 0xff
  padded[totalLen - 6] = (bitLen >>> 16) & 0xff
  padded[totalLen - 5] = (bitLen >>> 24) & 0xff

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  const x = new Int32Array(16)

  for (let off = 0; off < totalLen; off += 64) {
    for (let j = 0; j < 16; j++) {
      const k = off + j * 4
      x[j] = padded[k] | (padded[k + 1] << 8) | (padded[k + 2] << 16) | (padded[k + 3] << 24)
    }

    const aa = a
    const bb = b
    const cc = c
    const dd = d

    // Round 1
    a = ff(a, b, c, d, x[0], 7, -680876936)
    d = ff(d, a, b, c, x[1], 12, -389564586)
    c = ff(c, d, a, b, x[2], 17, 606105819)
    b = ff(b, c, d, a, x[3], 22, -1044525330)
    a = ff(a, b, c, d, x[4], 7, -176418897)
    d = ff(d, a, b, c, x[5], 12, 1200080426)
    c = ff(c, d, a, b, x[6], 17, -1473231341)
    b = ff(b, c, d, a, x[7], 22, -45705983)
    a = ff(a, b, c, d, x[8], 7, 1770035416)
    d = ff(d, a, b, c, x[9], 12, -1958414417)
    c = ff(c, d, a, b, x[10], 17, -42063)
    b = ff(b, c, d, a, x[11], 22, -1990404162)
    a = ff(a, b, c, d, x[12], 7, 1804603682)
    d = ff(d, a, b, c, x[13], 12, -40341101)
    c = ff(c, d, a, b, x[14], 17, -1502002290)
    b = ff(b, c, d, a, x[15], 22, 1236535329)

    // Round 2
    a = gg(a, b, c, d, x[1], 5, -165796510)
    d = gg(d, a, b, c, x[6], 9, -1069501632)
    c = gg(c, d, a, b, x[11], 14, 643717713)
    b = gg(b, c, d, a, x[0], 20, -373897302)
    a = gg(a, b, c, d, x[5], 5, -701558691)
    d = gg(d, a, b, c, x[10], 9, 38016083)
    c = gg(c, d, a, b, x[15], 14, -660478335)
    b = gg(b, c, d, a, x[4], 20, -405537848)
    a = gg(a, b, c, d, x[9], 5, 568446438)
    d = gg(d, a, b, c, x[14], 9, -1019803690)
    c = gg(c, d, a, b, x[3], 14, -187363961)
    b = gg(b, c, d, a, x[8], 20, 1163531501)
    a = gg(a, b, c, d, x[13], 5, -1444681467)
    d = gg(d, a, b, c, x[2], 9, -51403784)
    c = gg(c, d, a, b, x[7], 14, 1735328473)
    b = gg(b, c, d, a, x[12], 20, -1926607734)

    // Round 3
    a = hh(a, b, c, d, x[5], 4, -378558)
    d = hh(d, a, b, c, x[8], 11, -2022574463)
    c = hh(c, d, a, b, x[11], 16, 1839030562)
    b = hh(b, c, d, a, x[14], 23, -35309556)
    a = hh(a, b, c, d, x[1], 4, -1530992060)
    d = hh(d, a, b, c, x[4], 11, 1272893353)
    c = hh(c, d, a, b, x[7], 16, -155497632)
    b = hh(b, c, d, a, x[10], 23, -1094730640)
    a = hh(a, b, c, d, x[13], 4, 681279174)
    d = hh(d, a, b, c, x[0], 11, -358537222)
    c = hh(c, d, a, b, x[3], 16, -722521979)
    b = hh(b, c, d, a, x[6], 23, 76029189)
    a = hh(a, b, c, d, x[9], 4, -640364487)
    d = hh(d, a, b, c, x[12], 11, -421815835)
    c = hh(c, d, a, b, x[15], 16, 530742520)
    b = hh(b, c, d, a, x[2], 23, -995338651)

    // Round 4
    a = ii(a, b, c, d, x[0], 6, -198630844)
    d = ii(d, a, b, c, x[7], 10, 1126891415)
    c = ii(c, d, a, b, x[14], 15, -1416354905)
    b = ii(b, c, d, a, x[5], 21, -57434055)
    a = ii(a, b, c, d, x[12], 6, 1700485571)
    d = ii(d, a, b, c, x[3], 10, -1894986606)
    c = ii(c, d, a, b, x[10], 15, -1051523)
    b = ii(b, c, d, a, x[1], 21, -2054922799)
    a = ii(a, b, c, d, x[8], 6, 1873313359)
    d = ii(d, a, b, c, x[15], 10, -30611744)
    c = ii(c, d, a, b, x[6], 15, -1560198380)
    b = ii(b, c, d, a, x[13], 21, 1309151649)
    a = ii(a, b, c, d, x[4], 6, -145523070)
    d = ii(d, a, b, c, x[11], 10, -1120210379)
    c = ii(c, d, a, b, x[2], 15, 718787259)
    b = ii(b, c, d, a, x[9], 21, -343485551)

    a = (a + aa) | 0
    b = (b + bb) | 0
    c = (c + cc) | 0
    d = (d + dd) | 0
  }

  return wordsToHexLE([a, b, c, d])
}

function add32(a: number, b: number): number {
  return (a + b) | 0
}
function rotl32(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n))
}
function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
  return add32(rotl32(add32(add32(a, q), add32(x, t)), s), b)
}
function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn((b & c) | (~b & d), a, b, x, s, t)
}
function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn((b & d) | (c & ~d), a, b, x, s, t)
}
function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn(b ^ c ^ d, a, b, x, s, t)
}
function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn(c ^ (b | ~d), a, b, x, s, t)
}

function wordsToHexLE(words: number[]): string {
  let out = ''
  for (const w of words) {
    for (let i = 0; i < 4; i++) {
      const b = (w >>> (i * 8)) & 0xff
      out += (b < 16 ? '0' : '') + b.toString(16)
    }
  }
  return out
}
