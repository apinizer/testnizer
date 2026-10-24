/**
 * Pieces the JavaScript / Node variants share (issue #280): object literals,
 * the body as a browser value (`FormData`, `URLSearchParams`, a lossless JSON
 * object through `JSON.stringify`, otherwise a string), and a Basic
 * credential as a header (`btoa` at run time when a placeholder is in it).
 */
import { headersWithBasic } from '../helpers'
import { isLosslessJson, reindent } from '../json-literal'
import { rawContent } from '../options'
import { jsString } from '../quote'
import type { CodegenOptions, CodegenRequest } from '../types'

/** `{ 'k': v, … }` over several lines; values are already JS expressions. */
export function jsObject(entries: Array<[string, string]>, ind: string, level = 0): string {
  if (entries.length === 0) return '{}'
  const pad = ind.repeat(level + 1)
  const close = ind.repeat(level)
  return `{\n${entries.map(([k, v]) => `${pad}${jsString(k)}: ${v}`).join(',\n')}\n${close}}`
}

/** Header entries for a browser client (Basic folded in as a header). */
export function browserHeaderEntries(req: CodegenRequest): Array<[string, string]> {
  const { headers, runtime } = headersWithBasic(req)
  const out: Array<[string, string]> = headers.map((h) => [h.key, jsString(h.value)])
  if (runtime) out.push(['Authorization', `'Basic ' + btoa(${jsString(runtime.userPass)})`])
  return out
}

/** JSON body as `JSON.stringify(<literal>)` when lossless, else a string literal. */
export function jsRawExpr(req: CodegenRequest, o: CodegenOptions, ind: string, level = 0): string {
  const text = rawContent(req, o) ?? ''
  if (req.body?.mode === 'raw' && req.body.format === 'json' && isLosslessJson(text)) {
    return `JSON.stringify(${reindent(text.trim(), ind.repeat(level))})`
  }
  return jsString(text)
}

/**
 * Browser body: setup lines + the expression to send. `undefined` = no body.
 * Form-data files come from an `<input type="file">` (the snippet names the
 * path the request used); a binary body likewise.
 */
export function browserBody(
  req: CodegenRequest,
  o: CodegenOptions,
  ind: string,
): { setup: string[]; expr: string } | undefined {
  const b = req.body
  if (!b) return undefined
  if (b.mode === 'raw') return { setup: [], expr: jsRawExpr(req, o, ind) }
  if (b.mode === 'urlencoded') {
    const setup = ['const urlencoded = new URLSearchParams();']
    for (const f of b.fields)
      setup.push(`urlencoded.append(${jsString(f.key)}, ${jsString(f.value)});`)
    return { setup, expr: 'urlencoded' }
  }
  if (b.mode === 'binary') {
    return {
      setup: [`const file = fileInput.files[0]; // ${b.path}`],
      expr: 'file',
    }
  }
  const setup = ['const formdata = new FormData();']
  for (const p of b.parts) {
    setup.push(
      p.kind === 'file'
        ? `formdata.append(${jsString(p.key)}, fileInput.files[0], ${jsString(p.fileName)}); // ${p.path}`
        : `formdata.append(${jsString(p.key)}, ${jsString(p.value)});`,
    )
  }
  return { setup, expr: 'formdata' }
}
