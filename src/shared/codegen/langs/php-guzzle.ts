/** PHP — Guzzle (single-quoted strings; `multipart`, `auth`, `allow_redirects`). */
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { phpString as q } from '../quote'
import type { CodegenVariant } from '../types'

export const phpGuzzle: CodegenVariant = {
  id: 'php-guzzle',
  language: 'php',
  label: 'Guzzle',
  monaco: 'php',
  options: coreOptions(4),
  generate(req, o) {
    const ind = indentUnit(o, 4)
    const i2 = ind + ind
    const opts: string[] = []
    if (req.headers.length > 0) {
      const hs = req.headers.map((h) => `${i2}${q(h.key)} => ${q(h.value)},`)
      opts.push(`'headers' => [\n${hs.join('\n')}\n${ind}]`)
    }
    const b = req.body
    if (b?.mode === 'raw') opts.push(`'body' => ${q(rawContent(req, o) ?? '')}`)
    else if (b?.mode === 'urlencoded') opts.push(`'body' => ${q(b.encoded)}`)
    else if (b?.mode === 'binary') opts.push(`'body' => fopen(${q(b.path)}, 'r')`)
    else if (b?.mode === 'form-data') {
      const parts = b.parts.map((p) =>
        p.kind === 'file'
          ? `${i2}['name' => ${q(p.key)}, 'contents' => fopen(${q(p.path)}, 'r'), 'filename' => ${q(p.fileName)}],`
          : `${i2}['name' => ${q(p.key)}, 'contents' => ${q(p.value)}],`,
      )
      opts.push(`'multipart' => [\n${parts.join('\n')}\n${ind}]`)
    }
    if (req.auth) {
      const scheme = req.auth.scheme === 'basic' ? '' : `, ${q(req.auth.scheme)}`
      opts.push(`'auth' => [${q(req.auth.username)}, ${q(req.auth.password)}${scheme}]`)
    }
    if (!shouldFollow(req, o)) opts.push("'allow_redirects' => false")
    const ms = timeoutMs(req, o)
    if (ms > 0) opts.push(`'timeout' => ${ms / 1000}`)
    if (req.settings.insecure) opts.push("'verify' => false")
    const tail = opts.length ? `, [\n${opts.map((x) => `${ind}${x},`).join('\n')}\n]` : ''
    return [
      '<?php',
      "require 'vendor/autoload.php';",
      '',
      'use GuzzleHttp\\Client;',
      '',
      '$client = new Client();',
      `$response = $client->request(${q(req.method)}, ${q(req.url)}${tail});`,
      '',
      'echo $response->getBody();',
    ].join('\n')
  },
}
