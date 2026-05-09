/**
 * Regex tester — pure-data layer used by the UI. Compiles a regex with the
 * configured flags, scans the input for matches (with named/numbered group
 * captures + offset spans), and optionally previews the replacement.
 *
 * The compile + run is wrapped in try/catch so invalid patterns surface as
 * a structured error rather than throwing through the renderer.
 */

export type RegexFlag = 'g' | 'i' | 'm' | 's' | 'u' | 'y'
export const REGEX_FLAGS: RegexFlag[] = ['g', 'i', 'm', 's', 'u', 'y']

export interface RegexMatch {
  match: string
  index: number
  /** End index (exclusive). */
  end: number
  groups: { name: string | null; value: string | undefined }[]
}

export type RegexResult =
  | {
      ok: true
      matches: RegexMatch[]
      replaced: string | null
    }
  | { ok: false; error: string }

export interface RunRegexOptions {
  pattern: string
  flags: string
  input: string
  /** When provided, the regex is also used to produce a replaced output. */
  replacement?: string
}

const SCAN_LIMIT = 10000

export function runRegex(opts: RunRegexOptions): RegexResult {
  if (!opts.pattern) return { ok: false, error: 'Pattern is empty.' }
  let re: RegExp
  try {
    // Force /g on for scanning so we can iterate via exec; we also track
    // whether the user asked for /g for the replacement step.
    const userFlags = opts.flags
    const scanFlags = userFlags.includes('g') ? userFlags : userFlags + 'g'
    re = new RegExp(opts.pattern, scanFlags)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const matches: RegexMatch[] = []
  let m: RegExpExecArray | null
  let safety = 0
  while ((m = re.exec(opts.input)) !== null) {
    if (++safety > SCAN_LIMIT) break
    const groups: RegexMatch['groups'] = []
    // Named groups, if any, take precedence in display order
    if (m.groups) {
      for (const [name, value] of Object.entries(m.groups)) {
        groups.push({ name, value })
      }
    }
    // Numbered groups (1..n)
    for (let i = 1; i < m.length; i++) {
      const value = m[i]
      // Avoid duplicating named-group values that already appeared above.
      if (m.groups && Object.values(m.groups).includes(value)) continue
      groups.push({ name: null, value })
    }
    matches.push({
      match: m[0],
      index: m.index,
      end: m.index + m[0].length,
      groups,
    })
    // Avoid infinite loops on zero-width matches
    if (m.index === re.lastIndex) re.lastIndex++
  }

  let replaced: string | null = null
  if (opts.replacement !== undefined) {
    try {
      const replaceFlags = opts.flags.includes('g') ? opts.flags : opts.flags + 'g'
      const replaceRe = new RegExp(opts.pattern, replaceFlags)
      replaced = opts.input.replace(replaceRe, opts.replacement)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return { ok: true, matches, replaced }
}

/** Common regex cheatsheet entries — surfaced in a "Insert pattern" picker. */
export const REGEX_PRESETS: { label: string; pattern: string; flags: string }[] = [
  { label: 'Email (simple)', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+', flags: 'g' },
  { label: 'URL (http/https)', pattern: 'https?://[^\\s]+', flags: 'g' },
  { label: 'IPv4', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: 'g' },
  {
    label: 'UUID',
    pattern: '\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b',
    flags: 'gi',
  },
  {
    label: 'ISO 8601 date',
    pattern: '\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z?)?',
    flags: 'g',
  },
  { label: 'JWT token', pattern: '[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*', flags: 'g' },
  { label: 'Hex color', pattern: '#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\\b', flags: 'gi' },
  { label: 'Phone (intl, loose)', pattern: '\\+?\\d[\\d\\s().-]{6,}\\d', flags: 'g' },
  {
    label: 'Credit card (loose)',
    pattern: '\\b(?:\\d[ -]*?){13,16}\\b',
    flags: 'g',
  },
  { label: 'Whitespace runs', pattern: '\\s+', flags: 'g' },
  { label: 'HTML tag', pattern: '<\\/?[a-z][^>]*>', flags: 'gi' },
]
