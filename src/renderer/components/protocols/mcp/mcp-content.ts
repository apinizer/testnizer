/**
 * Content-block helpers for the MCP result views (issue #139). Pure; the
 * blob-URL helpers guard `URL.createObjectURL` (absent in jsdom).
 */
import type { McpCallToolResult, McpContentBlock } from '../../../types/mcp'

const BLOCK_TYPES = new Set(['text', 'image', 'audio', 'resource', 'resource_link'])

export function isContentBlock(v: unknown): v is McpContentBlock {
  return (
    typeof v === 'object' && v !== null && BLOCK_TYPES.has(String((v as { type?: unknown }).type))
  )
}

/** A raw `tools/call` result in CallToolResult shape, or null when it is something else. */
export function asCallToolResult(v: unknown): McpCallToolResult | null {
  if (typeof v !== 'object' || v === null) return null
  const content = (v as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  return v as McpCallToolResult
}

/** Decoded size of a base64 payload. */
export function base64ByteLength(b64: string): number {
  const clean = b64.replace(/\s+/g, '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding)
}

/** The decoded bytes of a base64 payload, or null when it is not base64. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ''))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function base64ToBlob(b64: string, mimeType: string): Blob | null {
  const bytes = base64ToBytes(b64)
  return bytes ? new Blob([bytes], { type: mimeType || 'application/octet-stream' }) : null
}

/**
 * Is an image payload structurally whole? (issue #215)
 *
 *   'incomplete' — the bytes are not base64, or a PNG / JPEG / GIF / WebP
 *                  whose structure stops before its end marker (PNG chunk
 *                  walk to IEND, JPEG EOI, GIF trailer, WebP RIFF size)
 *   'complete'   — that structure checks out
 *   'unchecked'  — any other format: nothing is claimed
 *
 * Used only to EXPLAIN a decode failure the browser already reported: the
 * hosted Everything server sends a PNG that breaks inside its iCCP chunk, and
 * "could not be displayed" read like a Testnizer bug. Checks structure, not
 * CRCs (browsers ignore ancillary-chunk CRC errors themselves).
 */
export function inspectImageData(
  b64: string,
  mimeType: string,
): 'complete' | 'incomplete' | 'unchecked' {
  const bytes = base64ToBytes(b64)
  if (!bytes) return 'incomplete'
  const mime = mimeType.toLowerCase()
  const at = (i: number): number => bytes[i] ?? -1
  const u32 = (i: number): number =>
    ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0
  const ascii = (i: number, n: number): string =>
    String.fromCharCode(...Array.from(bytes.subarray(i, i + n)))

  if (mime === 'image/png') {
    const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (!SIGNATURE.every((b, i) => at(i) === b)) return 'incomplete'
    // length(4) type(4) data(length) crc(4), until IEND
    for (let i = 8; i + 12 <= bytes.length; ) {
      const next = i + 12 + u32(i)
      if (next > bytes.length) return 'incomplete'
      if (ascii(i + 4, 4) === 'IEND') return 'complete'
      i = next
    }
    return 'incomplete'
  }
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    const n = bytes.length
    return at(0) === 0xff && at(1) === 0xd8 && at(n - 2) === 0xff && at(n - 1) === 0xd9
      ? 'complete'
      : 'incomplete'
  }
  if (mime === 'image/gif') {
    return ascii(0, 4) === 'GIF8' && at(bytes.length - 1) === 0x3b ? 'complete' : 'incomplete'
  }
  if (mime === 'image/webp') {
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return 'incomplete'
    const riffSize = (at(4) | (at(5) << 8) | (at(6) << 16) | (at(7) << 24)) >>> 0
    return riffSize + 8 <= bytes.length ? 'complete' : 'incomplete'
  }
  return 'unchecked'
}

export function canMakeObjectUrl(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
}

/** Save a base64 payload as a file via a transient blob URL (renderer-local, no network). */
export function downloadBase64(b64: string, mimeType: string | undefined, fileName: string): void {
  if (!canMakeObjectUrl()) return
  const blob = base64ToBlob(b64, mimeType ?? '')
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Last path segment of a URI, for a download file name. */
export function fileNameFromUri(uri: string): string {
  const last = uri.split(/[?#]/)[0].split('/').filter(Boolean).pop()
  return last && last.length < 120 ? last : 'resource.bin'
}

/** Download name for an image block: `image/png` → `image.png`, anything odd → `image.bin`. */
export function imageFileName(mimeType: string): string {
  const sub = (mimeType.split('/')[1] ?? '').split('+')[0]
  return /^[a-z0-9-]{1,12}$/i.test(sub) ? `image.${sub.toLowerCase()}` : 'image.bin'
}

/** Pretty-print text that is JSON; anything else is returned as-is. */
export function prettyIfJson(text: string): string {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}
