/**
 * Issue #247 — the credential PART of a text value (URL, stdio command line,
 * JSON) is blanked in place for the tab snapshot and filled back from the
 * saved text. Pure helpers (`lib/credential-text.ts`); the AI Chat rule of
 * issue #180 (remove, not blank) shares the predicates and keeps its
 * behaviour.
 */
import { describe, expect, it } from 'vitest'
import {
  fillCommandLineCredentials,
  fillJsonCredentials,
  fillUrlCredentials,
  hasLiteralUrlUserinfo,
  scrubCommandLineCredentials,
  scrubJsonCredentials,
  scrubTabCredentials,
  scrubTargetCredentials,
  scrubUrlCredentials,
} from '../../src/renderer/lib/credential-text'
import {
  stripCommandLineCredentials,
  stripUrlCredentials,
} from '../../src/renderer/lib/ai-chat-tools-config'

describe('URL', () => {
  it('blanks credential query values and the userinfo password, keeps the rest', () => {
    const url = 'https://alice:s3cr3t@api.test/v1?page=2&api_key=K-123&accessToken=T-9&q=x#frag'
    const out = scrubUrlCredentials(url)
    expect(out).toBe('https://alice:@api.test/v1?page=2&api_key=&accessToken=&q=x#frag')
    expect(fillUrlCredentials(out, url)).toBe(url)
  })

  it('keeps {{var}} values and non-credential names (author, keyword)', () => {
    const url = '{{base}}/a?token={{tok}}&author=bob&keyword=k'
    expect(scrubUrlCredentials(url)).toBe(url)
  })

  it('a token used as the user name is blanked whole', () => {
    expect(scrubUrlCredentials('https://ghp_abc@github.com/x')).toBe('https://@github.com/x')
    expect(fillUrlCredentials('https://@github.com/x', 'https://ghp_abc@github.com/x')).toBe(
      'https://ghp_abc@github.com/x',
    )
  })

  it('fills only empty slots — an edited path and a bare `token` keep working', () => {
    const saved = 'https://api.test/a?token=T1&x=1'
    // The Params tab rebuilt the URL: `token=` became bare `token`, path edited.
    expect(fillUrlCredentials('https://api.test/b?token&x=2', saved)).toBe(
      'https://api.test/b?token=T1&x=2',
    )
    // A value the user typed is not overwritten.
    expect(fillUrlCredentials('https://api.test/a?token=NEW', saved)).toBe(
      'https://api.test/a?token=NEW',
    )
    // Repeated names pair by occurrence.
    expect(fillUrlCredentials('h://x?key=&key=', 'h://x?key=A&key=B')).toBe('h://x?key=A&key=B')
  })
})

describe('stdio command line', () => {
  const cmd = 'npx -y @scope/server --token abc123 --api-key=K9 --port 8080 https://u:p@db.test/x'
  it('blanks flag values and URL argument credentials', () => {
    const out = scrubCommandLineCredentials(cmd)
    expect(out).toBe('npx -y @scope/server --token "" --api-key= --port 8080 https://u:@db.test/x')
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('K9')
    expect(fillCommandLineCredentials(out, cmd)).toBe(cmd)
  })

  it('leaves a command line without credentials as typed (no re-quoting)', () => {
    const plain = "node  'my server.js' --port 1 --token {{tok}}"
    expect(scrubCommandLineCredentials(plain)).toBe(plain)
  })

  it('target rule: a URL is scrubbed as a URL, a command line as a command line', () => {
    expect(scrubTargetCredentials('https://x.test/?token=a')).toBe('https://x.test/?token=')
    expect(scrubTargetCredentials('srv --password hunter2')).toBe('srv --password ""')
  })
})

describe('JSON text', () => {
  const body =
    '{\n  "user": "alice",\n  "password": "hunter2",\n  "n": {{n}},\n  "nested": { "apiKey": "K" }\n}'
  it('blanks credential-named string members in place, formatting and {{n}} kept', () => {
    const out = scrubJsonCredentials(body)
    expect(out).toBe(
      '{\n  "user": "alice",\n  "password": "",\n  "n": {{n}},\n  "nested": { "apiKey": "" }\n}',
    )
    expect(fillJsonCredentials(out, body)).toBe(body)
  })

  it('an edit elsewhere keeps the fill working; a typed value wins', () => {
    const edited = '{"user":"bob","password":"","apiKey":"mine"}'
    expect(fillJsonCredentials(edited, '{"password":"P","apiKey":"K"}')).toBe(
      '{"user":"bob","password":"P","apiKey":"mine"}',
    )
  })

  it('template-only values and escaped quotes', () => {
    expect(scrubJsonCredentials('{"token":"{{t}}"}')).toBe('{"token":"{{t}}"}')
    expect(scrubJsonCredentials('{"secret":"a\\"b","x":"y"}')).toBe('{"secret":"","x":"y"}')
  })
})

describe('env URL values and tab URLs', () => {
  it('a URL with literal userinfo is a credential value', () => {
    expect(hasLiteralUrlUserinfo('postgres://u:p@db/x')).toBe(true)
    expect(hasLiteralUrlUserinfo('postgres://{{u}}:{{p}}@db/x')).toBe(false)
    expect(hasLiteralUrlUserinfo('https://db/x')).toBe(false)
  })

  it('a tab keeps its identity; only the display url is scrubbed', () => {
    const tab = { id: 't', url: 'https://x.test/?api_key=1' }
    expect(scrubTabCredentials(tab)).toEqual({ id: 't', url: 'https://x.test/?api_key=' })
    const clean = { id: 't', url: 'https://x.test/' }
    expect(scrubTabCredentials(clean)).toBe(clean)
  })
})

describe('AI Chat rule (issue #180) unchanged — it removes, not blanks', () => {
  it('URL and command line', () => {
    expect(stripUrlCredentials('https://u:p@x.test/m?api_key=1&a=2')).toBe('https://x.test/m?a=2')
    expect(stripCommandLineCredentials('srv --token abc --port 1')).toBe('srv --port 1')
  })
})
