/**
 * PHP — cURL (id `php`). Single-quoted strings everywhere: a `$HOME` /
 * `${x}` in a URL, header or body used to be interpolated by PHP's double
 * quotes. Form-data is a `CURLFile` array, a binary body
 * `file_get_contents`, Basic / Digest / NTLM `CURLOPT_USERPWD`.
 */
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { phpString as q } from '../quote'
import type { CodegenVariant } from '../types'

const AUTH_CONST = { basic: 'CURLAUTH_BASIC', digest: 'CURLAUTH_DIGEST', ntlm: 'CURLAUTH_NTLM' }

export const phpCurl: CodegenVariant = {
  id: 'php',
  language: 'php',
  label: 'cURL',
  monaco: 'php',
  options: coreOptions(4),
  generate(req, o) {
    const ind = indentUnit(o, 4)
    const opts: string[] = [`CURLOPT_URL => ${q(req.url)}`, 'CURLOPT_RETURNTRANSFER => true']
    if (shouldFollow(req, o)) opts.push('CURLOPT_FOLLOWLOCATION => true')
    const ms = timeoutMs(req, o)
    if (ms > 0) opts.push(`CURLOPT_TIMEOUT_MS => ${ms}`)
    opts.push(`CURLOPT_CUSTOMREQUEST => ${q(req.method)}`)
    if (req.method === 'HEAD') opts.push('CURLOPT_NOBODY => true')
    const b = req.body
    if (b?.mode === 'raw') opts.push(`CURLOPT_POSTFIELDS => ${q(rawContent(req, o) ?? '')}`)
    else if (b?.mode === 'urlencoded') opts.push(`CURLOPT_POSTFIELDS => ${q(b.encoded)}`)
    else if (b?.mode === 'binary')
      opts.push(`CURLOPT_POSTFIELDS => file_get_contents(${q(b.path)})`)
    else if (b?.mode === 'form-data') {
      const fields = b.parts.map((p) =>
        p.kind === 'file'
          ? `${ind}${ind}${q(p.key)} => new CURLFile(${q(p.path)}, 'application/octet-stream', ${q(p.fileName)}),`
          : `${ind}${ind}${q(p.key)} => ${q(p.value)},`,
      )
      opts.push(`CURLOPT_POSTFIELDS => [\n${fields.join('\n')}\n${ind}]`)
    }
    if (req.auth) {
      opts.push(`CURLOPT_HTTPAUTH => ${AUTH_CONST[req.auth.scheme]}`)
      opts.push(`CURLOPT_USERPWD => ${q(`${req.auth.username}:${req.auth.password}`)}`)
    }
    if (req.settings.insecure)
      opts.push('CURLOPT_SSL_VERIFYPEER => false', 'CURLOPT_SSL_VERIFYHOST => 0')
    if (req.headers.length > 0) {
      const hs = req.headers.map((h) => `${ind}${ind}${q(`${h.key}: ${h.value}`)},`)
      opts.push(`CURLOPT_HTTPHEADER => [\n${hs.join('\n')}\n${ind}]`)
    }
    return [
      '<?php',
      '',
      '$curl = curl_init();',
      '',
      'curl_setopt_array($curl, [',
      ...opts.map((x) => `${ind}${x},`),
      ']);',
      '',
      '$response = curl_exec($curl);',
      'curl_close($curl);',
      '',
      'echo $response;',
    ].join('\n')
  },
}
