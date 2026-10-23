/**
 * Dialect-aware shell tokenizer for pasted cURL commands (issue #279).
 *
 * Three shells, each modelled the way the real shell + curl see the text —
 * never by executing or expanding anything:
 *
 *  - bash / POSIX sh: `'…'` verbatim (`'\''` idiom), `"…"` with `\` escaping
 *    only `$ \` " \ newline`, `$'…'` ANSI-C, unquoted `\x`, `\`+newline
 *    continuation. `$VAR` / `$(…)` / backticks stay literal (warning).
 *  - Windows CMD: TWO stages, exactly like cmd.exe + curl.exe. Stage 1 is
 *    cmd's own pass: it tracks its quote state, removes a `^` escape outside
 *    quotes (`^"` = a literal quote that does not toggle cmd's state), joins a
 *    `^`+newline continuation (the next line's first char is escaped, so
 *    `^`+LF+LF is a literal newline — Chrome's "Copy as cURL (cmd)" form) and
 *    collapses the batch-file `%%`. Stage 2 is the MSVCRT argv split curl.exe
 *    runs on what cmd passed it: space/tab separate, `"` toggles, `2n` `\`
 *    + `"` → `n` `\` + toggle, `2n+1` `\` + `"` → `n` `\` + literal quote,
 *    `""` inside quotes → `"`; a backslash NOT before a quote is literal, so a
 *    Windows path `C:\tmp\a.txt` survives.
 *  - PowerShell: backtick escapes and continuation, `'…'` verbatim with `''`,
 *    `"…"` with backtick escapes and `""`, here-strings `@'…'@` / `@"…"@`, the
 *    `&` call operator. Windows PowerShell 5.1 hands native programs the
 *    `\"` form for an embedded quote (`'{\"a\":1}'` → curl.exe gets `{"a":1}`),
 *    so a word whose every `"` is backslash-escaped is unescaped the MSVCRT way.
 *
 * Bare newlines (no continuation char) are whitespace in every dialect — a
 * command re-wrapped by a chat client or an editor still parses.
 */
import type { CurlDialect, CurlWarning } from './types'

export interface TokenizeResult {
  tokens: string[]
  warnings: CurlWarning[]
}

// ─── Prompt + dialect detection ────────────────────────────────────────────

/**
 * Strip one leading shell prompt: `$ `, `% `, `# `, `> `, `PS> `,
 * `PS C:\path> `, `C:\path>`. Returns the dialect the prompt implies, if any.
 */
export function stripPrompt(text: string): { text: string; hint?: CurlDialect } {
  const t = text.replace(/^\uFEFF/, '').replace(/^\s+/, '')
  const ps = /^PS(?:\s[^\r\n>]*)?>\s*/.exec(t)
  if (ps) return { text: t.slice(ps[0].length), hint: 'powershell' }
  const cmd = /^[A-Za-z]:\\[^\r\n>]*>\s*/.exec(t)
  if (cmd) return { text: t.slice(cmd[0].length), hint: 'cmd' }
  const generic = /^[$%#>]\s+/.exec(t)
  if (generic) return { text: t.slice(generic[0].length) }
  return { text: t }
}

/**
 * Which shell the text was written for, by a scoring rule (ties → bash):
 * caret continuation / `^"` → CMD; backtick continuation, `curl.exe`, the
 * `&` call operator, a here-string → PowerShell; `\` continuation, `'\''`,
 * `$'…'` → bash. A PowerShell / CMD prompt decides outright.
 */
export function detectDialect(text: string): CurlDialect {
  const { text: t, hint } = stripPrompt(text)
  if (hint) return hint
  let cmd = 0
  let ps = 0
  let sh = 0
  if (/\^\r?\n/.test(t)) cmd += 3
  if (/\^"/.test(t)) cmd += 3
  if (/\^[&|<>%{}\\[\]]/.test(t)) cmd += 1
  if (/`\r?\n/.test(t)) ps += 3
  if (/^&\s*/.test(t)) ps += 2
  if (/^&?\s*['"]?[^\s'"]*curl\.exe['"]?(\s|$)/i.test(t)) ps += 2
  if (/@['"]\r?\n/.test(t)) ps += 2
  if (/\\\r?\n/.test(t)) sh += 3
  if (/'\\''/.test(t)) sh += 2
  if (/\$'/.test(t)) sh += 1
  if (cmd > sh && cmd > ps) return 'cmd'
  if (ps > sh && ps >= cmd) return 'powershell'
  return 'bash'
}

/** Tokenize with a dialect (prompt already stripped or not — both work). */
export function tokenizeShell(text: string, dialect: CurlDialect): TokenizeResult {
  const { text: t } = stripPrompt(text)
  if (dialect === 'cmd') return tokenizeCmd(t)
  if (dialect === 'powershell') return tokenizePowershell(t)
  return tokenizeBash(t)
}

const warn = (code: CurlWarning['code'], message: string, arg?: string): CurlWarning =>
  arg === undefined ? { code, message } : { code, arg, message }

const EXPANSION_START = /[A-Za-z_{(]/

// ─── bash / POSIX ──────────────────────────────────────────────────────────

function decodeAnsiC(src: string, start: number): { value: string; end: number } {
  let out = ''
  let i = start
  while (i < src.length && src[i] !== "'") {
    const c = src[i]
    if (c !== '\\' || i + 1 >= src.length) {
      out += c
      i++
      continue
    }
    const e = src[i + 1]
    i += 2
    switch (e) {
      case 'n':
        out += '\n'
        break
      case 't':
        out += '\t'
        break
      case 'r':
        out += '\r'
        break
      case 'a':
        out += '\x07'
        break
      case 'b':
        out += '\b'
        break
      case 'f':
        out += '\f'
        break
      case 'v':
        out += '\v'
        break
      case 'e':
      case 'E':
        out += '\x1b'
        break
      case 'x': {
        const m = /^[0-9A-Fa-f]{1,2}/.exec(src.slice(i))
        if (m) {
          out += String.fromCharCode(parseInt(m[0], 16))
          i += m[0].length
        } else out += '\\x'
        break
      }
      case 'u':
      case 'U': {
        const m = (e === 'u' ? /^[0-9A-Fa-f]{1,4}/ : /^[0-9A-Fa-f]{1,8}/).exec(src.slice(i))
        if (m) {
          out += String.fromCodePoint(parseInt(m[0], 16))
          i += m[0].length
        } else out += `\\${e}`
        break
      }
      default:
        if (/[0-7]/.test(e)) {
          const m = /^[0-7]{0,2}/.exec(src.slice(i))
          const digits = e + (m ? m[0] : '')
          out += String.fromCharCode(parseInt(digits, 8))
          i += digits.length - 1
        } else {
          // \\ \' \" \? and anything else: the character itself.
          out += e
        }
    }
  }
  return { value: out, end: i }
}

function tokenizeBash(src: string): TokenizeResult {
  const tokens: string[] = []
  const warnings: CurlWarning[] = []
  let cur = ''
  let inWord = false
  let expansionWarned = false
  const n = src.length
  const push = (): void => {
    if (inWord) tokens.push(cur)
    cur = ''
    inWord = false
  }
  const noteExpansion = (at: number): void => {
    if (expansionWarned) return
    expansionWarned = true
    warnings.push(
      warn(
        'shell-expansion',
        'Shell variables and command substitutions are kept as typed, never expanded.',
        src.slice(at, at + 24),
      ),
    )
  }
  let i = 0
  while (i < n) {
    const c = src[i]
    if (c === '\\') {
      const nx = src[i + 1]
      if (nx === '\n') {
        i += 2
        continue
      }
      if (nx === '\r' && src[i + 2] === '\n') {
        i += 3
        continue
      }
      if (nx === undefined) {
        i++
        continue
      }
      cur += nx
      inWord = true
      i += 2
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      push()
      i++
      continue
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      inWord = true
      if (end === -1) {
        warnings.push(warn('unterminated-quote', 'A single quote is never closed.'))
        cur += src.slice(i + 1)
        i = n
        continue
      }
      cur += src.slice(i + 1, end)
      i = end + 1
      continue
    }
    if (c === '$' && src[i + 1] === "'") {
      const { value, end } = decodeAnsiC(src, i + 2)
      cur += value
      inWord = true
      if (end >= n) warnings.push(warn('unterminated-quote', "A $'…' quote is never closed."))
      i = end + 1
      continue
    }
    if (c === '$' && src[i + 1] === '"') {
      // $"…" (locale translation) reads like "…".
      i++
      continue
    }
    if (c === '"') {
      inWord = true
      i++
      let closed = false
      while (i < n) {
        const d = src[i]
        if (d === '"') {
          closed = true
          i++
          break
        }
        if (d === '\\' && i + 1 < n) {
          const nx = src[i + 1]
          if (nx === '$' || nx === '`' || nx === '"' || nx === '\\') {
            cur += nx
            i += 2
          } else if (nx === '\n') {
            i += 2
          } else if (nx === '\r' && src[i + 2] === '\n') {
            i += 3
          } else {
            cur += '\\'
            i++
          }
          continue
        }
        if ((d === '$' && EXPANSION_START.test(src[i + 1] ?? '')) || d === '`') noteExpansion(i)
        cur += d
        i++
      }
      if (!closed) warnings.push(warn('unterminated-quote', 'A double quote is never closed.'))
      continue
    }
    if (!inWord && c === '#') {
      // Comment to end of line.
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (
      !inWord &&
      (c === '|' ||
        c === ';' ||
        (c === '&' && (src[i + 1] === '&' || /\s/.test(src[i + 1] ?? ' '))))
    ) {
      warnings.push(
        warn(
          'pipeline-ignored',
          'Everything after the curl command is ignored.',
          src.slice(i).trim(),
        ),
      )
      break
    }
    if (c === '>' && (!inWord || /^\d+$/.test(cur))) {
      // Redirection (`> out`, `2>/dev/null`, `>> log`): drop operator + target.
      cur = ''
      inWord = false
      i++
      while (src[i] === '>' || src[i] === '&') i++
      while (src[i] === ' ' || src[i] === '\t') i++
      while (i < n && !/\s/.test(src[i])) i++
      continue
    }
    if ((c === '$' && EXPANSION_START.test(src[i + 1] ?? '')) || c === '`') noteExpansion(i)
    cur += c
    inWord = true
    i++
  }
  push()
  return { tokens, warnings }
}

// ─── Windows CMD ───────────────────────────────────────────────────────────

/** cmd.exe's own pass — see the module comment. */
function cmdStage1(src: string, warnings: CurlWarning[]): string {
  let out = ''
  let inQ = false
  const n = src.length
  for (let i = 0; i < n; i++) {
    const c = src[i]
    if (c === '"') {
      inQ = !inQ
      out += c
      continue
    }
    if (c === '%' && src[i + 1] === '%') {
      out += '%'
      i++
      continue
    }
    if (c === '\r') continue
    if (inQ) {
      out += c
      continue
    }
    if (c === '^') {
      const nx = src[i + 1]
      if (nx === undefined) break
      if (nx === '\n' || nx === '\r') {
        i += nx === '\r' && src[i + 2] === '\n' ? 2 : 1
        // The first character of the next line is escaped (a LF there is a literal newline).
        const esc = src[i + 1]
        if (esc === undefined) break
        if (esc === '\r' && src[i + 2] === '\n') {
          out += '\n'
          i += 2
        } else {
          out += esc === '\r' ? '\n' : esc
          i++
        }
        continue
      }
      out += nx
      i++
      continue
    }
    if ((c === '&' || c === '|') && (out === '' || /\s$/.test(out))) {
      warnings.push(
        warn(
          'pipeline-ignored',
          'Everything after the curl command is ignored.',
          src.slice(i).trim(),
        ),
      )
      break
    }
    if (c === '\n') {
      out += ' '
      continue
    }
    out += c
  }
  if (inQ) warnings.push(warn('unterminated-quote', 'A double quote is never closed.'))
  return out
}

/** MSVCRT / CommandLineToArgvW argument split (post-2008 rules). */
export function msvcrtSplit(s: string): string[] {
  const args: string[] = []
  let cur = ''
  let inArg = false
  let inQ = false
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      let j = i
      while (s[j] === '\\') j++
      const count = j - i
      inArg = true
      if (s[j] === '"') {
        cur += '\\'.repeat(Math.floor(count / 2))
        if (count % 2 === 1) {
          cur += '"'
          i = j + 1
        } else {
          i = j
        }
      } else {
        cur += '\\'.repeat(count)
        i = j
      }
      continue
    }
    if (c === '"') {
      inArg = true
      if (inQ && s[i + 1] === '"') {
        cur += '"'
        i += 2
        continue
      }
      inQ = !inQ
      i++
      continue
    }
    if (!inQ && (c === ' ' || c === '\t')) {
      if (inArg) args.push(cur)
      cur = ''
      inArg = false
      i++
      continue
    }
    cur += c
    inArg = true
    i++
  }
  if (inArg) args.push(cur)
  return args
}

function tokenizeCmd(src: string): TokenizeResult {
  const warnings: CurlWarning[] = []
  const passed = cmdStage1(src, warnings)
  return { tokens: msvcrtSplit(passed), warnings }
}

// ─── PowerShell ────────────────────────────────────────────────────────────

function psEscape(ch: string): string {
  switch (ch) {
    case '0':
      return '\0'
    case 'a':
      return '\x07'
    case 'b':
      return '\b'
    case 'e':
      return '\x1b'
    case 'f':
      return '\f'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    case 'v':
      return '\v'
    default:
      return ch
  }
}

/** PowerShell treats the typographic quotes as quotes too. */
const isPsSingle = (c: string): boolean => /^['\u2018\u2019\u201A\u201B]$/.test(c)
const isPsDouble = (c: string): boolean => /^["\u201C\u201D\u201E]$/.test(c)

/**
 * What curl.exe receives for a word Windows PowerShell 5.1 passes natively:
 * when EVERY `"` in it is backslash-escaped (the 5.1 workaround form the
 * generator emits), runs of backslashes before a quote are halved the MSVCRT
 * way. A word written for pwsh 7.3+ (`'{"a":1}'`) has bare quotes and is left
 * exactly as typed.
 */
export function psNativeArg(word: string): string {
  if (!word.includes('"')) return word
  const runs = word.match(/\\*"/g) ?? []
  const allEscaped = runs.every((r) => (r.length - 1) % 2 === 1)
  if (!allEscaped) return word
  return word.replace(/(\\+)"/g, (_m, bs: string) => '\\'.repeat(Math.floor(bs.length / 2)) + '"')
}

function tokenizePowershell(src: string): TokenizeResult {
  const tokens: string[] = []
  const warnings: CurlWarning[] = []
  let cur = ''
  let inWord = false
  let expansionWarned = false
  const n = src.length
  const push = (): void => {
    if (inWord) tokens.push(cur)
    cur = ''
    inWord = false
  }
  const noteExpansion = (at: number): void => {
    if (expansionWarned) return
    expansionWarned = true
    warnings.push(
      warn(
        'shell-expansion',
        'Shell variables and command substitutions are kept as typed, never expanded.',
        src.slice(at, at + 24),
      ),
    )
  }
  /** Backtick escapes + `$` detection for the content of a double-quoted string / here-string. */
  const expandDouble = (text: string, offset: number): string => {
    let out = ''
    for (let k = 0; k < text.length; k++) {
      const d = text[k]
      if (d === '`' && k + 1 < text.length) {
        out += psEscape(text[k + 1])
        k++
        continue
      }
      if (d === '$' && EXPANSION_START.test(text[k + 1] ?? '')) noteExpansion(offset + k)
      out += d
    }
    return out
  }
  let i = 0
  while (i < n) {
    const c = src[i]
    if (c === '`') {
      const nx = src[i + 1]
      if (nx === '\n') {
        i += 2
        continue
      }
      if (nx === '\r' && src[i + 2] === '\n') {
        i += 3
        continue
      }
      if (nx === undefined) {
        i++
        continue
      }
      cur += psEscape(nx)
      inWord = true
      i += 2
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      push()
      i++
      continue
    }
    if (!inWord && c === '@' && (src[i + 1] === "'" || src[i + 1] === '"')) {
      const nl = /^[ \t]*\r?\n/.exec(src.slice(i + 2))
      if (nl) {
        const q = src[i + 1]
        const bodyStart = i + 2 + nl[0].length
        const close = new RegExp(`\\r?\\n${q === '"' ? '"' : "'"}@`).exec(src.slice(bodyStart))
        let content: string
        if (close) {
          content = src.slice(bodyStart, bodyStart + close.index)
          i = bodyStart + close.index + close[0].length
        } else {
          warnings.push(warn('unterminated-quote', 'A here-string is never closed.'))
          content = src.slice(bodyStart)
          i = n
        }
        cur += q === '"' ? expandDouble(content, bodyStart) : content
        inWord = true
        continue
      }
    }
    if (isPsSingle(c)) {
      inWord = true
      i++
      let closed = false
      while (i < n) {
        const d = src[i]
        if (isPsSingle(d)) {
          if (isPsSingle(src[i + 1] ?? '')) {
            // A doubled quote is one literal quote (of the kind written first).
            cur += d
            i += 2
            continue
          }
          closed = true
          i++
          break
        }
        cur += d
        i++
      }
      if (!closed) warnings.push(warn('unterminated-quote', 'A single quote is never closed.'))
      continue
    }
    if (isPsDouble(c)) {
      inWord = true
      i++
      let closed = false
      let raw = ''
      const start = i
      while (i < n) {
        const d = src[i]
        if (d === '`' && i + 1 < n) {
          raw += d + src[i + 1]
          i += 2
          continue
        }
        if (isPsDouble(d)) {
          if (isPsDouble(src[i + 1] ?? '')) {
            raw += '`"'
            i += 2
            continue
          }
          closed = true
          i++
          break
        }
        raw += d
        i++
      }
      cur += expandDouble(raw, start)
      if (!closed) warnings.push(warn('unterminated-quote', 'A double quote is never closed.'))
      continue
    }
    if (!inWord && c === '&' && tokens.length === 0) {
      // Call operator: `& curl.exe …` / `& 'C:\…\curl.exe' …`.
      i++
      continue
    }
    if (!inWord && (c === '|' || c === ';')) {
      warnings.push(
        warn(
          'pipeline-ignored',
          'Everything after the curl command is ignored.',
          src.slice(i).trim(),
        ),
      )
      break
    }
    if (c === '$' && EXPANSION_START.test(src[i + 1] ?? '')) noteExpansion(i)
    cur += c
    inWord = true
    i++
  }
  push()
  return { tokens: tokens.map(psNativeArg), warnings }
}
