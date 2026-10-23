/**
 * BASELINE / CHARACTERIZATION — code generation (src/renderer/lib/code-generator.ts).
 *
 * Pins what `generateCode()` emits TODAY for every one of the 11 languages across
 * a matrix of requests. These snapshots are NOT a statement that the output is
 * correct: cases that look wrong are marked `// KNOWN-BUG:` and snapshot the
 * wrong output on purpose, so the upcoming rewrite shows a deliberate diff.
 * When the rewrite fixes a KNOWN-BUG, regenerate the snapshot and review it.
 *
 * Snapshot file: tests/renderer/__snapshots__/baseline-codegen.test.ts.snap
 *
 * KNOWN-BUG summary (each is marked at its case below):
 *  - form-data body (text + file part): only cURL emits `-F`; the other 10
 *    languages DROP the body entirely (bodyString() returns null).
 *  - basic auth: emitted as the literal text `Basic <base64(user:pass)>` instead
 *    of a real base64 value (cURL gets no `-u`).
 *  - api-key in query: the key/value is NOT appended to the URL in any language.
 *  - Python + JSON body: body text is pasted as a Python literal (`payload = {...}`),
 *    so JSON `true` / `false` / `null` are invalid Python (NameError).
 *  - Python/others: no Content-Type header is added for json / urlencoded / text
 *    bodies unless the user typed one; Java/Kotlin/C# derive the media type
 *    only from body.type === 'json' (xml/urlencoded become text/plain).
 *  - `{{var}}` placeholders without envVars stay literal (by design), and in the
 *    URL-encoded param path they are kept readable.
 *  - Go emits deprecated `ioutil`; every language ends with `response.json()` /
 *    `print(response.json())` style code that assumes a JSON response.
 *  - special-chars-and-quotes: the URL is emitted verbatim (spaces / non-ASCII /
 *    quotes unencoded) and table params are appended AFTER the `#frag` fragment
 *    (`...#frag&o'brien=...`), so they are lost/misparsed; PHP double-quoted
 *    strings leave `$HOME` / `${x}` interpolatable.
 *  - Escaping is inconsistent: JS/Java/Go/PHP/Swift/Kotlin/C# use JSON.stringify for
 *    bodies (so `$` in PHP and `\(` in Swift would be interpreted), Ruby/Python use
 *    escapeString; a body containing a newline is emitted as `\n` escapes.
 */
import { describe, it, expect } from 'vitest'
import { generateCode, CODE_LANGUAGES } from '../../src/renderer/lib/code-generator'
import type { CodeGenRequest } from '../../src/renderer/lib/code-generator'
import type { KeyValuePair, CodeLanguage } from '../../src/renderer/types'

let n = 0
function kv(key: string, value: string, extra: Partial<KeyValuePair> = {}): KeyValuePair {
  n += 1
  return { id: `kv-${n}`, key, value, enabled: true, ...extra }
}

interface Case {
  name: string
  req: CodeGenRequest
  options?: Parameters<typeof generateCode>[2]
  /** Documented in the header; the snapshot pins the (wrong) output as-is. */
  knownBug?: string
}

const cases: Case[] = [
  {
    name: 'get-query-headers',
    req: {
      method: 'GET',
      url: 'https://api.example.com/users?active=true',
      params: [
        kv('limit', '10'),
        kv('debug', '1', { enabled: false }),
        kv('active', 'true'), // already in URL -> not duplicated
        kv('q', 'a b&c'),
      ],
      headers: [
        kv('Accept', 'application/json'),
        kv('X-Trace', 'abc'),
        kv('X-Off', 'no', { enabled: false }),
      ],
    },
  },
  {
    name: 'post-json',
    req: {
      method: 'POST',
      url: 'https://api.example.com/users',
      params: [],
      headers: [kv('Content-Type', 'application/json')],
      body: {
        type: 'json',
        content: '{"name":"Ada","admin":true,"manager":null,"tags":["a","b"],"n":1.5}',
      },
    },
    // KNOWN-BUG: Python pastes the JSON as a Python literal -> `true`/`null` are NameErrors.
    knownBug: 'python JSON literal',
  },
  {
    name: 'post-urlencoded',
    req: {
      method: 'POST',
      url: 'https://api.example.com/login',
      params: [],
      headers: [],
      body: {
        type: 'urlencoded',
        urlEncoded: [
          kv('user', 'ada lovelace'),
          kv('pass', 'p&ss=1'),
          kv('skip', 'x', { enabled: false }),
        ],
      },
    },
    // KNOWN-BUG: no Content-Type: application/x-www-form-urlencoded header is added.
    knownBug: 'urlencoded without content-type',
  },
  {
    name: 'post-form-data-text-and-file',
    req: {
      method: 'POST',
      url: 'https://api.example.com/upload',
      params: [],
      headers: [kv('Content-Type', 'multipart/form-data')],
      body: {
        type: 'form-data',
        formData: [
          kv('title', 'My report'),
          kv('file', 'report.pdf', { type: 'file', filePath: '/tmp/report.pdf' }),
        ],
      },
    },
    // KNOWN-BUG: only cURL emits -F; the 10 other languages drop the form-data body entirely.
    knownBug: 'form-data dropped outside curl',
  },
  {
    name: 'put-raw-text',
    req: {
      method: 'PUT',
      url: 'https://api.example.com/notes/1',
      params: [],
      headers: [kv('Content-Type', 'text/plain')],
      body: { type: 'text', content: 'hello world' },
    },
  },
  {
    name: 'auth-basic',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'basic', basic: { username: 'admin', password: 's3cret' } },
    },
    // KNOWN-BUG: Authorization is the literal text `Basic <base64(admin:s3cret)>`, not real base64.
    knownBug: 'basic auth literal',
  },
  {
    name: 'auth-bearer',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'bearer', bearer: { token: 'tok-123' } },
    },
  },
  {
    name: 'auth-bearer-custom-prefix',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'bearer', bearer: { token: 'tok-123', prefix: 'Token' } },
    },
  },
  {
    name: 'auth-apikey-header',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'api-key', apiKey: { key: 'X-API-Key', value: 'key-1', in: 'header' } },
    },
  },
  {
    name: 'auth-apikey-query',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'api-key', apiKey: { key: 'api_key', value: 'key-1', in: 'query' } },
    },
    // KNOWN-BUG: the query api-key is not appended to the URL (and no header either).
    knownBug: 'apikey query dropped',
  },
  {
    name: 'placeholders-unresolved',
    req: {
      method: 'POST',
      url: '{{baseUrl}}/users/{{userId}}?token={{token}}',
      params: [kv('page', '{{page}}')],
      headers: [kv('X-Env', '{{envName}}')],
      body: { type: 'json', content: '{"id":"{{userId}}"}' },
      auth: { type: 'bearer', bearer: { token: '{{token}}' } },
    },
  },
  {
    name: 'placeholders-resolved-with-envvars',
    req: {
      method: 'POST',
      url: '{{baseUrl}}/users/{{userId}}',
      params: [kv('page', '{{page}}')],
      headers: [kv('X-Env', '{{envName}}')],
      body: { type: 'json', content: '{"id":"{{userId}}"}' },
      auth: { type: 'bearer', bearer: { token: '{{token}}' } },
    },
    options: {
      envVars: {
        baseUrl: 'https://api.example.com',
        userId: '42',
        page: '2',
        envName: 'dev',
        token: 'real-secret-token',
      },
      secretNames: new Set(['token']), // secret stays as {{token}} unless includeSecrets
    },
  },
  {
    name: 'special-chars-and-quotes',
    req: {
      method: 'POST',
      url: "https://api.example.com/search/ünï cødé?q=it's \"quoted\"&x=a b#frag",
      params: [kv("o'brien", 'say "hi"')],
      headers: [kv('X-Quote', `it's "mixed" \\ back`)],
      body: {
        type: 'text',
        content: `He said "hello" and it's \\n done $HOME \${x}\nline2 \`tick\``,
      },
    },
    // KNOWN-BUG: unencoded URL + params appended after the fragment; PHP `$HOME` interpolation.
    knownBug: 'url fragment / unencoded url / php dollar',
  },
  {
    name: 'special-chars-json-body-quotes',
    req: {
      method: 'POST',
      url: 'https://api.example.com/echo',
      params: [],
      headers: [kv('Content-Type', 'application/json')],
      body: { type: 'json', content: `{"msg":"it's \\"quoted\\"","path":"C:\\\\tmp"}` },
    },
  },
]

describe('baseline code generation — all languages x request matrix', () => {
  it('covers exactly the 11 languages', () => {
    expect(CODE_LANGUAGES.map((l) => l.id)).toEqual([
      'curl',
      'js-fetch',
      'js-axios',
      'python-requests',
      'java-okhttp',
      'go',
      'php',
      'ruby',
      'swift',
      'kotlin',
      'csharp',
    ])
  })

  for (const c of cases) {
    describe(c.name, () => {
      for (const lang of CODE_LANGUAGES.map((l) => l.id as CodeLanguage)) {
        it(lang, () => {
          expect(generateCode(lang, c.req, c.options)).toMatchSnapshot()
        })
      }
    })
  }

  it('unknown language falls back to a not-supported comment', () => {
    expect(generateCode('cobol' as CodeLanguage, cases[0].req)).toMatchSnapshot()
  })
})
