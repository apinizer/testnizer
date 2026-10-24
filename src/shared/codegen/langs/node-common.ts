/**
 * Node.js body pieces (issue #280): form-data through the `form-data`
 * package with `fs.createReadStream` file parts, a binary body as a stream.
 */
import { jsString } from '../quote'
import type { CodegenRequest } from '../types'

/** `require` lines the body needs. */
export function nodeRequires(req: CodegenRequest): string[] {
  const out: string[] = []
  if (req.body?.mode === 'form-data') out.push("const FormData = require('form-data');")
  const needsFs =
    req.body?.mode === 'binary' ||
    (req.body?.mode === 'form-data' && req.body.parts.some((p) => p.kind === 'file'))
  if (needsFs) out.push("const fs = require('fs');")
  return out
}

/** Lines building `form` from the form-data parts. */
export function nodeFormLines(req: CodegenRequest, name = 'form'): string[] {
  if (req.body?.mode !== 'form-data') return []
  const lines = [`const ${name} = new FormData();`]
  for (const p of req.body.parts) {
    lines.push(
      p.kind === 'file'
        ? `${name}.append(${jsString(p.key)}, fs.createReadStream(${jsString(p.path)}));`
        : `${name}.append(${jsString(p.key)}, ${jsString(p.value)});`,
    )
  }
  return lines
}

/** The JSON-stringify header object the pre-#280 Node / fetch snippets printed. */
export function legacyHeaderObject(
  headers: Array<{ key: string; value: string }>,
  ind: string,
): string {
  const rec: Record<string, string> = {}
  for (const h of headers) rec[h.key] = h.value
  return JSON.stringify(rec, null, ind + ind).replace(/\n/g, `\n${ind}`)
}
