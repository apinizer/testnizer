/**
 * Python — Requests (id `python-requests`). A lossless JSON body goes through
 * `json=` as a real Python literal (`True` / `False` / `None` — it used to be
 * the JSON text pasted as code, a NameError); form-data through `files=`;
 * Basic / Digest through `auth=`; the response is printed as text.
 */
import { indentUnit, rawContent, shouldFollow, timeoutMs, coreOptions } from '../options'
import { isLosslessJson, jsonToPython, reindent } from '../json-literal'
import { pyString } from '../quote'
import type { CodegenVariant } from '../types'

const SHORTCUTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export const pythonRequests: CodegenVariant = {
  id: 'python-requests',
  language: 'python',
  label: 'Requests',
  monaco: 'python',
  options: coreOptions(4),
  generate(req, o) {
    const ind = indentUnit(o, 4)
    const imports = ['import requests']
    const lines: string[] = []
    const args: string[] = [pyString(req.url)]
    if (req.headers.length > 0) {
      const rec: Record<string, string> = {}
      for (const h of req.headers) rec[h.key] = h.value
      lines.push(`headers = ${JSON.stringify(rec, null, ind)}`, '')
      args.push('headers=headers')
    }
    const b = req.body
    if (b?.mode === 'raw') {
      const text = rawContent(req, o) ?? ''
      if (b.format === 'json' && isLosslessJson(text)) {
        lines.push(`payload = ${reindent(jsonToPython(text.trim()), '')}`, '')
        args.push('json=payload')
      } else {
        lines.push(`data = ${pyString(text)}`, '')
        args.push('data=data')
      }
    } else if (b?.mode === 'urlencoded') {
      lines.push(`data = ${pyString(b.encoded)}`, '')
      args.push('data=data')
    } else if (b?.mode === 'binary') {
      lines.push(`data = open(${pyString(b.path)}, 'rb')`, '')
      args.push('data=data')
    } else if (b?.mode === 'form-data') {
      const text = b.parts.filter((p) => p.kind === 'text')
      const files = b.parts.filter((p) => p.kind === 'file')
      if (text.length) {
        lines.push('data = [')
        for (const p of text) lines.push(`${ind}(${pyString(p.key)}, ${pyString(p.value)}),`)
        lines.push(']')
        args.push('data=data')
      }
      if (files.length) {
        lines.push('files = [')
        for (const p of files) {
          lines.push(
            `${ind}(${pyString(p.key)}, (${pyString(p.fileName)}, open(${pyString(p.path)}, 'rb'))),`,
          )
        }
        lines.push(']')
        args.push('files=files')
      }
      lines.push('')
    }
    if (req.auth?.scheme === 'basic') {
      args.push(`auth=(${pyString(req.auth.username)}, ${pyString(req.auth.password)})`)
    } else if (req.auth?.scheme === 'digest') {
      imports.push('from requests.auth import HTTPDigestAuth')
      args.push(
        `auth=HTTPDigestAuth(${pyString(req.auth.username)}, ${pyString(req.auth.password)})`,
      )
    }
    const ms = timeoutMs(req, o)
    if (ms > 0) args.push(`timeout=${ms / 1000}`)
    if (!shouldFollow(req, o)) args.push('allow_redirects=False')
    if (req.settings.insecure) args.push('verify=False')
    const call = SHORTCUTS.has(req.method)
      ? `requests.${req.method.toLowerCase()}(${args.join(', ')})`
      : `requests.request(${pyString(req.method)}, ${args.join(', ')})`
    return [
      ...imports,
      '',
      ...lines,
      `response = ${call}`,
      '',
      'print(response.status_code)',
      'print(response.text)',
    ].join('\n')
  },
}
