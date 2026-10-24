/**
 * NodeJS — Axios (id `js-axios`, kept from before issue #280; the snippet
 * `require`s axios, so it is a Node snippet). The pre-#280 layout is kept;
 * form-data / binary bodies, Basic auth (`auth:`), redirects and timeout are new.
 */
import {
  ASYNC_AWAIT,
  coreOptions,
  indentUnit,
  rawContent,
  shouldFollow,
  timeoutMs,
} from '../options'
import { basicAuth } from '../helpers'
import { jsString } from '../quote'
import type { CodegenVariant } from '../types'
import { legacyHeaderObject, nodeFormLines, nodeRequires } from './node-common'

export const nodeAxios: CodegenVariant = {
  id: 'js-axios',
  language: 'nodejs',
  label: 'Axios',
  monaco: 'javascript',
  options: [...coreOptions(2), ASYNC_AWAIT],
  generate(req, o) {
    const ind = indentUnit(o)
    const lines: string[] = ["const axios = require('axios');", ...nodeRequires(req), '']
    const form = nodeFormLines(req, 'data')
    if (form.length) lines.push(...form, '')
    const cfg: string[] = [
      `${ind}method: ${jsString(req.method.toLowerCase())}`,
      `${ind}url: ${jsString(req.url)}`,
    ]
    if (req.headers.length > 0) cfg.push(`${ind}headers: ${legacyHeaderObject(req.headers, ind)}`)
    const b = basicAuth(req)
    if (b) {
      cfg.push(
        `${ind}auth: { username: ${jsString(b.username)}, password: ${jsString(b.password)} }`,
      )
    }
    const body = req.body
    if (body?.mode === 'raw') cfg.push(`${ind}data: ${JSON.stringify(rawContent(req, o) ?? '')}`)
    else if (body?.mode === 'urlencoded') cfg.push(`${ind}data: ${JSON.stringify(body.encoded)}`)
    else if (body?.mode === 'binary')
      cfg.push(`${ind}data: fs.createReadStream(${jsString(body.path)})`)
    else if (body?.mode === 'form-data') cfg.push(`${ind}data: data`)
    if (!shouldFollow(req, o)) cfg.push(`${ind}maxRedirects: 0`)
    const ms = timeoutMs(req, o)
    if (ms > 0) cfg.push(`${ind}timeout: ${ms}`)
    const call = `axios({\n${cfg.join(',\n')}\n})`
    if (o.asyncAwait !== false) {
      lines.push(`const response = await ${call};`, '', 'console.log(response.data);')
    } else {
      lines.push(call)
      lines.push(`${ind}.then((response) => console.log(response.data))`)
      lines.push(`${ind}.catch((error) => console.error(error));`)
    }
    return lines.join('\n')
  },
}
