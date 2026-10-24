/**
 * Ruby — Net::HTTP (id `ruby`). Pre-#280 layout kept; a body's `#{…}` is
 * escaped (Ruby double quotes interpolate it), form-data uses `set_form`, a
 * binary body `File.binread`, Basic auth `basic_auth`. Net::HTTP never
 * follows redirects, so there is no redirect option.
 */
import {
  indentCountOpt,
  indentTypeOpt,
  indentUnit,
  rawContent,
  TIMEOUT,
  timeoutMs,
  TRIM_BODY,
} from '../options'
import { basicAuth, titleCase } from '../helpers'
import { rubyString as q } from '../quote'
import type { CodegenVariant } from '../types'

const CLASSES = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'])

/** Ruby double-quoted literal: JSON escapes are valid Ruby escapes; `#{`, `#@`, `#$` must not interpolate. */
function dq(s: string): string {
  return JSON.stringify(s).replace(/#(?=[{@$])/g, '\\#')
}

export const rubyNetHttp: CodegenVariant = {
  id: 'ruby',
  language: 'ruby',
  label: 'Net::HTTP',
  monaco: 'ruby',
  options: [indentCountOpt(2), indentTypeOpt(), TRIM_BODY, TIMEOUT],
  generate(req, o) {
    const ind = indentUnit(o)
    const lines: string[] = ["require 'net/http'", "require 'uri'", "require 'json'", '']
    lines.push(`uri = URI.parse(${q(req.url)})`)
    lines.push(
      CLASSES.has(req.method)
        ? `request = Net::HTTP::${titleCase(req.method)}.new(uri)`
        : `request = Net::HTTPGenericRequest.new(${q(req.method)}, true, true, uri)`,
    )
    for (const h of req.headers) lines.push(`request[${q(h.key)}] = ${q(h.value)}`)
    const auth = basicAuth(req)
    if (auth) lines.push(`request.basic_auth(${q(auth.username)}, ${q(auth.password)})`)
    const b = req.body
    if (b?.mode === 'raw') lines.push(`request.body = ${dq(rawContent(req, o) ?? '')}`)
    else if (b?.mode === 'urlencoded') lines.push(`request.body = ${dq(b.encoded)}`)
    else if (b?.mode === 'binary') lines.push(`request.body = File.binread(${q(b.path)})`)
    else if (b?.mode === 'form-data') {
      const parts = b.parts.map((p) =>
        p.kind === 'file'
          ? `${ind}[${q(p.key)}, File.open(${q(p.path)}), { filename: ${q(p.fileName)} }]`
          : `${ind}[${q(p.key)}, ${q(p.value)}]`,
      )
      lines.push(`request.set_form([\n${parts.join(',\n')}\n], 'multipart/form-data')`)
    }
    const startOpts = ['use_ssl: uri.scheme == "https"']
    const ms = timeoutMs(req, o)
    if (ms > 0) startOpts.push(`open_timeout: ${ms / 1000}`, `read_timeout: ${ms / 1000}`)
    if (req.settings.insecure) startOpts.push('verify_mode: OpenSSL::SSL::VERIFY_NONE')
    lines.push('')
    lines.push(
      `response = Net::HTTP.start(uri.hostname, uri.port, ${startOpts.join(', ')}) do |http|`,
    )
    lines.push(`${ind}http.request(request)`)
    lines.push('end', '', 'puts response.body')
    return lines.join('\n')
  },
}
