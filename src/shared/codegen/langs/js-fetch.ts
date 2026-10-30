/** JavaScript — Fetch (browser `fetch`). */
import { ASYNC_AWAIT, coreOptions, indentUnit, shouldFollow, timeoutMs } from '../options'
import { jsString } from '../quote'
import type { CodegenVariant } from '../types'
import { browserBody, browserHeaderEntries, jsObject } from './js-common'

export const jsFetch: CodegenVariant = {
  id: 'js-fetch',
  language: 'javascript',
  label: 'Fetch',
  monaco: 'javascript',
  options: [...coreOptions(2), ASYNC_AWAIT],
  generate(req, o) {
    const ind = indentUnit(o)
    const lines: string[] = []
    const body = browserBody(req, o, ind)
    if (body?.setup.length) lines.push(...body.setup, '')
    const opts: string[] = [`${ind}method: ${jsString(req.method)}`]
    const headers = browserHeaderEntries(req)
    if (headers.length > 0) opts.push(`${ind}headers: ${jsObject(headers, ind, 1)}`)
    if (body) opts.push(`${ind}body: ${body.expr}`)
    if (!shouldFollow(req, o)) opts.push(`${ind}redirect: 'manual'`)
    const ms = timeoutMs(req, o)
    if (ms > 0) opts.push(`${ind}signal: AbortSignal.timeout(${ms})`)
    const call = `fetch(${jsString(req.url)}, {\n${opts.join(',\n')}\n})`
    if (o.asyncAwait !== false) {
      lines.push(`const response = await ${call};`, '')
      lines.push('const text = await response.text();', 'console.log(text);')
    } else {
      lines.push(`${call}`)
      lines.push(`${ind}.then((response) => response.text())`)
      lines.push(`${ind}.then((text) => console.log(text))`)
      lines.push(`${ind}.catch((error) => console.error(error));`)
    }
    return lines.join('\n')
  },
}
