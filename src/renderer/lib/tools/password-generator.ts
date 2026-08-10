/**
 * Password generator — two industry-standard modes:
 *
 *  1. `characters`  — a random string drawn from selectable classes (upper /
 *     lower / digits / symbols) with the usual hardening knobs: exclude
 *     ambiguous look-alikes (0 O o 1 l I | `), exclude arbitrary characters,
 *     require at least one of each selected class, minimum digit/symbol counts,
 *     and no repeated characters.
 *  2. `passphrase`  — a Diceware passphrase built from the EFF large wordlist
 *     (7776 words). Configurable word count, separator, word case and an
 *     optional appended digit.
 *
 * Randomness comes exclusively from the Web Crypto CSPRNG
 * (`crypto.getRandomValues`) with rejection sampling for a bias-free pick.
 * `Math.random()` is never used — it is not cryptographically secure.
 *
 * Pure, browser-safe, no IPC. Mirrors the `uuid.ts` / `hash.ts` conventions:
 * named exports, an options interface with `??` defaults, and a discriminated
 * `{ ok: true; … } | { ok: false; error }` result.
 */

import { EFF_WORDLIST } from './eff-wordlist'

export type PasswordMode = 'characters' | 'passphrase'
export type StrengthLevel = 'very-weak' | 'weak' | 'fair' | 'strong' | 'very-strong'
export type WordCase = 'lower' | 'upper' | 'title'

export const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
export const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const DIGITS = '0123456789'
/** Default symbol pool — includes common punctuation; editable in the UI. */
export const STANDARD_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?/'
/** Look-alike characters removed when `excludeAmbiguous` is on. */
export const AMBIGUOUS_CHARS = '0Oo1lI|`'

export const PASSWORD_LENGTH_MIN = 4
export const PASSWORD_LENGTH_MAX = 256
export const PASSPHRASE_WORDS_MIN = 3
export const PASSPHRASE_WORDS_MAX = 12
export const COUNT_MIN = 1
export const COUNT_MAX = 100

export interface CharacterOptions {
  /** Total password length (clamped to 4–256). */
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
  /** Symbol pool to draw from when `symbols` is on (default STANDARD_SYMBOLS). */
  symbolSet?: string
  /** Remove look-alike characters (0 O o 1 l I | `). */
  excludeAmbiguous: boolean
  /** Additional characters the user wants removed from every class. */
  excludeChars?: string
  /** Guarantee at least one character from every enabled class. */
  requireEachType: boolean
  /** Minimum number of digits (implies `numbers`). */
  minNumbers?: number
  /** Minimum number of symbols (implies `symbols`). */
  minSymbols?: number
  /** Never repeat a character (draws without replacement). */
  noRepeats: boolean
}

/**
 * Where the optional digit goes.
 *
 * `end` appends it to the LAST word, which is what "append" means and what
 * testers expected; `random` keeps the previous behaviour (a random word), which
 * is marginally stronger because the position itself carries entropy.
 */
export type DigitPosition = 'end' | 'random'

export interface PassphraseOptions {
  /** Number of words (clamped to 3–12). */
  wordCount: number
  /** Separator placed between words. */
  separator: string
  wordCase: WordCase
  /** Append a single digit to the passphrase. */
  includeNumber: boolean
  /** Defaults to `end`. */
  digitPosition?: DigitPosition
}

export interface GenerateOptions {
  mode: PasswordMode
  /** How many passwords to produce (clamped to 1–100). */
  count?: number
  characters?: CharacterOptions
  passphrase?: PassphraseOptions
}

export type PasswordResult =
  | { ok: true; passwords: string[]; entropyBits: number; strength: StrengthLevel }
  | { ok: false; error: string }

export const DEFAULT_CHARACTER_OPTIONS: CharacterOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  symbolSet: STANDARD_SYMBOLS,
  excludeAmbiguous: false,
  excludeChars: '',
  requireEachType: true,
  minNumbers: 1,
  minSymbols: 1,
  noRepeats: false,
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  wordCount: 5,
  separator: '-',
  wordCase: 'lower',
  includeNumber: false,
  digitPosition: 'end',
}

// ── secure randomness ──────────────────────────────────────────────────────

/** Unbiased uniform integer in [0, maxExclusive) via CSPRNG rejection sampling. */
function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('secureRandomInt requires a positive integer bound')
  }
  if (maxExclusive === 1) return 0
  // Reject the top slice of the 2^32 space that would skew `% range`.
  const range = maxExclusive
  const threshold = Math.floor(0x100000000 / range) * range
  const buf = new Uint32Array(1)
  let x: number
  do {
    crypto.getRandomValues(buf)
    x = buf[0]
  } while (x >= threshold)
  return x % range
}

/** In-place Fisher–Yates shuffle backed by the CSPRNG. */
function secureShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1)
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, Math.floor(n)))
}

/** Remove excluded/ambiguous characters and de-duplicate a class pool. */
function filterChars(chars: string, o: CharacterOptions): string {
  const exclude = new Set<string>()
  if (o.excludeAmbiguous) for (const c of AMBIGUOUS_CHARS) exclude.add(c)
  if (o.excludeChars) for (const c of o.excludeChars) exclude.add(c)
  const seen = new Set<string>()
  let out = ''
  for (const c of chars) {
    if (exclude.has(c) || seen.has(c)) continue
    seen.add(c)
    out += c
  }
  return out
}

// ── character mode ─────────────────────────────────────────────────────────

interface EnabledClass {
  pool: string
  min: number
}

/** Filtered per-class pools for the currently enabled classes. */
function classPools(opts: CharacterOptions): {
  lower: string
  upper: string
  num: string
  sym: string
} {
  return {
    lower: opts.lowercase ? filterChars(LOWERCASE, opts) : '',
    upper: opts.uppercase ? filterChars(UPPERCASE, opts) : '',
    num: opts.numbers ? filterChars(DIGITS, opts) : '',
    sym: opts.symbols ? filterChars(opts.symbolSet ?? STANDARD_SYMBOLS, opts) : '',
  }
}

/**
 * Number of distinct characters available for the given options. This is the
 * hard ceiling on password length when `noRepeats` is on — the UI uses it to
 * cap the length input so an impossible request can't be submitted.
 */
export function availablePoolSize(opts: CharacterOptions): number {
  const p = classPools(opts)
  return filterChars(p.lower + p.upper + p.num + p.sym, opts).length
}

/**
 * Why this request cannot be satisfied, or `null` if it can.
 *
 * The SAME function the generator throws from, so the form can show the problem
 * while the user is still configuring instead of only after pressing Generate.
 * That mattered for a trap testers walked straight into: `minSymbols` defaults
 * to 1, so simply unchecking Symbols made every Generate fail with "A minimum
 * symbol count requires the Symbols class to be enabled" — a rule the user never
 * knowingly set.
 *
 * Messages are byte-identical to the ones the engine used to throw inline.
 */
export function validateCharacterOptions(opts: CharacterOptions): string | null {
  const length = clamp(opts.length, PASSWORD_LENGTH_MIN, PASSWORD_LENGTH_MAX)
  const minNumbers = Math.max(0, Math.floor(opts.minNumbers ?? 0))
  const minSymbols = Math.max(0, Math.floor(opts.minSymbols ?? 0))

  if (minNumbers > 0 && !opts.numbers) {
    return 'A minimum digit count requires the Numbers class to be enabled.'
  }
  if (minSymbols > 0 && !opts.symbols) {
    return 'A minimum symbol count requires the Symbols class to be enabled.'
  }

  const p = classPools(opts)
  const pools = [p.lower, p.upper, p.num, p.sym].filter((x) => x.length > 0)
  if (pools.length === 0) {
    return 'Select at least one character type (and keep its pool non-empty).'
  }

  const each = opts.requireEachType ? 1 : 0
  let minTotal = 0
  if (p.lower) minTotal += each
  if (p.upper) minTotal += each
  if (p.num) minTotal += Math.max(each, minNumbers)
  if (p.sym) minTotal += Math.max(each, minSymbols)
  if (minTotal > length) {
    return `Length ${length} is too short for the required character rules (need at least ${minTotal}).`
  }

  const unique = availablePoolSize(opts)
  if (opts.noRepeats && length > unique) {
    return `Only ${unique} unique characters available — cannot build a ${length}-char password without repeats.`
  }
  return null
}

/** Generate one character password. Throws `Error` on an impossible request. */
function generateCharacterPassword(opts: CharacterOptions): {
  password: string
  poolSize: number
} {
  const length = clamp(opts.length, PASSWORD_LENGTH_MIN, PASSWORD_LENGTH_MAX)

  const { lower: lowerP, upper: upperP, num: numP, sym: symP } = classPools(opts)

  const minNumbers = Math.max(0, Math.floor(opts.minNumbers ?? 0))
  const minSymbols = Math.max(0, Math.floor(opts.minSymbols ?? 0))

  const classes: EnabledClass[] = []
  const addClass = (pool: string, min: number): void => {
    if (pool.length > 0) classes.push({ pool, min })
  }
  addClass(lowerP, opts.requireEachType ? 1 : 0)
  addClass(upperP, opts.requireEachType ? 1 : 0)
  addClass(numP, Math.max(opts.requireEachType ? 1 : 0, minNumbers))
  addClass(symP, Math.max(opts.requireEachType ? 1 : 0, minSymbols))

  const problem = validateCharacterOptions(opts)
  if (problem) throw new Error(problem)

  const fullPool = filterChars(classes.map((c) => c.pool).join(''), opts)

  const used = new Set<string>()
  const pickFrom = (pool: string): string => {
    let candidates = pool
    if (opts.noRepeats) {
      candidates = ''
      for (const c of pool) if (!used.has(c)) candidates += c
      if (candidates.length === 0) {
        throw new Error('Ran out of unique characters while enforcing "no repeats".')
      }
    }
    const c = candidates[secureRandomInt(candidates.length)]
    if (opts.noRepeats) used.add(c)
    return c
  }

  const chars: string[] = []
  for (const cls of classes) {
    for (let i = 0; i < cls.min; i++) chars.push(pickFrom(cls.pool))
  }
  while (chars.length < length) chars.push(pickFrom(fullPool))

  // Cheap post-condition. The draw above cannot repeat a character, but this is
  // the one property users check by eye and the one they reported as broken, so
  // a future refactor must not be able to weaken it silently.
  if (opts.noRepeats && new Set(chars).size !== chars.length) {
    throw new Error(
      'Internal error: "no repeats" was requested but the result repeats a character.',
    )
  }
  return { password: secureShuffle(chars).join(''), poolSize: fullPool.length }
}

// ── passphrase mode ────────────────────────────────────────────────────────

function applyWordCase(word: string, wordCase: WordCase): string {
  switch (wordCase) {
    case 'upper':
      return word.toUpperCase()
    case 'title':
      return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)
    case 'lower':
    default:
      return word.toLowerCase()
  }
}

function generatePassphrase(opts: PassphraseOptions): string {
  const wordCount = clamp(opts.wordCount, PASSPHRASE_WORDS_MIN, PASSPHRASE_WORDS_MAX)
  const words: string[] = []
  for (let i = 0; i < wordCount; i++) {
    const raw = EFF_WORDLIST[secureRandomInt(EFF_WORDLIST.length)]
    words.push(applyWordCase(raw, opts.wordCase))
  }
  if (opts.includeNumber) {
    // "Append" now means the END by default. It used to always pick a RANDOM
    // word, which testers read as a bug ("the position changes with word case")
    // — it does not depend on case, it is simply re-rolled every time. Random
    // stays available because the position itself carries a little entropy.
    const idx =
      (opts.digitPosition ?? 'end') === 'random' ? secureRandomInt(words.length) : words.length - 1
    words[idx] = words[idx] + String(secureRandomInt(10))
  }
  return words.join(opts.separator)
}

// ── entropy & strength ─────────────────────────────────────────────────────

/**
 * Estimated entropy in bits. Character mode uses the standard
 * `length · log2(poolSize)` approximation (ignoring the small reduction from
 * min-count / no-repeat constraints). Passphrase mode counts word-choice
 * entropy plus the optional appended digit.
 */
export function estimateEntropyBits(opts: GenerateOptions, poolOrWordlistSize: number): number {
  if (poolOrWordlistSize <= 1) return 0
  if (opts.mode === 'passphrase') {
    const p = opts.passphrase ?? DEFAULT_PASSPHRASE_OPTIONS
    const wordCount = clamp(p.wordCount, PASSPHRASE_WORDS_MIN, PASSPHRASE_WORDS_MAX)
    let bits = wordCount * Math.log2(poolOrWordlistSize)
    // A fixed position contributes only the digit; a random one also contributes
    // the choice of word.
    if (p.includeNumber) {
      bits += Math.log2((p.digitPosition ?? 'end') === 'random' ? 10 * wordCount : 10)
    }
    return bits
  }
  const c = opts.characters ?? DEFAULT_CHARACTER_OPTIONS
  const length = clamp(c.length, PASSWORD_LENGTH_MIN, PASSWORD_LENGTH_MAX)
  if (c.noRepeats) {
    // Drawing WITHOUT replacement shrinks the pool by one each time, so the
    // count is a falling factorial rather than pool^length. Reporting the
    // with-replacement figure meant ticking "no repeated characters" left the
    // strength readout completely unchanged — which is exactly what made testers
    // think the option did nothing.
    let bits = 0
    for (let i = 0; i < length && poolOrWordlistSize - i > 1; i++) {
      bits += Math.log2(poolOrWordlistSize - i)
    }
    return bits
  }
  return length * Math.log2(poolOrWordlistSize)
}

export function strengthFromEntropy(bits: number): StrengthLevel {
  if (bits < 28) return 'very-weak'
  if (bits < 40) return 'weak'
  if (bits < 60) return 'fair'
  if (bits < 100) return 'strong'
  return 'very-strong'
}

// ── public entry point ─────────────────────────────────────────────────────

export function generatePasswords(opts: GenerateOptions): PasswordResult {
  const count = clamp(opts.count ?? 1, COUNT_MIN, COUNT_MAX)
  try {
    const passwords: string[] = []
    let poolSize = 1

    if (opts.mode === 'characters') {
      const c = opts.characters ?? DEFAULT_CHARACTER_OPTIONS
      for (let i = 0; i < count; i++) {
        const r = generateCharacterPassword(c)
        passwords.push(r.password)
        poolSize = r.poolSize
      }
    } else if (opts.mode === 'passphrase') {
      const p = opts.passphrase ?? DEFAULT_PASSPHRASE_OPTIONS
      for (let i = 0; i < count; i++) passwords.push(generatePassphrase(p))
      poolSize = EFF_WORDLIST.length
    } else {
      return { ok: false, error: `Unsupported mode "${String(opts.mode)}".` }
    }

    const entropyBits = estimateEntropyBits(opts, poolSize)
    return { ok: true, passwords, entropyBits, strength: strengthFromEntropy(entropyBits) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
