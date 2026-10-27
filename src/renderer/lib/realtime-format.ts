/**
 * Message formatting for the WebSocket and Socket.IO editors (issues #282 /
 * #283): Beautify in the composer, the expanded-message view modes, the
 * Info line. Pure (no DOM, no stores).
 */
import {
  bytesFromBase64,
  hexdump,
  isBinaryContentType,
  utf8Length,
  type RtContentType,
} from '../../shared/realtime'
import { formatXml } from './tools/xml-format'

/** The Monaco language of a message body format (composers, the MQTT will payload). */
export const RT_MONACO_LANGUAGE: Readonly<Record<RtContentType, string>> = {
  text: 'plaintext',
  json: 'json',
  xml: 'xml',
  html: 'html',
  base64: 'plaintext',
  hex: 'plaintext',
}

export type BeautifyResult = { ok: true; output: string } | { ok: false; error: string }

/** Formats Beautify supports (Postman: JSON, XML, HTML). */
export function canBeautify(type: RtContentType): boolean {
  return type === 'json' || type === 'xml' || type === 'html'
}

export function beautify(content: string, type: RtContentType): BeautifyResult {
  if (type === 'json') {
    try {
      return { ok: true, output: JSON.stringify(JSON.parse(content), null, 2) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  if (type === 'xml' || type === 'html') {
    const res = formatXml(content, { indent: 2, selfCloseEmpty: false })
    return res.ok ? { ok: true, output: res.output } : { ok: false, error: res.error }
  }
  return { ok: true, output: content }
}

/** How an expanded message is shown. `hexdump` only for binary payloads. */
export type MessageViewMode = 'text' | 'json' | 'xml' | 'html' | 'hexdump'

/** The default view for a message of `type`. */
export function defaultViewMode(type: RtContentType | 'binary'): MessageViewMode {
  if (type === 'binary' || isBinaryContentType(type)) return 'hexdump'
  return type === 'json' || type === 'xml' || type === 'html' ? type : 'text'
}

/**
 * The text an expanded message shows in `mode`. Binary content is base64;
 * `text` decodes it as UTF-8. A JSON / XML / HTML view of text that does not
 * parse falls back to the raw text.
 */
export function viewText(content: string, binary: boolean, mode: MessageViewMode): string {
  if (binary) {
    const res = bytesFromBase64(content)
    if (!res.ok) return content
    if (mode === 'hexdump') return hexdump(res.bytes)
    return new TextDecoder('utf-8', { fatal: false }).decode(res.bytes)
  }
  if (mode === 'json' || mode === 'xml' || mode === 'html') {
    const res = beautify(content, mode)
    return res.ok ? res.output : content
  }
  return content
}

/** Size in bytes of a message as it went over the wire. */
export function messageSize(content: string, binary: boolean): number {
  if (!binary) return utf8Length(content)
  const res = bytesFromBase64(content)
  return res.ok ? res.bytes.length : utf8Length(content)
}

/** `1 234 B` / `12.3 KB` / `1.2 MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** `HH:MM:SS.mmm`, local time (Postman's log column). */
export function formatLogTime(ts: number): string {
  const d = new Date(ts)
  const pad = (v: number, l = 2): string => String(v).padStart(l, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}
