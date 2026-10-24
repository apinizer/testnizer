/**
 * cURL command parser (issue #279): text → `ParsedCurl` (a neutral model of
 * what curl would send) + warnings. Shared by the `import:curl` importer
 * (main) and the URL-bar paste (renderer).
 *
 * Option syntax handled: long and short forms, glued short values (`-XPOST`,
 * `-H'x: y'` → `-Hx: y` after tokenizing), clustered booleans (`-sSL`, `-sX
 * POST`), `--opt=value`, `--no-<bool>`, `--` end of options. Semantics follow
 * curl: repeated data joins with `&`, `-G` moves the data into the query,
 * `-I` is HEAD, `--json` sets the JSON Content-Type + Accept, `-u` + `--digest
 * / --ntlm`, `-b name=value` is a Cookie header… Files (`@file`, `<file`,
 * `-T`) are never read: they are kept by path and reported as warnings.
 */
import { detectDialect, stripPrompt, tokenizeShell } from './tokenize'
import { longFlag, shortFlag, type CurlFlagKind, type CurlFlagSpec } from './flags'
import type {
  CurlDataPart,
  CurlDialect,
  CurlFormPart,
  CurlHeader,
  CurlWarning,
  ParsedCurl,
} from './types'
import { CURL_DIALECTS } from './types'

export interface ParseCurlOptions {
  /** Force a dialect instead of detecting it. */
  dialect?: CurlDialect
}

const CURL_WORD = /(^|[\\/])curl(\.exe)?$/i

/**
 * Does the text START with the curl command word (after an optional prompt
 * / `&` call operator / quoted path)? The importer's gate — looser than
 * `looksLikeCurl`, so `curl -X POST` still reaches "No URL found".
 */
export function startsWithCurl(text: string): boolean {
  if (typeof text !== 'string') return false
  const { text: t } = stripPrompt(text)
  return /^&?\s*(['"]?)((?:[^\s'"]*[\\/])?curl(?:\.exe)?)\1(\s|$)/i.test(t)
}

/**
 * Does the pasted / typed text look like a cURL command (any dialect)? A
 * plain URL, `curl` alone, or prose that merely starts with the word "curl"
 * does not: after `curl` there must be a flag, a URL or a `{{var}}`.
 */
export function looksLikeCurl(text: string): boolean {
  if (typeof text !== 'string') return false
  const { text: t } = stripPrompt(text)
  const m = /^&?\s*(['"]?)((?:[^\s'"]*[\\/])?curl(?:\.exe)?)\1(?=\s)/i.exec(t)
  if (!m) return false
  const rest = t.slice(m[0].length)
  return /(^|\s)['"^]*(-{1,2}[A-Za-z#:]|[a-z][a-z0-9+.-]*:\/\/|\{\{|localhost\b|\d{1,3}(\.\d{1,3}){3}|[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}([:/?#'"]|\s|$))/i.test(
    rest,
  )
}

/** Characters curl's `--data-urlencode` leaves as they are (RFC 3986 unreserved). */
export function curlUrlEncode(s: string): string {
  let out = ''
  for (const ch of s) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) {
      out += ch
      continue
    }
    for (const byte of new TextEncoder().encode(ch)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return out
}

const warnOf = (code: CurlWarning['code'], message: string, arg?: string): CurlWarning =>
  arg === undefined ? { code, message } : { code, arg, message }

function looksLikeUrl(s: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ||
    s.startsWith('{{') ||
    /^localhost(:\d+)?([/?#]|$)/i.test(s) ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(s) ||
    /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(:\d+)?([/?#]|$)/.test(s)
  )
}

/** `-F` value after `name=`: `@file;type=…`, `<file`, `"quoted"`, plain text + modifiers. */
function parseFormValue(name: string, raw: string, warnings: CurlWarning[]): CurlFormPart {
  let content = raw
  let mods: string[] = []
  if (content.startsWith('"')) {
    // name="value with ; inside" — curl strips the quotes, `\"` / `\\` escape.
    let i = 1
    let text = ''
    while (i < content.length && content[i] !== '"') {
      if (content[i] === '\\' && i + 1 < content.length) {
        text += content[i + 1]
        i += 2
        continue
      }
      text += content[i]
      i++
    }
    const tail = content.slice(i + 1)
    mods = tail.split(/;(?=\s*(?:type|filename|headers|encoder)=)/i).filter((m) => m !== '')
    content = text
  } else {
    const segs = content.split(/;(?=\s*(?:type|filename|headers|encoder)=)/i)
    content = segs[0]
    mods = segs.slice(1)
  }
  let contentType: string | undefined
  let filename: string | undefined
  for (const m of mods) {
    const eq = m.indexOf('=')
    const key = m.slice(0, eq).trim().toLowerCase()
    let value = m.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      value = value.slice(1, -1)
    if (key === 'type') contentType = value
    else if (key === 'filename') filename = value
  }
  if (content.startsWith('@')) {
    const path = content.slice(1)
    const base = filename ?? path.split(/[/\\]/).pop() ?? path
    return { name, value: base, kind: 'file', path, contentType, filename }
  }
  if (content.startsWith('<')) {
    const path = content.slice(1)
    warnings.push(
      warnOf(
        'file-reference',
        `Form field "${name}" reads its text from ${path}; the file is not read — the field keeps "<${path}".`,
        path,
      ),
    )
    return { name, value: content, kind: 'text-file', path, contentType }
  }
  if (contentType) {
    warnings.push(
      warnOf(
        'form-type-ignored',
        `Form field "${name}" declares type ${contentType}; a text field cannot store its own type.`,
        name,
      ),
    )
  }
  return { name, value: content, kind: 'text', contentType }
}

interface ParseState {
  out: ParsedCurl
  urls: string[]
  explicitUrls: string[]
  stray: string[]
  stop: boolean
}

function applyFlag(
  st: ParseState,
  spec: CurlFlagSpec,
  flagText: string,
  value: string | undefined,
  negated = false,
): void {
  const o = st.out
  const kind: CurlFlagKind = spec.kind
  const val = value ?? ''
  switch (kind) {
    case 'request':
      o.method = val.toUpperCase()
      o.methodExplicit = true
      return
    case 'header': {
      if (val.startsWith('@')) {
        o.warnings.push(
          warnOf(
            'file-reference',
            `Headers are read from ${val.slice(1)}; the file is not read.`,
            val.slice(1),
          ),
        )
        return
      }
      const colon = val.indexOf(':')
      const semi = val.indexOf(';')
      if (colon > 0) {
        const key = val.slice(0, colon).trim()
        const hv = val.slice(colon + 1).trim()
        // `Name:` with nothing after it REMOVES the header in curl — nothing to send.
        if (hv !== '') o.headers.push({ key, value: hv })
        return
      }
      if (semi > 0 && val.slice(semi + 1).trim() === '') {
        // `Name;` = the header with an empty value.
        o.headers.push({ key: val.slice(0, semi).trim(), value: '' })
        return
      }
      o.warnings.push(warnOf('ignored-arg', `"${val}" is not a header line (Name: value).`, val))
      return
    }
    case 'data':
    case 'data-ascii':
    case 'data-binary':
    case 'json': {
      if (val.startsWith('@')) {
        const file = val.slice(1)
        o.data.push({ kind, value: val, file })
        o.warnings.push(
          warnOf(
            'file-reference',
            `The body is read from ${file}; the file is not read here.`,
            file,
          ),
        )
      } else {
        o.data.push({ kind, value: val })
      }
      return
    }
    case 'data-raw':
      o.data.push({ kind, value: val })
      return
    case 'data-urlencode': {
      // `content`, `=content`, `name=content`, `@file`, `name@file`.
      const eq = val.indexOf('=')
      const at = val.indexOf('@')
      if (at !== -1 && (eq === -1 || at < eq)) {
        const file = val.slice(at + 1)
        o.data.push({ kind, value: val, file })
        o.warnings.push(
          warnOf(
            'file-reference',
            `The body is read from ${file}; the file is not read here.`,
            file,
          ),
        )
        return
      }
      let encoded: string
      if (eq === -1) encoded = curlUrlEncode(val)
      else if (eq === 0) encoded = curlUrlEncode(val.slice(1))
      else encoded = `${val.slice(0, eq)}=${curlUrlEncode(val.slice(eq + 1))}`
      o.data.push({ kind, value: encoded })
      return
    }
    case 'form':
    case 'form-string': {
      const eq = val.indexOf('=')
      if (eq <= 0) {
        o.warnings.push(warnOf('ignored-arg', `"${val}" is not a form field (name=value).`, val))
        return
      }
      const name = val.slice(0, eq)
      const raw = val.slice(eq + 1)
      o.form.push(
        kind === 'form-string'
          ? { name, value: raw, kind: 'text' }
          : parseFormValue(name, raw, o.warnings),
      )
      return
    }
    case 'user': {
      const colon = val.indexOf(':')
      if (colon === -1) {
        o.user = { username: val, password: '' }
        o.warnings.push(
          warnOf(
            'password-prompt',
            'No password after the user name (curl would prompt) — it is left empty.',
            val,
          ),
        )
      } else {
        o.user = { username: val.slice(0, colon), password: val.slice(colon + 1) }
      }
      return
    }
    case 'basic':
    case 'digest':
    case 'ntlm':
    case 'negotiate':
    case 'anyauth':
      o.authScheme = kind
      return
    case 'cookie':
      if (val.includes('=')) o.cookies.push(val)
      else if (val !== '') {
        o.warnings.push(
          warnOf('cookie-file', `Cookies are read from the file ${val}; it is not read.`, val),
        )
      }
      return
    case 'user-agent':
      o.headers.push({ key: 'User-Agent', value: val })
      return
    case 'referer': {
      const ref = val.replace(/;auto$/, '')
      if (ref !== '') o.headers.push({ key: 'Referer', value: ref })
      return
    }
    case 'get':
      o.get = !negated
      return
    case 'head':
      o.head = !negated
      return
    case 'insecure':
      o.insecure = !negated
      return
    case 'location':
      o.followRedirects = !negated
      return
    case 'max-redirs': {
      const n = Number(val)
      if (Number.isFinite(n)) o.maxRedirects = n < 0 ? 0 : Math.floor(n)
      return
    }
    case 'max-time': {
      const n = Number(val)
      if (Number.isFinite(n) && n >= 0) o.maxTimeSeconds = n
      return
    }
    case 'connect-timeout': {
      const n = Number(val)
      if (Number.isFinite(n) && n >= 0) o.connectTimeoutSeconds = n
      return
    }
    case 'compressed':
      o.compressed = !negated
      return
    case 'url':
      st.explicitUrls.push(val)
      return
    case 'oauth2-bearer':
      o.bearer = val
      return
    case 'upload-file':
      o.uploadFile = val
      o.warnings.push(
        warnOf(
          'file-reference',
          `The body is uploaded from ${val}; set as a binary body path, not read here.`,
          val,
        ),
      )
      return
    case 'next':
      o.warnings.push(warnOf('next-ignored', 'Only the first request of a --next chain is used.'))
      st.stop = true
      return
    case 'unsupported':
      o.warnings.push(
        warnOf(
          'unsupported-flag',
          `${flagText} has no equivalent on a Testnizer request and was ignored.`,
          flagText,
        ),
      )
      return
    case 'ignore':
      return
  }
}

function parseTokens(
  tokens: string[],
  dialect: CurlDialect,
  preWarnings: CurlWarning[],
): ParsedCurl {
  const out: ParsedCurl = {
    dialect,
    method: 'GET',
    methodExplicit: false,
    url: '',
    headers: [],
    data: [],
    form: [],
    cookies: [],
    get: false,
    head: false,
    insecure: false,
    compressed: false,
    warnings: [...preWarnings],
  }
  const st: ParseState = { out, urls: [], explicitUrls: [], stray: [], stop: false }
  let i = tokens.length > 0 && CURL_WORD.test(tokens[0]) ? 1 : 0
  let endOfOptions = false
  const missing = (flag: string): void => {
    out.warnings.push(warnOf('missing-value', `${flag} needs a value.`, flag))
  }
  for (; i < tokens.length && !st.stop; i++) {
    const tok = tokens[i]
    if (endOfOptions || !tok.startsWith('-') || tok === '-') {
      if (tok !== '-' && tok !== '') st.urls.push(tok)
      continue
    }
    if (tok === '--') {
      endOfOptions = true
      continue
    }
    if (tok.startsWith('--')) {
      let name = tok.slice(2)
      let value: string | undefined
      let spec = longFlag(name)
      if (!spec) {
        const eq = name.indexOf('=')
        if (eq > 0 && longFlag(name.slice(0, eq))) {
          spec = longFlag(name.slice(0, eq))
          value = name.slice(eq + 1)
          name = name.slice(0, eq)
        }
      }
      if (!spec && name.startsWith('no-')) {
        const positive = longFlag(name.slice(3))
        if (positive && !positive.arg) {
          applyFlag(st, positive, tok, undefined, true)
          continue
        }
      }
      if (!spec) {
        out.warnings.push(
          warnOf('unknown-flag', `${tok} is not a known curl option and was ignored.`, tok),
        )
        continue
      }
      if (spec.arg && value === undefined) {
        if (i + 1 >= tokens.length) {
          missing(tok)
          continue
        }
        value = tokens[++i]
      }
      applyFlag(st, spec, `--${name}`, value)
      continue
    }
    // Short option cluster.
    for (let k = 1; k < tok.length; k++) {
      const ch = tok[k]
      const spec = shortFlag(ch)
      if (!spec) {
        out.warnings.push(
          warnOf(
            'unknown-flag',
            `-${ch} is not a known curl option and was ignored.`,
            k === 1 ? tok : `-${ch}`,
          ),
        )
        break
      }
      if (spec.arg) {
        let value = tok.slice(k + 1)
        if (value === '') {
          if (i + 1 >= tokens.length) {
            missing(`-${ch}`)
            break
          }
          value = tokens[++i]
        }
        applyFlag(st, spec, `-${ch}`, value)
        break
      }
      applyFlag(st, spec, `-${ch}`, undefined)
    }
  }
  finish(st)
  return out
}

/** Pick the URL, resolve method / body by curl's rules. */
function finish(st: ParseState): void {
  const o = st.out
  const candidates = [...st.explicitUrls, ...st.urls]
  const urlLike = candidates.filter(looksLikeUrl)
  o.url = st.explicitUrls[0] ?? urlLike[0] ?? candidates[0] ?? ''
  for (const c of candidates) {
    if (c === o.url) continue
    if (looksLikeUrl(c)) {
      o.warnings.push(warnOf('extra-url', `Only the first URL is used; ${c} was ignored.`, c))
    } else {
      o.warnings.push(warnOf('ignored-arg', `"${c}" was not understood and was ignored.`, c))
    }
  }
  const hasData = o.data.length > 0
  const allJson = hasData && o.data.every((d) => d.kind === 'json')
  const joined = o.data.map((d) => d.value).join(allJson ? '' : '&')
  if (o.data.some((d) => d.kind === 'json')) {
    const has = (name: string): boolean => o.headers.some((h) => h.key.toLowerCase() === name)
    if (!has('content-type')) o.headers.push({ key: 'Content-Type', value: 'application/json' })
    if (!has('accept')) o.headers.push({ key: 'Accept', value: 'application/json' })
  }
  if (hasData && o.get) {
    if (o.url) o.url += (o.url.includes('?') ? '&' : '?') + joined
  } else if (hasData && o.head && !o.methodExplicit) {
    o.warnings.push(
      warnOf('head-with-data', '-I cannot send data without -G; the data was dropped.'),
    )
  } else if (hasData) {
    o.body = joined
  }
  if (!o.methodExplicit) {
    if (o.head) o.method = 'HEAD'
    else if (o.get) o.method = 'GET'
    else if (hasData || o.form.length > 0) o.method = 'POST'
    else if (o.uploadFile) o.method = 'PUT'
    else o.method = 'GET'
  }
}

function score(p: ParsedCurl): number {
  let s = p.url ? 100 : 0
  for (const w of p.warnings) {
    if (w.code === 'unknown-flag' || w.code === 'unterminated-quote') s -= 10
    else if (w.code === 'ignored-arg' || w.code === 'extra-url') s -= 5
    else s -= 1
  }
  return s
}

/** Tokenize + parse with one dialect. */
export function parseCurlAs(text: string, dialect: CurlDialect): ParsedCurl {
  const { tokens, warnings } = tokenizeShell(text, dialect)
  return parseTokens(tokens, dialect, warnings)
}

/**
 * Parse a cURL command in any of the three dialects. The detected dialect
 * goes first; when its result has no URL or looks broken (unknown flags,
 * unbalanced quotes, stray words) the other two are tried and the best
 * scoring parse wins.
 */
export function parseCurl(text: string, options: ParseCurlOptions = {}): ParsedCurl {
  if (options.dialect) return parseCurlAs(text, options.dialect)
  const first = detectDialect(text)
  const primary = parseCurlAs(text, first)
  if (primary.url && score(primary) >= 100 - primary.warnings.length) return primary
  let best = primary
  for (const d of CURL_DIALECTS) {
    if (d === first) continue
    const alt = parseCurlAs(text, d)
    if (score(alt) > score(best)) best = alt
  }
  if (best !== primary) {
    // Read as another shell — still say the quotes did not balance as typed.
    const unbalanced = primary.warnings.find((w) => w.code === 'unterminated-quote')
    if (unbalanced && !best.warnings.some((w) => w.code === 'unterminated-quote')) {
      best.warnings.push(unbalanced)
    }
  }
  return best
}

export type { CurlDataPart, CurlFormPart, CurlHeader }
