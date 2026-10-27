/**
 * PHP — pecl_http (v2+: `http\Client`, `http\Client\Request`,
 * `http\Message\Body`). Single-quoted strings; Basic / Digest / NTLM through
 * the curl `httpauth` options (curl encodes it, so a `{{placeholder}}` stays
 * readable); form-data through `Body::addForm`.
 */
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { phpString as q } from '../quote'
import type { CodegenVariant } from '../types'

const AUTH_CONST = { basic: 'AUTH_BASIC', digest: 'AUTH_DIGEST', ntlm: 'AUTH_NTLM' }

function phpArray(entries: string[], ind: string, level = 0): string {
  if (entries.length === 0) return 'array()'
  const pad = ind.repeat(level + 1)
  return `array(\n${entries.map((e) => `${pad}${e}`).join(',\n')}\n${ind.repeat(level)})`
}

export const phpPeclHttp: CodegenVariant = {
  id: 'php-pecl-http',
  language: 'php',
  label: 'pecl_http',
  monaco: 'php',
  options: coreOptions(2),
  generate(req, o) {
    const ind = indentUnit(o)
    const lines = ['<?php', '$client = new http\\Client;', '$request = new http\\Client\\Request;']
    lines.push(`$request->setRequestUrl(${q(req.url)});`)
    lines.push(`$request->setRequestMethod(${q(req.method)});`)
    // Headers before the body: setHeaders replaces the list, and setBody adds
    // the multipart Content-Type (with its boundary) to it.
    if (req.headers.length > 0) {
      const hs = req.headers.map((h) => `${q(h.key)} => ${q(h.value)}`)
      lines.push(`$request->setHeaders(${phpArray(hs, ind)});`)
    }
    const b = req.body
    if (b?.mode === 'binary') {
      lines.push(`$body = new http\\Message\\Body(fopen(${q(b.path)}, 'r'));`)
    } else if (b) {
      lines.push('$body = new http\\Message\\Body;')
      if (b.mode === 'raw') lines.push(`$body->append(${q(rawContent(req, o) ?? '')});`)
      else if (b.mode === 'urlencoded') lines.push(`$body->append(${q(b.encoded)});`)
      else {
        const fields = b.parts.flatMap((p) =>
          p.kind === 'text' ? [`${q(p.key)} => ${q(p.value)}`] : [],
        )
        const files = b.parts.flatMap((p) =>
          p.kind === 'file'
            ? [
                `array('name' => ${q(p.key)}, 'type' => 'application/octet-stream', 'file' => ${q(p.path)}, 'data' => null)`,
              ]
            : [],
        )
        lines.push(`$body->addForm(${phpArray(fields, ind)}, ${phpArray(files, ind)});`)
      }
    }
    if (b) lines.push('$request->setBody($body);')
    const opts: string[] = []
    if (shouldFollow(req, o)) opts.push("'redirect' => 10")
    const ms = timeoutMs(req, o)
    if (ms > 0) opts.push(`'timeout' => ${ms / 1000}`)
    if (req.auth) {
      opts.push(`'httpauth' => ${q(`${req.auth.username}:${req.auth.password}`)}`)
      opts.push(`'httpauthtype' => \\http\\Client\\Curl\\${AUTH_CONST[req.auth.scheme]}`)
    }
    if (opts.length) lines.push(`$request->setOptions(${phpArray(opts, ind)});`)
    if (req.settings.insecure) {
      lines.push(`$request->setSslOptions(array('verifypeer' => false, 'verifyhost' => false));`)
    }
    lines.push(
      '',
      '$client->enqueue($request)->send();',
      '$response = $client->getResponse();',
      'echo $response->getBody();',
    )
    return lines.join('\n')
  },
}
