/**
 * Literal credentials INSIDE a text value — a URL, a stdio command line, a
 * JSON document — and the rule that finds them (issues #180, #247).
 *
 * One rule, two uses:
 *   - AI Chat's ad-hoc servers (issue #180, `ai-chat-tools-config.ts`) REMOVE
 *     the credential part before saving;
 *   - the tab snapshots (issue #247, `credential-withhold.ts` `texts`) BLANK it
 *     and put the saved value back after a restart, so the URL bar / command
 *     line / body still shows where the value goes.
 *
 * What counts as a credential part:
 *   - URL userinfo: the password of `user:pass@` (the user name is an
 *     identifier and stays), or the whole userinfo when it has no `:` (a token
 *     used as the user name: `https://ghp_x@github.com`);
 *   - URL query pairs whose NAME is a credential argument name
 *     (`isCredentialArgName`: `api_key`, `token`, `accessToken`, …);
 *   - a stdio flag of that kind and its value (`--token xyz`, `--api-key=xyz`)
 *     and URL arguments of the command line;
 *   - JSON members with such a name whose value is a string
 *     (`"password": "…"`), found lexically — never parsed and re-serialized —
 *     so the text keeps its formatting and `{{var}}` placeholders outside
 *     strings (`{"n": {{n}}}`) do not break it.
 * A value that is only `{{variable}}` references carries no secret and is
 * left as typed.
 *
 * Pure TS — no store imports.
 */
import { isTemplateOnlyValue } from './ai-chat-config'
import { isCredentialArgName } from '../../shared/credential-headers'
import { joinCommandLine, tokenizeCommandLine } from '../../shared/mcp-call'
import type { CredentialText } from './credential-withhold'

/** A non-empty value that is not only `{{var}}` references. */
export const isLiteralText = (v: string): boolean => v.trim() !== '' && !isTemplateOnlyValue(v)

/** A query parameter name as typed or percent-encoded (`api%5Fkey`). */
export function decodeQueryName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

/** `scheme://` + userinfo + `@` at the start of a URL. */
export const URL_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)([^/\s@?#]*)@/i

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const FLAG = /^--?[A-Za-z]/
const INLINE_FLAG = /^(--?[^=\s]+)=(.*)$/

/** `--token`, `-p`, `--api-key` — never `--no-token`. */
export function isCredentialFlag(flag: string): boolean {
  const name = flag.replace(/^-+/, '')
  return FLAG.test(flag) && !/^no-/i.test(name) && isCredentialArgName(name)
}

/** A URL whose userinfo carries a literal credential (`postgres://u:p@h`). */
export function hasLiteralUrlUserinfo(value: string): boolean {
  const ui = URL_USERINFO.exec((value ?? '').trim())
  return !!ui && ui[2].split(':').some(isLiteralText)
}

// ─── Slots ──────────────────────────────────────────────────────────────
// A slot is the place a credential value sits in the text. `key` pairs a slot
// of the live text with the same slot of the saved text (n-th occurrence of
// the same key); `bare` is a query name with no `=` — its value is empty and
// filling it inserts `=value`.

interface Slot {
  key: string
  start: number
  end: number
  bare?: boolean
}

function urlSlots(url: string): Slot[] {
  const slots: Slot[] = []
  const ui = URL_USERINFO.exec(url)
  if (ui) {
    const at = ui[1].length
    const colon = ui[2].indexOf(':')
    if (colon >= 0)
      slots.push({ key: 'userinfo:pass', start: at + colon + 1, end: at + ui[2].length })
    else slots.push({ key: 'userinfo', start: at, end: at + ui[2].length })
  }
  const q = url.indexOf('?')
  if (q < 0) return slots
  const hashAt = url.indexOf('#', q)
  const end = hashAt < 0 ? url.length : hashAt
  let pos = q + 1
  while (pos <= end) {
    let amp = url.indexOf('&', pos)
    if (amp < 0 || amp > end) amp = end
    const pair = url.slice(pos, amp)
    const eq = pair.indexOf('=')
    const name = decodeQueryName(eq < 0 ? pair : pair.slice(0, eq))
    if (name && isCredentialArgName(name)) {
      const key = `q:${name.toLowerCase()}`
      slots.push(
        eq < 0 ? { key, start: amp, end: amp, bare: true } : { key, start: pos + eq + 1, end: amp },
      )
    }
    pos = amp + 1
  }
  return slots
}

/** End index (after the closing quote) of the JSON string opening at `start`; -1 if unterminated. */
function stringEnd(text: string, start: number): number {
  for (let j = start + 1; j < text.length; j++) {
    const c = text[j]
    if (c === '\\') j++
    else if (c === '"') return j + 1
  }
  return -1
}

function skipSpace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}

function jsonSlots(text: string): Slot[] {
  const slots: Slot[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== '"') {
      i++
      continue
    }
    const keyEnd = stringEnd(text, i)
    if (keyEnd < 0) break
    const name = text.slice(i + 1, keyEnd - 1)
    let j = skipSpace(text, keyEnd)
    if (text[j] !== ':') {
      i = keyEnd
      continue
    }
    j = skipSpace(text, j + 1)
    if (text[j] !== '"') {
      i = j
      continue
    }
    const valueEnd = stringEnd(text, j)
    if (valueEnd < 0) break
    if (isCredentialArgName(name)) {
      slots.push({ key: `j:${name.toLowerCase()}`, start: j + 1, end: valueEnd - 1 })
    }
    i = valueEnd
  }
  return slots
}

/** Splice replacements into `text` (slots in ascending, non-overlapping order). */
function splice(text: string, edits: Array<{ slot: Slot; value: string }>): string {
  let out = text
  for (const { slot, value } of [...edits].reverse()) {
    out = out.slice(0, slot.start) + value + out.slice(slot.end)
  }
  return out
}

function scrubSlots(text: string, slots: Slot[]): string {
  const edits = slots
    .filter((s) => !s.bare && isLiteralText(text.slice(s.start, s.end)))
    .map((slot) => ({ slot, value: '' }))
  return edits.length === 0 ? text : splice(text, edits)
}

/** The live text's EMPTY slots take the saved text's value of the same slot. */
function fillSlots(live: string, liveSlots: Slot[], saved: string, savedSlots: Slot[]): string {
  const pool = new Map<string, string[]>()
  for (const s of savedSlots) {
    const list = pool.get(s.key) ?? []
    list.push(s.bare ? '' : saved.slice(s.start, s.end))
    pool.set(s.key, list)
  }
  const seen = new Map<string, number>()
  const edits: Array<{ slot: Slot; value: string }> = []
  for (const slot of liveSlots) {
    const n = seen.get(slot.key) ?? 0
    seen.set(slot.key, n + 1)
    const value = pool.get(slot.key)?.[n]
    if (!value || (!slot.bare && live.slice(slot.start, slot.end) !== '')) continue
    edits.push({ slot, value: slot.bare ? `=${value}` : value })
  }
  return edits.length === 0 ? live : splice(live, edits)
}

// ─── URL ────────────────────────────────────────────────────────────────

/** The URL with its literal credential values blanked (`?api_key=`, `user:@`). */
export function scrubUrlCredentials(url: string): string {
  return scrubSlots(url, urlSlots(url))
}

/** Put the credential values of `saved` back into the blank slots of `live`. */
export function fillUrlCredentials(live: string, saved: string): string {
  return fillSlots(live, urlSlots(live), saved, urlSlots(saved))
}

// ─── JSON text ──────────────────────────────────────────────────────────

/** JSON text with the string values of credential-named members blanked. */
export function scrubJsonCredentials(text: string): string {
  return scrubSlots(text, jsonSlots(text))
}

export function fillJsonCredentials(live: string, saved: string): string {
  return fillSlots(live, jsonSlots(live), saved, jsonSlots(saved))
}

/**
 * A message body that reads as a JSON object or array (`{…}` / `[…]`). The
 * realtime composers (MQTT, WebSocket, Socket.IO, issue #284) default to the
 * `text` format, so the format picker is no guide — the shape of the text is.
 * Base64 / hex never start with a brace or bracket.
 */
export function isJsonLookingText(text: string): boolean {
  const t = (text ?? '').trimStart()
  return t.startsWith('{') || t.startsWith('[')
}

/** `scrubJsonCredentials` for a message body: JSON-looking text only, the rest as typed. */
export function scrubMessageCredentials(text: string): string {
  return isJsonLookingText(text) ? scrubJsonCredentials(text) : text
}

// ─── stdio command line ─────────────────────────────────────────────────

interface TokenSlot {
  key: string
  index: number
  kind: 'inline' | 'next' | 'url'
}

function commandSlots(tokens: string[]): TokenSlot[] {
  const slots: TokenSlot[] = []
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    const inline = INLINE_FLAG.exec(t)
    if (inline) {
      if (isCredentialFlag(inline[1])) {
        slots.push({ key: `f:${inline[1].toLowerCase()}`, index: i, kind: 'inline' })
      }
      continue
    }
    const next = tokens[i + 1]
    if (isCredentialFlag(t) && next !== undefined && !next.startsWith('-')) {
      slots.push({ key: `f:${t.toLowerCase()}`, index: i + 1, kind: 'next' })
      i++
      continue
    }
    if (SCHEME.test(t)) slots.push({ key: 'url', index: i, kind: 'url' })
  }
  return slots
}

function flagValue(token: string, kind: TokenSlot['kind']): string {
  return kind === 'inline' ? (INLINE_FLAG.exec(token)?.[2] ?? '') : token
}

function withFlagValue(token: string, kind: TokenSlot['kind'], value: string): string {
  return kind === 'inline' ? `${INLINE_FLAG.exec(token)?.[1] ?? ''}=${value}` : value
}

function joinTokens(tokens: string[]): string {
  const [command = '', ...args] = tokens
  return joinCommandLine(command, args)
}

/**
 * The command line with literal credential values blanked: `--token ""`,
 * `--api-key=`, URL arguments through `scrubUrlCredentials`. Unchanged text
 * is returned as typed (no re-quoting).
 */
export function scrubCommandLineCredentials(raw: string): string {
  const tokens = tokenizeCommandLine(raw)
  let changed = false
  for (const s of commandSlots(tokens)) {
    const t = tokens[s.index]
    const next =
      s.kind === 'url'
        ? scrubUrlCredentials(t)
        : isLiteralText(flagValue(t, s.kind))
          ? withFlagValue(t, s.kind, '')
          : t
    if (next !== t) {
      tokens[s.index] = next
      changed = true
    }
  }
  return changed ? joinTokens(tokens) : raw
}

export function fillCommandLineCredentials(live: string, saved: string): string {
  const tokens = tokenizeCommandLine(live)
  const savedTokens = tokenizeCommandLine(saved)
  const pool = new Map<string, Array<{ token: string; kind: TokenSlot['kind'] }>>()
  for (const s of commandSlots(savedTokens)) {
    const list = pool.get(s.key) ?? []
    list.push({ token: savedTokens[s.index], kind: s.kind })
    pool.set(s.key, list)
  }
  const seen = new Map<string, number>()
  let changed = false
  for (const s of commandSlots(tokens)) {
    const n = seen.get(s.key) ?? 0
    seen.set(s.key, n + 1)
    const src = pool.get(s.key)?.[n]
    if (!src) continue
    const t = tokens[s.index]
    let next = t
    if (s.kind === 'url') next = fillUrlCredentials(t, src.token)
    else if (flagValue(t, s.kind) === '') {
      const value = flagValue(src.token, src.kind)
      if (value) next = withFlagValue(t, s.kind, value)
    }
    if (next !== t) {
      tokens[s.index] = next
      changed = true
    }
  }
  return changed ? joinTokens(tokens) : live
}

// ─── A connection target: URL or command line ───────────────────────────

/**
 * The request store's `url` and a tab's `url` hold a URL for most protocols
 * and the command line for a stdio MCP server — one rule for both: a value
 * that starts with a URL scheme or a `{{variable}}` is a URL.
 */
function isCommandLine(value: string): boolean {
  const v = value.trim()
  return v !== '' && !SCHEME.test(v) && !v.startsWith('{{') && /\s/.test(v)
}

export function scrubTargetCredentials(value: string): string {
  if (typeof value !== 'string' || value === '') return value
  return isCommandLine(value) ? scrubCommandLineCredentials(value) : scrubUrlCredentials(value)
}

export function fillTargetCredentials(live: string, saved: string): string {
  return isCommandLine(live)
    ? fillCommandLineCredentials(live, saved)
    : fillUrlCredentials(live, saved)
}

/** A tab with no literal credential in its display `url` (same object when clean). */
export function scrubTabCredentials<T extends { url?: string }>(tab: T): T {
  if (!tab || typeof tab.url !== 'string') return tab
  const url = scrubTargetCredentials(tab.url)
  return url === tab.url ? tab : { ...tab, url }
}

// ─── Spec entries (issue #247) ──────────────────────────────────────────

/** A store field holding a URL: `?token=` / `user:pass@` withheld. */
export function urlCredentialText(path: string, source?: string): CredentialText {
  return {
    path,
    source,
    scrub: (v) => scrubUrlCredentials(v),
    fill: (live, saved) => fillUrlCredentials(live, saved),
  }
}

/** A store field holding JSON text: credential-named string members withheld. */
export function jsonCredentialText(path: string, source?: string): CredentialText {
  return {
    path,
    source,
    scrub: (v) => scrubJsonCredentials(v),
    fill: (live, saved) => fillJsonCredentials(live, saved),
  }
}

/**
 * A realtime message body (composer, will payload, saved message, emit
 * argument — issue #284): credential-named string members of JSON-looking
 * text withheld, the format and `{{var}}` placeholders kept. `path` may name
 * list items (`savedMessages[].content`).
 */
export function messageCredentialText(path: string): CredentialText {
  return {
    path,
    scrub: (v) => scrubMessageCredentials(v),
    fill: (live, saved) => fillJsonCredentials(live, saved),
  }
}
