/**
 * NodeJS — Native (`http` / `https`; with redirects on, the `follow-redirects`
 * drop-in like Postman, since Node's own client never follows).
 */
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { basicAuth } from '../helpers'
import { jsString } from '../quote'
import type { CodegenVariant } from '../types'
import { jsObject } from './js-common'
import { nodeFormLines, nodeRequires } from './node-common'

export const nodeNative: CodegenVariant = {
  id: 'nodejs-native',
  language: 'nodejs',
  label: 'Native',
  monaco: 'javascript',
  options: coreOptions(2),
  generate(req, o) {
    const ind = indentUnit(o)
    const scheme = /^http:/i.test(req.url) ? 'http' : 'https'
    const follow = shouldFollow(req, o)
    const lib = follow ? `require('follow-redirects').${scheme}` : `require('${scheme}')`
    const lines: string[] = [`const ${scheme} = ${lib};`, ...nodeRequires(req), '']
    const form = nodeFormLines(req)
    if (form.length) lines.push(...form, '')
    const b = req.body
    const headerEntries: Array<[string, string]> = req.headers.map((h) => [
      h.key,
      jsString(h.value),
    ])
    const opts: Array<[string, string]> = [['method', jsString(req.method)]]
    if (b?.mode === 'form-data') {
      opts.push([
        'headers',
        headerEntries.length
          ? `{ ...form.getHeaders(), ...${jsObject(headerEntries, ind, 1)} }`
          : 'form.getHeaders()',
      ])
    } else if (headerEntries.length > 0) {
      opts.push(['headers', jsObject(headerEntries, ind, 1)])
    }
    const auth = basicAuth(req)
    if (auth) opts.push(['auth', jsString(`${auth.username}:${auth.password}`)])
    if (follow) opts.push(['maxRedirects', '20'])
    const ms = timeoutMs(req, o)
    if (ms > 0) opts.push(['timeout', String(ms)])
    if (req.settings.insecure) opts.push(['rejectUnauthorized', 'false'])
    lines.push(`const options = ${jsObject(opts, ind)};`, '')
    lines.push(`const req = ${scheme}.request(${jsString(req.url)}, options, (res) => {`)
    lines.push(`${ind}const chunks = [];`)
    lines.push(`${ind}res.on('data', (chunk) => chunks.push(chunk));`)
    lines.push(`${ind}res.on('end', () => console.log(Buffer.concat(chunks).toString()));`)
    lines.push('});', '')
    lines.push("req.on('error', (error) => console.error(error));")
    if (ms > 0) lines.push("req.on('timeout', () => req.destroy(new Error('timeout')));")
    if (b?.mode === 'form-data') lines.push('form.pipe(req);')
    else if (b?.mode === 'binary') lines.push(`fs.createReadStream(${jsString(b.path)}).pipe(req);`)
    else {
      if (b?.mode === 'raw') lines.push(`req.write(${jsString(rawContent(req, o) ?? '')});`)
      if (b?.mode === 'urlencoded') lines.push(`req.write(${jsString(b.encoded)});`)
      lines.push('req.end();')
    }
    return lines.join('\n')
  },
}
