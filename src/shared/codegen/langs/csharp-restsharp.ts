/** C# — RestSharp (v107+ API: `RestClientOptions`, `AddStringBody`, `AddFile`). */
import { basicAuth, contentType, titleCase } from '../helpers'
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

const METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'MERGE',
  'COPY',
  'SEARCH',
])

export const csharpRestsharp: CodegenVariant = {
  id: 'csharp-restsharp',
  language: 'csharp',
  label: 'RestSharp',
  monaco: 'csharp',
  options: [...coreOptions(4), BOILERPLATE],
  generate(req, o) {
    const ind = indentUnit(o, 4)
    const lines: string[] = []
    const opts: string[] = []
    const ms = timeoutMs(req, o)
    if (ms > 0) opts.push(`MaxTimeout = ${ms}`)
    if (!shouldFollow(req, o)) opts.push('FollowRedirects = false')
    if (req.settings.insecure)
      opts.push(
        'RemoteCertificateValidationCallback = (sender, certificate, chain, errors) => true',
      )
    const auth = basicAuth(req)
    if (auth)
      opts.push(
        `Authenticator = new HttpBasicAuthenticator(${q(auth.username)}, ${q(auth.password)})`,
      )
    if (opts.length) {
      lines.push(
        'var options = new RestClientOptions',
        '{',
        ...opts.map((x) => `${ind}${x},`),
        '};',
      )
      lines.push('var client = new RestClient(options);')
    } else lines.push('var client = new RestClient();')
    const method = METHODS.has(req.method) ? `Method.${titleCase(req.method)}` : 'Method.Get'
    if (!METHODS.has(req.method))
      lines.push(`// RestSharp has no ${req.method} method; Method.Get is used.`)
    lines.push(`var request = new RestRequest(${q(req.url)}, ${method});`)
    const b = req.body
    const bodyTyped = b?.mode === 'raw' || b?.mode === 'urlencoded' || b?.mode === 'binary'
    for (const h of req.headers) {
      if (bodyTyped && h.key.toLowerCase() === 'content-type') continue
      lines.push(`request.AddHeader(${q(h.key)}, ${q(h.value)});`)
    }
    if (b?.mode === 'raw' || b?.mode === 'urlencoded') {
      const text = b.mode === 'urlencoded' ? b.encoded : (rawContent(req, o) ?? '')
      lines.push(`request.AddStringBody(${q(text)}, ${q(contentType(req))});`)
    } else if (b?.mode === 'binary') {
      lines.push(
        `request.AddBody(File.ReadAllBytes(${q(b.path)}), ${q(contentType(req, 'application/octet-stream'))});`,
      )
    } else if (b?.mode === 'form-data') {
      lines.push('request.AlwaysMultipartFormData = true;')
      for (const p of b.parts) {
        lines.push(
          p.kind === 'file'
            ? `request.AddFile(${q(p.key)}, ${q(p.path)});`
            : `request.AddParameter(${q(p.key)}, ${q(p.value)});`,
        )
      }
    }
    lines.push('RestResponse response = await client.ExecuteAsync(request);')
    lines.push('Console.WriteLine(response.Content);')
    const usings = ['using RestSharp;', ...(auth ? ['using RestSharp.Authenticators;'] : [])]
    if (o.includeBoilerplate !== true) return [...usings, '', ...lines].join('\n')
    return [
      'using System;',
      'using System.IO;',
      'using System.Threading.Tasks;',
      ...usings,
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
