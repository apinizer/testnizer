/**
 * One-Time Password primitives — RFC 4226 (HOTP, counter-based) and RFC 6238
 * (TOTP, time-based), plus RFC 4648 Base32 decoding and `otpauth://` URI
 * parsing.
 *
 * Main-process only: uses Node's `crypto.createHmac` (the same primitive
 * `http.engine.ts` uses for Hawk / AWS SigV4). Secrets never leave the main
 * process — the handler decrypts, computes here, and returns only the code.
 *
 * Pure and offline: a TOTP/HOTP code is just `truncate(HMAC(secret, counter))`;
 * no network is involved.
 */

import { createHmac } from 'crypto'

export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'
export type OtpType = 'totp' | 'hotp'

export interface OtpComputeOptions {
  /** HMAC hash. Default SHA1 (the near-universal authenticator default). */
  algorithm?: OtpAlgorithm
  /** Number of digits in the code. Default 6. */
  digits?: number
  /** TOTP time step in seconds. Default 30. Ignored by HOTP. */
  period?: number
}

/** Fields extracted from an `otpauth://` URI (secret kept as the raw Base32). */
export interface OtpDraft {
  type: OtpType
  label: string
  issuer: string
  account: string
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
  counter: number
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Decode an RFC 4648 Base32 secret (spaces/padding tolerated) to raw bytes. */
export function decodeBase32(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase()
  if (clean.length === 0) throw new Error('Empty Base32 secret.')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error(`Invalid Base32 character: "${ch}".`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }
  return Buffer.from(out)
}

function nodeAlgo(a: OtpAlgorithm): string {
  switch (a) {
    case 'SHA256':
      return 'sha256'
    case 'SHA512':
      return 'sha512'
    case 'SHA1':
    default:
      return 'sha1'
  }
}

/** Big-endian 8-byte counter (handles values above 2^32 up to 2^53). */
function counterToBuffer(counter: number): Buffer {
  const buf = Buffer.alloc(8)
  let tmp = Math.floor(counter)
  for (let i = 7; i >= 0; i--) {
    buf[i] = tmp & 0xff
    tmp = Math.floor(tmp / 256)
  }
  return buf
}

/** RFC 4226 HOTP — counter-based one-time password. */
export function hotp(secret: Buffer, counter: number, opts: OtpComputeOptions = {}): string {
  const algorithm = opts.algorithm ?? 'SHA1'
  const digits = opts.digits ?? 6
  const hmac = createHmac(nodeAlgo(algorithm), secret).update(counterToBuffer(counter)).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const code = binary % 10 ** digits
  return code.toString().padStart(digits, '0')
}

/** RFC 6238 TOTP — time-based; returns the code and seconds left in the step. */
export function totp(
  secret: Buffer,
  opts: OtpComputeOptions = {},
  nowMs: number = Date.now(),
): { code: string; secondsRemaining: number } {
  const period = opts.period ?? 30
  const nowSec = Math.floor(nowMs / 1000)
  const counter = Math.floor(nowSec / period)
  return {
    code: hotp(secret, counter, opts),
    secondsRemaining: period - (nowSec % period),
  }
}

/** True if `token` matches the current TOTP within ±`window` time steps. */
export function verifyTotp(
  secret: Buffer,
  token: string,
  opts: OtpComputeOptions = {},
  window = 1,
  nowMs: number = Date.now(),
): boolean {
  const period = opts.period ?? 30
  const nowSec = Math.floor(nowMs / 1000)
  const counter = Math.floor(nowSec / period)
  const clean = token.replace(/\s+/g, '')
  for (let w = -window; w <= window; w++) {
    if (hotp(secret, counter + w, opts) === clean) return true
  }
  return false
}

function normaliseAlgorithm(raw: string | null): OtpAlgorithm {
  const a = (raw ?? 'SHA1').toUpperCase()
  return a === 'SHA256' ? 'SHA256' : a === 'SHA512' ? 'SHA512' : 'SHA1'
}

/**
 * Parse an `otpauth://{totp|hotp}/{label}?secret=…&issuer=…&algorithm=…` URI
 * (the format encoded in authenticator QR codes) into editable fields.
 */
export function parseOtpauthUri(uri: string): OtpDraft {
  let url: URL
  try {
    url = new URL(uri.trim())
  } catch {
    throw new Error('Invalid otpauth URI.')
  }
  if (url.protocol !== 'otpauth:') throw new Error('Not an otpauth:// URI.')
  const type: OtpType = url.host.toLowerCase() === 'hotp' ? 'hotp' : 'totp'

  const rawLabel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  let issuer = url.searchParams.get('issuer') ?? ''
  let account = rawLabel
  if (rawLabel.includes(':')) {
    const [iss, ...rest] = rawLabel.split(':')
    if (!issuer) issuer = iss.trim()
    account = rest.join(':').trim()
  }

  const secret = (url.searchParams.get('secret') ?? '').replace(/\s+/g, '')
  if (!secret) throw new Error('otpauth URI is missing the secret parameter.')
  // Validate the secret is decodable now so a bad import fails loudly.
  decodeBase32(secret)

  return {
    type,
    label: rawLabel,
    issuer,
    account,
    secret,
    algorithm: normaliseAlgorithm(url.searchParams.get('algorithm')),
    digits: Number(url.searchParams.get('digits')) || 6,
    period: Number(url.searchParams.get('period')) || 30,
    counter: Number(url.searchParams.get('counter')) || 0,
  }
}

export interface OtpUriInput {
  type: OtpType
  issuer?: string | null
  account?: string | null
  label?: string | null
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
  counter: number
}

/** Build an `otpauth://` URI (the inverse of {@link parseOtpauthUri}) so an
 *  entry can be rendered as a QR code and scanned into a phone authenticator. */
export function buildOtpauthUri(e: OtpUriInput): string {
  const issuer = (e.issuer ?? '').trim()
  const account = (e.account ?? e.label ?? '').trim()
  const label = issuer ? `${issuer}:${account}` : account || 'OTP'
  const params = new URLSearchParams()
  params.set('secret', e.secret)
  if (issuer) params.set('issuer', issuer)
  params.set('algorithm', e.algorithm)
  params.set('digits', String(e.digits))
  if (e.type === 'hotp') params.set('counter', String(e.counter))
  else params.set('period', String(e.period))
  return `otpauth://${e.type}/${encodeURIComponent(label)}?${params.toString()}`
}
