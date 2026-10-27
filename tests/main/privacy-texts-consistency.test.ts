/**
 * The privacy policy exists three times: docs/legal/privacy-policy.md (shown
 * in the consent gate) and the website pages in EN and TR. They drifted twice
 * (secret variables were still "plain text" on the website after issue #239;
 * MQTT was missing). This keeps them saying the same things the code does.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

const TEXTS = {
  'docs/legal/privacy-policy.md': read('docs/legal/privacy-policy.md'),
  'website/src/pages/privacy.astro': read('website/src/pages/privacy.astro'),
  'website/src/pages/tr/privacy.astro': read('website/src/pages/tr/privacy.astro'),
} as const

/** Plain text with tags and markdown emphasis removed, whitespace collapsed. */
function flatten(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
}

/** Sentences (split on ". ") that start with or contain the phrase. */
function sentencesWith(text: string, phrase: RegExp): string[] {
  return flatten(text)
    .split(/(?<=\.)\s/)
    .filter((s) => phrase.test(s))
}

const SECRET_VARIABLES = /secret-type variables|gizli \(secret\) türündeki değişkenler/i
const PLAIN = /plain text|düz metin|not encrypted|şifrelenmez/i
const KEYCHAIN = /safeStorage|keychain|anahtarlık/i

describe.each(Object.entries(TEXTS))('%s', (_name, raw) => {
  it('mentions MQTT in the outgoing traffic, stream data and History wording', () => {
    const text = flatten(raw)
    expect(text).toMatch(/Socket\.IO, MQTT, MCP\)/)
    expect(text).toMatch(/WebSocket, Socket\.IO,? (and|ve) MQTT (messages|mesajları)/)
    expect(text).toMatch(/MQTT/)
    // History keeps the connection, never the password or the messages.
    expect(text).toMatch(/MQTT[^.]*(client id|istemci kimliği)/i)
  })

  it('says a Socket.IO v2 token goes out as a token query parameter', () => {
    const text = flatten(raw)
    expect(text).toMatch(/Socket\.IO (version|sürüm) 2/)
    expect(text).toMatch(/`?token`? (query parameter|sorgu parametresi)|token query parameter/)
  })

  it('says the MQTT password and Socket.IO token are saved with the request', () => {
    expect(flatten(raw)).toMatch(/\{\{secretVar\}\}/)
  })

  it('never claims secret variables are stored as plain text without the keychain', () => {
    const sentences = sentencesWith(raw, SECRET_VARIABLES)
    expect(sentences.length).toBeGreaterThan(0)
    for (const s of sentences) {
      // A sentence naming secret variables may not call them plain text, and
      // must not be the old "…and credentials typed into an Auth tab are not
      // encrypted" lump; Auth-tab values are their own sentence.
      expect(PLAIN.test(s) && !KEYCHAIN.test(s), s).toBe(false)
      expect(/auth sekmesine|auth tab/i.test(s) && PLAIN.test(s), s).toBe(false)
    }
    // And the encryption claim is made somewhere for them.
    expect(flatten(raw)).toMatch(
      /(Secret-type variables|Gizli \(secret\) türündeki değişkenler)[^|]*?(safeStorage|encrypted|şifrelen)/i,
    )
  })
})
