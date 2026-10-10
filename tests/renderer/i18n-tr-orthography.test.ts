/**
 * Issue #192 — Turkish UI strings must use Turkish letters (ç, ğ, ı, İ, ö, ş, ü).
 *
 * About 110 TR values were written with ASCII substitutes ("Gonder",
 * "Basliklar", "Yanit", "Ileri" …). Nothing flags that: the key exists, the
 * string renders, only a Turkish reader notices. This test scans every TR value
 * for words that are ALWAYS misspelled without their diacritics, so a new
 * ASCII-substituted string fails here instead of shipping.
 *
 * The lists hold only unambiguous misspellings. Words that are also valid
 * without diacritics (istek, iptal, ileri, sertifika, gizli …) are not in the
 * case-insensitive list; the capital-ASCII-I forms (Istek, Iptal, Ileri …) are
 * checked case-sensitively, because a Turkish word never starts with a dotless
 * capital I where the lowercase form is dotted.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setLocale, t } from '../../src/renderer/lib/i18n'

const SRC = readFileSync(resolve(__dirname, '../../src/renderer/lib/i18n.ts'), 'utf8')
const keys = [...new Set([...SRC.matchAll(/^ {4}'([a-zA-Z0-9_.]+)':/gm)].map((m) => m[1]))]

/** ASCII spellings that are never correct Turkish (matched case-insensitively, whole token). */
const FOLDED_MISSPELLINGS = [
  'gonder',
  'gonderin',
  'gonderiliyor',
  'baslik',
  'basliklar',
  'basliklari',
  'yanit',
  'yaniti',
  'govde',
  'govdesi',
  'dogrulama',
  'dogrulamalar',
  'gorsel',
  'esittir',
  'kucuktur',
  'icerir',
  'henuz',
  'kayit',
  'kaydi',
  'kayitlar',
  'kayitlari',
  'kaydir',
  'eslesen',
  'cevrimici',
  'cevrimdisi',
  'uyarilar',
  'calistir',
  'calistiricisi',
  'disari',
  'tiklayin',
  'icin',
  'gormek',
  'lutfen',
  'kaynagi',
  'secin',
  'olustur',
  'olusturun',
  'olusturuluyor',
  'olusturuldu',
  'duzenle',
  'cogalt',
  'tasi',
  'kaldir',
  'etkinlestir',
  'birak',
  'klasor',
  'klasoru',
  'modul',
  'cerez',
  'cerezler',
  'diger',
  'sema',
  'hizli',
  'yardim',
  'onizlemesi',
  'gorunum',
  'gorunumu',
  'aciklama',
  'hakkinda',
  'kullanici',
  'basarisiz',
  'basariyla',
  'sifirdan',
  'sifreli',
  'saklanir',
  'klonlaniyor',
  'klonlansin',
  'yapistir',
  'ozeti',
  'anahtari',
  'adini',
  'dosyasi',
  'dosyasini',
  'orn',
  'tasarim',
  'oncelikli',
  'tum',
]

/** Capital ASCII "I" where Turkish needs "İ" (matched case-sensitively, whole token). */
const DOTLESS_CAPITAL_I = ['Iptal', 'Ileri', 'Istek', 'Iceri', 'Ilk', 'Ikon', 'Ismin', 'Ikisi']

const folded = new Set(FOLDED_MISSPELLINGS)
const capitalI = new Set(DOTLESS_CAPITAL_I)

/** URLs keep ASCII on purpose (e.g. "https://github.com/kullanici/repo.git"). */
const withoutUrls = (text: string): string => text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')

/** Unicode-aware tokens — JS `\b` treats ç/ş/ı as word boundaries. */
const tokens = (text: string): string[] => withoutUrls(text).match(/\p{L}+/gu) ?? []

function misspellings(text: string): string[] {
  return tokens(text).filter((w) => capitalI.has(w) || folded.has(w.toLowerCase()))
}

afterEach(() => setLocale('en'))

describe('TR strings use Turkish letters (issue #192)', () => {
  it('the scanner catches the issue examples', () => {
    expect(misspellings('Gonder')).toEqual(['Gonder'])
    expect(misspellings('Istek Basliklari')).toEqual(['Istek', 'Basliklari'])
    expect(misspellings('Ileri')).toEqual(['Ileri'])
    // Correct Turkish and plain technical text pass.
    expect(misspellings('İstek Başlıkları — Gönder, İleri, iptal, istek')).toEqual([])
    expect(misspellings('https://github.com/kullanici/repo.git')).toEqual([])
  })

  it('no TR value contains an ASCII-substituted Turkish word', () => {
    setLocale('tr')
    expect(keys.length).toBeGreaterThan(1000)
    const offenders = keys
      .map((k) => ({ k, v: t(k), bad: misspellings(t(k)) }))
      .filter((o) => o.bad.length > 0)
      .map((o) => `${o.k}: "${o.v}" → ${o.bad.join(', ')}`)
    expect(offenders, `TR values with ASCII-substituted words:\n${offenders.join('\n')}`).toEqual(
      [],
    )
  })
})
