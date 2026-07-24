/**
 * Unit tests for `src/main/lib/filename-safe.ts`.
 *
 * Issue #71: every export path ran the project/folder/suite name through an
 * ASCII whitelist, so "sağlık_bakanlığı" was suggested as
 * "sa_l_k_bakanl___.json". The replacement keeps letters/digits from any
 * script and strips only what a filesystem actually rejects — these tests
 * pin both halves of that contract, since loosening the filter is only safe
 * if the genuinely-illegal set stays covered.
 */

import { describe, it, expect } from 'vitest'
import { safeFileName } from '../../../src/main/lib/filename-safe'

describe('safeFileName — non-ASCII scripts survive', () => {
  it('round-trips a Turkish name unchanged (issue #71)', () => {
    expect(safeFileName('sağlık_bakanlığı')).toBe('sağlık_bakanlığı')
  })

  it('keeps dotted/dotless i, ş, ç, ö, ü and the uppercase forms', () => {
    expect(safeFileName('İŞÇÖÜĞ ışçöüğ')).toBe('İŞÇÖÜĞ ışçöüğ')
  })

  it('keeps Greek, Cyrillic and CJK', () => {
    expect(safeFileName('δοκιμή')).toBe('δοκιμή')
    expect(safeFileName('проект')).toBe('проект')
    expect(safeFileName('健康保険')).toBe('健康保険')
  })

  it('keeps emoji (legal on APFS/ext4/NTFS — we only strip what breaks)', () => {
    expect(safeFileName('api 🚀 v2')).toBe('api 🚀 v2')
  })

  it('leaves spaces, hyphens, dots and underscores inside the name alone', () => {
    expect(safeFileName('My Project - v1.2_final')).toBe('My Project - v1.2_final')
  })
})

describe('safeFileName — illegal characters', () => {
  it.each([
    ['a/b', 'a_b'],
    ['a\\b', 'a_b'],
    ['a<b', 'a_b'],
    ['a>b', 'a_b'],
    ['a:b', 'a_b'],
    ['a"b', 'a_b'],
    ['a|b', 'a_b'],
    ['a?b', 'a_b'],
    ['a*b', 'a_b'],
    ['a\u0000b', 'a_b'],
    ['a\u001fb', 'a_b'],
    ['a\u007fb', 'a_b'],
  ])('replaces %j', (input, expected) => {
    expect(safeFileName(input)).toBe(expected)
  })

  it('collapses a run of illegal characters into a single underscore', () => {
    expect(safeFileName('a//\\<>:b')).toBe('a_b')
  })

  it('does not collapse underscores the user typed', () => {
    expect(safeFileName('a__b')).toBe('a__b')
  })

  it('cannot produce a path separator (no directory traversal via a name)', () => {
    expect(safeFileName('../../etc/passwd')).not.toMatch(/[/\\]/)
  })
})

describe('safeFileName — edges Windows trims silently', () => {
  it('strips leading dots and spaces', () => {
    expect(safeFileName('  .hidden')).toBe('hidden')
  })

  it('strips trailing dots and spaces', () => {
    expect(safeFileName('report... ')).toBe('report')
  })
})

describe('safeFileName — reserved Windows device names', () => {
  it.each(['CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9'])(
    'prefixes %s so the file can be created',
    (name) => {
      expect(safeFileName(name)).toBe(`_${name}`)
    },
  )

  it('treats the stem before the first dot as the device name', () => {
    expect(safeFileName('nul.json')).toBe('_nul.json')
  })

  it('leaves names that merely start with a device name alone', () => {
    expect(safeFileName('CONSOLE')).toBe('CONSOLE')
    expect(safeFileName('COM10')).toBe('COM10')
  })
})

describe('safeFileName — never returns an empty name', () => {
  it('falls back for an empty string', () => {
    expect(safeFileName('')).toBe('export')
  })

  it('falls back for a whitespace-only name', () => {
    expect(safeFileName('   ')).toBe('export')
  })

  it('falls back for a dots-only name', () => {
    expect(safeFileName('...')).toBe('export')
  })

  it('falls back when the name is nothing but illegal characters', () => {
    expect(safeFileName('<>:"|?*/\\')).toBe('export')
  })

  it('uses the caller-supplied fallback', () => {
    expect(safeFileName('///', 'project')).toBe('project')
  })
})

describe('safeFileName — length cap', () => {
  it('caps at 100 code points', () => {
    const capped = safeFileName('ğ'.repeat(300))
    expect(Array.from(capped)).toHaveLength(100)
  })

  it('counts code points, so an emoji is never split into a lone surrogate', () => {
    const capped = safeFileName('🚀'.repeat(300))
    expect(Array.from(capped)).toHaveLength(100)
    expect(capped).not.toMatch(/[\uD800-\uDFFF]/u)
  })

  it('does not leave a trailing dot/space behind after truncating', () => {
    const capped = safeFileName('a'.repeat(99) + '. tail')
    expect(capped).toBe('a'.repeat(99))
  })

  it('leaves a short name untouched', () => {
    expect(safeFileName('short')).toBe('short')
  })
})

describe('every filename builder shares the sanitiser (issue #71 completeness)', () => {
  it('keystore entry export keeps a Turkish alias', async () => {
    // keystore.ts had its OWN ASCII whitelist feeding a save dialog, so an
    // alias like `imza-anahtarı` was still mangled after the export handlers
    // were fixed. It now delegates here.
    const { sanitizeFileName } = await import('../../../src/main/lib/keystore')
    expect(sanitizeFileName('imza-anahtarı')).toBe('imza-anahtarı')
    expect(sanitizeFileName('şirket/anahtar')).toBe('şirket_anahtar')
    expect(sanitizeFileName('   ')).toBe('entry')
  })
})
