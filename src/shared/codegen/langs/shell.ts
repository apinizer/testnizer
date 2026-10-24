/** Shell — wget and HTTPie (bash quoting through the shared cURL engine). */
import { basicAuth } from '../helpers'
import {
  followRedirectOpt,
  rawContent,
  shouldFollow,
  TIMEOUT,
  timeoutMs,
  TRIM_BODY,
} from '../options'
import { shString as q } from '../quote'
import type { CodegenOptions, CodegenRequest, CodegenVariant } from '../types'

const join = (args: string[]): string => args.join(' \\\n  ')

/** A plain method token is written bare (`POST`), anything else quoted. */
const method = (m: string): string => (/^[A-Z]+$/.test(m) ? m : q(m))

function wget(req: CodegenRequest, o: CodegenOptions): string {
  const pre: string[] = []
  const args: string[] = ['wget --quiet', `--method=${method(req.method)}`]
  for (const h of req.headers) args.push(`--header=${q(`${h.key}: ${h.value}`)}`)
  const auth = basicAuth(req)
  if (auth)
    args.push(`--user=${q(auth.username)}`, `--password=${q(auth.password)}`, '--auth-no-challenge')
  const b = req.body
  if (b?.mode === 'raw') args.push(`--body-data=${q(rawContent(req, o) ?? '')}`)
  else if (b?.mode === 'urlencoded') args.push(`--body-data=${q(b.encoded)}`)
  else if (b?.mode === 'binary') args.push(`--body-file=${q(b.path)}`)
  else if (b?.mode === 'form-data') {
    pre.push(
      '# wget cannot build a multipart/form-data body — use cURL or HTTPie for this request.',
    )
  }
  if (!shouldFollow(req, o)) args.push('--max-redirect=0')
  const ms = timeoutMs(req, o)
  if (ms > 0) args.push(`--timeout=${Math.ceil(ms / 1000)}`)
  if (req.settings.insecure) args.push('--no-check-certificate')
  args.push('--output-document=-', q(req.url))
  return [...pre, join(args)].join('\n')
}

export const shellWget: CodegenVariant = {
  id: 'shell-wget',
  language: 'shell',
  label: 'wget',
  monaco: 'shell',
  options: [TRIM_BODY, followRedirectOpt(), TIMEOUT],
  generate: wget,
}

/**
 * HTTPie: request items (`Header:value`, `field=value`, `file@path`) quoted
 * as whole words; a raw body is piped through `printf %s` (so HTTPie does not
 * re-encode it), a binary body redirected from the file.
 */
function httpie(req: CodegenRequest, o: CodegenOptions): string {
  const flags: string[] = ['http']
  const b = req.body
  if (b?.mode === 'form-data') flags.push('--multipart')
  if (shouldFollow(req, o)) flags.push('--follow')
  const ms = timeoutMs(req, o)
  if (ms > 0) flags.push(`--timeout=${ms / 1000}`)
  if (req.settings.insecure) flags.push('--verify=no')
  const auth = req.auth
  if (auth && auth.scheme !== 'ntlm') {
    flags.push(`--auth=${q(`${auth.username}:${auth.password}`)}`)
    if (auth.scheme === 'digest') flags.push('--auth-type=digest')
  }
  const args = [flags.join(' '), method(req.method), q(req.url)]
  for (const h of req.headers) args.push(q(`${h.key}:${h.value}`))
  if (b?.mode === 'form-data') {
    for (const p of b.parts)
      args.push(q(p.kind === 'file' ? `${p.key}@${p.path}` : `${p.key}=${p.value}`))
  }
  let cmd = join(args)
  if (b?.mode === 'raw') cmd = `printf '%s' ${q(rawContent(req, o) ?? '')} | ${cmd}`
  else if (b?.mode === 'urlencoded') cmd = `printf '%s' ${q(b.encoded)} | ${cmd}`
  else if (b?.mode === 'binary') cmd = `${cmd} \\\n  < ${q(b.path)}`
  return cmd
}

export const shellHttpie: CodegenVariant = {
  id: 'shell-httpie',
  language: 'shell',
  label: 'HTTPie',
  monaco: 'shell',
  // HTTPie does not follow redirects unless `--follow`; Send does — default on.
  options: [TRIM_BODY, followRedirectOpt(), TIMEOUT],
  generate: httpie,
}
