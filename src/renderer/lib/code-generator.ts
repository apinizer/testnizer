import type {
  HttpMethod,
  KeyValuePair,
  RequestBody,
  AuthConfig,
  CodeLanguage,
} from '../types'

export interface CodeGenRequest {
  method: HttpMethod
  url: string
  params: KeyValuePair[]
  headers: KeyValuePair[]
  body?: RequestBody
  auth?: AuthConfig
}

function buildFullUrl(url: string, params: KeyValuePair[]): string {
  const enabled = params.filter((p) => p.enabled && p.key)
  if (enabled.length === 0) return url
  const qs = enabled.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`
}

function activeHeaders(headers: KeyValuePair[], auth?: AuthConfig): Record<string, string> {
  const h: Record<string, string> = {}
  headers.filter((hd) => hd.enabled && hd.key).forEach((hd) => {
    h[hd.key] = hd.value
  })
  if (auth?.type === 'bearer' && auth.bearer?.token) {
    h['Authorization'] = `${auth.bearer.prefix || 'Bearer'} ${auth.bearer.token}`
  } else if (auth?.type === 'basic' && auth.basic) {
    h['Authorization'] = `Basic <base64(${auth.basic.username}:${auth.basic.password})>`
  } else if (auth?.type === 'api-key' && auth.apiKey?.in === 'header' && auth.apiKey.key) {
    h[auth.apiKey.key] = auth.apiKey.value
  }
  return h
}

function bodyString(body?: RequestBody): string | null {
  if (!body || body.type === 'none') return null
  if (body.type === 'json' || body.type === 'xml' || body.type === 'text' || body.type === 'html' || body.type === 'javascript') {
    return body.content || null
  }
  if (body.type === 'urlencoded' && body.urlEncoded) {
    return body.urlEncoded
      .filter((p) => p.enabled && p.key)
      .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&')
  }
  return null
}

function escapeShell(s: string): string {
  return s.replace(/'/g, "'\\''")
}

function escapeString(s: string, quote = "'"): string {
  if (quote === "'") return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function genCurl(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const lines: string[] = [`curl -X ${req.method} '${escapeShell(fullUrl)}'`]
  const hdrs = activeHeaders(req.headers, req.auth)
  Object.entries(hdrs).forEach(([k, v]) => {
    lines.push(`  -H '${escapeShell(k)}: ${escapeShell(v)}'`)
  })
  const bd = bodyString(req.body)
  if (bd) {
    lines.push(`  -d '${escapeShell(bd)}'`)
  }
  return lines.join(' \\\n')
}

function genJsFetch(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const hdrs = activeHeaders(req.headers, req.auth)
  const bd = bodyString(req.body)
  const opts: string[] = [`  method: '${req.method}'`]
  if (Object.keys(hdrs).length > 0) {
    opts.push(`  headers: ${JSON.stringify(hdrs, null, 4).replace(/\n/g, '\n  ')}`)
  }
  if (bd) {
    opts.push(`  body: ${JSON.stringify(bd)}`)
  }
  return `const response = await fetch('${escapeString(fullUrl)}', {
${opts.join(',\n')}
});

const data = await response.json();
console.log(data);`
}

function genJsAxios(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const hdrs = activeHeaders(req.headers, req.auth)
  const bd = bodyString(req.body)
  const cfg: string[] = [`  method: '${req.method.toLowerCase()}'`, `  url: '${escapeString(fullUrl)}'`]
  if (Object.keys(hdrs).length > 0) {
    cfg.push(`  headers: ${JSON.stringify(hdrs, null, 4).replace(/\n/g, '\n  ')}`)
  }
  if (bd) {
    cfg.push(`  data: ${JSON.stringify(bd)}`)
  }
  return `const axios = require('axios');

const response = await axios({
${cfg.join(',\n')}
});

console.log(response.data);`
}

function genPython(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const hdrs = activeHeaders(req.headers, req.auth)
  const bd = bodyString(req.body)
  const lines: string[] = ['import requests', '']
  if (Object.keys(hdrs).length > 0) {
    lines.push(`headers = ${JSON.stringify(hdrs, null, 4)}`)
    lines.push('')
  }
  const args: string[] = [`'${escapeString(fullUrl)}'`]
  if (Object.keys(hdrs).length > 0) args.push('headers=headers')
  if (bd) {
    if (req.body?.type === 'json') {
      lines.splice(1, 0, 'import json')
      lines.push(`payload = ${bd}`)
      lines.push('')
      args.push('json=payload')
    } else {
      lines.push(`data = '${escapeString(bd)}'`)
      lines.push('')
      args.push('data=data')
    }
  }
  lines.push(`response = requests.${req.method.toLowerCase()}(${args.join(', ')})`)
  lines.push('')
  lines.push('print(response.status_code)')
  lines.push('print(response.json())')
  return lines.join('\n')
}

function genJava(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const hdrs = activeHeaders(req.headers, req.auth)
  const bd = bodyString(req.body)
  const lines: string[] = [
    'OkHttpClient client = new OkHttpClient();',
    '',
  ]
  if (bd) {
    lines.push(`MediaType mediaType = MediaType.parse("${req.body?.type === 'json' ? 'application/json' : 'text/plain'}");`)
    lines.push(`RequestBody body = RequestBody.create(mediaType, ${JSON.stringify(bd)});`)
    lines.push('')
  }
  lines.push('Request request = new Request.Builder()')
  lines.push(`    .url("${escapeString(fullUrl, '"')}")`)
  lines.push(`    .method("${req.method}"${bd ? ', body' : ', null'})`)
  Object.entries(hdrs).forEach(([k, v]) => {
    lines.push(`    .addHeader("${escapeString(k, '"')}", "${escapeString(v, '"')}")`)
  })
  lines.push('    .build();')
  lines.push('')
  lines.push('Response response = client.newCall(request).execute();')
  lines.push('System.out.println(response.body().string());')
  return lines.join('\n')
}

function genGo(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const hdrs = activeHeaders(req.headers, req.auth)
  const bd = bodyString(req.body)
  const lines: string[] = ['package main', '', 'import (', '    "fmt"', '    "io/ioutil"', '    "net/http"']
  if (bd) lines.push('    "strings"')
  lines.push(')', '')
  lines.push('func main() {')
  if (bd) {
    lines.push(`    payload := strings.NewReader(${JSON.stringify(bd)})`)
    lines.push(`    req, _ := http.NewRequest("${req.method}", "${escapeString(fullUrl, '"')}", payload)`)
  } else {
    lines.push(`    req, _ := http.NewRequest("${req.method}", "${escapeString(fullUrl, '"')}", nil)`)
  }
  Object.entries(hdrs).forEach(([k, v]) => {
    lines.push(`    req.Header.Add("${escapeString(k, '"')}", "${escapeString(v, '"')}")`)
  })
  lines.push('')
  lines.push('    res, _ := http.DefaultClient.Do(req)')
  lines.push('    defer res.Body.Close()')
  lines.push('    body, _ := ioutil.ReadAll(res.Body)')
  lines.push('    fmt.Println(string(body))')
  lines.push('}')
  return lines.join('\n')
}

function genPhp(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const hdrs = activeHeaders(req.headers, req.auth)
  const bd = bodyString(req.body)
  const lines: string[] = ['<?php', '', '$curl = curl_init();', '', 'curl_setopt_array($curl, [']
  lines.push(`    CURLOPT_URL => "${escapeString(fullUrl, '"')}",`)
  lines.push('    CURLOPT_RETURNTRANSFER => true,')
  lines.push(`    CURLOPT_CUSTOMREQUEST => "${req.method}",`)
  if (bd) {
    lines.push(`    CURLOPT_POSTFIELDS => ${JSON.stringify(bd)},`)
  }
  if (Object.keys(hdrs).length > 0) {
    lines.push('    CURLOPT_HTTPHEADER => [')
    Object.entries(hdrs).forEach(([k, v]) => {
      lines.push(`        "${escapeString(k, '"')}: ${escapeString(v, '"')}",`)
    })
    lines.push('    ],')
  }
  lines.push(']);', '')
  lines.push('$response = curl_exec($curl);')
  lines.push('curl_close($curl);')
  lines.push('')
  lines.push('echo $response;')
  return lines.join('\n')
}

function genRuby(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const hdrs = activeHeaders(req.headers, req.auth)
  const bd = bodyString(req.body)
  const lines: string[] = [
    "require 'net/http'",
    "require 'uri'",
    "require 'json'",
    '',
    `uri = URI.parse('${escapeString(fullUrl)}')`,
    `request = Net::HTTP::${req.method.charAt(0) + req.method.slice(1).toLowerCase()}.new(uri)`,
  ]
  Object.entries(hdrs).forEach(([k, v]) => {
    lines.push(`request['${escapeString(k)}'] = '${escapeString(v)}'`)
  })
  if (bd) {
    lines.push(`request.body = ${JSON.stringify(bd)}`)
  }
  lines.push('')
  lines.push('response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") do |http|')
  lines.push('  http.request(request)')
  lines.push('end')
  lines.push('')
  lines.push('puts response.body')
  return lines.join('\n')
}

function genSwift(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const hdrs = activeHeaders(req.headers, req.auth)
  const bd = bodyString(req.body)
  const lines: string[] = [
    'import Foundation',
    '',
    `let url = URL(string: "${escapeString(fullUrl, '"')}")!`,
    'var request = URLRequest(url: url)',
    `request.httpMethod = "${req.method}"`,
  ]
  Object.entries(hdrs).forEach(([k, v]) => {
    lines.push(`request.setValue("${escapeString(v, '"')}", forHTTPHeaderField: "${escapeString(k, '"')}")`)
  })
  if (bd) {
    lines.push(`request.httpBody = ${JSON.stringify(bd)}.data(using: .utf8)`)
  }
  lines.push('')
  lines.push('let task = URLSession.shared.dataTask(with: request) { data, response, error in')
  lines.push('    guard let data = data else { return }')
  lines.push('    print(String(data: data, encoding: .utf8) ?? "")')
  lines.push('}')
  lines.push('task.resume()')
  return lines.join('\n')
}

function genKotlin(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const hdrs = activeHeaders(req.headers, req.auth)
  const bd = bodyString(req.body)
  const lines: string[] = [
    'val client = OkHttpClient()',
    '',
  ]
  if (bd) {
    lines.push(`val mediaType = "${req.body?.type === 'json' ? 'application/json' : 'text/plain'}".toMediaType()`)
    lines.push(`val body = ${JSON.stringify(bd)}.toRequestBody(mediaType)`)
    lines.push('')
  }
  lines.push('val request = Request.Builder()')
  lines.push(`    .url("${escapeString(fullUrl, '"')}")`)
  lines.push(`    .method("${req.method}"${bd ? ', body' : ', null'})`)
  Object.entries(hdrs).forEach(([k, v]) => {
    lines.push(`    .addHeader("${escapeString(k, '"')}", "${escapeString(v, '"')}")`)
  })
  lines.push('    .build()')
  lines.push('')
  lines.push('val response = client.newCall(request).execute()')
  lines.push('println(response.body?.string())')
  return lines.join('\n')
}

function genCsharp(req: CodeGenRequest): string {
  const fullUrl = buildFullUrl(req.url, req.params)
  const hdrs = activeHeaders(req.headers, req.auth)
  const bd = bodyString(req.body)
  const lines: string[] = [
    'using System.Net.Http;',
    '',
    'var client = new HttpClient();',
    '',
    `var request = new HttpRequestMessage(HttpMethod.${req.method.charAt(0) + req.method.slice(1).toLowerCase()}, "${escapeString(fullUrl, '"')}");`,
  ]
  Object.entries(hdrs).forEach(([k, v]) => {
    lines.push(`request.Headers.Add("${escapeString(k, '"')}", "${escapeString(v, '"')}");`)
  })
  if (bd) {
    lines.push(`request.Content = new StringContent(${JSON.stringify(bd)}, System.Text.Encoding.UTF8, "${req.body?.type === 'json' ? 'application/json' : 'text/plain'}");`)
  }
  lines.push('')
  lines.push('var response = await client.SendAsync(request);')
  lines.push('var body = await response.Content.ReadAsStringAsync();')
  lines.push('Console.WriteLine(body);')
  return lines.join('\n')
}

const GENERATORS: Record<CodeLanguage, (req: CodeGenRequest) => string> = {
  'curl': genCurl,
  'js-fetch': genJsFetch,
  'js-axios': genJsAxios,
  'python-requests': genPython,
  'java-okhttp': genJava,
  'go': genGo,
  'php': genPhp,
  'ruby': genRuby,
  'swift': genSwift,
  'kotlin': genKotlin,
  'csharp': genCsharp,
}

export function generateCode(language: CodeLanguage, req: CodeGenRequest): string {
  const gen = GENERATORS[language]
  if (!gen) return `// Code generation for ${language} is not supported yet.`
  return gen(req)
}

export const CODE_LANGUAGES: { id: CodeLanguage; label: string; monacoLang: string }[] = [
  { id: 'curl', label: 'cURL', monacoLang: 'shell' },
  { id: 'js-fetch', label: 'JavaScript (fetch)', monacoLang: 'javascript' },
  { id: 'js-axios', label: 'JavaScript (axios)', monacoLang: 'javascript' },
  { id: 'python-requests', label: 'Python', monacoLang: 'python' },
  { id: 'java-okhttp', label: 'Java', monacoLang: 'java' },
  { id: 'go', label: 'Go', monacoLang: 'go' },
  { id: 'php', label: 'PHP', monacoLang: 'php' },
  { id: 'ruby', label: 'Ruby', monacoLang: 'ruby' },
  { id: 'swift', label: 'Swift', monacoLang: 'swift' },
  { id: 'kotlin', label: 'Kotlin', monacoLang: 'kotlin' },
  { id: 'csharp', label: 'C#', monacoLang: 'csharp' },
]
