/**
 * PowerShell — Invoke-RestMethod. Strings are single-quoted (nothing
 * expands); a multi-line body is a verbatim here-string. Content-Type goes
 * through `-ContentType` (Windows PowerShell 5.1 refuses it in `-Headers`).
 */
import { headersWithBasic } from '../helpers'
import {
  followRedirectOpt,
  rawContent,
  shouldFollow,
  TIMEOUT,
  timeoutMs,
  TRIM_BODY,
} from '../options'
import { psString as q } from '../quote'
import type { CodegenVariant } from '../types'

/** `@'…'@` when the text spans lines (and cannot end the here-string early). */
function psText(s: string): string {
  if (/[\r\n]/.test(s) && !/\n'@/.test(s)) return `@'\n${s}\n'@`
  return q(s)
}

export const powershellRestMethod: CodegenVariant = {
  id: 'powershell-restmethod',
  language: 'powershell',
  label: 'Invoke-RestMethod',
  monaco: 'powershell',
  options: [TRIM_BODY, followRedirectOpt(), TIMEOUT],
  generate(req, o) {
    const lines: string[] = []
    const { headers, runtime } = headersWithBasic(req)
    const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value
    const other = headers.filter((h) => h.key.toLowerCase() !== 'content-type')
    const args: string[] = [q(req.url), `-Method ${q(req.method)}`]
    if (other.length > 0 || runtime) {
      lines.push('$headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"')
      for (const h of other) lines.push(`$headers.Add(${q(h.key)}, ${q(h.value)})`)
      if (runtime) {
        lines.push(
          `$headers.Add('Authorization', 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${q(runtime.userPass)})))`,
        )
      }
      lines.push('')
      args.push('-Headers $headers')
    }
    const b = req.body
    if (b?.mode === 'raw' || b?.mode === 'urlencoded') {
      const text = b.mode === 'urlencoded' ? b.encoded : (rawContent(req, o) ?? '')
      lines.push(`$body = ${psText(text)}`, '')
      args.push('-Body $body')
    } else if (b?.mode === 'binary') {
      args.push(`-InFile ${q(b.path)}`)
    } else if (b?.mode === 'form-data') {
      lines.push('# -Form needs PowerShell 7 or later', '$form = @{')
      for (const p of b.parts) {
        lines.push(
          `  ${q(p.key)} = ${p.kind === 'file' ? `Get-Item -Path ${q(p.path)}` : q(p.value)}`,
        )
      }
      lines.push('}', '')
      args.push('-Form $form')
    }
    if (ct && b && b.mode !== 'form-data') args.push(`-ContentType ${q(ct)}`)
    if (!shouldFollow(req, o)) args.push('-MaximumRedirection 0')
    const ms = timeoutMs(req, o)
    if (ms > 0) args.push(`-TimeoutSec ${Math.ceil(ms / 1000)}`)
    if (req.settings.insecure) args.push('-SkipCertificateCheck')
    lines.push(`$response = Invoke-RestMethod ${args.join(' ')}`)
    lines.push('$response | ConvertTo-Json')
    return lines.join('\n')
  },
}
