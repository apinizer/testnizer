/**
 * Swift — URLSession (id `swift`). Pre-#280 layout kept; form-data is built
 * as a multipart `Data`, a binary body read from the file, Basic auth a real
 * base64 header (computed at run time when a `{{placeholder}}` is in it).
 */
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
import { swiftString as q } from '../quote'
import type { CodegenVariant } from '../types'

const BOUNDARY = 'TestnizerFormBoundary7MA4YWxkTrZu0gW'

export const swiftUrlSession: CodegenVariant = {
  id: 'swift',
  language: 'swift',
  label: 'URLSession',
  monaco: 'swift',
  options: [indentCountOpt(4), indentTypeOpt(), TRIM_BODY, TIMEOUT],
  generate(req, o) {
    const ind = indentUnit(o, 4)
    const lines: string[] = ['import Foundation', '']
    lines.push(`let url = URL(string: ${q(req.url)})!`)
    lines.push('var request = URLRequest(url: url)')
    lines.push(`request.httpMethod = ${q(req.method)}`)
    const { headers, runtime } = headersWithBasic(req)
    for (const h of headers)
      lines.push(`request.setValue(${q(h.value)}, forHTTPHeaderField: ${q(h.key)})`)
    if (runtime) {
      lines.push(
        `request.setValue("Basic " + Data(${q(runtime.userPass)}.utf8).base64EncodedString(), forHTTPHeaderField: "Authorization")`,
      )
    }
    const ms = timeoutMs(req, o)
    if (ms > 0) lines.push(`request.timeoutInterval = ${ms / 1000}`)
    const b = req.body
    if (b?.mode === 'raw')
      lines.push(`request.httpBody = ${q(rawContent(req, o) ?? '')}.data(using: .utf8)`)
    else if (b?.mode === 'urlencoded')
      lines.push(`request.httpBody = ${q(b.encoded)}.data(using: .utf8)`)
    else if (b?.mode === 'binary') {
      lines.push(`request.httpBody = try! Data(contentsOf: URL(fileURLWithPath: ${q(b.path)}))`)
    } else if (b?.mode === 'form-data') {
      lines.push('', `let boundary = "${BOUNDARY}"`, 'var body = Data()')
      for (const p of b.parts) {
        lines.push('body.append(Data(("--" + boundary + "\\r\\n").utf8))')
        if (p.kind === 'text') {
          const head = `Content-Disposition: form-data; name="${p.key}"\r\n\r\n${p.value}\r\n`
          lines.push(`body.append(Data(${q(head)}.utf8))`)
        } else {
          const head = `Content-Disposition: form-data; name="${p.key}"; filename="${p.fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
          lines.push(`body.append(Data(${q(head)}.utf8))`)
          lines.push(`body.append(try! Data(contentsOf: URL(fileURLWithPath: ${q(p.path)})))`)
          lines.push('body.append(Data("\\r\\n".utf8))')
        }
      }
      lines.push('body.append(Data(("--" + boundary + "--\\r\\n").utf8))')
      lines.push(
        'request.setValue("multipart/form-data; boundary=" + boundary, forHTTPHeaderField: "Content-Type")',
      )
      lines.push('request.httpBody = body')
    }
    lines.push('')
    lines.push('let task = URLSession.shared.dataTask(with: request) { data, response, error in')
    lines.push(`${ind}guard let data = data else { return }`)
    lines.push(`${ind}print(String(data: data, encoding: .utf8) ?? "")`)
    lines.push('}', 'task.resume()')
    return lines.join('\n')
  },
}
