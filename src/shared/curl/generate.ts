/**
 * cURL snippet generation in three shells (issue #279) — the ONE quoting and
 * layout engine behind every cURL Testnizer prints: the Generate Code
 * `curl` snippet, `export:curl`, a mock endpoint's "Copy as cURL" and the MCP
 * "Copy as cURL". Callers choose WHICH arguments to emit; this module decides
 * how each is quoted and how lines are joined.
 *
 * Quoting (derived from Apinizer's CodeSnippet.java, with its CMD / PowerShell
 * gaps fixed; the round-trip tests feed every output back to `parseCurl`):
 *
 *  - bash: `'…'`, an embedded `'` → `'\''`. Everything else (`$`, `!`,
 *    backticks, `\`, newlines) is literal inside single quotes.
 *  - Windows CMD — two forms:
 *     · plain `"…"` when the value is safe inside cmd's quotes, i.e. it has no
 *       `"`, no newline and no `%name%` / `%%` that cmd could expand or a
 *       batch file would collapse. `& | < > ^ ( )` are literal inside quotes,
 *       so URLs and headers stay readable. Trailing backslashes are doubled
 *       (the closing quote must not become `\"`).
 *     · otherwise the caret form Chrome DevTools' "Copy as cURL (cmd)" uses:
 *       `^"…^"` keeps cmd OUTSIDE its quote state for the whole value, so every
 *       metacharacter is caret-escaped (`^& ^| ^< ^> ^( ^) ^^`), an embedded
 *       quote is MSVCRT-escaped `\"` then carets `\^"`, a `%` before a name
 *       character becomes `%^` (cmd finds no variable `^name`, the caret pass
 *       then removes the caret — this is the only escape that works at an
 *       interactive prompt; `%%` only works inside .bat files and would reach
 *       curl doubled when pasted into a console), and a newline is `^`+LF+LF
 *       (the caret escapes the line end, the empty line is a literal newline).
 *       `!` is literal: delayed expansion is off in a default cmd session.
 *  - PowerShell: `curl.exe` (in Windows PowerShell `curl` is the
 *    Invoke-WebRequest alias), `'…'` verbatim with `'` → `''` (the
 *    typographic quotes PowerShell also accepts are doubled too), and an
 *    embedded `"` written `\"` (runs of backslashes before it doubled): Windows
 *    PowerShell 5.1 strips bare quotes from native arguments, so `'{\"a\":1}'`
 *    is what reaches curl.exe as `{"a":1}`. Caveat: pwsh 7.3+ passes
 *    arguments verbatim, so there curl receives the backslashes too — the
 *    snippet targets the PowerShell that ships with Windows.
 *
 * Layout: single line, or multi-line with the shell's continuation (` \`,
 * ` ^`, `` ` ``) as the LAST character of each line, items indented.
 */
import type { CurlDialect } from './types'

export interface CurlArg {
  /** `-H`, `--data-raw`, `-k`… */
  flag?: string
  /** Quoted for the shell unless `literal`. */
  value?: string
  /** Emit `value` as typed (`-X POST`, never quoted). */
  literal?: boolean
}

export interface RenderCurlOptions {
  dialect?: CurlDialect
  /** One argument per line with the shell's continuation (default true). */
  multiLine?: boolean
  /** How many leading arguments share the first line with the command word. */
  inline?: number
  /** Indent of continuation lines (default two spaces). */
  indent?: string
}

/** The command word per shell. */
export function curlCommandWord(dialect: CurlDialect): string {
  return dialect === 'powershell' ? 'curl.exe' : 'curl'
}

const CONTINUATION: Record<CurlDialect, string> = { bash: '\\', cmd: '^', powershell: '`' }

/** `"` → `\"` with the MSVCRT backslash rule; `trailing` doubles a final backslash run too. */
function msvcrtEscape(v: string, trailing: boolean): string {
  let out = ''
  let i = 0
  while (i < v.length) {
    if (v[i] === '\\') {
      let j = i
      while (v[j] === '\\') j++
      const run = j - i
      const beforeQuote = v[j] === '"' || (trailing && j === v.length)
      out += '\\'.repeat(beforeQuote ? run * 2 : run)
      i = j
      continue
    }
    if (v[i] === '"') {
      out += '\\"'
      i++
      continue
    }
    out += v[i]
    i++
  }
  return out
}

function quoteBash(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`
}

function quotePowershell(v: string): string {
  return `'${msvcrtEscape(v, false).replace(/['‘’‚‛]/g, (q) => q + q)}'`
}

/** Needs the caret form (see the module comment). */
function cmdNeedsCaret(v: string): boolean {
  return /["\r\n]/.test(v) || /%[A-Za-z_][^%\r\n]*%/.test(v) || v.includes('%%')
}

function quoteCmd(v: string): string {
  if (!cmdNeedsCaret(v)) return `"${msvcrtEscape(v, true)}"`
  const ms = msvcrtEscape(v.replace(/\r\n?/g, '\n'), true)
  let out = ''
  for (let k = 0; k < ms.length; k++) {
    const c = ms[k]
    if (c === '\n') {
      out += '^\n\n'
      continue
    }
    if (c === '%' && /[A-Za-z0-9_%]/.test(ms[k + 1] ?? '')) {
      out += '%^'
      continue
    }
    if ('^&|<>()"'.includes(c)) {
      out += `^${c}`
      continue
    }
    out += c
  }
  return `^"${out}^"`
}

/** Quote one argument for a shell. */
export function quoteCurlArg(value: string, dialect: CurlDialect = 'bash'): string {
  if (dialect === 'cmd') return quoteCmd(value)
  if (dialect === 'powershell') return quotePowershell(value)
  return quoteBash(value)
}

function renderArg(a: CurlArg, dialect: CurlDialect): string {
  const value =
    a.value === undefined ? undefined : a.literal ? a.value : quoteCurlArg(a.value, dialect)
  if (a.flag && value !== undefined) return `${a.flag} ${value}`
  return a.flag ?? value ?? ''
}

/** Lay out `curl` + args for a shell. */
export function renderCurl(args: CurlArg[], opts: RenderCurlOptions = {}): string {
  const dialect = opts.dialect ?? 'bash'
  const multiLine = opts.multiLine ?? true
  const inline = Math.max(0, opts.inline ?? 0)
  const indent = opts.indent ?? '  '
  const parts = args.map((a) => renderArg(a, dialect))
  const first = [curlCommandWord(dialect), ...parts.slice(0, inline)].join(' ')
  const rest = parts.slice(inline)
  if (!multiLine) return [first, ...rest].join(' ')
  return [first, ...rest.map((p) => indent + p)].join(` ${CONTINUATION[dialect]}\n`)
}

// ─── Request → arguments (the Generate Code `curl` snippet) ────────────────

export interface CurlGenRequest {
  method: string
  /** Full URL — query params already merged by the caller. */
  url: string
  headers: Array<{ key: string; value: string }>
  /** `-u` credentials (Basic unless `scheme`). */
  user?: { username: string; password: string; scheme?: 'basic' | 'digest' | 'ntlm' }
  body?:
    | { kind: 'raw'; content: string }
    | { kind: 'form'; parts: Array<{ key: string; value: string; filePath?: string }> }
    | { kind: 'binary'; path: string }
  /** SSL verification off → `-k`. */
  insecure?: boolean
}

/** Form text that curl's `-F` would reinterpret (`@file`, `<file`, `;type=`) goes through `--form-string`. */
function formTextFlag(value: string): string {
  return /^[@<]/.test(value) || value.includes(';') ? '--form-string' : '-F'
}

/**
 * Arguments of the Generate Code snippet: `-X METHOD 'url'`, `-H` per header,
 * `-u` (+ `--digest` / `--ntlm`), the body (`-d`, or `--data-raw` when it
 * starts with `@` so curl does not read a file; `-F` / `--form-string`;
 * `--data-binary '@path'`), `-k`. Render with `inline: 2` for the classic
 * `curl -X GET 'url' \` first line.
 */
export function curlArgsFor(req: CurlGenRequest): CurlArg[] {
  const args: CurlArg[] = [{ flag: '-X', value: req.method, literal: true }, { value: req.url }]
  for (const h of req.headers) args.push({ flag: '-H', value: `${h.key}: ${h.value}` })
  if (req.user) {
    args.push({ flag: '-u', value: `${req.user.username}:${req.user.password}` })
    if (req.user.scheme === 'digest') args.push({ flag: '--digest' })
    if (req.user.scheme === 'ntlm') args.push({ flag: '--ntlm' })
  }
  const body = req.body
  if (body?.kind === 'raw' && body.content) {
    args.push({ flag: body.content.startsWith('@') ? '--data-raw' : '-d', value: body.content })
  } else if (body?.kind === 'form') {
    for (const p of body.parts) {
      if (p.filePath) args.push({ flag: '-F', value: `${p.key}=@${p.filePath}` })
      else args.push({ flag: formTextFlag(p.value), value: `${p.key}=${p.value}` })
    }
  } else if (body?.kind === 'binary' && body.path) {
    args.push({ flag: '--data-binary', value: `@${body.path}` })
  }
  if (req.insecure) args.push({ flag: '-k' })
  return args
}

/** The Generate Code snippet for a shell. */
export function generateCurl(
  req: CurlGenRequest,
  opts: { dialect?: CurlDialect; multiLine?: boolean } = {},
): string {
  return renderCurl(curlArgsFor(req), { ...opts, inline: 2 })
}
