import { describe, it, expect } from 'vitest'
import {
  parseCurlCommand,
  exportAsCurl,
  tokenizeCurl,
} from '../../src/main/ipc/import-export.handler'

// ─── Tokenizer basics ──────────────────────────────────────

describe('tokenizeCurl', () => {
  it('tokenizes simple curl with single-quoted url', () => {
    expect(tokenizeCurl(`curl 'https://api.example.com/users'`)).toEqual([
      'curl',
      'https://api.example.com/users',
    ])
  })

  it('keeps spaces inside single-quoted values intact', () => {
    expect(
      tokenizeCurl(`curl -H 'X-Custom: hello world with spaces' https://x`),
    ).toEqual(['curl', '-H', 'X-Custom: hello world with spaces', 'https://x'])
  })

  it('handles double-quoted values', () => {
    expect(tokenizeCurl(`curl -H "X: a b c" https://x`)).toEqual([
      'curl',
      '-H',
      'X: a b c',
      'https://x',
    ])
  })

  it('handles escaped quote inside double quotes', () => {
    expect(tokenizeCurl(`curl -d "a\\"b"`)).toEqual(['curl', '-d', 'a"b'])
  })
})

// ─── Basic GET ─────────────────────────────────────────────

describe('parseCurlCommand: basic forms', () => {
  it('parses bare GET', () => {
    const r = parseCurlCommand(`curl https://api.example.com/users`)
    expect(r.method).toBe('GET')
    expect(r.url).toBe('https://api.example.com/users')
    expect(r.headers).toEqual({})
    expect(r.body).toBeUndefined()
  })

  it('-X custom method', () => {
    const r = parseCurlCommand(`curl -X DELETE https://api.example.com/u/1`)
    expect(r.method).toBe('DELETE')
    expect(r.url).toBe('https://api.example.com/u/1')
  })

  it('--request long form', () => {
    const r = parseCurlCommand(`curl --request PATCH https://x/y`)
    expect(r.method).toBe('PATCH')
  })
})

// ─── Body flags ────────────────────────────────────────────

describe('parseCurlCommand: body flags', () => {
  it('-d sets body and changes method to POST', () => {
    const r = parseCurlCommand(`curl -d 'a=1&b=2' https://x`)
    expect(r.method).toBe('POST')
    expect(r.body).toBe('a=1&b=2')
  })

  it('--data-raw preserves content', () => {
    const r = parseCurlCommand(`curl --data-raw '{"name":"john"}' https://x`)
    expect(r.method).toBe('POST')
    expect(r.body).toBe('{"name":"john"}')
  })

  it('--data-binary keeps body', () => {
    const r = parseCurlCommand(`curl --data-binary 'raw stuff' https://x`)
    expect(r.body).toBe('raw stuff')
  })

  it('--data-urlencode appends and sets Content-Type', () => {
    const r = parseCurlCommand(
      `curl --data-urlencode 'q=hello world' --data-urlencode 'p=v' https://x`,
    )
    expect(r.method).toBe('POST')
    expect(r.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(r.body).toBe('q=hello world&p=v')
  })
})

// ─── Headers / aliases ─────────────────────────────────────

describe('parseCurlCommand: headers', () => {
  it('-H multiple headers', () => {
    const r = parseCurlCommand(
      `curl -H 'Accept: application/json' -H 'X-Trace: 123' https://x`,
    )
    expect(r.headers['Accept']).toBe('application/json')
    expect(r.headers['X-Trace']).toBe('123')
  })

  it('--header long form', () => {
    const r = parseCurlCommand(`curl --header 'Accept: text/plain' https://x`)
    expect(r.headers['Accept']).toBe('text/plain')
  })

  it('-A sets User-Agent (likely unhandled)', () => {
    const r = parseCurlCommand(`curl -A 'MyAgent/1.0' https://x`)
    // Expectation: header should be set; bug if missing
    expect(r.headers['User-Agent']).toBe('MyAgent/1.0')
  })

  it('-e sets Referer (likely unhandled)', () => {
    const r = parseCurlCommand(`curl -e 'https://ref.example' https://x`)
    expect(r.headers['Referer']).toBe('https://ref.example')
  })
})

// ─── Auth ──────────────────────────────────────────────────

describe('parseCurlCommand: auth', () => {
  it('-u user:pass produces basic auth', () => {
    const r = parseCurlCommand(`curl -u alice:secret https://x`)
    expect(r.auth).toEqual({
      type: 'basic',
      basic: { username: 'alice', password: 'secret' },
    })
  })

  it('--user long form', () => {
    const r = parseCurlCommand(`curl --user 'bob:pw' https://x`)
    expect(r.auth?.basic?.username).toBe('bob')
    expect(r.auth?.basic?.password).toBe('pw')
  })

  it('Authorization Bearer header is preserved verbatim', () => {
    const r = parseCurlCommand(
      `curl -H 'Authorization: Bearer abc.def.ghi' https://x`,
    )
    expect(r.headers['Authorization']).toBe('Bearer abc.def.ghi')
  })
})

// ─── Cookies ───────────────────────────────────────────────

describe('parseCurlCommand: cookies', () => {
  it('-b sets cookies', () => {
    const r = parseCurlCommand(`curl -b 'session=abc; user=42' https://x`)
    expect(r.cookies).toBe('session=abc; user=42')
  })

  it('--cookie long form', () => {
    const r = parseCurlCommand(`curl --cookie 'a=b' https://x`)
    expect(r.cookies).toBe('a=b')
  })
})

// ─── Multipart -F ──────────────────────────────────────────

describe('parseCurlCommand: multipart -F', () => {
  it('captures text fields', () => {
    const r = parseCurlCommand(
      `curl -F 'name=John' -F 'age=30' https://x/upload`,
    )
    expect(r.method).toBe('POST')
    expect(r.headers['Content-Type']).toBe('multipart/form-data')
    expect(r.body).toContain('name=John')
    expect(r.body).toContain('age=30')
  })

  it('captures @file path', () => {
    const r = parseCurlCommand(
      `curl -F 'file=@/tmp/data.bin' -F 'desc=hello' https://x/upload`,
    )
    expect(r.body).toContain('file=@/tmp/data.bin')
    expect(r.body).toContain('desc=hello')
  })
})

// ─── TLS / network flags ───────────────────────────────────

describe('parseCurlCommand: misc flags', () => {
  it('-k / --insecure marks insecure', () => {
    expect(parseCurlCommand(`curl -k https://x`).insecure).toBe(true)
    expect(parseCurlCommand(`curl --insecure https://x`).insecure).toBe(true)
  })

  it('--compressed should not break parsing', () => {
    const r = parseCurlCommand(`curl --compressed https://x/y`)
    expect(r.url).toBe('https://x/y')
  })

  it('--proxy / -x value is consumed (no leak as URL)', () => {
    const r = parseCurlCommand(`curl --proxy http://proxy:8080 https://x/y`)
    expect(r.url).toBe('https://x/y')
  })

  it('--location / -L should not break parsing', () => {
    const r = parseCurlCommand(`curl -L https://x/y`)
    expect(r.url).toBe('https://x/y')
  })
})

// ─── Quoting variations ────────────────────────────────────

describe('parseCurlCommand: quoting', () => {
  it('single-quoted JSON body keeps internal double quotes', () => {
    const r = parseCurlCommand(`curl -d '{"a":"b c"}' https://x`)
    expect(r.body).toBe('{"a":"b c"}')
  })

  it('double-quoted JSON body with escaped quotes', () => {
    const r = parseCurlCommand(`curl -d "{\\"a\\":\\"b\\"}" https://x`)
    expect(r.body).toBe('{"a":"b"}')
  })

  it("$'...'-style ANSI-C quoting (KNOWN BUG: $ kept, escapes not decoded)", () => {
    // bash $'...' supports escapes (\n, \t...). The current tokenizer treats
    // $ as a literal char and only the ' pair as quotes -> produces "$hello".
    // Documented as a known limitation; assertion locks the current shape so
    // we notice if behavior changes.
    const r = parseCurlCommand(`curl -d $'hello' https://x`)
    expect(r.body).toBe('$hello')
  })
})

// ─── Multiline / Chrome-style copy ─────────────────────────

describe('parseCurlCommand: multiline / Chrome copy', () => {
  it('parses multiline command with backslash continuations without crashing', () => {
    const cmd = [
      `curl 'https://api.example.com/v1/items' \\`,
      `  -X POST \\`,
      `  -H 'accept: application/json' \\`,
      `  -H 'content-type: application/json' \\`,
      `  --data-raw '{"id":1,"name":"A"}'`,
    ].join('\n')
    const r = parseCurlCommand(cmd)
    expect(r.method).toBe('POST')
    expect(r.url).toBe('https://api.example.com/v1/items')
    expect(r.headers['accept']).toBe('application/json')
    expect(r.headers['content-type']).toBe('application/json')
    expect(r.body).toBe('{"id":1,"name":"A"}')
  })

  it('parses a Chrome "Copy as cURL (bash)" sample', () => {
    const cmd = `curl 'https://api.example.com/products?q=foo' \\
  -H 'accept: */*' \\
  -H 'accept-language: en-US,en;q=0.9' \\
  -H 'cookie: a=1; b=2' \\
  -H 'referer: https://example.com/' \\
  -H 'user-agent: Mozilla/5.0' \\
  --compressed`
    const r = parseCurlCommand(cmd)
    expect(r.method).toBe('GET')
    expect(r.url).toBe('https://api.example.com/products?q=foo')
    expect(r.headers['accept']).toBe('*/*')
    expect(r.headers['cookie']).toBe('a=1; b=2')
    expect(r.headers['user-agent']).toBe('Mozilla/5.0')
  })

  it('cmd.exe form with caret-escaped quotes (best effort)', () => {
    // Windows: curl ^"https://x^"
    // We accept either correct parse OR graceful no-crash with empty url.
    const cmd = `curl ^"https://api.example.com/x^"`
    let r: ReturnType<typeof parseCurlCommand> | null = null
    expect(() => {
      r = parseCurlCommand(cmd)
    }).not.toThrow()
    expect(r).not.toBeNull()
  })
})

// ─── exportAsCurl ──────────────────────────────────────────

describe('exportAsCurl', () => {
  it('emits GET with no method flag', () => {
    const out = exportAsCurl({ method: 'GET', url: 'https://x/y' })
    expect(out).toContain(`curl`)
    expect(out).toContain(`'https://x/y'`)
    expect(out).not.toContain(`-X GET`)
  })

  it('includes -X for non-GET', () => {
    const out = exportAsCurl({ method: 'POST', url: 'https://x/y' })
    expect(out).toContain(`-X POST`)
  })

  it('includes headers, basic auth, cookies, -k', () => {
    const out = exportAsCurl({
      method: 'POST',
      url: 'https://x/y',
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
      cookies: 'session=abc',
      sslVerification: false,
    })
    expect(out).toContain(`-H 'Accept: application/json'`)
    expect(out).toContain(`-u 'u:p'`)
    expect(out).toContain(`-b 'session=abc'`)
    expect(out).toContain(`-k`)
  })

  it('emits bearer as Authorization header', () => {
    const out = exportAsCurl({
      method: 'GET',
      url: 'https://x',
      auth: { type: 'bearer', bearer: { token: 'TKN' } },
    })
    expect(out).toContain(`-H 'Authorization: Bearer TKN'`)
  })

  it('JSON body uses -d with quote escaping', () => {
    const out = exportAsCurl({
      method: 'POST',
      url: 'https://x',
      body: { type: 'json', content: `{"a":"b's"}` },
    })
    expect(out).toContain(`-d`)
    // single quote should be escaped via '\''
    expect(out).toContain(`'\\''`)
  })

  it('form-data file row produces -F field=@/path', () => {
    const out = exportAsCurl({
      method: 'POST',
      url: 'https://x/upload',
      body: {
        type: 'form-data',
        formData: [
          { key: 'file', value: '', enabled: true, type: 'file', filePath: '/tmp/a.bin' },
          { key: 'desc', value: 'hello', enabled: true, type: 'text' },
        ],
      },
    })
    expect(out).toContain(`-F 'file=@/tmp/a.bin'`)
    expect(out).toContain(`-F 'desc=hello'`)
  })

  it('urlencoded body uses --data-urlencode per field', () => {
    const out = exportAsCurl({
      method: 'POST',
      url: 'https://x',
      body: {
        type: 'urlencoded',
        urlEncoded: [
          { key: 'q', value: 'hello world', enabled: true },
          { key: 'p', value: 'v', enabled: false },
        ],
      },
    })
    expect(out).toContain(`--data-urlencode 'q=hello world'`)
    expect(out).not.toContain(`--data-urlencode 'p=v'`)
  })
})

// ─── Round-trip ────────────────────────────────────────────

describe('round-trip: parseCurl -> exportAsCurl -> parseCurl', () => {
  it('preserves method, url, headers, body, auth', () => {
    const original = `curl -X POST 'https://api.example.com/v1/users' \\
  -H 'Accept: application/json' \\
  -H 'X-Trace: 42' \\
  -u 'alice:secret' \\
  --data-raw '{"name":"john","age":30}'`
    const r1 = parseCurlCommand(original)
    expect(r1.method).toBe('POST')
    expect(r1.url).toBe('https://api.example.com/v1/users')

    // Build CurlExportRequest from parsed
    const exported = exportAsCurl({
      method: r1.method,
      url: r1.url,
      headers: Object.entries(r1.headers).map(([k, v]) => ({
        key: k,
        value: v,
        enabled: true,
      })),
      body: r1.body ? { type: 'json', content: r1.body } : undefined,
      auth: r1.auth,
      sslVerification: r1.insecure ? false : true,
      cookies: r1.cookies,
    })

    const r2 = parseCurlCommand(exported)
    expect(r2.method).toBe('POST')
    expect(r2.url).toBe('https://api.example.com/v1/users')
    expect(r2.headers['Accept']).toBe('application/json')
    expect(r2.headers['X-Trace']).toBe('42')
    expect(r2.auth?.basic?.username).toBe('alice')
    expect(r2.auth?.basic?.password).toBe('secret')
    expect(r2.body).toBe('{"name":"john","age":30}')
  })

  it('round-trips multipart with file path', () => {
    const original = `curl -X POST 'https://x/upload' -F 'file=@/tmp/a.bin' -F 'desc=hello'`
    const r1 = parseCurlCommand(original)
    // Reconstruct an export request from parsed body
    const fields = (r1.body || '').split('&').map((kv) => {
      const eq = kv.indexOf('=')
      const key = eq > 0 ? kv.slice(0, eq) : kv
      const value = eq > 0 ? kv.slice(eq + 1) : ''
      if (value.startsWith('@')) {
        return { key, value: '', enabled: true, type: 'file' as const, filePath: value.slice(1) }
      }
      return { key, value, enabled: true, type: 'text' as const }
    })
    const exported = exportAsCurl({
      method: 'POST',
      url: r1.url,
      body: { type: 'form-data', formData: fields },
    })
    expect(exported).toContain(`-F 'file=@/tmp/a.bin'`)
    expect(exported).toContain(`-F 'desc=hello'`)

    const r2 = parseCurlCommand(exported)
    expect(r2.url).toBe('https://x/upload')
    expect(r2.body).toContain('file=@/tmp/a.bin')
    expect(r2.body).toContain('desc=hello')
  })
})
// ─── Single-quote escaping (bug fixes) ─────────────────────

describe("single-quote escaping in exportAsCurl + round-trip", () => {
  it("URL containing ' survives parse -> export -> parse", () => {
    // The export must wrap the URL in '...' with internal ' rewritten as '\''
    // so the shell tokenizer can rebuild the original string verbatim.
    const original = `curl 'https://api.example.com/search?q=it%27s'`
    // Use a URL that legitimately contains a single quote (e.g. an exotic
    // path component that some servers accept).
    const tricky = `https://api.example.com/path/o'reilly`
    const exported = exportAsCurl({ method: 'GET', url: tricky })
    expect(exported).toContain(`'https://api.example.com/path/o'\\''reilly'`)
    const reparsed = parseCurlCommand(exported)
    expect(reparsed.url).toBe(tricky)
    // sanity-check baseline parse still works
    expect(parseCurlCommand(original).url).toContain('search')
  })

  it("header value containing ' survives round-trip", () => {
    const headerValue = `it's-a-value`
    const exported = exportAsCurl({
      method: 'GET',
      url: 'https://x',
      headers: [{ key: 'X-Quote', value: headerValue, enabled: true }],
    })
    // Encoded as: -H 'X-Quote: it'\''s-a-value'
    expect(exported).toContain(`-H 'X-Quote: it'\\''s-a-value'`)
    const reparsed = parseCurlCommand(exported)
    expect(reparsed.headers['X-Quote']).toBe(headerValue)
  })

  it("cookie + basic-auth password with ' survive round-trip", () => {
    const cookie = `sess='abc';u=42`
    const password = `p'wd`
    const exported = exportAsCurl({
      method: 'GET',
      url: 'https://x',
      auth: { type: 'basic', basic: { username: 'alice', password } },
      cookies: cookie,
    })
    // Each ' must be escaped as '\''
    expect(exported).toContain(`-u 'alice:p'\\''wd'`)
    expect(exported).toContain(`-b 'sess='\\''abc'\\'';u=42'`)
    const reparsed = parseCurlCommand(exported)
    expect(reparsed.auth?.basic?.password).toBe(password)
    expect(reparsed.cookies).toBe(cookie)
  })
})

// ─── -d auto Content-Type ──────────────────────────────────

describe('parseCurlCommand: -d implies application/x-www-form-urlencoded', () => {
  it("-d 'foo=bar' without -H adds Content-Type", () => {
    const r = parseCurlCommand(`curl -d 'foo=bar' https://x`)
    expect(r.method).toBe('POST')
    expect(r.body).toBe('foo=bar')
    expect(r.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it("-d with explicit -H 'Content-Type: text/plain' keeps user value", () => {
    const r = parseCurlCommand(
      `curl -d 'foo=bar' -H 'Content-Type: text/plain' https://x`,
    )
    expect(r.body).toBe('foo=bar')
    expect(r.headers['Content-Type']).toBe('text/plain')
  })
})
