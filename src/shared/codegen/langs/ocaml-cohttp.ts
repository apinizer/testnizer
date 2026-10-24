/** OCaml — Cohttp (cohttp-lwt-unix; multipart built by hand, Cohttp has no form API). */
import { basicAuth } from '../helpers'
import { indentCountOpt, indentTypeOpt, indentUnit, rawContent, TRIM_BODY } from '../options'
import { ocamlString as q } from '../quote'
import type { CodegenVariant } from '../types'

const BOUNDARY = 'TestnizerFormBoundary7MA4YWxkTrZu0gW'
const READ = (path: string): string => `In_channel.with_open_bin ${q(path)} In_channel.input_all`

export const ocamlCohttp: CodegenVariant = {
  id: 'ocaml-cohttp',
  language: 'ocaml',
  label: 'Cohttp',
  monaco: 'fsharp',
  options: [indentCountOpt(2), indentTypeOpt(), TRIM_BODY],
  generate(req, o) {
    const ind = indentUnit(o)
    const out: string[] = ['open Lwt', 'open Cohttp', 'open Cohttp_lwt_unix', '']
    const b = req.body
    let data: string | undefined
    if (b?.mode === 'raw') data = q(rawContent(req, o) ?? '')
    else if (b?.mode === 'urlencoded') data = q(b.encoded)
    else if (b?.mode === 'binary') data = READ(b.path)
    else if (b?.mode === 'form-data') {
      const pieces: string[] = []
      for (const p of b.parts) {
        if (p.kind === 'text') {
          pieces.push(
            q(
              `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${p.key}"\r\n\r\n${p.value}\r\n`,
            ),
          )
        } else {
          pieces.push(
            q(
              `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${p.key}"; filename="${p.fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
            ),
            `(${READ(p.path)})`,
            q('\r\n'),
          )
        }
      }
      pieces.push(q(`--${BOUNDARY}--\r\n`))
      data = `String.concat "" [\n${pieces.map((x) => `${ind}${x};`).join('\n')}\n]`
    }
    if (data !== undefined) out.push(`let postData = ${data}`, '')
    out.push('let reqBody =', `${ind}let uri = Uri.of_string ${q(req.url)} in`)
    const adds: string[] = req.headers.map((h) => `Header.add h ${q(h.key)} ${q(h.value)}`)
    if (b?.mode === 'form-data') {
      adds.push(`Header.add h "Content-Type" "multipart/form-data; boundary=${BOUNDARY}"`)
    }
    const auth = basicAuth(req)
    if (auth)
      adds.push(`Header.add_authorization h (\`Basic (${q(auth.username)}, ${q(auth.password)}))`)
    out.push(`${ind}let headers = Header.init ()`)
    for (const a of adds) out.push(`${ind}${ind}|> fun h -> ${a}`)
    out.push(`${ind}in`)
    const bodyArg = data !== undefined ? ' ~body' : ''
    if (data !== undefined) out.push(`${ind}let body = Cohttp_lwt.Body.of_string postData in`)
    out.push(
      `${ind}Client.call ~headers${bodyArg} (Code.method_of_string ${q(req.method)}) uri >>= fun (_resp, body) ->`,
    )
    out.push(`${ind}body |> Cohttp_lwt.Body.to_string >|= fun body -> body`, '')
    out.push(
      'let () =',
      `${ind}let respBody = Lwt_main.run reqBody in`,
      `${ind}print_endline respBody`,
    )
    return out.join('\n')
  },
}
