/**
 * MCP Security Scan (issue #142) — content heuristics over what a server
 * advertises to the model: tool names / titles / descriptions / parameter
 * descriptions, prompt and resource descriptions, server `instructions`.
 *
 * Pure functions, no I/O. They FLAG text for human review (tool poisoning,
 * hidden instructions, shadowing); the checks never fail them above medium.
 */

/** One piece of model-visible text and where it came from. */
export interface TextItem {
  /** e.g. `tool "get_weather" description`. */
  where: string
  text: string
}

export interface Hit {
  where: string
  /** Short, single-line excerpt with invisible characters made visible. */
  excerpt: string
  /** Which rule matched. */
  rule: string
}

// ─── Excerpts ───────────────────────────────────────────────

const INVISIBLE_RANGES: ReadonlyArray<{ from: number; to: number; label: string }> = [
  { from: 0x200b, to: 0x200f, label: 'zero-width / directional mark' },
  { from: 0x2060, to: 0x2060, label: 'word joiner' },
  { from: 0xfeff, to: 0xfeff, label: 'zero-width no-break space' },
  { from: 0x202a, to: 0x202e, label: 'bidi embedding / override' },
  { from: 0x2066, to: 0x2069, label: 'bidi isolate' },
  { from: 0xe0000, to: 0xe007f, label: 'Unicode tag character' },
]

function invisibleLabel(cp: number): string | null {
  for (const r of INVISIBLE_RANGES) if (cp >= r.from && cp <= r.to) return r.label
  return null
}

const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`

/** Replace every hidden character with a visible `<U+200B>` marker. */
export function makeVisible(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    out += invisibleLabel(cp) ? `<${hex(cp)}>` : ch
  }
  return out
}

function excerpt(text: string, index: number, length: number): string {
  const from = Math.max(0, index - 40)
  const to = Math.min(text.length, index + length + 40)
  const body = makeVisible(text.slice(from, to)).replace(/\s+/g, ' ').trim()
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`
}

// ─── instruction_override ───────────────────────────────────

/**
 * `strong` rules are classic tool-poisoning phrasing (fail medium); `weak`
 * ones are imperative wording a benign description can contain (warn medium).
 */
export const INSTRUCTION_RULES: ReadonlyArray<{ id: string; re: RegExp; strong: boolean }> = [
  {
    id: 'ignore-instructions',
    re: /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+)?(previous\s+|prior\s+|above\s+|earlier\s+|preceding\s+|other\s+|existing\s+)?(instructions?|prompts?|rules|directives|guidelines)\b/i,
    strong: true,
  },
  {
    id: 'hide-from-user',
    re: /\b(do\s+not|don'?t|never)\s+(tell|inform|mention|reveal|notify|show|alert)\s+(this\s+(to\s+)?)?(the\s+)?user\b|\bwithout\s+(telling|informing|notifying)\s+the\s+user\b/i,
    strong: true,
  },
  { id: 'system-prompt', re: /\bsystem\s+prompt\b/i, strong: true },
  {
    id: 'pseudo-tag',
    re: /<\s*\/?\s*(important|system|instructions?|secret|admin)\s*>/i,
    strong: true,
  },
  {
    id: 'call-first',
    re: /\balways\s+(call|use|invoke|run)\s+this\s+tool\s+(first|before)\b/i,
    strong: true,
  },
  {
    id: 'before-other-tools',
    re: /\bbefore\s+(using|calling|invoking|running)\s+any\s+other\s+tools?\b/i,
    strong: true,
  },
  { id: 'exfiltrate', re: /\bexfiltrat\w*/i, strong: true },
  {
    id: 'send-to-url',
    re: /\b(send|post|upload|forward)\b[^.\n]{0,80}\bto\s+https?:\/\//i,
    strong: true,
  },
  {
    id: 'sensitive-file',
    re: /(~\/\.ssh|\bid_rsa\b|\/etc\/passwd|\/etc\/shadow|~\/\.aws|\.env\b|mcp\.json\b)/i,
    strong: true,
  },
  { id: 'you-must', re: /\byou\s+must\b/i, strong: false },
]

export function findInstructionOverrides(
  items: readonly TextItem[],
): Array<Hit & { strong: boolean }> {
  const hits: Array<Hit & { strong: boolean }> = []
  for (const item of items) {
    for (const rule of INSTRUCTION_RULES) {
      const m = rule.re.exec(item.text)
      if (m) {
        hits.push({
          where: item.where,
          rule: rule.id,
          strong: rule.strong,
          excerpt: excerpt(item.text, m.index, m[0].length),
        })
      }
    }
  }
  return hits
}

// ─── hidden_unicode ─────────────────────────────────────────

export function findInvisibleChars(text: string): Array<{ codePoint: string; label: string }> {
  const found: Array<{ codePoint: string; label: string }> = []
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    const label = invisibleLabel(cp)
    if (label) found.push({ codePoint: hex(cp), label })
  }
  return found
}

const SCRIPT_TESTS: ReadonlyArray<[string, RegExp]> = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
]

/** Words mixing Latin letters with Cyrillic / Greek / Armenian look-alikes (homoglyphs). */
export function findMixedScriptWords(text: string): string[] {
  const words = text.match(/[\p{L}\p{M}]+/gu) ?? []
  const out: string[] = []
  for (const word of words) {
    const scripts = new Set<string>()
    for (const ch of word) {
      for (const [name, re] of SCRIPT_TESTS) if (re.test(ch)) scripts.add(name)
    }
    if (scripts.has('Latin') && scripts.size > 1 && !out.includes(word)) out.push(word)
  }
  return out
}

export function findHiddenUnicode(items: readonly TextItem[]): {
  invisible: Hit[]
  mixedScript: Hit[]
} {
  const invisible: Hit[] = []
  const mixedScript: Hit[] = []
  for (const item of items) {
    const chars = findInvisibleChars(item.text)
    if (chars.length > 0) {
      const first = [...item.text].findIndex((ch) => invisibleLabel(ch.codePointAt(0) ?? 0))
      const unique = [...new Set(chars.map((c) => `${c.codePoint} (${c.label})`))]
      invisible.push({
        where: item.where,
        rule: unique.join(', '),
        excerpt: excerpt(item.text, Math.max(0, first), 1),
      })
    }
    for (const word of findMixedScriptWords(item.text)) {
      mixedScript.push({ where: item.where, rule: 'mixed-script', excerpt: makeVisible(word) })
    }
  }
  return { invisible, mixedScript }
}

// ─── urls_in_descriptions ───────────────────────────────────

const URL_RE = /\bhttps?:\/\/[^\s"'<>`)\]]+/gi
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g

export function findUrls(text: string): { urls: string[]; ips: string[] } {
  const urls = [...new Set(text.match(URL_RE) ?? [])]
  const ips = [...new Set(text.match(IPV4_RE) ?? [])]
  return { urls, ips }
}

// ─── oversized_description ──────────────────────────────────

export const OVERSIZED_DESCRIPTION_CHARS = 2000

// ─── tool_shadowing ─────────────────────────────────────────

/** Common look-alikes folded onto ASCII (lower case). */
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ɡ: 'g',
  ο: 'o',
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ı: 'i',
  ℓ: 'l',
  '０': '0',
  '１': '1',
}

/** Name folded the way a model / user would confuse it: case, separators, Unicode. */
export function shadowKey(name: string): string {
  let out = ''
  for (const ch of name.normalize('NFKC').toLowerCase()) {
    if (invisibleLabel(ch.codePointAt(0) ?? 0)) continue
    out += CONFUSABLES[ch] ?? ch
  }
  return out.replace(/[\s\-_.:/\\]+/g, '')
}

/** Groups of two or more advertised names that fold to the same key (duplicates included). */
export function findShadowingGroups(names: readonly string[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const key = shadowKey(name)
    groups.set(key, [...(groups.get(key) ?? []), name])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

// ─── secret_like_schema_fields ──────────────────────────────

const SECRET_WORDS = new Set([
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'ssn',
  'cvv',
  'cvc',
  'pin',
  'creditcard',
  'privatekey',
])
const SECRET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['api', 'key'],
  ['access', 'key'],
  ['private', 'key'],
  ['credit', 'card'],
  ['card', 'number'],
  ['social', 'security'],
  ['client', 'secret'],
]
/** A `max_tokens` / `token_count` style parameter is a number, not a credential. */
const NOT_SECRET_WORDS = new Set([
  'max',
  'min',
  'count',
  'limit',
  'num',
  'budget',
  'usage',
  'length',
  'len',
  'total',
  'type',
  'ttl',
  'expires',
  'expiry',
  'policy',
  'strength',
  'hint',
  'reset',
  'name',
])

export function isSecretLikeName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (words.some((w) => NOT_SECRET_WORDS.has(w))) return false
  if (words.some((w) => SECRET_WORDS.has(w))) return true
  for (let i = 0; i + 1 < words.length; i++) {
    if (SECRET_PAIRS.some(([a, b]) => words[i] === a && words[i + 1] === b)) return true
  }
  return false
}

/** Property paths of secret-like parameters that carry no `description`. */
export function findSecretLikeFields(schema: unknown, prefix = '', depth = 0): string[] {
  if (!schema || typeof schema !== 'object' || depth > 6) return []
  const s = schema as Record<string, unknown>
  const out: string[] = []
  if (s.properties && typeof s.properties === 'object') {
    for (const [name, sub] of Object.entries(s.properties as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${name}` : name
      const description =
        sub && typeof sub === 'object' ? (sub as Record<string, unknown>).description : undefined
      if (isSecretLikeName(name) && !(typeof description === 'string' && description.trim())) {
        out.push(path)
      }
      out.push(...findSecretLikeFields(sub, path, depth + 1))
    }
  }
  if (s.items) out.push(...findSecretLikeFields(s.items, `${prefix}[]`, depth + 1))
  return out
}

// ─── disclosure helpers ─────────────────────────────────────

/**
 * Stack traces, file system paths and framework internals in an error body.
 *
 * These run synchronously in the main process on server-controlled text, so
 * every rule must stay linear: no two adjacent quantifiers that can match the
 * same characters, and line-local scans (`[^\n]`) — the first `js-stack`
 * (`\n\s*at\s+[^\n]*\(?[^\s()]+:\d+:\d+`) took minutes on 400 KB of
 * `"\n at " + "a"…`, and the old `.NET` rule (`\(.*\)\s+in\s+.+:line`) was
 * cubic on a repeated `at a() in `.
 */
export const VERBOSE_ERROR_RULES: ReadonlyArray<{ id: string; re: RegExp }> = [
  // `    at fn (/srv/app/x.js:89:19)` / `    at /srv/app/x.js:89:19` on its own line.
  { id: 'js-stack', re: /\n[ \t]*at[ \t][^\n]*?[^\s()]:\d+:\d+/ },
  { id: 'node_modules', re: /node_modules[\\/]/ },
  { id: 'python-traceback', re: /Traceback \(most recent call last\)|File "[^"]+", line \d+/ },
  {
    id: 'java-stack',
    re: /\bat\s+(?:[a-z_$][\w$]*\.)+[A-Z][\w$]*\.[\w$<>]+\([\w$]*\.(?:java|kt|scala):\d+\)|\b(?:java|javax|jakarta)\.[a-z]+\.[A-Z]\w*(?:Exception|Error)\b|\borg\.springframework\./,
  },
  // `   at Ns.Type.Method(String s) in C:\src\File.cs:line 42`
  {
    id: 'dotnet-stack',
    re: /\bat[ \t]+[\w.]+\([^()\n]*\)[ \t]+in[ \t][^\n]{0,300}?:line[ \t]\d+|System\.\w+Exception/,
  },
  { id: 'php-stack', re: /\.php(?::|\s+on\s+line\s+)\d+|PHP (?:Fatal|Warning|Notice)/ },
  {
    id: 'fs-path',
    re: /(?:\/(?:home|Users|usr\/src|var\/www|opt|srv|app)\/[\w.\-/]+|[A-Z]:\\(?:Users|inetpub|Program Files)\\)/,
  },
]

/** Most of a server-controlled body the rules look at — a leak shows in the first lines. */
export const VERBOSE_ERROR_MAX_CHARS = 256 * 1024

export function findVerboseError(text: string): string[] {
  // Bounded input too, so no future rule can block the main process for long.
  const head = text.length > VERBOSE_ERROR_MAX_CHARS ? text.slice(0, VERBOSE_ERROR_MAX_CHARS) : text
  return VERBOSE_ERROR_RULES.filter((r) => r.re.test(head)).map((r) => r.id)
}

/** `serverInfo.version` looking like a build stamp: semver plus a commit hash / build id. */
export function isVerboseVersion(version: string): boolean {
  return (
    /\d+\.\d+\.\d+[-+._][\w.-]*[0-9a-f]{7,}/i.test(version) || /\b[0-9a-f]{12,40}\b/i.test(version)
  )
}
