/**
 * PHP — HTTP_Request2 (PEAR). Single-quoted strings (no interpolation);
 * method constants only where the class defines one (there is no
 * `METHOD_PATCH`); Basic / Digest through `setAuth` — NTLM has no
 * HTTP_Request2 API, so the snippet says so instead of dropping it silently.
 */
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { phpString as q } from '../quote'
import type { CodegenVariant } from '../types'

const METHOD_CONST = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'CONNECT',
])

function phpArray(entries: string[], ind: string): string {
  return entries.length ? `array(\n${entries.map((e) => `${ind}${e}`).join(',\n')}\n)` : 'array()'
}

export const phpHttpRequest2: CodegenVariant = {
  id: 'php-http-request2',
  language: 'php',
  label: 'HTTP_Request2',
  monaco: 'php',
  options: coreOptions(2),
  generate(req, o) {
    const ind = indentUnit(o)
    const lines = [
      '<?php',
      "require_once 'HTTP/Request2.php';",
      '',
      '$request = new HTTP_Request2();',
    ]
    lines.push(`$request->setUrl(${q(req.url)});`)
    const m = METHOD_CONST.has(req.method) ? `HTTP_Request2::METHOD_${req.method}` : q(req.method)
    lines.push(`$request->setMethod(${m});`)
    const cfg = [`'follow_redirects' => ${shouldFollow(req, o) ? 'TRUE' : 'FALSE'}`]
    const ms = timeoutMs(req, o)
    if (ms > 0) cfg.push(`'timeout' => ${Math.max(1, Math.ceil(ms / 1000))}`)
    if (req.settings.insecure) cfg.push("'ssl_verify_peer' => FALSE", "'ssl_verify_host' => FALSE")
    lines.push(`$request->setConfig(${phpArray(cfg, ind)});`)
    if (req.headers.length > 0) {
      const hs = req.headers.map((h) => `${q(h.key)} => ${q(h.value)}`)
      lines.push(`$request->setHeader(${phpArray(hs, ind)});`)
    }
    if (req.auth?.scheme === 'ntlm') {
      lines.push('// NTLM authentication is not supported by HTTP_Request2.')
    } else if (req.auth) {
      const scheme = req.auth.scheme === 'digest' ? 'AUTH_DIGEST' : 'AUTH_BASIC'
      lines.push(
        `$request->setAuth(${q(req.auth.username)}, ${q(req.auth.password)}, HTTP_Request2::${scheme});`,
      )
    }
    const b = req.body
    if (b?.mode === 'raw') lines.push(`$request->setBody(${q(rawContent(req, o) ?? '')});`)
    else if (b?.mode === 'urlencoded') lines.push(`$request->setBody(${q(b.encoded)});`)
    else if (b?.mode === 'binary') lines.push(`$request->setBody(${q(b.path)}, true);`)
    else if (b?.mode === 'form-data') {
      // Without an upload HTTP_Request2 would send the fields urlencoded.
      lines.push("$request->setHeader('Content-Type', 'multipart/form-data');")
      for (const p of b.parts) {
        lines.push(
          p.kind === 'file'
            ? `$request->addUpload(${q(p.key)}, ${q(p.path)}, ${q(p.fileName)});`
            : `$request->addPostParameter(${q(p.key)}, ${q(p.value)});`,
        )
      }
    }
    lines.push(
      '',
      'try {',
      `${ind}$response = $request->send();`,
      `${ind}echo $response->getStatus() . ' ' . $response->getReasonPhrase() . PHP_EOL;`,
      `${ind}echo $response->getBody();`,
      '} catch (HTTP_Request2_Exception $e) {',
      `${ind}echo 'Error: ' . $e->getMessage();`,
      '}',
    )
    return lines.join('\n')
  },
}
