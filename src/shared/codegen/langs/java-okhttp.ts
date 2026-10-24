/**
 * Java — OkHttp (id `java-okhttp`). Pre-#280 layout kept; the media type now
 * comes from the Content-Type the request sends (it was `application/json`
 * or `text/plain` only), form-data is a `MultipartBody`, a binary body a
 * `File`, Basic auth `Credentials.basic`.
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
import { javaString as q } from '../quote'
import type { CodegenVariant } from '../types'
import { javaMain } from './jvm-common'

export const javaOkhttp: CodegenVariant = {
  id: 'java-okhttp',
  language: 'java',
  label: 'OkHttp',
  monaco: 'java',
  options: [...coreOptions(4), BOILERPLATE],
  generate(req, o) {
    const ind = indentUnit(o, 4)
    const lines: string[] = []
    const follow = shouldFollow(req, o)
    const ms = timeoutMs(req, o)
    if (follow && ms === 0) lines.push('OkHttpClient client = new OkHttpClient();', '')
    else {
      lines.push('OkHttpClient client = new OkHttpClient().newBuilder()')
      if (!follow) lines.push(`${ind}.followRedirects(false)`)
      if (ms > 0) lines.push(`${ind}.callTimeout(${ms}, TimeUnit.MILLISECONDS)`)
      lines.push(`${ind}.build();`, '')
    }
    const b = req.body
    if (b?.mode === 'form-data') {
      lines.push('RequestBody body = new MultipartBody.Builder().setType(MultipartBody.FORM)')
      for (const p of b.parts) {
        lines.push(
          p.kind === 'file'
            ? `${ind}.addFormDataPart(${q(p.key)}, ${q(p.fileName)},\n${ind}${ind}RequestBody.create(MediaType.parse("application/octet-stream"), new File(${q(p.path)})))`
            : `${ind}.addFormDataPart(${q(p.key)}, ${q(p.value)})`,
        )
      }
      lines.push(`${ind}.build();`, '')
    } else if (b) {
      lines.push(`MediaType mediaType = MediaType.parse(${q(contentType(req))});`)
      const content =
        b.mode === 'binary'
          ? `new File(${q(b.path)})`
          : q(b.mode === 'urlencoded' ? b.encoded : (rawContent(req, o) ?? ''))
      lines.push(`RequestBody body = RequestBody.create(mediaType, ${content});`, '')
    }
    lines.push('Request request = new Request.Builder()')
    lines.push(`${ind}.url(${q(req.url)})`)
    lines.push(`${ind}.method(${q(req.method)}${b ? ', body' : ', null'})`)
    for (const h of req.headers) lines.push(`${ind}.addHeader(${q(h.key)}, ${q(h.value)})`)
    const auth = basicAuth(req)
    if (auth) {
      lines.push(
        `${ind}.addHeader("Authorization", Credentials.basic(${q(auth.username)}, ${q(auth.password)}))`,
      )
    }
    lines.push(`${ind}.build();`, '')
    lines.push('Response response = client.newCall(request).execute();')
    lines.push('System.out.println(response.body().string());')
    const code = lines.join('\n')
    if (o.includeBoilerplate !== true) return code
    return javaMain(['java.io.*', 'java.util.concurrent.TimeUnit', 'okhttp3.*'], code, ind)
  },
}
