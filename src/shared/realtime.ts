/**
 * WebSocket + Socket.IO request model shared by main (engines, handlers) and
 * the renderer (stores, editors). Issues #282 / #283.
 *
 * Field names follow the Postman collection v3 `websocket-request` /
 * `socket.io-request` shapes so a later v3 import/export maps 1:1:
 *   - settings: `strictSSL`, `handshakeTimeout` (ms), `retryCount`,
 *     `retryDelay` (ms), WebSocket `maxPayload`, Socket.IO `version` / `path`;
 *   - message `contentType`: `text | json | xml | html | base64 | hex`
 *     (the editor shows base64 / hex as "Binary");
 *   - Socket.IO saved message: `name, description, eventName,
 *     acknowledgement, args[{content, contentType}]`.
 * Two deliberate differences, mapped at the v3 boundary:
 *   - a Socket.IO listener's v3 `subscribeOnConnect` is `listen` here;
 *   - WebSocket `maxPayload` is in MB (the Settings field's unit), v3's unit is
 *     not documented.
 *
 * Pure TS, zero runtime imports: compiled into both bundles.
 */

// ─── Payload formats ────────────────────────────────────────────────────

/** A message / argument format. `base64` and `hex` are binary frames. */
export type RtContentType = 'text' | 'json' | 'xml' | 'html' | 'base64' | 'hex'
/** Socket.IO argument formats (no XML / HTML in Postman's Socket.IO composer). */
export type SioArgContentType = 'text' | 'json' | 'base64' | 'hex'

export const WS_CONTENT_TYPES: readonly RtContentType[] = [
  'text',
  'json',
  'xml',
  'html',
  'base64',
  'hex',
]
export const SIO_ARG_CONTENT_TYPES: readonly SioArgContentType[] = ['text', 'json', 'base64', 'hex']

export function isBinaryContentType(t: string): t is 'base64' | 'hex' {
  return t === 'base64' || t === 'hex'
}

export function isRtContentType(v: unknown): v is RtContentType {
  return typeof v === 'string' && (WS_CONTENT_TYPES as readonly string[]).includes(v)
}

export function isSioArgContentType(v: unknown): v is SioArgContentType {
  return typeof v === 'string' && (SIO_ARG_CONTENT_TYPES as readonly string[]).includes(v)
}

// ─── Settings ───────────────────────────────────────────────────────────

/** Settings both protocols share (Postman's Settings tab). */
export interface RtSettingsBase {
  /** Verify the server's TLS certificate (wss:// / https://). */
  strictSSL: boolean
  /** Handshake timeout in ms. */
  handshakeTimeout: number
  /** Reconnection attempts after an unexpected close; 0 = never reconnect. */
  retryCount: number
  /** Delay between reconnection attempts in ms. */
  retryDelay: number
}

export interface WsSettings extends RtSettingsBase {
  /** Largest incoming message in MB; 0 = unlimited. */
  maxPayload: number
}

/**
 * Socket.IO client versions (Postman v3's enum). `'2'` connects with the 2.x
 * client (v2 servers, EIO=3); `'3'` and `'4'` both use the 4.x client, which
 * talks to v3 and v4 servers alike (main `protocols/socketio-client.ts`).
 */
export type SioClientVersion = '2' | '3' | '4'
export const SIO_CLIENT_VERSIONS: readonly SioClientVersion[] = ['2', '3', '4']

/** Socket.IO transports: `auto` = WebSocket first, long-polling fallback (the pre-#283 behaviour). */
export type SioTransport = 'auto' | 'websocket' | 'polling'
export const SIO_TRANSPORTS: readonly SioTransport[] = ['auto', 'websocket', 'polling']

export interface SioSettings extends RtSettingsBase {
  version: SioClientVersion
  /** Server path of the handshake (`/socket.io`). */
  path: string
  transport: SioTransport
}

/**
 * Defaults = the behaviour before these settings existed, so a request saved
 * without them connects exactly as it did: WebSocket's fixed 15 s handshake
 * timer and the `ws` library's 100 MiB message cap; Socket.IO's 10 s timeout,
 * no reconnection, WebSocket-then-polling.
 */
export const DEFAULT_WS_SETTINGS: WsSettings = {
  strictSSL: true,
  handshakeTimeout: 15_000,
  retryCount: 0,
  retryDelay: 5_000,
  maxPayload: 100,
}

export const DEFAULT_SIO_SETTINGS: SioSettings = {
  strictSSL: true,
  handshakeTimeout: 10_000,
  retryCount: 0,
  retryDelay: 1_000,
  version: '4',
  path: '/socket.io',
  transport: 'auto',
}

const MAX_TIMEOUT_MS = 600_000
const MAX_RETRY = 100

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function baseOf(raw: Record<string, unknown>, d: RtSettingsBase): RtSettingsBase {
  return {
    strictSSL: typeof raw.strictSSL === 'boolean' ? raw.strictSSL : d.strictSSL,
    handshakeTimeout: intIn(raw.handshakeTimeout, 1, MAX_TIMEOUT_MS, d.handshakeTimeout),
    retryCount: intIn(raw.retryCount, 0, MAX_RETRY, d.retryCount),
    retryDelay: intIn(raw.retryDelay, 0, MAX_TIMEOUT_MS, d.retryDelay),
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Saved / IPC settings → a complete, clamped `WsSettings` (missing keys take the defaults). */
export function readWsSettings(raw: unknown): WsSettings {
  const r = isRecord(raw) ? raw : {}
  return {
    ...baseOf(r, DEFAULT_WS_SETTINGS),
    maxPayload: intIn(r.maxPayload, 0, 4096, DEFAULT_WS_SETTINGS.maxPayload),
  }
}

/** Saved / IPC settings → a complete, clamped `SioSettings`. */
export function readSioSettings(raw: unknown): SioSettings {
  const r = isRecord(raw) ? raw : {}
  const version = SIO_CLIENT_VERSIONS.includes(r.version as SioClientVersion)
    ? (r.version as SioClientVersion)
    : DEFAULT_SIO_SETTINGS.version
  const path =
    typeof r.path === 'string' && r.path.trim() ? r.path.trim() : DEFAULT_SIO_SETTINGS.path
  const transport = SIO_TRANSPORTS.includes(r.transport as SioTransport)
    ? (r.transport as SioTransport)
    : DEFAULT_SIO_SETTINGS.transport
  return { ...baseOf(r, DEFAULT_SIO_SETTINGS), version, path, transport }
}

/** MB (the Settings unit) → bytes for `ws`'s `maxPayload`; 0 stays 0 = unlimited. */
export function maxPayloadBytes(mb: number): number {
  return mb > 0 ? Math.round(mb * 1024 * 1024) : 0
}

// ─── Saved messages ─────────────────────────────────────────────────────

export interface WsSavedMessage {
  id: string
  name: string
  content: string
  contentType: RtContentType
}

export interface SioArg {
  id: string
  content: string
  contentType: SioArgContentType
}

export interface SioSavedMessage {
  id: string
  name: string
  description?: string
  eventName: string
  acknowledgement: boolean
  args: SioArg[]
}

/** A Socket.IO event listener (the Events tab). v3: `{name, description, subscribeOnConnect}`. */
export interface SioListener {
  id: string
  name: string
  description: string
  listen: boolean
}

/** What the engine forwards: every event, or only the listened names. */
export interface SioListenConfig {
  all: boolean
  events: string[]
}

/** An argument on the wire (renderer → main): content already `{{var}}`-resolved. */
export interface SioWireArg {
  content: string
  contentType: SioArgContentType
}

// ─── Binary helpers ─────────────────────────────────────────────────────

/** How main tags a received binary value so the renderer can show it (IPC turns Buffers into Uint8Array). */
export interface TaggedBinary {
  $binary: string
  size: number
}

export function isTaggedBinary(v: unknown): v is TaggedBinary {
  return isRecord(v) && typeof v.$binary === 'string' && typeof v.size === 'number'
}

export type DecodeResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string }

/** Strict hex: pairs of hex digits, whitespace / `0x` / `:` separators allowed. */
export function bytesFromHex(text: string): DecodeResult {
  const clean = text.replace(/0x/gi, '').replace(/[\s:,-]/g, '')
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    return { ok: false, error: 'Invalid hexadecimal: use pairs of 0-9 / a-f digits.' }
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return { ok: true, bytes: out }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Strict base64 (standard or URL-safe alphabet, whitespace ignored, padding optional). */
export function bytesFromBase64(text: string): DecodeResult {
  const clean = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const body = clean.replace(/=+$/, '')
  if (/[^A-Za-z0-9+/]/.test(body) || body.length % 4 === 1 || clean.length - body.length > 2) {
    return { ok: false, error: 'Invalid Base64.' }
  }
  const out = new Uint8Array(Math.floor((body.length * 3) / 4))
  let buf = 0
  let bits = 0
  let j = 0
  for (const ch of body) {
    buf = (buf << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[j++] = (buf >> bits) & 0xff
    }
  }
  return { ok: true, bytes: out }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

/** A binary payload (`base64` / `hex` content) → bytes. */
export function decodeBinary(content: string, contentType: 'base64' | 'hex'): DecodeResult {
  return contentType === 'hex' ? bytesFromHex(content) : bytesFromBase64(content)
}

/** Classic 16-bytes-per-line hexdump: offset, hex columns, printable ASCII. */
export function hexdump(bytes: Uint8Array, maxBytes = 64 * 1024): string {
  const n = Math.min(bytes.length, maxBytes)
  const lines: string[] = []
  for (let off = 0; off < n; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, n))
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0'))
    const left = hex.slice(0, 8).join(' ')
    const right = hex.slice(8).join(' ')
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
    lines.push(
      `${off.toString(16).padStart(8, '0')}  ${left.padEnd(23)}  ${right.padEnd(23)}  |${ascii.join('')}|`,
    )
  }
  if (bytes.length > n) lines.push(`… ${bytes.length - n} more bytes`)
  return lines.join('\n')
}

/** UTF-8 byte length of a string (Console sizes, the message Info popover). */
export function utf8Length(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4
      i++
    } else n += 3
  }
  return n
}
