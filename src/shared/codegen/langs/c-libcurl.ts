/** C — libcurl (`curl_easy_*`, `curl_mime_*` for form-data). */
import {
  BOILERPLATE,
  coreOptions,
  indentUnit,
  rawContent,
  shouldFollow,
  timeoutMs,
} from '../options'
import { cLangString as q } from '../quote'
import type { CodegenVariant } from '../types'
import { indentBlock } from './jvm-common'

const AUTH = { basic: 'CURLAUTH_BASIC', digest: 'CURLAUTH_DIGEST', ntlm: 'CURLAUTH_NTLM' }

export const cLibcurl: CodegenVariant = {
  id: 'c-libcurl',
  language: 'c',
  label: 'libcurl',
  monaco: 'c',
  options: [...coreOptions(2), BOILERPLATE],
  generate(req, o) {
    const ind = indentUnit(o)
    const s: string[] = []
    const set = (opt: string, v: string): void => {
      s.push(`curl_easy_setopt(curl, ${opt}, ${v});`)
    }
    set('CURLOPT_CUSTOMREQUEST', q(req.method))
    if (req.method === 'HEAD') set('CURLOPT_NOBODY', '1L')
    set('CURLOPT_URL', q(req.url))
    if (shouldFollow(req, o)) set('CURLOPT_FOLLOWLOCATION', '1L')
    const ms = timeoutMs(req, o)
    if (ms > 0) set('CURLOPT_TIMEOUT_MS', `${ms}L`)
    if (req.settings.insecure) {
      set('CURLOPT_SSL_VERIFYPEER', '0L')
      set('CURLOPT_SSL_VERIFYHOST', '0L')
    }
    const hasHeaders = req.headers.length > 0
    if (hasHeaders) {
      s.push('struct curl_slist *headers = NULL;')
      for (const h of req.headers)
        s.push(`headers = curl_slist_append(headers, ${q(`${h.key}: ${h.value}`)});`)
      set('CURLOPT_HTTPHEADER', 'headers')
    }
    if (req.auth) {
      set('CURLOPT_HTTPAUTH', AUTH[req.auth.scheme])
      set('CURLOPT_USERPWD', q(`${req.auth.username}:${req.auth.password}`))
    }
    const b = req.body
    let cleanup: string[] = []
    if (b?.mode === 'raw' || b?.mode === 'urlencoded') {
      const text = b.mode === 'urlencoded' ? b.encoded : (rawContent(req, o) ?? '')
      s.push(`const char *data = ${q(text)};`)
      set('CURLOPT_POSTFIELDS', 'data')
    } else if (b?.mode === 'binary') {
      s.push(`FILE *fd = fopen(${q(b.path)}, "rb");`)
      set('CURLOPT_UPLOAD', '1L')
      set('CURLOPT_READDATA', 'fd')
      cleanup = ['fclose(fd);']
    } else if (b?.mode === 'form-data') {
      s.push('curl_mime *mime = curl_mime_init(curl);', 'curl_mimepart *part;')
      for (const p of b.parts) {
        s.push('part = curl_mime_addpart(mime);', `curl_mime_name(part, ${q(p.key)});`)
        s.push(
          p.kind === 'file'
            ? `curl_mime_filedata(part, ${q(p.path)});`
            : `curl_mime_data(part, ${q(p.value)}, CURL_ZERO_TERMINATED);`,
        )
      }
      set('CURLOPT_MIMEPOST', 'mime')
      cleanup = ['curl_mime_free(mime);']
    }
    s.push('res = curl_easy_perform(curl);', ...cleanup)
    if (hasHeaders) s.push('curl_slist_free_all(headers);')
    const code = [
      'CURL *curl;',
      'CURLcode res;',
      'curl = curl_easy_init();',
      'if (curl) {',
      indentBlock(s.join('\n'), ind),
      '}',
      'curl_easy_cleanup(curl);',
    ].join('\n')
    if (o.includeBoilerplate !== true) return code
    return [
      '#include <stdio.h>',
      '#include <curl/curl.h>',
      '',
      'int main(void)',
      '{',
      indentBlock(code, ind),
      `${ind}return 0;`,
      '}',
    ].join('\n')
  },
}
