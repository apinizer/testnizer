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

export function base64ToBlob(b64: string, mimeType: string): Blob | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ''))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mimeType || 'application/octet-stream' })
  } catch {
    return null
  }
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
