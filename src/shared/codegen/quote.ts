/**
 * String literals per language (issue #280) — every variant quotes user text
 * through these, never by hand. The rules pick NON-interpolating forms, so a
 * `$HOME`, `${x}`, `#{x}`, `\(x)` or backtick in a header / body is sent as
 * typed: PHP and Ruby single quotes, Kotlin / Dart `\$`, PowerShell single
 * quotes, bash single quotes (`quoteCurlArg`). No format strings anywhere —
 * `{{name}}` placeholders must stay readable.
 */
import { quoteCurlArg } from '../curl/generate'

const hex = (n: number, w: number): string => n.toString(16).toUpperCase().padStart(w, '0')

/** JavaScript single-quoted literal. */
export function jsString(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (ch === '\\') out += '\\\\'
    else if (ch === "'") out += "\\'"
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (c < 0x20 || c === 0x7f) out += `\\x${hex(c, 2)}`
    else if (c === 0x2028 || c === 0x2029) out += `\\u${hex(c, 4)}`
    else out += ch
  }
  return `'${out}'`
}

/** Python single-quoted literal (same escapes as JS; `\x` is valid there too). */
export const pyString = jsString

export type ControlEscape = 'octal' | 'u4' | 'ubrace' | 'decimal' | 'x2'

export interface CStringOptions {
  /** How a control character is written. */
  control?: ControlEscape
  /** Escape `$` (Kotlin, Dart string templates). */
  dollar?: boolean
  /** Prefix before the opening quote (`@` for Objective-C). */
  prefix?: string
}

function controlEscape(c: number, mode: ControlEscape): string {
  if (mode === 'octal') return `\\${c.toString(8).padStart(3, '0')}`
  if (mode === 'u4') return `\\u${hex(c, 4)}`
  if (mode === 'ubrace') return `\\u{${hex(c, 1)}}`
  if (mode === 'decimal') return `\\${c.toString(10).padStart(3, '0')}`
  return `\\x${hex(c, 2)}`
}

/** Double-quoted C-family literal (C, Objective-C, Java, Go, C#, Kotlin, Swift, Rust, Dart, R, OCaml). */
export function cString(s: string, o: CStringOptions = {}): string {
  const mode = o.control ?? 'u4'
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (ch === '\\') out += '\\\\'
    else if (ch === '"') out += '\\"'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (ch === '$' && o.dollar) out += '\\$'
    else if (c < 0x20 || c === 0x7f) out += controlEscape(c, mode)
    else out += ch
  }
  return `${o.prefix ?? ''}"${out}"`
}

/** Java: octal control escapes (a `\u000a` would be turned into a newline before lexing). */
export const javaString = (s: string): string => cString(s, { control: 'octal' })
export const goString = (s: string): string => cString(s, { control: 'octal' })
export const cLangString = (s: string): string => cString(s, { control: 'octal' })
export const objcString = (s: string): string => cString(s, { control: 'octal', prefix: '@' })
export const csString = (s: string): string => cString(s, { control: 'u4' })
export const kotlinString = (s: string): string => cString(s, { control: 'u4', dollar: true })
export const dartString = (s: string): string => cString(s, { control: 'u4', dollar: true })
export const swiftString = (s: string): string => cString(s, { control: 'ubrace' })
export const rustString = (s: string): string => cString(s, { control: 'ubrace' })
export const rString = (s: string): string => cString(s, { control: 'x2' })
export const ocamlString = (s: string): string => cString(s, { control: 'decimal' })

/**
 * PHP / Ruby single-quoted literal: only `\\` and `\'` are escapes, nothing
 * interpolates, newlines are literal.
 */
export function singleQuotedNoInterp(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}
export const phpString = singleQuotedNoInterp
export const rubyString = singleQuotedNoInterp

/** PowerShell verbatim string: `'` (and the typographic quotes PowerShell accepts) doubled. */
export function psString(s: string): string {
  return `'${s.replace(/['‘’‚‛]/g, (q) => q + q)}'`
}

/** bash single-quoted word (the shared cURL quoting engine). */
export const shString = (s: string): string => quoteCurlArg(s, 'bash')
