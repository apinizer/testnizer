/**
 * Issue #279 — cURL generation in three shells (`src/shared/curl/generate.ts`)
 * and the generate → parse round trip: every snippet the generator writes
 * must come back through the shared parser as the same request, in every
 * dialect, single- and multi-line, over a matrix of hostile values (quotes,
 * `%`, `&`, `!`, `$`, backticks, unicode, newlines, form-data, auth).
 */
import { describe, expect, it } from 'vitest'
import {
  CURL_DIALECTS,
  generateCurl,
  parseCurl,
  parseCurlAs,
  quoteCurlArg,
  renderCurl,
  type CurlDialect,
  type CurlGenRequest,
  type ParsedCurl,
} from '../../../src/shared/curl'

describe('quoteCurlArg — per-shell rules', () => {
  it("bash: single quotes, ' → '\\''", () => {
    expect(quoteCurlArg(`it's $HOME "x" \`y\` !`, 'bash')).toBe(`'it'\\''s $HOME "x" \`y\` !'`)
  })

  it("PowerShell: single quotes, ' → '', \" → \\\" (5.1 native-arg form), backslashes before a quote doubled", () => {
    expect(quoteCurlArg(`it's $x \`y\``, 'powershell')).toBe(`'it''s $x \`y\`'`)
    expect(quoteCurlArg(`{"a":"x\\"y"}`, 'powershell')).toBe(`'{\\"a\\":\\"x\\\\\\"y\\"}'`)
    expect(quoteCurlArg('C:\\tmp\\', 'powershell')).toBe(`'C:\\tmp\\'`)
    expect(quoteCurlArg('it\u2019s', 'powershell')).toBe(`'it\u2019\u2019s'`)
  })

  it('CMD: plain "…" when safe — & | < > ^ ( ) are literal inside quotes, trailing \\ doubled', () => {
    expect(quoteCurlArg('https://x.test/a?b=1&c=2|3<4>5^6(7)', 'cmd')).toBe(
      '"https://x.test/a?b=1&c=2|3<4>5^6(7)"',
    )
    expect(quoteCurlArg('100% done, %20 encoded', 'cmd')).toBe('"100% done, %20 encoded"')
    expect(quoteCurlArg('C:\\dir\\', 'cmd')).toBe('"C:\\dir\\\\"')
  })

  it('CMD: the caret form for a quote, a %name% pair, %% or a newline', () => {
    expect(quoteCurlArg('{"a":"x & y"}', 'cmd')).toBe('^"{\\^"a\\^":\\^"x ^& y\\^"}^"')
    expect(quoteCurlArg('%PATH%', 'cmd')).toBe('^"%^PATH%^"')
    expect(quoteCurlArg('50%%', 'cmd')).toBe('^"50%^%^"')
    expect(quoteCurlArg('a\nb', 'cmd')).toBe('^"a^\n\nb^"')
  })
})

describe('renderCurl — layout', () => {
  const args = [
    { flag: '-X', value: 'POST', literal: true },
    { value: 'https://x.test' },
    { flag: '-H', value: 'A: b' },
  ]
  it('multi-line uses each shell continuation as the last character of the line', () => {
    expect(renderCurl(args, { inline: 2 })).toBe(`curl -X POST 'https://x.test' \\\n  -H 'A: b'`)
    expect(renderCurl(args, { inline: 2, dialect: 'cmd' })).toBe(
      `curl -X POST "https://x.test" ^\n  -H "A: b"`,
    )
    expect(renderCurl(args, { inline: 2, dialect: 'powershell' })).toBe(
      "curl.exe -X POST 'https://x.test' `\n  -H 'A: b'",
    )
  })

  it('single line joins with spaces', () => {
    expect(renderCurl(args, { inline: 2, multiLine: false, dialect: 'powershell' })).toBe(
      "curl.exe -X POST 'https://x.test' -H 'A: b'",
    )
  })

  it('inline: 0 puts every argument on its own line (export:curl layout)', () => {
    expect(renderCurl(args)).toBe(`curl \\\n  -X POST \\\n  'https://x.test' \\\n  -H 'A: b'`)
  })
})

describe('generateCurl — request → arguments', () => {
  it('-u for basic, --digest / --ntlm, --data-raw for an @-body, --form-string, -k', () => {
    const out = generateCurl({
      method: 'POST',
      url: 'https://x.test',
      headers: [],
      user: { username: 'CORP\\bob', password: 'p:w', scheme: 'ntlm' },
      body: { kind: 'raw', content: '@not-a-file' },
      insecure: true,
    })
    expect(out).toBe(
      `curl -X POST 'https://x.test' \\\n  -u 'CORP\\bob:p:w' \\\n  --ntlm \\\n  --data-raw '@not-a-file' \\\n  -k`,
    )
    expect(
      generateCurl({
        method: 'POST',
        url: 'u.test',
        headers: [],
        body: {
          kind: 'form',
          parts: [
            { key: 'a', value: 'x;type=y' },
            { key: 'f', value: 'a.png', filePath: '/tmp/a.png' },
          ],
        },
      }),
    ).toBe(`curl -X POST 'u.test' \\\n  --form-string 'a=x;type=y' \\\n  -F 'f=@/tmp/a.png'`)
  })
})

// ─── Round trip ─────────────────────────────────────────────────────────

const MATRIX: Array<{ name: string; req: CurlGenRequest }> = [
  {
    name: 'query with & and percent-encoding',
    req: { method: 'GET', url: 'https://x.test/a?b=1&c=a%20b&d=%E2%82%AC', headers: [] },
  },
  {
    name: 'quotes in headers and a JSON body with \\" and a Windows path',
    req: {
      method: 'POST',
      url: 'https://api.example.com/echo',
      headers: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'X-Quote', value: `it's "mixed" \\ back` },
      ],
      body: { kind: 'raw', content: `{"msg":"it's \\"quoted\\"","path":"C:\\\\tmp"}` },
    },
  },
  {
    name: 'percent forms: %PATH%, %%, 100%, %name without a closing %',
    req: {
      method: 'PUT',
      url: 'https://x.test/p?v=%PATH%',
      headers: [{ key: 'X-P', value: '100% of %%USERNAME%% and %HOME' }],
      body: { kind: 'raw', content: 'a=%ProgramFiles(x86)%&b=50%' },
    },
  },
  {
    name: 'cmd metacharacters & | < > ^ ( ) next to quotes',
    req: {
      method: 'POST',
      url: 'https://x.test/m',
      headers: [{ key: 'X-M', value: 'a&b|c<d>e^f(g)' }],
      body: { kind: 'raw', content: `{"a":"x & y","b":"1 | 2","c":"<tag>","d":"^up^","e":"(p)"}` },
    },
  },
  {
    name: 'shell expansion characters stay literal: ! $ ${} backticks',
    req: {
      method: 'POST',
      url: 'https://x.test/$path?q=!bang',
      headers: [{ key: 'X-S', value: '$HOME ${x} `whoami` !! $(id)' }],
      body: { kind: 'raw', content: 'echo $HOME ${x} `tick` !history $(cmd)' },
    },
  },
  {
    name: 'unicode, typographic quotes and emoji',
    req: {
      method: 'POST',
      url: 'https://x.test/ünï/cødé?q=日本',
      headers: [{ key: 'X-U', value: 'it\u2019s \u201Cquoted\u201D — çğıİöşü 🚀' }],
      body: { kind: 'raw', content: '{"name":"Çağrı \u2018x\u2019","e":"🚀"}' },
    },
  },
  {
    name: 'newlines in a pretty-printed body',
    req: {
      method: 'POST',
      url: 'https://x.test/n',
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: { kind: 'raw', content: '{\n  "a": "line1",\n  "b": "it\'s \\"x\\""\n}\n' },
    },
  },
  {
    name: 'form-data: text, file with a Windows path, text with ; and @',
    req: {
      method: 'POST',
      url: 'https://x.test/up',
      headers: [],
      body: {
        kind: 'form',
        parts: [
          { key: 'title', value: `My "report" & it's 100%` },
          { key: 'file', value: 'a.txt', filePath: 'C:\\Users\\me\\a b.txt' },
          { key: 'semi', value: 'x;type=text/plain' },
          { key: 'at', value: '@literal' },
        ],
      },
    },
  },
  {
    name: 'basic auth with quotes and colons in the password',
    req: {
      method: 'GET',
      url: 'https://x.test/secure',
      headers: [],
      user: { username: "o'brien", password: `p:"w"&%PATH%!` },
    },
  },
  {
    name: 'digest + ntlm-with-domain + -k',
    req: {
      method: 'DELETE',
      url: 'https://x.test/d',
      headers: [],
      user: { username: 'CORP\\bob', password: 'pw', scheme: 'ntlm' },
      insecure: true,
    },
  },
  {
    name: 'binary body and a trailing backslash value',
    req: {
      method: 'POST',
      url: 'https://x.test/bin',
      headers: [{ key: 'X-Dir', value: 'C:\\dir\\' }],
      body: { kind: 'binary', path: 'C:\\data\\payload.bin' },
    },
  },
  {
    name: '{{var}} placeholders',
    req: {
      method: 'POST',
      url: '{{baseUrl}}/users/{{id}}',
      headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
      body: { kind: 'raw', content: '{"id":"{{id}}"}' },
    },
  },
]

/** The request as the parser sees it, in a comparable shape. */
function view(p: ParsedCurl): unknown {
  return {
    method: p.method,
    url: p.url,
    headers: p.headers,
    body: p.data.length > 0 ? p.body : undefined,
    binary: p.data.length === 1 && p.data[0].file !== undefined ? p.data[0].file : undefined,
    form: p.form.map((f) => ({
      key: f.name,
      value: f.kind === 'file' ? undefined : f.value,
      path: f.path,
    })),
    user: p.user,
    scheme: p.authScheme,
    insecure: p.insecure,
  }
}

function expected(req: CurlGenRequest): unknown {
  const b = req.body
  return {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: b?.kind === 'raw' ? b.content : b?.kind === 'binary' ? `@${b.path}` : undefined,
    binary: b?.kind === 'binary' ? b.path : undefined,
    form:
      b?.kind === 'form'
        ? b.parts.map((p) => ({
            key: p.key,
            value: p.filePath ? undefined : p.value,
            path: p.filePath,
          }))
        : [],
    user: req.user ? { username: req.user.username, password: req.user.password } : undefined,
    scheme: req.user?.scheme,
    insecure: req.insecure ?? false,
  }
}

describe('generate → parse round trip (all dialects × single / multi-line)', () => {
  for (const dialect of CURL_DIALECTS) {
    for (const multiLine of [true, false]) {
      describe(`${dialect} ${multiLine ? 'multi-line' : 'single-line'}`, () => {
        for (const c of MATRIX) {
          it(c.name, () => {
            const text = generateCurl(c.req, { dialect, multiLine })
            const forced = parseCurlAs(text, dialect)
            // A binary body is an `@file` reference — reported, never read.
            const fileRefs = c.req.body?.kind === 'binary' ? ['file-reference'] : []
            expect(forced.warnings.map((w) => w.code)).toEqual(fileRefs)
            expect(view(forced)).toEqual(expected(c.req))
            if (multiLine) {
              // Auto-detection recognises the shell from its own continuation.
              const auto = parseCurl(text)
              expect(auto.dialect).toBe(dialect)
              expect(view(auto)).toEqual(expected(c.req))
            }
          })
        }
      })
    }
  }

  it('single-line bash and PowerShell snippets are auto-detected too', () => {
    for (const d of ['bash', 'powershell'] as CurlDialect[]) {
      const text = generateCurl(MATRIX[1].req, { dialect: d, multiLine: false })
      expect(parseCurl(text).dialect).toBe(d)
      expect(view(parseCurl(text))).toEqual(expected(MATRIX[1].req))
    }
  })
})
