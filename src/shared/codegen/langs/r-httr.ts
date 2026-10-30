/** R — httr (`VERB`, `upload_file`, `authenticate`). */
import { basicAuth } from '../helpers'
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { rString as q } from '../quote'
import type { CodegenVariant } from '../types'

export const rHttr: CodegenVariant = {
  id: 'r-httr',
  language: 'r',
  label: 'httr',
  monaco: 'r',
  options: coreOptions(2),
  generate(req, o) {
    const ind = indentUnit(o)
    const lines: string[] = ['library(httr)', '']
    const args: string[] = [q(req.method), `url = ${q(req.url)}`]
    if (req.headers.length > 0) {
      const hs = req.headers.map((h) => `${ind}${q(h.key)} = ${q(h.value)}`)
      lines.push(`headers <- c(\n${hs.join(',\n')}\n)`, '')
      args.push('add_headers(.headers = headers)')
    }
    const b = req.body
    if (b?.mode === 'raw') lines.push(`body <- ${q(rawContent(req, o) ?? '')}`, '')
    else if (b?.mode === 'urlencoded') lines.push(`body <- ${q(b.encoded)}`, '')
    else if (b?.mode === 'binary') lines.push(`body <- upload_file(${q(b.path)})`, '')
    else if (b?.mode === 'form-data') {
      const parts = b.parts.map((p) =>
        p.kind === 'file'
          ? `${ind}${q(p.key)} = upload_file(${q(p.path)})`
          : `${ind}${q(p.key)} = ${q(p.value)}`,
      )
      lines.push(`body <- list(\n${parts.join(',\n')}\n)`, '')
    }
    if (b) args.push('body = body')
    if (b?.mode === 'form-data') args.push("encode = 'multipart'")
    const auth = basicAuth(req)
    if (auth) args.push(`authenticate(${q(auth.username)}, ${q(auth.password)})`)
    if (!shouldFollow(req, o)) args.push('config(followlocation = 0L)')
    const ms = timeoutMs(req, o)
    if (ms > 0) args.push(`timeout(${ms / 1000})`)
    if (req.settings.insecure) args.push('config(ssl_verifypeer = 0L)')
    lines.push(`res <- VERB(${args.join(', ')})`, '', "cat(content(res, 'text'))")
    return lines.join('\n')
  },
}
