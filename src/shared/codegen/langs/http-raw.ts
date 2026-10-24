/**
 * HTTP — the raw HTTP/1.1 request message. No quoting: the message is the
 * text on the wire. A file's bytes are shown as `<contents of PATH>`; a Basic
 * credential with a `{{placeholder}}` cannot be encoded, so it is written as
 * `<base64 of user:pass>` with the placeholder readable.
 */
import { basicAuth } from '../helpers'
import { rawContent, TRIM_BODY } from '../options'
import type { CodegenVariant } from '../types'

const BOUNDARY = '----TestnizerFormBoundary7MA4YWxkTrZu0gW'

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length
}

export const httpRaw: CodegenVariant = {
  id: 'http-raw',
  language: 'http',
  label: 'HTTP/1.1',
  monaco: 'plaintext',
  options: [TRIM_BODY],
  generate(req, o) {
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^#]*)/i.exec(req.url)
    const host = m && !m[1].includes('{{') ? m[1] : undefined
    const target = host ? m?.[2] || '/' : req.url.replace(/#.*$/, '')
    const lines = [`${req.method} ${target} HTTP/1.1`]
    if (host) lines.push(`Host: ${host}`)
    for (const h of req.headers) lines.push(`${h.key}: ${h.value}`)
    const auth = basicAuth(req)
    if (auth)
      lines.push(
        `Authorization: ${auth.literal ?? `Basic <base64 of ${auth.username}:${auth.password}>`}`,
      )
    const b = req.body
    let body: string | undefined
    if (b?.mode === 'raw') body = rawContent(req, o) ?? ''
    else if (b?.mode === 'urlencoded') body = b.encoded
    else if (b?.mode === 'binary') body = `<contents of ${b.path}>`
    else if (b?.mode === 'form-data') {
      lines.push(`Content-Type: multipart/form-data; boundary=${BOUNDARY}`)
      const parts: string[] = []
      for (const p of b.parts) {
        parts.push(`--${BOUNDARY}`)
        if (p.kind === 'text') {
          parts.push(`Content-Disposition: form-data; name="${p.key}"`, '', p.value)
        } else {
          parts.push(`Content-Disposition: form-data; name="${p.key}"; filename="${p.fileName}"`)
          parts.push('Content-Type: application/octet-stream', '', `<contents of ${p.path}>`)
        }
      }
      parts.push(`--${BOUNDARY}--`)
      body = parts.join('\r\n')
    }
    if (b?.mode === 'raw' || b?.mode === 'urlencoded')
      lines.push(`Content-Length: ${utf8Length(body ?? '')}`)
    if (body === undefined) return lines.join('\n')
    return `${lines.join('\n')}\n\n${body.replace(/\r\n/g, '\n')}`
  },
}
