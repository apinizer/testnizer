/** Python — http.client (standard library; never follows redirects). */
import { headersWithBasic } from '../helpers'
import {
  indentCountOpt,
  indentTypeOpt,
  indentUnit,
  rawContent,
  TIMEOUT,
  timeoutMs,
  TRIM_BODY,
} from '../options'
import { pyString } from '../quote'
import type { CodegenVariant } from '../types'

export const pythonHttpClient: CodegenVariant = {
  id: 'python-http-client',
  language: 'python',
  label: 'http.client',
  monaco: 'python',
  options: [indentCountOpt(4), indentTypeOpt(), TRIM_BODY, TIMEOUT],
  generate(req, o) {
    const ind = indentUnit(o, 4)
    const imports = ['import http.client']
    const lines: string[] = []
    const m = /^(https?):\/\/([^/?#{}]+)(.*)$/i.exec(req.url)
    const https = m ? m[1].toLowerCase() === 'https' : !/^http:/i.test(req.url)
    const cls = https ? 'HTTPSConnection' : 'HTTPConnection'
    const connArgs: string[] = []
    let target: string
    if (m) {
      connArgs.push(pyString(m[2]))
      target = pyString(m[3].replace(/#.*$/, '') || '/')
    } else {
      imports.push('from urllib.parse import urlsplit')
      lines.push(`url = urlsplit(${pyString(req.url)})`)
      connArgs.push('url.netloc')
      target = "url.path + ('?' + url.query if url.query else '')"
    }
    const ms = timeoutMs(req, o)
    if (ms > 0) connArgs.push(`timeout=${ms / 1000}`)
    if (https && req.settings.insecure) {
      imports.push('import ssl')
      connArgs.push('context=ssl._create_unverified_context()')
    }
    lines.push(`conn = http.client.${cls}(${connArgs.join(', ')})`)
    const b = req.body
    let payload = "''"
    if (b?.mode === 'raw') payload = pyString(rawContent(req, o) ?? '')
    else if (b?.mode === 'urlencoded') payload = pyString(b.encoded)
    else if (b?.mode === 'binary') payload = `open(${pyString(b.path)}, 'rb').read()`
    else if (b?.mode === 'form-data') {
      lines.push("boundary = 'TestnizerFormBoundary7MA4YWxkTrZu0gW'", '')
      lines.push('def part(name, value, filename=None):')
      lines.push(
        `${ind}head = '--' + boundary + '\\r\\nContent-Disposition: form-data; name="' + name + '"'`,
      )
      lines.push(`${ind}if filename:`)
      lines.push(
        `${ind}${ind}head += '; filename="' + filename + '"\\r\\nContent-Type: application/octet-stream'`,
      )
      lines.push(`${ind}return head.encode() + b'\\r\\n\\r\\n' + value + b'\\r\\n'`, '')
      lines.push("payload = b''.join([")
      for (const p of b.parts) {
        lines.push(
          p.kind === 'file'
            ? `${ind}part(${pyString(p.key)}, open(${pyString(p.path)}, 'rb').read(), ${pyString(p.fileName)}),`
            : `${ind}part(${pyString(p.key)}, ${pyString(p.value)}.encode()),`,
        )
      }
      lines.push("]) + ('--' + boundary + '--\\r\\n').encode()")
      payload = 'payload'
    }
    if (b && b.mode !== 'form-data') lines.push(`payload = ${payload}`)
    const { headers, runtime } = headersWithBasic(req)
    const entries = headers.map((h) => `${ind}${pyString(h.key)}: ${pyString(h.value)},`)
    if (runtime) {
      imports.push('from base64 import b64encode')
      entries.push(
        `${ind}'Authorization': 'Basic ' + b64encode(${pyString(runtime.userPass)}.encode()).decode(),`,
      )
    }
    if (b?.mode === 'form-data') {
      entries.push(`${ind}'Content-Type': 'multipart/form-data; boundary=' + boundary,`)
    }
    lines.push(entries.length ? `headers = {\n${entries.join('\n')}\n}` : 'headers = {}')
    const body = b ? 'payload' : "''"
    lines.push(`conn.request(${pyString(req.method)}, ${target}, ${body}, headers)`)
    lines.push('res = conn.getresponse()', 'data = res.read()', "print(data.decode('utf-8'))")
    return [...imports, '', ...lines].join('\n')
  },
}
