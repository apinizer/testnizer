/**
 * NodeJS — Unirest (the `unirest` npm package Postman offers): chained
 * `.headers` / `.send` / `.field` / `.attach`, Basic through `.auth` (the
 * library encodes it at run time, so a `{{placeholder}}` stays readable).
 */
import { basicAuth } from '../helpers'
import { coreOptions, indentUnit, shouldFollow, timeoutMs } from '../options'
import { jsString } from '../quote'
import type { CodegenVariant } from '../types'
import { jsObject, jsRawExpr } from './js-common'

export const nodeUnirest: CodegenVariant = {
  id: 'nodejs-unirest',
  language: 'nodejs',
  label: 'Unirest',
  monaco: 'javascript',
  options: coreOptions(2),
  generate(req, o) {
    const ind = indentUnit(o)
    const b = req.body
    const lines = ["const unirest = require('unirest');"]
    if (b?.mode === 'binary') lines.push("const fs = require('fs');")
    lines.push('')
    const chain: string[] = []
    if (req.headers.length > 0) {
      const entries: Array<[string, string]> = req.headers.map((h) => [h.key, jsString(h.value)])
      chain.push(`.headers(${jsObject(entries, ind, 1)})`)
    }
    const auth = basicAuth(req)
    if (auth) chain.push(`.auth(${jsString(auth.username)}, ${jsString(auth.password)}, true)`)
    if (b?.mode === 'raw') chain.push(`.send(${jsRawExpr(req, o, ind, 1)})`)
    else if (b?.mode === 'urlencoded') chain.push(`.send(${jsString(b.encoded)})`)
    else if (b?.mode === 'binary') chain.push(`.send(fs.readFileSync(${jsString(b.path)}))`)
    else if (b?.mode === 'form-data') {
      for (const p of b.parts) {
        chain.push(
          p.kind === 'file'
            ? `.attach(${jsString(p.key)}, ${jsString(p.path)})`
            : `.field(${jsString(p.key)}, ${jsString(p.value)})`,
        )
      }
    }
    if (!shouldFollow(req, o)) chain.push('.followRedirect(false)')
    const ms = timeoutMs(req, o)
    if (ms > 0) chain.push(`.timeout(${ms})`)
    if (req.settings.insecure) chain.push('.strictSSL(false)')
    chain.push('.end((res) => {')
    lines.push(`unirest(${jsString(req.method)}, ${jsString(req.url)})`)
    for (const c of chain) lines.push(`${ind}${c}`)
    lines.push(`${ind}${ind}if (res.error) throw new Error(res.error);`)
    lines.push(`${ind}${ind}console.log(res.raw_body);`, `${ind}});`)
    return lines.join('\n')
  },
}
