/**
 * Go — net/http (id `go`). `io.ReadAll` (the deprecated `ioutil` is gone),
 * gofmt tabs by default, form-data through `mime/multipart`, a binary body
 * from `os.Open`, Basic auth `SetBasicAuth`.
 */
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { basicAuth } from '../helpers'
import { goString as q } from '../quote'
import type { CodegenVariant } from '../types'

export const goNetHttp: CodegenVariant = {
  id: 'go',
  language: 'go',
  label: 'net/http',
  monaco: 'go',
  options: coreOptions(4, 'tab'),
  generate(req, o) {
    const t = indentUnit(o, 4)
    const imports = new Set(['fmt', 'io', 'net/http'])
    const body: string[] = []
    const b = req.body
    let payload = 'nil'
    if (b?.mode === 'raw' || b?.mode === 'urlencoded') {
      imports.add('strings')
      const text = b.mode === 'urlencoded' ? b.encoded : (rawContent(req, o) ?? '')
      body.push(`${t}payload := strings.NewReader(${q(text)})`)
      payload = 'payload'
    } else if (b?.mode === 'binary') {
      imports.add('os')
      body.push(`${t}payload, _ := os.Open(${q(b.path)})`, `${t}defer payload.Close()`)
      payload = 'payload'
    } else if (b?.mode === 'form-data') {
      imports.add('bytes').add('mime/multipart')
      body.push(`${t}payload := &bytes.Buffer{}`, `${t}writer := multipart.NewWriter(payload)`)
      let n = 0
      for (const p of b.parts) {
        if (p.kind === 'text') {
          body.push(`${t}_ = writer.WriteField(${q(p.key)}, ${q(p.value)})`)
          continue
        }
        imports.add('os')
        n += 1
        body.push(`${t}file${n}, _ := os.Open(${q(p.path)})`, `${t}defer file${n}.Close()`)
        body.push(`${t}part${n}, _ := writer.CreateFormFile(${q(p.key)}, ${q(p.fileName)})`)
        body.push(`${t}_, _ = io.Copy(part${n}, file${n})`)
      }
      body.push(`${t}_ = writer.Close()`)
      payload = 'payload'
    }
    body.push(`${t}req, _ := http.NewRequest(${q(req.method)}, ${q(req.url)}, ${payload})`)
    for (const h of req.headers) body.push(`${t}req.Header.Add(${q(h.key)}, ${q(h.value)})`)
    if (b?.mode === 'form-data')
      body.push(`${t}req.Header.Set("Content-Type", writer.FormDataContentType())`)
    const auth = basicAuth(req)
    if (auth) body.push(`${t}req.SetBasicAuth(${q(auth.username)}, ${q(auth.password)})`)
    body.push('')
    const follow = shouldFollow(req, o)
    const ms = timeoutMs(req, o)
    let client = 'http.DefaultClient'
    if (!follow || ms > 0) {
      body.push(`${t}client := &http.Client{`)
      if (ms > 0) {
        imports.add('time')
        body.push(`${t}${t}Timeout: ${ms} * time.Millisecond,`)
      }
      if (!follow) {
        body.push(`${t}${t}CheckRedirect: func(req *http.Request, via []*http.Request) error {`)
        body.push(`${t}${t}${t}return http.ErrUseLastResponse`, `${t}${t}},`)
      }
      body.push(`${t}}`)
      client = 'client'
    }
    body.push(`${t}res, _ := ${client}.Do(req)`)
    body.push(`${t}defer res.Body.Close()`)
    body.push(`${t}body, _ := io.ReadAll(res.Body)`)
    body.push(`${t}fmt.Println(string(body))`)
    const imp = [...imports].sort().map((i) => `${t}"${i}"`)
    return ['package main', '', 'import (', ...imp, ')', '', 'func main() {', ...body, '}'].join(
      '\n',
    )
  },
}
