/**
 * C# — HttpClient (id `csharp`). Pre-#280 layout kept. Content-Type goes on
 * the CONTENT with the request's real media type (`request.Headers.Add(
 * "Content-Type", …)` throws "Misused header name" in .NET, and the type was
 * `application/json` or `text/plain` only); form-data is a
 * `MultipartFormDataContent`, a binary body a `StreamContent`.
 */
import { headersWithBasic, titleCase } from '../helpers'
import {
  BOILERPLATE,
  coreOptions,
  indentUnit,
  rawContent,
  shouldFollow,
  timeoutMs,
} from '../options'
import { csString as q } from '../quote'
import type { CodegenVariant } from '../types'
import { indentBlock } from './jvm-common'

const KNOWN = new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH', 'TRACE'])

export function csMethod(method: string): string {
  return KNOWN.has(method) ? `HttpMethod.${titleCase(method)}` : `new HttpMethod(${q(method)})`
}

export const csharpHttpClient: CodegenVariant = {
  id: 'csharp',
  language: 'csharp',
  label: 'HttpClient',
  monaco: 'csharp',
  options: [...coreOptions(4), BOILERPLATE],
  generate(req, o) {
    const ind = indentUnit(o, 4)
    const lines: string[] = []
    const follow = shouldFollow(req, o)
    const ms = timeoutMs(req, o)
    const insecure = req.settings.insecure === true
    if (follow && !insecure)
      lines.push(
        ms > 0
          ? `var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(${ms}) };`
          : 'var client = new HttpClient();',
        '',
      )
    else {
      const h: string[] = []
      if (!follow) h.push('AllowAutoRedirect = false')
      if (insecure)
        h.push(
          'ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator',
        )
      lines.push(`var handler = new HttpClientHandler { ${h.join(', ')} };`)
      lines.push(
        ms > 0
          ? `var client = new HttpClient(handler) { Timeout = TimeSpan.FromMilliseconds(${ms}) };`
          : 'var client = new HttpClient(handler);',
        '',
      )
    }
    lines.push(`var request = new HttpRequestMessage(${csMethod(req.method)}, ${q(req.url)});`)
    const { headers, runtime } = headersWithBasic(req)
    const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value
    for (const h of headers) {
      if (h.key.toLowerCase() !== 'content-type')
        lines.push(`request.Headers.Add(${q(h.key)}, ${q(h.value)});`)
    }
    if (runtime) {
      lines.push(
        `request.Headers.Add("Authorization", "Basic " + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(${q(runtime.userPass)})));`,
      )
    }
    const b = req.body
    const setType = (): void => {
      if (ct)
        lines.push(
          `request.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(${q(ct)});`,
        )
    }
    if (b?.mode === 'raw' || b?.mode === 'urlencoded') {
      const text = b.mode === 'urlencoded' ? b.encoded : (rawContent(req, o) ?? '')
      const simple = ct && !ct.includes(';')
      lines.push(
        `request.Content = new StringContent(${q(text)}, System.Text.Encoding.UTF8${simple ? `, ${q(ct)}` : ''});`,
      )
      if (!simple) setType()
    } else if (b?.mode === 'binary') {
      lines.push(`request.Content = new StreamContent(File.OpenRead(${q(b.path)}));`)
      setType()
    } else if (b?.mode === 'form-data') {
      lines.push('var content = new MultipartFormDataContent();')
      for (const p of b.parts) {
        lines.push(
          p.kind === 'file'
            ? `content.Add(new StreamContent(File.OpenRead(${q(p.path)})), ${q(p.key)}, ${q(p.fileName)});`
            : `content.Add(new StringContent(${q(p.value)}), ${q(p.key)});`,
        )
      }
      lines.push('request.Content = content;')
    }
    lines.push('')
    lines.push('var response = await client.SendAsync(request);')
    lines.push('var body = await response.Content.ReadAsStringAsync();')
    lines.push('Console.WriteLine(body);')
    if (o.includeBoilerplate !== true) return ['using System.Net.Http;', '', ...lines].join('\n')
    return [
      'using System;',
      'using System.IO;',
      'using System.Net.Http;',
      'using System.Threading.Tasks;',
      '',
      'public class Program',
      '{',
      `${ind}public static async Task Main()`,
      `${ind}{`,
      indentBlock(lines.join('\n'), ind + ind),
      `${ind}}`,
      '}',
    ].join('\n')
  },
}
