/**
 * Dart — dio (`package:dio`, 5.x). Basic folded in as a header (run-time
 * `base64Encode` when a `{{placeholder}}` is in it — dio has no basic-auth
 * API); form-data through `FormData` field / file entries (duplicate keys
 * kept); a binary body streamed with its Content-Length.
 */
import { headersWithBasic } from '../helpers'
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { dartString as q } from '../quote'
import type { CodegenVariant } from '../types'

export const dartDio: CodegenVariant = {
  id: 'dart-dio',
  language: 'dart',
  label: 'dio',
  monaco: 'dart',
  options: coreOptions(2),
  generate(req, o) {
    const ind = indentUnit(o)
    const i2 = ind + ind
    const imports = new Set(["import 'package:dio/dio.dart';"])
    const body: string[] = []
    const { headers, runtime } = headersWithBasic(req)
    const entries = headers.map((h) => `${i2}${q(h.key)}: ${q(h.value)},`)
    if (runtime) {
      imports.add("import 'dart:convert';")
      entries.push(
        `${i2}'Authorization': 'Basic ' + base64Encode(utf8.encode(${q(runtime.userPass)})),`,
      )
    }
    body.push(
      entries.length
        ? `${ind}var headers = {\n${entries.join('\n')}\n${ind}};`
        : `${ind}var headers = <String, String>{};`,
    )
    const b = req.body
    if (b?.mode === 'raw') body.push(`${ind}var data = ${q(rawContent(req, o) ?? '')};`)
    else if (b?.mode === 'urlencoded') body.push(`${ind}var data = ${q(b.encoded)};`)
    else if (b?.mode === 'binary') {
      imports.add("import 'dart:io';")
      body.push(`${ind}var file = File(${q(b.path)});`)
      body.push(`${ind}headers[Headers.contentLengthHeader] = (await file.length()).toString();`)
      body.push(`${ind}var data = file.openRead();`)
    } else if (b?.mode === 'form-data') {
      body.push(`${ind}var data = FormData();`)
      for (const p of b.parts) {
        body.push(
          p.kind === 'file'
            ? `${ind}data.files.add(MapEntry(${q(p.key)}, await MultipartFile.fromFile(${q(p.path)}, filename: ${q(p.fileName)})));`
            : `${ind}data.fields.add(MapEntry(${q(p.key)}, ${q(p.value)}));`,
        )
      }
    }
    const ms = timeoutMs(req, o)
    body.push(
      ms > 0
        ? `${ind}var dio = Dio(BaseOptions(\n${i2}connectTimeout: Duration(milliseconds: ${ms}),\n${i2}receiveTimeout: Duration(milliseconds: ${ms}),\n${ind}));`
        : `${ind}var dio = Dio();`,
    )
    if (req.settings.insecure) {
      imports.add("import 'dart:io';")
      imports.add("import 'package:dio/io.dart';")
      body.push(`${ind}dio.httpClientAdapter = IOHttpClientAdapter(`)
      body.push(
        `${i2}createHttpClient: () => HttpClient()..badCertificateCallback = (cert, host, port) => true,`,
      )
      body.push(`${ind});`)
    }
    const opts = [`method: ${q(req.method)}`, 'headers: headers']
    if (!shouldFollow(req, o)) {
      // dio throws on a 3xx unless validateStatus lets it through.
      opts.push(
        'followRedirects: false',
        'validateStatus: (status) => status != null && status < 400',
      )
    }
    const args = [
      q(req.url),
      `options: Options(\n${opts.map((x) => `${i2}${ind}${x},`).join('\n')}\n${i2})`,
    ]
    if (b) args.push('data: data')
    body.push(
      `${ind}var response = await dio.request(\n${args.map((x) => `${i2}${x},`).join('\n')}\n${ind});`,
      '',
      `${ind}print(response.statusCode);`,
      `${ind}print(response.data);`,
    )
    return [...[...imports].sort(), '', 'void main() async {', ...body, '}'].join('\n')
  },
}
