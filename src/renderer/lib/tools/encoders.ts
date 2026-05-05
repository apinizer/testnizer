/**
 * Pure-fn encoders/decoders for the Encode/Decode tool.
 * Each function takes a string and returns either {ok:true, output} or
 * {ok:false, error}. Round-trip identity is preserved for valid inputs.
 *
 * Encoders prefer Buffer when available (Electron renderer + Node) and fall
 * back to TextEncoder/atob/btoa otherwise.
 */

export type EncodeResult = { ok: true; output: string } | { ok: false; error: string }

const hasBuffer = typeof Buffer !== 'undefined'

// ─── Base64 ──────────────────────────────────────────────────────

export function encodeBase64(input: string): EncodeResult {
  try {
    if (hasBuffer) return { ok: true, output: Buffer.from(input, 'utf8').toString('base64') }
    const bytes = new TextEncoder().encode(input)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return { ok: true, output: btoa(bin) }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

export function decodeBase64(input: string): EncodeResult {
  const cleaned = input.trim()
  if (cleaned === '') return { ok: true, output: '' }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    return { ok: false, error: 'Invalid Base64 — contains non-Base64 characters' }
  }
  if (cleaned.length % 4 !== 0) {
    return { ok: false, error: 'Invalid Base64 — length must be multiple of 4 (with padding)' }
  }
  try {
    if (hasBuffer) return { ok: true, output: Buffer.from(cleaned, 'base64').toString('utf8') }
    const bin = atob(cleaned)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { ok: true, output: new TextDecoder().decode(bytes) }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

// ─── Base64 URL ──────────────────────────────────────────────────

export function encodeBase64Url(input: string): EncodeResult {
  const r = encodeBase64(input)
  if (!r.ok) return r
  return { ok: true, output: r.output.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
}

export function decodeBase64Url(input: string): EncodeResult {
  const cleaned = input.trim().replace(/-/g, '+').replace(/_/g, '/')
  const pad = cleaned.length % 4 === 0 ? '' : '='.repeat(4 - (cleaned.length % 4))
  return decodeBase64(cleaned + pad)
}

// ─── URL (percent) ───────────────────────────────────────────────

export function encodeUrl(input: string): EncodeResult {
  try {
    return { ok: true, output: encodeURIComponent(input) }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

export function decodeUrl(input: string): EncodeResult {
  try {
    return { ok: true, output: decodeURIComponent(input) }
  } catch (e) {
    return { ok: false, error: 'Invalid percent-encoded sequence: ' + errMsg(e) }
  }
}

// ─── Hex ─────────────────────────────────────────────────────────

export function encodeHex(input: string): EncodeResult {
  try {
    if (hasBuffer) return { ok: true, output: Buffer.from(input, 'utf8').toString('hex') }
    const bytes = new TextEncoder().encode(input)
    let hex = ''
    for (const b of bytes) hex += b.toString(16).padStart(2, '0')
    return { ok: true, output: hex }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

export function decodeHex(input: string): EncodeResult {
  const cleaned = input.trim().replace(/\s+/g, '')
  if (cleaned === '') return { ok: true, output: '' }
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    return { ok: false, error: 'Invalid hex — contains non-hex characters' }
  }
  if (cleaned.length % 2 !== 0) {
    return { ok: false, error: 'Invalid hex — odd length (each byte needs 2 hex chars)' }
  }
  try {
    if (hasBuffer) return { ok: true, output: Buffer.from(cleaned, 'hex').toString('utf8') }
    const bytes = new Uint8Array(cleaned.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
    return { ok: true, output: new TextDecoder().decode(bytes) }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

// ─── HTML ────────────────────────────────────────────────────────

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  euro: '€',
  pound: '£',
  yen: '¥',
}

export function encodeHtml(input: string): EncodeResult {
  return { ok: true, output: input.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]) }
}

export function decodeHtml(input: string): EncodeResult {
  let unknownEntity: string | null = null
  const output = input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    const named = HTML_NAMED_ENTITIES[body.toLowerCase()]
    if (named !== undefined) return named
    if (unknownEntity === null) unknownEntity = body
    return match
  })
  if (unknownEntity !== null) {
    return { ok: false, error: `Unknown HTML entity: &${unknownEntity};` }
  }
  return { ok: true, output }
}

// ─── Unicode escape (\uXXXX) ─────────────────────────────────────

export function encodeUnicode(input: string): EncodeResult {
  let out = ''
  for (const ch of input) {
    const code = ch.codePointAt(0)!
    if (code < 0x20 || code > 0x7e) {
      if (code > 0xffff) {
        const high = 0xd800 + ((code - 0x10000) >> 10)
        const low = 0xdc00 + ((code - 0x10000) & 0x3ff)
        out += `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`
      } else {
        out += `\\u${code.toString(16).padStart(4, '0')}`
      }
    } else {
      out += ch
    }
  }
  return { ok: true, output: out }
}

export function decodeUnicode(input: string): EncodeResult {
  try {
    const out = input.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    return { ok: true, output: out }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

// ─── Encoder registry (for the UI tab bar) ───────────────────────

export type EncoderId = 'base64' | 'base64url' | 'url' | 'hex' | 'html' | 'unicode'

export const ENCODERS: Record<
  EncoderId,
  { encode: (s: string) => EncodeResult; decode: (s: string) => EncodeResult; label: string }
> = {
  base64: { encode: encodeBase64, decode: decodeBase64, label: 'Base64' },
  base64url: { encode: encodeBase64Url, decode: decodeBase64Url, label: 'Base64 URL' },
  url: { encode: encodeUrl, decode: decodeUrl, label: 'URL' },
  hex: { encode: encodeHex, decode: decodeHex, label: 'Hex' },
  html: { encode: encodeHtml, decode: decodeHtml, label: 'HTML' },
  unicode: { encode: encodeUnicode, decode: decodeUnicode, label: 'Unicode' },
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
