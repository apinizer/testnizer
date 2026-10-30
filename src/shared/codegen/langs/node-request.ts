/** NodeJS — Request (the deprecated `request` package Postman still offers). */
import { coreOptions, indentUnit, shouldFollow, timeoutMs } from '../options'
import { basicAuth } from '../helpers'
import { jsString } from '../quote'
import type { CodegenVariant } from '../types'
import { jsObject, jsRawExpr } from './js-common'

export const nodeRequest: CodegenVariant = {
  id: 'nodejs-request',
  language: 'nodejs',
  label: 'Request',
  monaco: 'javascript',
  options: coreOptions(2),
  generate(req, o) {
    const ind = indentUnit(o)
    const b = req.body
    const needsFs =
      b?.mode === 'binary' || (b?.mode === 'form-data' && b.parts.some((p) => p.kind === 'file'))
    const lines = ["const request = require('request');"]
    if (needsFs) lines.push("const fs = require('fs');")
    lines.push('')
    const opts: Array<[string, string]> = [
      ['method', jsString(req.method)],
      ['url', jsString(req.url)],
    ]
    if (req.headers.length > 0) {
      opts.push([
        'headers',
        jsObject(
          req.headers.map((h) => [h.key, jsString(h.value)]),
          ind,
          1,
        ),
      ])
    }
    const auth = basicAuth(req)
    if (auth)
      opts.push(['auth', `{ user: ${jsString(auth.username)}, pass: ${jsString(auth.password)} }`])
    if (b?.mode === 'raw') opts.push(['body', jsRawExpr(req, o, ind, 1)])
    else if (b?.mode === 'urlencoded') opts.push(['body', jsString(b.encoded)])
    else if (b?.mode === 'binary') opts.push(['body', `fs.readFileSync(${jsString(b.path)})`])
    else if (b?.mode === 'form-data') {
      const parts: Array<[string, string]> = b.parts.map((p) =>
        p.kind === 'file'
          ? [
              p.key,
              `{ value: fs.createReadStream(${jsString(p.path)}), options: { filename: ${jsString(p.fileName)} } }`,
            ]
          : [p.key, jsString(p.value)],
      )
      opts.push(['formData', jsObject(parts, ind, 1)])
    }
    if (!shouldFollow(req, o)) opts.push(['followRedirect', 'false'])
    const ms = timeoutMs(req, o)
    if (ms > 0) opts.push(['timeout', String(ms)])
    if (req.settings.insecure) opts.push(['strictSSL', 'false'])
    lines.push(`const options = ${jsObject(opts, ind)};`, '')
    lines.push('request(options, (error, response) => {')
    lines.push(`${ind}if (error) throw error;`, `${ind}console.log(response.body);`, '});')
    return lines.join('\n')
  },
}
