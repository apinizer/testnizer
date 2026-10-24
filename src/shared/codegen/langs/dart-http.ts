/** Dart — http (`package:http`; `MultipartRequest` for form-data). */
import { headersWithBasic } from '../helpers'
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { dartString as q } from '../quote'
import type { CodegenVariant } from '../types'

export const dartHttp: CodegenVariant = {
  id: 'dart-http',
  language: 'dart',
  label: 'http',
  monaco: 'dart',
  options: coreOptions(2),
  generate(req, o) {
    const ind = indentUnit(o)
    const imports = new Set(["import 'package:http/http.dart' as http;"])
    const body: string[] = []
    const { headers, runtime } = headersWithBasic(req)
    const entries = headers.map((h) => `${ind}${ind}${q(h.key)}: ${q(h.value)},`)
    if (runtime) {
      imports.add("import 'dart:convert';")
      entries.push(
        `${ind}${ind}'Authorization': 'Basic ' + base64Encode(utf8.encode(${q(runtime.userPass)})),`,
      )
    }
    body.push(
      entries.length
        ? `${ind}var headers = {\n${entries.join('\n')}\n${ind}};`
        : `${ind}var headers = <String, String>{};`,
    )
    const b = req.body
    const url = `Uri.parse(${q(req.url)})`
    if (b?.mode === 'form-data') {
      body.push(`${ind}var request = http.MultipartRequest(${q(req.method)}, ${url});`)
      const fields = b.parts.filter((p) => p.kind === 'text')
      if (fields.length) {
        const f = fields.map(
          (p) => `${ind}${ind}${q(p.key)}: ${q(p.kind === 'text' ? p.value : '')},`,
        )
        body.push(`${ind}request.fields.addAll({\n${f.join('\n')}\n${ind}});`)
      }
      for (const p of b.parts) {
        if (p.kind === 'file') {
          body.push(
            `${ind}request.files.add(await http.MultipartFile.fromPath(${q(p.key)}, ${q(p.path)}));`,
          )
        }
      }
    } else {
      body.push(`${ind}var request = http.Request(${q(req.method)}, ${url});`)
      if (b?.mode === 'raw') body.push(`${ind}request.body = ${q(rawContent(req, o) ?? '')};`)
      else if (b?.mode === 'urlencoded') body.push(`${ind}request.body = ${q(b.encoded)};`)
      else if (b?.mode === 'binary') {
        imports.add("import 'dart:io';")
        body.push(`${ind}request.bodyBytes = File(${q(b.path)}).readAsBytesSync();`)
      }
    }
    body.push(`${ind}request.headers.addAll(headers);`)
    if (!shouldFollow(req, o) && b?.mode !== 'form-data')
      body.push(`${ind}request.followRedirects = false;`)
    const ms = timeoutMs(req, o)
    const send = ms > 0 ? `request.send().timeout(Duration(milliseconds: ${ms}))` : 'request.send()'
    body.push('', `${ind}http.StreamedResponse response = await ${send};`, '')
    body.push(`${ind}print(response.statusCode);`)
    body.push(`${ind}print(await response.stream.bytesToString());`)
    return [...[...imports].sort(), '', 'void main() async {', ...body, '}'].join('\n')
  },
}
