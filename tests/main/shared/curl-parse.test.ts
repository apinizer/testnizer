/**
 * Issue #279 — the shared cURL tokenizer + parser (`src/shared/curl/`), per
 * dialect: bash / POSIX, Windows CMD (cmd.exe pass + MSVCRT argv split) and
 * PowerShell (backticks, `''`, here-strings, `curl.exe`, 5.1 `\"`). The
 * importer (`import:curl`) and the URL-bar paste (issue #278) both run this.
 */
import { describe, expect, it } from 'vitest'
import {
  curlToRequest,
  detectDialect,
  looksLikeCurl,
  msvcrtSplit,
  parseCurl,
  parseCurlAs,
  psNativeArg,
  startsWithCurl,
  stripPrompt,
  tokenizeShell,
  type CurlRequest,
} from '../../../src/shared/curl'

let n = 0
const req = (cmd: string): CurlRequest =>
  curlToRequest(parseCurl(cmd), { makeId: () => `id${++n}` })
const headers = (cmd: string): string[] => req(cmd).headers.map((h) => `${h.key}: ${h.value}`)
const codes = (cmd: string): string[] => parseCurl(cmd).warnings.map((w) => w.code)
const tokens = (cmd: string, d: 'bash' | 'cmd' | 'powershell'): string[] =>
  tokenizeShell(cmd, d).tokens

describe('bash / POSIX tokenizer', () => {
  it("single quotes are verbatim and '\\'' embeds a quote", () => {
    expect(tokens(`curl -H 'X: it'\\''s $HOME \\n' u`, 'bash')).toEqual([
      'curl',
      '-H',
      `X: it's $HOME \\n`,
      'u',
    ])
  })

  it('double quotes escape only $ ` " \\ and newline', () => {
    expect(tokens(`curl -d "a\\"b \\$x \\\\ \\t"`, 'bash')).toEqual(['curl', '-d', 'a"b $x \\ \\t'])
  })

  it("$'…' ANSI-C quoting decodes escapes (\\n, \\t, \\x41, \\u00e9, octal)", () => {
    expect(tokens(`curl -d $'a\\nb\\tc\\x41\\u00e9\\101\\''`, 'bash')).toEqual([
      'curl',
      '-d',
      "a\nb\tcAéA'",
    ])
  })

  it('backslash-newline (LF and CRLF) continues; bare newlines are whitespace', () => {
    expect(tokens(`curl \\\n  -X POST \\\r\n  u\n  -k`, 'bash')).toEqual([
      'curl',
      '-X',
      'POST',
      'u',
      '-k',
    ])
  })

  it('unquoted backslash escapes the next character', () => {
    expect(tokens(`curl a\\ b\\&c`, 'bash')).toEqual(['curl', 'a b&c'])
  })

  it('$VAR / $(…) / backticks stay literal with one warning', () => {
    const r = tokenizeShell(`curl -H "Authorization: Bearer $TOKEN" $(echo u) \`x\``, 'bash')
    expect(r.tokens).toEqual(['curl', '-H', 'Authorization: Bearer $TOKEN', '$(echo', 'u)', '`x`'])
    expect(r.warnings.map((w) => w.code)).toEqual(['shell-expansion'])
  })

  it('pipes, ; and && end the command; redirections are dropped', () => {
    expect(tokens(`curl u -o x > out.json 2>/dev/null | jq .`, 'bash')).toEqual([
      'curl',
      'u',
      '-o',
      'x',
    ])
    expect(codes(`curl https://x.test && echo done`)).toContain('pipeline-ignored')
  })

  it('an unterminated quote takes the rest and warns', () => {
    const r = tokenizeShell(`curl -d 'abc`, 'bash')
    expect(r.tokens).toEqual(['curl', '-d', 'abc'])
    expect(r.warnings.map((w) => w.code)).toEqual(['unterminated-quote'])
  })
})

describe('Windows CMD tokenizer (cmd.exe pass + MSVCRT argv)', () => {
  it('Chrome "Copy as cURL (cmd)" form: ^" quotes, ^ continuation, \\^" inner quotes', () => {
    const cmd = [
      'curl ^"https://x.test/a?b=1^&c=2^" ^',
      '  -H ^"Content-Type: application/json^" ^',
      '  --data-raw ^"^{^\\^"name^\\^":^\\^"A ^& B^\\^"^}^" ^',
      '  --compressed',
    ].join('\r\n')
    expect(tokens(cmd, 'cmd')).toEqual([
      'curl',
      'https://x.test/a?b=1&c=2',
      '-H',
      'Content-Type: application/json',
      '--data-raw',
      '{"name":"A & B"}',
      '--compressed',
    ])
  })

  it('plain "…" quoting with \\" and "" inside', () => {
    expect(tokens(`curl -d "{\\"a\\":\\"x\\"}" -H "Say ""hi"""`, 'cmd')).toEqual([
      'curl',
      '-d',
      '{"a":"x"}',
      '-H',
      'Say "hi"',
    ])
  })

  it('Windows paths keep their backslashes; a backslash run before a quote halves', () => {
    expect(tokens(`curl -F "f=@C:\\tmp\\a.txt" "C:\\dir\\\\"`, 'cmd')).toEqual([
      'curl',
      '-F',
      'f=@C:\\tmp\\a.txt',
      'C:\\dir\\',
    ])
  })

  it('%% collapses (batch file); %^name and ^% reach curl as %', () => {
    expect(tokens(`curl "https://x.test/a%%20b" ^"%^PATH%^" a^%b`, 'cmd')).toEqual([
      'curl',
      'https://x.test/a%20b',
      '%PATH%',
      'a%b',
    ])
  })

  it('^ + LF + LF is a literal newline (caret escapes the line end)', () => {
    expect(tokens(`curl -d ^"line1^\n\nline2^"`, 'cmd')).toEqual(['curl', '-d', 'line1\nline2'])
  })

  it('msvcrtSplit follows the 2n / 2n+1 backslash rule', () => {
    expect(msvcrtSplit(`a\\\\"b c" d\\"e f\\\\\\"g`)).toEqual(['a\\b c', 'd"e', 'f\\"g'])
  })
})

describe('PowerShell tokenizer', () => {
  it("backtick continuation, '' inside single quotes, curl.exe", () => {
    const ps = "curl.exe 'https://x.test/a' `\n  -H 'X: it''s' `\r\n  -X PUT"
    expect(tokens(ps, 'powershell')).toEqual([
      'curl.exe',
      'https://x.test/a',
      '-H',
      "X: it's",
      '-X',
      'PUT',
    ])
  })

  it('double quotes: backtick escapes and ""; $var stays literal (warning)', () => {
    const r = tokenizeShell('curl.exe -H "A: `"q`" ""x"" `t $env:TOKEN"', 'powershell')
    expect(r.tokens).toEqual(['curl.exe', '-H', 'A: "q" "x" \t $env:TOKEN'])
    expect(r.warnings.map((w) => w.code)).toEqual(['shell-expansion'])
  })

  it('here-strings @\'…\'@ (verbatim) and @"…"@', () => {
    const ps = `curl.exe -d @'\n{"a": "$x"}\nline2\n'@ -H @"\nA: \`"b\`"\n"@ u`
    expect(tokens(ps, 'powershell')).toEqual([
      'curl.exe',
      '-d',
      '{"a": "$x"}\nline2',
      '-H',
      'A: "b"',
      'u',
    ])
  })

  it('the & call operator and a quoted curl.exe path', () => {
    expect(tokens(`& 'C:\\Program Files\\curl\\curl.exe' https://x.test`, 'powershell')).toEqual([
      'C:\\Program Files\\curl\\curl.exe',
      'https://x.test',
    ])
    expect(parseCurl(`& 'C:\\Program Files\\curl\\curl.exe' https://x.test`).url).toBe(
      'https://x.test',
    )
  })

  it('the Windows PowerShell 5.1 \\" form is unescaped; a 7.3-style bare quote is kept', () => {
    expect(tokens(`curl.exe -d '{\\"a\\":\\"x\\\\\\"y\\"}'`, 'powershell')[2]).toBe('{"a":"x\\"y"}')
    expect(tokens(`curl.exe -d '{"path":"C:\\\\"}'`, 'powershell')[2]).toBe('{"path":"C:\\\\"}')
    expect(psNativeArg('no quotes \\ here')).toBe('no quotes \\ here')
  })
})

describe('prompt + dialect detection', () => {
  it('strips $ / % / > / PS> / PS C:\\…> / C:\\…> prompts', () => {
    expect(stripPrompt('$ curl u').text).toBe('curl u')
    expect(stripPrompt('% curl u').text).toBe('curl u')
    expect(stripPrompt('> curl u').text).toBe('curl u')
    expect(stripPrompt('PS> curl.exe u')).toEqual({ text: 'curl.exe u', hint: 'powershell' })
    expect(stripPrompt('PS C:\\Users\\me> curl.exe u')).toEqual({
      text: 'curl.exe u',
      hint: 'powershell',
    })
    expect(stripPrompt('C:\\Users\\me>curl u')).toEqual({ text: 'curl u', hint: 'cmd' })
  })

  it('scores the shell from its continuation and quoting signals', () => {
    expect(detectDialect(`curl 'u' \\\n -H 'a: b'`)).toBe('bash')
    expect(detectDialect(`curl ^"u^" ^\n -H ^"a: b^"`)).toBe('cmd')
    expect(detectDialect("curl.exe 'u' `\n -H 'a: b'")).toBe('powershell')
    expect(detectDialect('& curl.exe u')).toBe('powershell')
    expect(detectDialect('curl https://x.test')).toBe('bash')
  })

  it('falls back to another dialect when the detected one finds no URL', () => {
    // No continuation signal at all, but only CMD reads ^" as a quote.
    const p = parseCurl('curl -H ^"A: 1^" ^"https://x.test^"')
    expect(p.dialect).toBe('cmd')
    expect(p.url).toBe('https://x.test')
  })
})

describe('looksLikeCurl / startsWithCurl', () => {
  it.each([
    ['curl https://x.test', true],
    ['curl -X POST {{base}}/a', true],
    ['  $ curl localhost:3000/a', true],
    ['curl.exe -H "a: b" x.test', true],
    ['& curl.exe https://x.test', true],
    ["PS C:\\> curl.exe 'https://x.test'", true],
    ['C:\\work>curl "https://x.test"', true],
    ['curl\n  https://x.test', true],
    ['https://x.test/curl', false],
    ['curl', false],
    ['curl is great', false],
    ['curling https://x.test', false],
    ['wget https://x.test', false],
    ['', false],
  ])('looksLikeCurl(%j) → %s', (text, expected) => {
    expect(looksLikeCurl(text)).toBe(expected)
  })

  it('startsWithCurl accepts `curl` + anything (the importer then reports a missing URL)', () => {
    expect(startsWithCurl('curl -X POST')).toBe(true)
    expect(startsWithCurl('curl')).toBe(true)
    expect(startsWithCurl('wget u')).toBe(false)
  })
})

describe('option syntax', () => {
  it('glued short values, clustered booleans, --opt=value, -- end of options', () => {
    const r = req(`curl -sSLkXPUT -H'A: 1' --header=B:2 -m3 -- https://x.test`)
    expect(r.method).toBe('PUT')
    expect(r.url).toBe('https://x.test')
    expect(headers(`curl -sSLkXPUT -H'A: 1' --header=B:2 -m3 -- https://x.test`)).toEqual([
      'A: 1',
      'B: 2',
    ])
    expect(r.settings).toEqual({ sslVerification: false, followRedirects: true, timeout: 3000 })
  })

  it('value-taking flags never leak their value into the URL', () => {
    const cmd = `curl -o out.txt -w '%{http_code}' --cacert ca.pem --cert c.pem --key k.pem -x http://p:1 -T up.bin -D h.txt -c jar https://x.test/a`
    const p = parseCurl(cmd)
    expect(p.url).toBe('https://x.test/a')
    expect(p.warnings.filter((w) => w.code === 'unsupported-flag').map((w) => w.arg)).toEqual([
      '--cacert',
      '--cert',
      '--key',
      '-x',
    ])
  })

  it('unknown flags warn and never swallow the URL', () => {
    const p = parseCurl('curl --frobnicate https://x.test -%')
    expect(p.url).toBe('https://x.test')
    expect(p.warnings.map((w) => [w.code, w.arg])).toEqual([
      ['unknown-flag', '--frobnicate'],
      ['unknown-flag', '-%'],
    ])
  })

  it('an unknown flag with a value: the URL-looking word still wins', () => {
    const p = parseCurl('curl --new-thing value https://x.test')
    expect(p.url).toBe('https://x.test')
    expect(p.warnings.map((w) => w.code)).toEqual(['unknown-flag', 'ignored-arg'])
  })

  it('--url, extra URLs, --next and --no-<bool>', () => {
    const p = parseCurl(
      'curl https://a.test --url https://b.test --no-location -L --no-insecure --next https://c.test',
    )
    expect(p.url).toBe('https://b.test')
    expect(p.followRedirects).toBe(true)
    expect(p.insecure).toBe(false)
    expect(p.warnings.map((w) => w.code)).toEqual(['next-ignored', 'extra-url'])
  })

  it('a value-taking flag at the end is reported', () => {
    expect(codes('curl https://x.test -H')).toEqual(['missing-value'])
  })
})

describe('request semantics', () => {
  it('-G with --data-urlencode appends the encoded data to the query', () => {
    const r = req(`curl -G https://x.test/s?a=1 --data-urlencode 'q=a b&c' -d n=2`)
    expect(r.method).toBe('GET')
    expect(r.url).toBe('https://x.test/s?a=1&q=a%20b%26c&n=2')
    expect(r.params.map((p) => [p.key, p.value])).toEqual([
      ['a', '1'],
      ['q', 'a%20b%26c'],
      ['n', '2'],
    ])
  })

  it('--data-urlencode forms: content, =content, name=content, name@file', () => {
    const p = parseCurl(
      `curl --data-urlencode 'a b' --data-urlencode '=x&y' --data-urlencode 'k=v/w' --data-urlencode 'f@data.txt' u.test`,
    )
    expect(p.data.map((d) => d.value)).toEqual(['a%20b', 'x%26y', 'k=v%2Fw', 'f@data.txt'])
    expect(p.warnings.map((w) => [w.code, w.arg])).toEqual([['file-reference', 'data.txt']])
  })

  it('-I is HEAD, -I with data and no -G drops the data with a warning', () => {
    expect(req('curl -I https://x.test').method).toBe('HEAD')
    const r = req('curl -I -d a=1 https://x.test')
    expect(r.method).toBe('HEAD')
    expect(r.body.type).toBe('none')
    expect(r.warnings.map((w) => w.code)).toEqual(['head-with-data'])
  })

  it('-T file is PUT with a binary body (not read)', () => {
    const r = req('curl -T ./big.iso https://x.test/up')
    expect(r.method).toBe('PUT')
    expect(r.body).toEqual({ type: 'binary', binaryPath: './big.iso' })
    expect(r.warnings.map((w) => w.code)).toEqual(['file-reference'])
  })

  it('-u + --digest / --ntlm (DOMAIN\\user), --oauth2-bearer', () => {
    expect(req('curl -u a:b --digest u.test').auth).toEqual({
      type: 'digest',
      digest: { username: 'a', password: 'b' },
    })
    expect(req(`curl --ntlm -u 'CORP\\bob:pw' u.test`).auth).toEqual({
      type: 'ntlm',
      ntlm: { username: 'bob', password: 'pw', domain: 'CORP' },
    })
    expect(req('curl -u a:b --basic u.test').auth?.type).toBe('basic')
    expect(req('curl --oauth2-bearer tok123 u.test').auth).toEqual({
      type: 'bearer',
      bearer: { token: 'tok123' },
    })
  })

  it('cookies (-b) join into one Cookie header; a cookie FILE warns', () => {
    expect(headers(`curl -b 'a=1' -b 'b=2' -b jar.txt u.test`)).toEqual(['Cookie: a=1; b=2'])
    expect(codes(`curl -b jar.txt u.test`)).toEqual(['cookie-file'])
  })

  it('-A, -e (;auto stripped), --compressed', () => {
    expect(headers(`curl -A 'ua/1' -e 'https://r.test;auto' --compressed u.test`)).toEqual([
      'User-Agent: ua/1',
      'Referer: https://r.test',
      'Accept-Encoding: deflate, gzip, br',
    ])
  })

  it('-F: file with ;type= and ;filename=, quoted value, --form-string keeps @ literal', () => {
    const r = req(
      `curl -F 'doc=@/tmp/a b.pdf;type=application/pdf;filename=r.pdf' -F 'n="x;y"' --form-string 'raw=@not-a-file' u.test`,
    )
    expect(r.body.formData).toEqual([
      {
        id: expect.any(String),
        key: 'doc',
        value: 'r.pdf',
        enabled: true,
        type: 'file',
        filePath: '/tmp/a b.pdf',
      },
      { id: expect.any(String), key: 'n', value: 'x;y', enabled: true, type: 'text' },
      { id: expect.any(String), key: 'raw', value: '@not-a-file', enabled: true, type: 'text' },
    ])
  })

  it('body type: Content-Type first, then JSON / XML / k=v sniffing; never "raw"', () => {
    expect(req(`curl -d '{"a":1}' u.test`).body.type).toBe('json')
    expect(headers(`curl -d '{"a":1}' u.test`)).toEqual([])
    expect(req(`curl -d '<a/>' u.test`).body.type).toBe('xml')
    expect(req(`curl -d 'hello world' u.test`).body).toEqual({
      type: 'text',
      content: 'hello world',
    })
    expect(headers(`curl -d 'hello world' u.test`)).toEqual([
      'Content-Type: application/x-www-form-urlencoded',
    ])
    expect(req(`curl -H 'Content-Type: text/html' -d '<p/>' u.test`).body.type).toBe('html')
    expect(req(`curl -H 'content-type: application/vnd.api+json' -d 'x' u.test`).body.type).toBe(
      'json',
    )
    expect(req(`curl -d '{"id":"{{id}}"}' u.test`).body.type).toBe('json')
    expect(req(`curl -d 'a=b+c&d=%41' u.test`).body.urlEncoded?.map((r) => r.value)).toEqual([
      'b c',
      'A',
    ])
  })

  it('custom methods the editor cannot select fall back with a warning', () => {
    const r = req('curl -X PURGE https://x.test')
    expect(r.method).toBe('GET')
    expect(r.warnings.map((w) => [w.code, w.arg])).toEqual([['unsupported-method', 'PURGE']])
  })

  it('{{var}} placeholders survive in every dialect', () => {
    for (const d of ['bash', 'cmd', 'powershell'] as const) {
      const p = parseCurlAs(`curl -H "X: {{tok}}" "{{base}}/a"`, d)
      expect(p.url).toBe('{{base}}/a')
      expect(p.headers).toEqual([{ key: 'X', value: '{{tok}}' }])
    }
  })
})
