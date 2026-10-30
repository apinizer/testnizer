/**
 * R — RCurl (`getURL` with curl options; `postForm(style = 'httppost')` for
 * form-data). Basic / Digest / NTLM through `userpwd` + `httpauth` (curl
 * encodes it, so a `{{placeholder}}` stays readable).
 */
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { rString as q } from '../quote'
import type { CodegenVariant } from '../types'

/** libcurl CURLAUTH_* bit values. */
const AUTH_BIT = { basic: '1L', digest: '2L', ntlm: '8L' }

export const rRcurl: CodegenVariant = {
  id: 'r-rcurl',
  language: 'r',
  label: 'RCurl',
  monaco: 'r',
  options: coreOptions(2),
  generate(req, o) {
    const ind = indentUnit(o)
    const lines: string[] = ['library(RCurl)', '']
    const opts: string[] = []
    if (req.method === 'HEAD') opts.push('nobody = TRUE')
    else if (req.method !== 'GET') opts.push(`customrequest = ${q(req.method)}`)
    if (req.headers.length > 0) {
      const hs = req.headers.map((h) => `${ind}${q(h.key)} = ${q(h.value)}`)
      lines.push(`headers <- c(\n${hs.join(',\n')}\n)`, '')
      opts.push('httpheader = headers')
    }
    const b = req.body
    if (b?.mode === 'raw') lines.push(`body <- ${q(rawContent(req, o) ?? '')}`, '')
    else if (b?.mode === 'urlencoded') lines.push(`body <- ${q(b.encoded)}`, '')
    else if (b?.mode === 'binary') {
      lines.push(
        `body <- readBin(${q(b.path)}, what = 'raw', n = file.info(${q(b.path)})$size)`,
        '',
      )
    } else if (b?.mode === 'form-data') {
      const parts = b.parts.map((p) =>
        p.kind === 'file'
          ? `${ind}${q(p.key)} = fileUpload(${q(p.path)})`
          : `${ind}${q(p.key)} = ${q(p.value)}`,
      )
      lines.push(`params <- list(\n${parts.join(',\n')}\n)`, '')
    }
    if (b && b.mode !== 'form-data') opts.push('postfields = body')
    if (b?.mode === 'binary') opts.push('postfieldsize = length(body)')
    if (req.auth) {
      opts.push(`userpwd = ${q(`${req.auth.username}:${req.auth.password}`)}`)
      opts.push(`httpauth = ${AUTH_BIT[req.auth.scheme]}`)
    }
    if (shouldFollow(req, o)) opts.push('followlocation = TRUE')
    const ms = timeoutMs(req, o)
    if (ms > 0) opts.push(`timeout.ms = ${ms}`)
    if (req.settings.insecure) opts.push('ssl.verifypeer = FALSE', 'ssl.verifyhost = FALSE')
    const optList = opts.length
      ? `list(\n${opts.map((x) => `${ind}${x}`).join(',\n')}\n)`
      : 'list()'
    lines.push(`opts <- ${optList}`, '')
    lines.push(
      b?.mode === 'form-data'
        ? `res <- postForm(${q(req.url)}, .params = params, .opts = opts, style = 'httppost')`
        : `res <- getURL(${q(req.url)}, .opts = opts)`,
      'cat(res)',
    )
    return lines.join('\n')
  },
}
