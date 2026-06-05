import { describe, it, expect } from 'vitest'
import {
  generateCode,
  CODE_LANGUAGES,
  type CodeGenRequest,
} from '../../src/renderer/lib/code-generator'
import type { CodeLanguage, KeyValuePair, RequestBody, AuthConfig } from '../../src/renderer/types'

// ── helpers ─────────────────────────────────────────────────────────────

let idSeq = 0
function kv(key: string, value: string, extra: Partial<KeyValuePair> = {}): KeyValuePair {
  return { id: `kv-${idSeq++}`, key, value, enabled: true, ...extra }
}

function baseReq(over: Partial<CodeGenRequest> = {}): CodeGenRequest {
  return {
    method: 'GET',
    url: 'https://api.example.com/users',
    params: [],
    headers: [],
    ...over,
  }
}

const jsonBody: RequestBody = {
  type: 'json',
  content: '{"name":"Ada","age":36}',
}

const ALL_IDS = CODE_LANGUAGES.map((l) => l.id)

// ── catalog sanity ──────────────────────────────────────────────────────

describe('CODE_LANGUAGES catalog', () => {
  it('exposes all 11 supported languages', () => {
    expect(ALL_IDS).toEqual([
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

  it('every entry has id, label and monacoLang', () => {
    for (const lang of CODE_LANGUAGES) {
      expect(lang.id).toBeTruthy()
      expect(lang.label).toBeTruthy()
      expect(lang.monacoLang).toBeTruthy()
    }
  })
})

// ── table-driven: every language produces non-empty output ──────────────

describe('generateCode — all languages', () => {
  const richReq = baseReq({
    method: 'POST',
    params: [kv('q', 'search term')],
    headers: [kv('X-Custom', 'yes')],
    body: jsonBody,
    auth: { type: 'bearer', bearer: { token: 'TOK' } } as AuthConfig,
  })

  for (const id of ALL_IDS) {
    it(`${id}: returns a non-empty string and does not throw`, () => {
      let out = ''
      expect(() => {
        out = generateCode(id, richReq)
      }).not.toThrow()
      expect(typeof out).toBe('string')
      expect(out.trim().length).toBeGreaterThan(0)
    })

    it(`${id}: empty request (no headers/body/params) still renders`, () => {
      const out = generateCode(id, baseReq())
      expect(out.length).toBeGreaterThan(0)
      expect(out).toContain('api.example.com')
    })
  }

  it('returns a "not supported" comment for an unknown language', () => {
    const out = generateCode('cobol' as CodeLanguage, baseReq())
    expect(out).toContain('not supported')
  })
})

// ── URL + query params ──────────────────────────────────────────────────

describe('query params', () => {
  it('curl: GET with params produces the full URL with query string', () => {
    const out = generateCode(
      'curl',
      baseReq({ params: [kv('q', 'hello world'), kv('page', '2')] }),
    )
    expect(out).toContain('curl -X GET')
    expect(out).toContain('https://api.example.com/users?q=hello%20world&page=2')
  })

  it('js-fetch: full URL with params appears', () => {
    const out = generateCode(
      'js-fetch',
      baseReq({ params: [kv('q', 'x'), kv('y', 'z')] }),
    )
    expect(out).toContain('https://api.example.com/users?q=x&y=z')
  })

  it('appends with & when the URL already has a query string', () => {
    const out = generateCode(
      'curl',
      baseReq({ url: 'https://api.example.com/users?existing=1', params: [kv('q', 'v')] }),
    )
    expect(out).toContain('https://api.example.com/users?existing=1&q=v')
  })

  it('excludes disabled params from the URL', () => {
    const out = generateCode(
      'curl',
      baseReq({ params: [kv('keep', '1'), kv('drop', '2', { enabled: false })] }),
    )
    expect(out).toContain('keep=1')
    expect(out).not.toContain('drop=2')
  })

  it('excludes params with an empty key', () => {
    const out = generateCode('curl', baseReq({ params: [kv('', 'orphan')] }))
    expect(out).not.toContain('?')
    expect(out).not.toContain('orphan')
  })
})

// ── JSON body ───────────────────────────────────────────────────────────

describe('JSON body', () => {
  const req = baseReq({ method: 'POST', body: jsonBody })

  it('curl: includes -X POST and the -d payload', () => {
    const out = generateCode('curl', req)
    expect(out).toContain('curl -X POST')
    expect(out).toContain(`-d '${jsonBody.content}'`)
  })

  it('js-fetch: includes method POST and a body field', () => {
    const out = generateCode('js-fetch', req)
    expect(out).toContain("method: 'POST'")
    expect(out).toContain('body:')
    expect(out).toContain('Ada')
  })

  it('js-axios: lowercases method and uses a data field', () => {
    const out = generateCode('js-axios', req)
    expect(out).toContain("method: 'post'")
    expect(out).toContain('data:')
  })

  it('python: uses json=payload for JSON bodies and imports json', () => {
    const out = generateCode('python-requests', req)
    expect(out).toContain('import requests')
    expect(out).toContain('import json')
    expect(out).toContain('requests.post(')
    expect(out).toContain('json=payload')
  })

  it('java: emits application/json media type', () => {
    const out = generateCode('java-okhttp', req)
    expect(out).toContain('MediaType.parse("application/json")')
    expect(out).toContain('.method("POST", body)')
  })

  it('csharp: StringContent with application/json', () => {
    const out = generateCode('csharp', req)
    expect(out).toContain('HttpMethod.Post')
    expect(out).toContain('application/json')
  })

  it('go: passes the payload through strings.NewReader', () => {
    const out = generateCode('go', req)
    expect(out).toContain('strings.NewReader(')
    expect(out).toContain('http.NewRequest("POST"')
  })

  it('php: sets CURLOPT_POSTFIELDS and CURLOPT_CUSTOMREQUEST', () => {
    const out = generateCode('php', req)
    expect(out).toContain('CURLOPT_CUSTOMREQUEST => "POST"')
    expect(out).toContain('CURLOPT_POSTFIELDS =>')
  })

  it('ruby: builds a Net::HTTP::Post and sets request.body', () => {
    const out = generateCode('ruby', req)
    expect(out).toContain('Net::HTTP::Post.new(uri)')
    expect(out).toContain('request.body =')
  })

  it('swift: sets httpMethod and httpBody', () => {
    const out = generateCode('swift', req)
    expect(out).toContain('request.httpMethod = "POST"')
    expect(out).toContain('request.httpBody =')
  })

  it('kotlin: emits application/json media type and a request body', () => {
    const out = generateCode('kotlin', req)
    expect(out).toContain('"application/json".toMediaType()')
    expect(out).toContain('.toRequestBody(mediaType)')
  })
})

// ── headers + auth ──────────────────────────────────────────────────────

describe('headers and auth', () => {
  it('curl: custom enabled headers appear as -H lines', () => {
    const out = generateCode(
      'curl',
      baseReq({ headers: [kv('X-Trace', 'abc'), kv('Accept', 'application/json')] }),
    )
    expect(out).toContain("-H 'X-Trace: abc'")
    expect(out).toContain("-H 'Accept: application/json'")
  })

  it('curl: disabled headers are excluded', () => {
    const out = generateCode(
      'curl',
      baseReq({ headers: [kv('Keep', 'y'), kv('Drop', 'n', { enabled: false })] }),
    )
    expect(out).toContain('Keep: y')
    expect(out).not.toContain('Drop: n')
  })

  it('bearer auth injects an Authorization header with the token (curl)', () => {
    const out = generateCode(
      'curl',
      baseReq({ auth: { type: 'bearer', bearer: { token: 'mytoken' } } as AuthConfig }),
    )
    expect(out).toContain('Authorization: Bearer mytoken')
  })

  it('bearer auth honours a custom prefix', () => {
    const out = generateCode(
      'curl',
      baseReq({ auth: { type: 'bearer', bearer: { token: 't', prefix: 'Token' } } as AuthConfig }),
    )
    expect(out).toContain('Authorization: Token t')
  })

  it('bearer auth appears in a non-curl language too (python headers)', () => {
    const out = generateCode(
      'python-requests',
      baseReq({ auth: { type: 'bearer', bearer: { token: 'pytok' } } as AuthConfig }),
    )
    expect(out).toContain('headers = ')
    expect(out).toContain('Authorization')
    expect(out).toContain('Bearer pytok')
    expect(out).toContain('headers=headers')
  })

  it('basic auth produces a Basic Authorization placeholder', () => {
    const out = generateCode(
      'curl',
      baseReq({ auth: { type: 'basic', basic: { username: 'u', password: 'p' } } as AuthConfig }),
    )
    expect(out).toContain('Authorization: Basic <base64(u:p)>')
  })

  it('api-key auth (header) injects the named header', () => {
    const out = generateCode(
      'curl',
      baseReq({
        auth: { type: 'api-key', apiKey: { key: 'X-Api-Key', value: 'secret', in: 'header' } } as AuthConfig,
      }),
    )
    expect(out).toContain('X-Api-Key: secret')
  })

  it('api-key auth in query does NOT add a header', () => {
    const out = generateCode(
      'curl',
      baseReq({
        auth: { type: 'api-key', apiKey: { key: 'apikey', value: 'v', in: 'query' } } as AuthConfig,
      }),
    )
    expect(out).not.toContain('apikey: v')
  })

  it('no headers section is emitted when there are none (python)', () => {
    const out = generateCode('python-requests', baseReq())
    expect(out).not.toContain('headers = ')
    expect(out).not.toContain('headers=headers')
  })
})

// ── variable resolution ─────────────────────────────────────────────────

describe('variable resolution via options.envVars', () => {
  it('resolves {{base}} in the URL to a concrete value', () => {
    const out = generateCode(
      'curl',
      baseReq({ url: '{{base}}/users' }),
      { envVars: { base: 'https://prod.example.com' } },
    )
    expect(out).toContain('https://prod.example.com/users')
    expect(out).not.toContain('{{base}}')
  })

  it('resolves variables inside params, headers and body', () => {
    const out = generateCode(
      'curl',
      baseReq({
        url: '{{base}}/items',
        params: [kv('q', '{{term}}')],
        headers: [kv('Authorization', 'Bearer {{token}}')],
        body: { type: 'json', content: '{"id":"{{id}}"}' },
        method: 'POST',
      }),
      { envVars: { base: 'https://x.io', term: 'shoes', token: 'abc', id: '42' } },
    )
    expect(out).toContain('https://x.io/items?q=shoes')
    expect(out).toContain('Authorization: Bearer abc')
    expect(out).toContain('"id":"42"')
    expect(out).not.toContain('{{')
  })

  it('leaves placeholders untouched when no envVars are provided', () => {
    const out = generateCode('curl', baseReq({ url: '{{base}}/users' }))
    expect(out).toContain('{{base}}/users')
  })
})

// ── body modes ──────────────────────────────────────────────────────────

describe('body modes', () => {
  it('form-urlencoded: curl encodes enabled pairs into -d', () => {
    const body: RequestBody = {
      type: 'urlencoded',
      urlEncoded: [kv('grant_type', 'password'), kv('user', 'a b')],
    }
    const out = generateCode('curl', baseReq({ method: 'POST', body }))
    expect(out).toContain("-d 'grant_type=password&user=a%20b'")
  })

  it('form-urlencoded: excludes disabled rows', () => {
    const body: RequestBody = {
      type: 'urlencoded',
      urlEncoded: [kv('keep', '1'), kv('drop', '2', { enabled: false })],
    }
    const out = generateCode('curl', baseReq({ method: 'POST', body }))
    expect(out).toContain('keep=1')
    expect(out).not.toContain('drop=2')
  })

  it('form-urlencoded: renders in python as data=data', () => {
    const body: RequestBody = {
      type: 'urlencoded',
      urlEncoded: [kv('a', '1')],
    }
    const out = generateCode('python-requests', baseReq({ method: 'POST', body }))
    expect(out).toContain('data=data')
    expect(out).toContain('a=1')
  })

  it('form-data: curl emits -F parts and skips an explicit content-type header', () => {
    const body: RequestBody = {
      type: 'form-data',
      formData: [
        kv('field', 'value'),
        kv('upload', 'photo.png', { type: 'file', filePath: '/tmp/photo.png' }),
      ],
    }
    const out = generateCode(
      'curl',
      baseReq({
        method: 'POST',
        body,
        headers: [kv('Content-Type', 'multipart/form-data')],
      }),
    )
    expect(out).toContain("-F 'field=value'")
    expect(out).toContain("-F 'upload=@/tmp/photo.png'")
    // explicit multipart content-type header is intentionally dropped
    expect(out).not.toContain("-H 'Content-Type: multipart/form-data'")
  })

  it('xml body: curl ships the raw content', () => {
    const out = generateCode(
      'curl',
      baseReq({ method: 'POST', body: { type: 'xml', content: '<a>1</a>' } }),
    )
    expect(out).toContain("-d '<a>1</a>'")
  })

  it('none body: curl emits no -d flag', () => {
    const out = generateCode('curl', baseReq({ method: 'POST', body: { type: 'none' } }))
    expect(out).not.toContain('-d ')
  })

  it('non-json body in java uses text/plain media type', () => {
    const out = generateCode(
      'java-okhttp',
      baseReq({ method: 'POST', body: { type: 'text', content: 'plain' } }),
    )
    expect(out).toContain('MediaType.parse("text/plain")')
  })
})
