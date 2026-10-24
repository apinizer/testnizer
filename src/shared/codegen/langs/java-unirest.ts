/** Java — Unirest (kong.unirest, 3.x+). */
import { basicAuth } from '../helpers'
import {
  BOILERPLATE,
  coreOptions,
  indentUnit,
  rawContent,
  shouldFollow,
  timeoutMs,
} from '../options'
import { javaString as q } from '../quote'
import type { CodegenVariant } from '../types'
import { javaMain } from './jvm-common'

const SHORTCUTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export const javaUnirest: CodegenVariant = {
  id: 'java-unirest',
  language: 'java',
  label: 'Unirest',
  monaco: 'java',
  options: [...coreOptions(2), BOILERPLATE],
  generate(req, o) {
    const ind = indentUnit(o)
    const lines: string[] = []
    const cfg: string[] = []
    if (!shouldFollow(req, o)) cfg.push('.followRedirects(false)')
    const ms = timeoutMs(req, o)
    if (ms > 0) cfg.push(`.socketTimeout(${ms})`)
    if (req.settings.insecure) cfg.push('.verifySsl(false)')
    if (cfg.length) lines.push(`Unirest.config()${cfg.join('')};`)
    const start = SHORTCUTS.has(req.method)
      ? `Unirest.${req.method.toLowerCase()}(${q(req.url)})`
      : `Unirest.request(${q(req.method)}, ${q(req.url)})`
    lines.push(`HttpResponse<String> response = ${start}`)
    for (const h of req.headers) lines.push(`${ind}.header(${q(h.key)}, ${q(h.value)})`)
    const auth = basicAuth(req)
    if (auth) lines.push(`${ind}.basicAuth(${q(auth.username)}, ${q(auth.password)})`)
    const b = req.body
    if (b?.mode === 'raw') lines.push(`${ind}.body(${q(rawContent(req, o) ?? '')})`)
    else if (b?.mode === 'urlencoded') lines.push(`${ind}.body(${q(b.encoded)})`)
    else if (b?.mode === 'binary')
      lines.push(`${ind}.body(Files.readAllBytes(Paths.get(${q(b.path)})))`)
    else if (b?.mode === 'form-data') {
      for (const p of b.parts) {
        lines.push(
          p.kind === 'file'
            ? `${ind}.field(${q(p.key)}, new File(${q(p.path)}))`
            : `${ind}.field(${q(p.key)}, ${q(p.value)})`,
        )
      }
    }
    lines.push(`${ind}.asString();`, '', 'System.out.println(response.getBody());')
    const code = lines.join('\n')
    if (o.includeBoilerplate !== true) return code
    return javaMain(
      ['java.io.File', 'java.nio.file.Files', 'java.nio.file.Paths', 'kong.unirest.*'],
      code,
      ind,
    )
  },
}
