/** Rust — reqwest (async + tokio; `multipart` feature for form-data). */
import { basicAuth } from '../helpers'
import { coreOptions, indentUnit, rawContent, shouldFollow, timeoutMs } from '../options'
import { rustString as q } from '../quote'
import type { CodegenVariant } from '../types'

const STANDARD = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'TRACE',
  'CONNECT',
])

export const rustReqwest: CodegenVariant = {
  id: 'rust-reqwest',
  language: 'rust',
  label: 'reqwest',
  monaco: 'rust',
  options: coreOptions(4),
  generate(req, o) {
    const t = indentUnit(o, 4)
    const lines: string[] = []
    const builder: string[] = []
    if (!shouldFollow(req, o)) builder.push('.redirect(reqwest::redirect::Policy::none())')
    const ms = timeoutMs(req, o)
    if (ms > 0) builder.push(`.timeout(std::time::Duration::from_millis(${ms}))`)
    if (req.settings.insecure) builder.push('.danger_accept_invalid_certs(true)')
    lines.push(`${t}let client = reqwest::Client::builder()`)
    for (const x of builder) lines.push(`${t}${t}${x}`)
    lines.push(`${t}${t}.build()?;`, '')
    const b = req.body
    if (b?.mode === 'form-data') {
      lines.push(`${t}let form = reqwest::multipart::Form::new()`)
      for (const p of b.parts) {
        lines.push(
          p.kind === 'file'
            ? `${t}${t}.part(${q(p.key)}, reqwest::multipart::Part::bytes(std::fs::read(${q(p.path)})?).file_name(${q(p.fileName)}))`
            : `${t}${t}.text(${q(p.key)}, ${q(p.value)})`,
        )
      }
      lines[lines.length - 1] += ';'
      lines.push('')
    }
    const method = STANDARD.has(req.method)
      ? `reqwest::Method::${req.method}`
      : `reqwest::Method::from_bytes(${q(req.method).replace(/^"/, 'b"')})?`
    lines.push(`${t}let response = client.request(${method}, ${q(req.url)})`)
    for (const h of req.headers) lines.push(`${t}${t}.header(${q(h.key)}, ${q(h.value)})`)
    const auth = basicAuth(req)
    if (auth) lines.push(`${t}${t}.basic_auth(${q(auth.username)}, Some(${q(auth.password)}))`)
    if (b?.mode === 'raw') lines.push(`${t}${t}.body(${q(rawContent(req, o) ?? '')})`)
    else if (b?.mode === 'urlencoded') lines.push(`${t}${t}.body(${q(b.encoded)})`)
    else if (b?.mode === 'binary') lines.push(`${t}${t}.body(std::fs::read(${q(b.path)})?)`)
    else if (b?.mode === 'form-data') lines.push(`${t}${t}.multipart(form)`)
    lines.push(`${t}${t}.send()`, `${t}${t}.await?;`, '')
    lines.push(
      `${t}let body = response.text().await?;`,
      `${t}println!("{}", body);`,
      '',
      `${t}Ok(())`,
    )
    return [
      '#[tokio::main]',
      'async fn main() -> Result<(), Box<dyn std::error::Error>> {',
      ...lines,
      '}',
    ].join('\n')
  },
}
