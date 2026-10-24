/**
 * Kotlin — OkHttp (id `kotlin`). Pre-#280 layout kept; strings escape `$`
 * (a `$HOME` in the body used to be a string template), the media type is the
 * request's Content-Type, form-data / binary / Basic auth are rendered.
 */
import {
  BOILERPLATE,
  coreOptions,
  indentUnit,
  rawContent,
  shouldFollow,
  timeoutMs,
} from '../options'
import { basicAuth, contentType } from '../helpers'
import { kotlinString as q } from '../quote'
import type { CodegenVariant } from '../types'
import { indentBlock } from './jvm-common'

export const kotlinOkhttp: CodegenVariant = {
  id: 'kotlin',
  language: 'kotlin',
  label: 'OkHttp',
  monaco: 'kotlin',
  options: [...coreOptions(4), BOILERPLATE],
  generate(req, o) {
    const ind = indentUnit(o, 4)
    const lines: string[] = []
    const follow = shouldFollow(req, o)
    const ms = timeoutMs(req, o)
    if (follow && ms === 0) lines.push('val client = OkHttpClient()', '')
    else {
      lines.push('val client = OkHttpClient.Builder()')
      if (!follow) lines.push(`${ind}.followRedirects(false)`)
      if (ms > 0) lines.push(`${ind}.callTimeout(${ms}, TimeUnit.MILLISECONDS)`)
      lines.push(`${ind}.build()`, '')
    }
    const b = req.body
    if (b?.mode === 'form-data') {
      lines.push('val body = MultipartBody.Builder().setType(MultipartBody.FORM)')
      for (const p of b.parts) {
        lines.push(
          p.kind === 'file'
            ? `${ind}.addFormDataPart(${q(p.key)}, ${q(p.fileName)},\n${ind}${ind}File(${q(p.path)}).asRequestBody("application/octet-stream".toMediaType()))`
            : `${ind}.addFormDataPart(${q(p.key)}, ${q(p.value)})`,
        )
      }
      lines.push(`${ind}.build()`, '')
    } else if (b) {
      lines.push(`val mediaType = ${q(contentType(req))}.toMediaType()`)
      if (b.mode === 'binary')
        lines.push(`val body = File(${q(b.path)}).asRequestBody(mediaType)`, '')
      else {
        const text = b.mode === 'urlencoded' ? b.encoded : (rawContent(req, o) ?? '')
        lines.push(`val body = ${q(text)}.toRequestBody(mediaType)`, '')
      }
    }
    lines.push('val request = Request.Builder()')
    lines.push(`${ind}.url(${q(req.url)})`)
    lines.push(`${ind}.method(${q(req.method)}${b ? ', body' : ', null'})`)
    for (const h of req.headers) lines.push(`${ind}.addHeader(${q(h.key)}, ${q(h.value)})`)
    const auth = basicAuth(req)
    if (auth) {
      lines.push(
        `${ind}.addHeader("Authorization", Credentials.basic(${q(auth.username)}, ${q(auth.password)}))`,
      )
    }
    lines.push(`${ind}.build()`, '')
    lines.push('val response = client.newCall(request).execute()')
    lines.push('println(response.body?.string())')
    const code = lines.join('\n')
    if (o.includeBoilerplate !== true) return code
    const imports = [
      'java.io.File',
      'java.util.concurrent.TimeUnit',
      'okhttp3.*',
      'okhttp3.MediaType.Companion.toMediaType',
      'okhttp3.RequestBody.Companion.asRequestBody',
      'okhttp3.RequestBody.Companion.toRequestBody',
    ]
    return [
      ...imports.map((i) => `import ${i}`),
      '',
      'fun main() {',
      indentBlock(code, ind),
      '}',
    ].join('\n')
  },
}
