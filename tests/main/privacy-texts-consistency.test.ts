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

/**
 * The Security pages once claimed that basic-auth passwords, bearer tokens,
 * OAuth refresh tokens and certificate keys all go through safeStorage and
 * that raw values never reach disk, and that the master password encrypts the
 * database with PBKDF2. None of that is true: Auth-tab credentials are plain
 * text in SQLite (privacy policy, Section 3), there is no keychain on some
 * Linux systems, and the app password is only a scrypt-hashed login gate.
 */
const SECURITY = {
  'website/src/pages/security.astro': read('website/src/pages/security.astro'),
  'website/src/pages/tr/security.astro': read('website/src/pages/tr/security.astro'),
} as const

describe.each(Object.entries(SECURITY))('%s', (_name, raw) => {
  const text = flatten(raw)

  it('does not overclaim what safeStorage covers or that nothing reaches disk', () => {
    expect(text).not.toMatch(/never write to disk|asla diske yazılmaz/i)
    expect(text).not.toMatch(/raw (plaintext|values) never|ham (düz metin|değerler) asla/i)
    expect(text).not.toMatch(/OAuth refresh tokens|OAuth yenileme token/i)
    expect(text).not.toMatch(
      /basic-auth passwords, bearer tokens|temel kimlik doğrulama parolaları, taşıyıcı/i,
    )
    expect(text).not.toMatch(/only encrypted blobs|yalnızca şifreli bloblar/i)
  })

  it('names the secrets that are encrypted and the plain-text exceptions', () => {
    expect(text).toMatch(/Secret-type (environment and global )?variables|Gizli \(secret\) türündeki/i)
    expect(text).toMatch(/Mock MCP bearer/i)
    expect(text).toMatch(/certificate passphrases|sertifika parola/i)
    // No keychain (Linux without libsecret) -> stored unencrypted.
    expect(text).toMatch(
      /without libsecret[^.]*\)[^.]*(unencrypted|without encryption)|libsecret olmayan Linux[^.]*\)[^.]*şifrelenmeden/i,
    )
    // Auth-tab credentials are plain text and travel with exports and git.
    expect(text).toMatch(/Auth tab[\s\S]{0,300}plain text|Auth sekmesine[\s\S]{0,300}düz metin/i)
    expect(text).toMatch(/\{\{secretVar\}\}/)
    // MCP OAuth tokens are memory-only.
    expect(text).toMatch(/MCP OAuth tokens[^.]*memory|MCP OAuth token[^.]*bellek/i)
  })

  it('describes the app password as a scrypt login gate, not database encryption', () => {
    expect(text).not.toMatch(/PBKDF2/i)
    expect(text).not.toMatch(/envelope-encrypt|zarf şifrele/i)
    expect(text).toMatch(/scrypt/i)
    expect(text).toMatch(/does not encrypt the database|veritabanını[^.]*şifrelemez/i)
  })
})
