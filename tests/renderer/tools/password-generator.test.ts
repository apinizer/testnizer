import { describe, it, expect } from 'vitest'
import {
  generatePasswords,
  availablePoolSize,
  estimateEntropyBits,
  strengthFromEntropy,
  DEFAULT_CHARACTER_OPTIONS,
  DEFAULT_PASSPHRASE_OPTIONS,
  AMBIGUOUS_CHARS,
  type CharacterOptions,
  type PassphraseOptions,
} from '../../../src/renderer/lib/tools/password-generator'
import { EFF_WORDLIST } from '../../../src/renderer/lib/tools/eff-wordlist'

function chars(overrides: Partial<CharacterOptions> = {}): CharacterOptions {
  return { ...DEFAULT_CHARACTER_OPTIONS, ...overrides }
}
function phrase(overrides: Partial<PassphraseOptions> = {}): PassphraseOptions {
  return { ...DEFAULT_PASSPHRASE_OPTIONS, ...overrides }
}

describe('password-generator — character mode', () => {
  it('produces a password of the requested length', () => {
    const r = generatePasswords({ mode: 'characters', characters: chars({ length: 24 }) })
    if (!r.ok) throw new Error(r.error)
    expect(r.passwords).toHaveLength(1)
    expect(r.passwords[0]).toHaveLength(24)
  })

  it('clamps length to the 4–256 range', () => {
    const short = generatePasswords({ mode: 'characters', characters: chars({ length: 1 }) })
    const long = generatePasswords({ mode: 'characters', characters: chars({ length: 9999 }) })
    if (!short.ok || !long.ok) throw new Error('expected ok')
    expect(short.passwords[0]).toHaveLength(4)
    expect(long.passwords[0]).toHaveLength(256)
  })

  it('restricts the pool to the enabled class (lowercase only)', () => {
    const r = generatePasswords({
      mode: 'characters',
      characters: chars({
        length: 40,
        lowercase: true,
        uppercase: false,
        numbers: false,
        symbols: false,
        requireEachType: false,
        minNumbers: 0,
        minSymbols: 0,
      }),
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.passwords[0]).toMatch(/^[a-z]+$/)
  })

  it('excludes ambiguous look-alikes', () => {
    const r = generatePasswords({
      mode: 'characters',
      characters: chars({ length: 200, excludeAmbiguous: true }),
    })
    if (!r.ok) throw new Error(r.error)
    for (const c of AMBIGUOUS_CHARS) expect(r.passwords[0]).not.toContain(c)
  })

  it('honours excludeChars', () => {
    const r = generatePasswords({
      mode: 'characters',
      characters: chars({
        length: 200,
        excludeChars: 'abcABC',
        symbols: false,
        numbers: false,
        minNumbers: 0,
        minSymbols: 0,
      }),
    })
    if (!r.ok) throw new Error(r.error)
    for (const c of 'abcABC') expect(r.passwords[0]).not.toContain(c)
  })

  it('guarantees at least one of each class when requireEachType is on', () => {
    for (let i = 0; i < 20; i++) {
      const r = generatePasswords({
        mode: 'characters',
        characters: chars({
          length: 8,
          requireEachType: true,
          minNumbers: 0,
          minSymbols: 0,
          symbolSet: '!@#',
          excludeAmbiguous: false,
        }),
      })
      if (!r.ok) throw new Error(r.error)
      const pw = r.passwords[0]
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/[0-9]/)
      expect(pw).toMatch(/[!@#]/)
    }
  })

  it('enforces minimum digit and symbol counts', () => {
    for (let i = 0; i < 20; i++) {
      const r = generatePasswords({
        mode: 'characters',
        characters: chars({ length: 30, minNumbers: 4, minSymbols: 3, symbolSet: '!@#$%' }),
      })
      if (!r.ok) throw new Error(r.error)
      const pw = r.passwords[0]
      expect((pw.match(/[0-9]/g) ?? []).length).toBeGreaterThanOrEqual(4)
      expect((pw.match(/[!@#$%]/g) ?? []).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('never repeats a character when noRepeats is on', () => {
    const r = generatePasswords({
      mode: 'characters',
      characters: chars({ length: 30, noRepeats: true }),
    })
    if (!r.ok) throw new Error(r.error)
    const pw = r.passwords[0]
    expect(new Set(pw).size).toBe(pw.length)
  })

  it('fails when no character class is selected', () => {
    const r = generatePasswords({
      mode: 'characters',
      characters: chars({
        lowercase: false,
        uppercase: false,
        numbers: false,
        symbols: false,
        minNumbers: 0,
        minSymbols: 0,
      }),
    })
    expect(r.ok).toBe(false)
  })

  it('fails when noRepeats length exceeds the unique pool', () => {
    const r = generatePasswords({
      mode: 'characters',
      characters: chars({
        length: 40,
        noRepeats: true,
        lowercase: true,
        uppercase: false,
        numbers: false,
        symbols: false,
        requireEachType: false,
        minNumbers: 0,
        minSymbols: 0,
      }),
    })
    expect(r.ok).toBe(false) // only 26 unique lowercase letters
  })

  it('fails when the required minimums exceed the length', () => {
    const r = generatePasswords({
      mode: 'characters',
      characters: chars({ length: 4, minNumbers: 3, minSymbols: 3 }),
    })
    expect(r.ok).toBe(false)
  })

  it('generates the requested count of distinct passwords', () => {
    const r = generatePasswords({
      mode: 'characters',
      count: 25,
      characters: chars({ length: 24 }),
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.passwords).toHaveLength(25)
    expect(new Set(r.passwords).size).toBe(25)
  })

  it('clamps count to the 1–100 range', () => {
    const r = generatePasswords({ mode: 'characters', count: 9999, characters: chars() })
    if (!r.ok) throw new Error(r.error)
    expect(r.passwords).toHaveLength(100)
  })
})

describe('password-generator — passphrase mode', () => {
  it('produces the requested number of words from the EFF list', () => {
    const wordSet = new Set(EFF_WORDLIST)
    const r = generatePasswords({
      mode: 'passphrase',
      passphrase: phrase({ wordCount: 6, separator: '-', wordCase: 'lower' }),
    })
    if (!r.ok) throw new Error(r.error)
    const words = r.passwords[0].split('-')
    expect(words).toHaveLength(6)
    for (const w of words) expect(wordSet.has(w)).toBe(true)
  })

  it('respects a custom separator', () => {
    const r = generatePasswords({
      mode: 'passphrase',
      passphrase: phrase({ wordCount: 4, separator: '.' }),
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.passwords[0].split('.')).toHaveLength(4)
  })

  it('applies title case', () => {
    const r = generatePasswords({
      mode: 'passphrase',
      passphrase: phrase({ wordCount: 5, separator: '-', wordCase: 'title' }),
    })
    if (!r.ok) throw new Error(r.error)
    for (const w of r.passwords[0].split('-')) expect(w[0]).toMatch(/[A-Z0-9]/)
  })

  it('appends a digit when includeNumber is on', () => {
    let sawDigit = false
    for (let i = 0; i < 30 && !sawDigit; i++) {
      const r = generatePasswords({
        mode: 'passphrase',
        passphrase: phrase({ wordCount: 4, includeNumber: true }),
      })
      if (!r.ok) throw new Error(r.error)
      if (/[0-9]/.test(r.passwords[0])) sawDigit = true
    }
    expect(sawDigit).toBe(true)
  })

  it('clamps word count to 3–12', () => {
    const few = generatePasswords({ mode: 'passphrase', passphrase: phrase({ wordCount: 1 }) })
    const many = generatePasswords({ mode: 'passphrase', passphrase: phrase({ wordCount: 99 }) })
    if (!few.ok || !many.ok) throw new Error('expected ok')
    expect(few.passwords[0].split('-')).toHaveLength(3)
    expect(many.passwords[0].split('-')).toHaveLength(12)
  })
})

describe('password-generator — availablePoolSize (no-repeats ceiling)', () => {
  it('shrinks when ambiguous look-alikes are excluded', () => {
    const withAmb = availablePoolSize(chars({ excludeAmbiguous: false }))
    const without = availablePoolSize(chars({ excludeAmbiguous: true }))
    expect(without).toBeLessThan(withAmb)
    expect(without).toBeGreaterThan(0)
  })

  it('is the exact max no-repeats length that still succeeds', () => {
    const opts = chars({
      excludeAmbiguous: true,
      noRepeats: true,
      requireEachType: false,
      minNumbers: 0,
      minSymbols: 0,
    })
    const pool = availablePoolSize(opts)
    const atLimit = generatePasswords({ mode: 'characters', characters: { ...opts, length: pool } })
    const overLimit = generatePasswords({
      mode: 'characters',
      characters: { ...opts, length: pool + 1 },
    })
    expect(atLimit.ok).toBe(true)
    expect(overLimit.ok).toBe(false)
  })
})

describe('password-generator — entropy & strength', () => {
  it('maps entropy bits to strength buckets', () => {
    expect(strengthFromEntropy(20)).toBe('very-weak')
    expect(strengthFromEntropy(35)).toBe('weak')
    expect(strengthFromEntropy(50)).toBe('fair')
    expect(strengthFromEntropy(80)).toBe('strong')
    expect(strengthFromEntropy(150)).toBe('very-strong')
  })

  it('reports higher entropy for longer character passwords', () => {
    const short = estimateEntropyBits({ mode: 'characters', characters: chars({ length: 8 }) }, 90)
    const long = estimateEntropyBits({ mode: 'characters', characters: chars({ length: 32 }) }, 90)
    expect(long).toBeGreaterThan(short)
  })

  it('returns a strong-or-better verdict for the default character options', () => {
    const r = generatePasswords({ mode: 'characters', characters: chars() })
    if (!r.ok) throw new Error(r.error)
    expect(r.entropyBits).toBeGreaterThan(60)
    expect(['strong', 'very-strong']).toContain(r.strength)
  })
})

describe('EFF wordlist', () => {
  it('contains exactly 7776 unique lowercase words', () => {
    expect(EFF_WORDLIST).toHaveLength(7776)
    expect(new Set(EFF_WORDLIST).size).toBe(7776)
    for (const w of EFF_WORDLIST.slice(0, 100)) expect(w).toMatch(/^[a-z0-9]+$/)
  })
})
