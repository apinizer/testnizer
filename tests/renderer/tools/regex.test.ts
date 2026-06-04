import { describe, it, expect } from 'vitest'
import { runRegex, REGEX_PRESETS } from '../../../src/renderer/lib/tools/regex'

describe('runRegex — basics', () => {
  it('finds all matches with global flag', () => {
    const r = runRegex({ pattern: '\\d+', flags: 'g', input: 'a1 b22 c333' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches.map((m) => m.match)).toEqual(['1', '22', '333'])
    expect(r.matches[0]).toMatchObject({ index: 1, end: 2 })
  })

  it('returns named-group captures', () => {
    const r = runRegex({
      pattern: '(?<word>\\w+)@(?<host>\\w+)',
      flags: 'g',
      input: 'alice@example bob@test',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.matches[0].groups.find((g) => g.name === 'word')?.value).toBe('alice')
    expect(r.matches[0].groups.find((g) => g.name === 'host')?.value).toBe('example')
  })

  it('returns numbered captures when no named groups', () => {
    const r = runRegex({ pattern: '(\\w+)=(\\d+)', flags: 'g', input: 'a=1 b=2' })
    if (!r.ok) throw new Error(r.error)
    expect(r.matches[0].groups.length).toBe(2)
    expect(r.matches[0].groups[0].value).toBe('a')
    expect(r.matches[0].groups[1].value).toBe('1')
  })

  it('case-insensitive flag', () => {
    const r = runRegex({ pattern: 'hello', flags: 'gi', input: 'Hello HELLO hello' })
    if (!r.ok) throw new Error(r.error)
    expect(r.matches.length).toBe(3)
  })

  it('returns ok:false on invalid regex', () => {
    const r = runRegex({ pattern: '(unclosed', flags: '', input: 'x' })
    expect(r.ok).toBe(false)
  })

  it('rejects empty pattern', () => {
    const r = runRegex({ pattern: '', flags: '', input: 'x' })
    expect(r.ok).toBe(false)
  })
})

describe('runRegex — replacement', () => {
  it('replaces all matches when /g is on', () => {
    const r = runRegex({
      pattern: '\\d+',
      flags: 'g',
      input: 'a1 b22 c333',
      replacement: 'N',
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.replaced).toBe('aN bN cN')
  })

  it('supports backreferences', () => {
    const r = runRegex({
      pattern: '(\\w+) is (\\d+)',
      flags: 'g',
      input: 'foo is 42 bar is 7',
      replacement: '$1=$2',
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.replaced).toBe('foo=42 bar=7')
  })

  it('replaced is null when replacement option is omitted', () => {
    const r = runRegex({ pattern: '\\d+', flags: 'g', input: '42' })
    if (!r.ok) throw new Error(r.error)
    expect(r.replaced).toBeNull()
  })
})

describe('REGEX_PRESETS', () => {
  it('every preset compiles cleanly', () => {
    for (const p of REGEX_PRESETS) {
      const r = runRegex({ pattern: p.pattern, flags: p.flags, input: '' })
      expect(r.ok, `preset "${p.label}" failed: ${!r.ok ? r.error : ''}`).toBe(true)
    }
  })

  it('email preset matches a sample address', () => {
    const email = REGEX_PRESETS.find((p) => p.label.startsWith('Email'))!
    const r = runRegex({ pattern: email.pattern, flags: email.flags, input: 'reach me at foo@bar.baz today' })
    if (!r.ok) throw new Error(r.error)
    expect(r.matches[0].match).toBe('foo@bar.baz')
  })
})
