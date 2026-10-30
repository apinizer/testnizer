/**
 * Issue #256 — through the real facade (`generateSnippet` / `generateCode`)
 * and EVERY registered variant: with "Include secret values" OFF
 * (`includeSecrets: false`) no literal credential typed into the request
 * appears in the snippet — header values, the Authorization tab (bearer, API
 * key in a header / in the query, Basic incl. its base64 form), credential-
 * named query params, credentials in the URL — and the placeholder is the same
 * everywhere. ON (`true`) and "unknown" (`undefined`) leave everything as
 * typed. `{{var}}` references stay readable. The request object is not
 * mutated. Contract: `mask-credentials.test.ts`.
 *
 * Fail-before: a literal `X-Api-Key` / Bearer token / Basic password was in
 * the output of every variant regardless of the toggle.
 */
import { describe, expect, it } from 'vitest'
import { ALL_VARIANTS, base64Utf8 } from '../../../../src/shared/codegen'
import { CODEGEN_MASK } from '../../../../src/shared/codegen/mask-credentials'
import { generateCode, generateSnippet } from '../../../../src/renderer/lib/code-generator'
import type { CodeGenRequest } from '../../../../src/renderer/lib/code-generator'
import { kv } from '../../../fixtures/codegen-cases'

const HEADER_KEY = 'HDR-KEY-LITERAL-1a2b'
const COOKIE = 'COOKIE-LITERAL-3c4d'
const BEARER = 'BEARER-LITERAL-5e6f'
const QUERY_KEY = 'QUERY-KEY-LITERAL-7a8b'
const URL_TOKEN = 'URL-TOKEN-LITERAL-9c0d'
const URL_PASS = 'URL-PASS-LITERAL-1e2f'
const API_VALUE = 'APIKEY-LITERAL-3a4b'
const BASIC_PASS = 'BASIC-PASS-LITERAL-5c6d'

const ALL_LITERALS = [
  HEADER_KEY,
  COOKIE,
  BEARER,
  QUERY_KEY,
  URL_TOKEN,
  URL_PASS,
  API_VALUE,
  BASIC_PASS,
]

/** Header + query + URL credentials, bearer in the Authorization tab. */
function headerAndQuery(): CodeGenRequest {
  return {
    method: 'GET',
    url: `https://ada:${URL_PASS}@api.test/items?access_token=${URL_TOKEN}&page=2`,
    params: [kv('api_key', QUERY_KEY), kv('limit', '10')],
    headers: [
      kv('X-Api-Key', HEADER_KEY),
      kv('Cookie', `sid=${COOKIE}`),
      kv('Accept', 'application/json'),
      kv('X-Trace', 'trace-1'),
    ],
    auth: { type: 'bearer', bearer: { token: BEARER } },
  }
}

const apiKeyHeader = (): CodeGenRequest => ({
  method: 'GET',
  url: 'https://api.test/items',
  params: [],
  headers: [],
  auth: { type: 'api-key', apiKey: { key: 'X-Custom-Thing', value: API_VALUE, in: 'header' } },
})

const apiKeyQuery = (): CodeGenRequest => ({
  method: 'GET',
  url: 'https://api.test/items',
  params: [],
  headers: [],
  auth: { type: 'api-key', apiKey: { key: 'foo', value: API_VALUE, in: 'query' } },
})

const basic = (): CodeGenRequest => ({
  method: 'GET',
  url: 'https://api.test/items',
  params: [],
  headers: [],
  auth: { type: 'basic', basic: { username: 'ada', password: BASIC_PASS } },
})

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

const OFF = { includeSecrets: false } as const
const ON = { includeSecrets: true } as const

describe('every variant, toggle OFF', () => {
  for (const v of ALL_VARIANTS) {
    describe(`${v.language} / ${v.label} (${v.id})`, () => {
      it('header, query and URL credentials + bearer are masked, ordinary parts stay', () => {
        const code = generateSnippet(v.id, headerAndQuery(), OFF)
        for (const literal of [HEADER_KEY, COOKIE, BEARER, QUERY_KEY, URL_TOKEN, URL_PASS]) {
          expect(code, literal).not.toContain(literal)
        }
        expect(code).toContain(CODEGEN_MASK)
        // The same placeholder everywhere; ordinary data is untouched.
        expect(code).toContain('trace-1')
        expect(code).toContain('limit')
        expect(code).toContain('api.test')
        // The user name of the URL userinfo is not a secret.
        expect(code).toContain('ada')
      })

      it('API key (header and query) value is masked', () => {
        for (const make of [apiKeyHeader, apiKeyQuery]) {
          const code = generateSnippet(v.id, make(), OFF)
          expect(code).not.toContain(API_VALUE)
          expect(code).toContain(CODEGEN_MASK)
        }
      })

      it('Basic: neither the password nor base64(user:password) is in the snippet', () => {
        const code = generateSnippet(v.id, basic(), OFF)
        expect(code).not.toContain(BASIC_PASS)
        expect(code).not.toContain(base64Utf8(`ada:${BASIC_PASS}`))
        // What IS allowed: the user name, and the mask (plain or inside base64).
        const masked = code.includes(CODEGEN_MASK) || code.includes(base64Utf8(`ada:${CODEGEN_MASK}`))
        expect(masked).toBe(true)
      })

      it('toggle ON: everything as typed', () => {
        const code = generateSnippet(v.id, headerAndQuery(), ON)
        for (const literal of [HEADER_KEY, COOKIE, BEARER, QUERY_KEY, URL_TOKEN]) {
          expect(code, literal).toContain(literal)
        }
        expect(generateSnippet(v.id, apiKeyHeader(), ON)).toContain(API_VALUE)
        expect(generateSnippet(v.id, apiKeyQuery(), ON)).toContain(API_VALUE)
      })

      it('toggle unknown (option absent): as typed — callers that never knew the toggle are unchanged', () => {
        const code = generateSnippet(v.id, headerAndQuery())
        expect(code).toContain(HEADER_KEY)
        expect(code).toContain(BEARER)
      })
    })
  }
})

describe('legacy ids and the curl dialects', () => {
  it('generateCode(legacy id) masks the same way', () => {
    for (const id of ['curl', 'js-fetch', 'js-axios', 'python-requests', 'java-okhttp', 'go', 'php', 'ruby', 'swift', 'kotlin', 'csharp'] as const) {
      const code = generateCode(id, headerAndQuery(), OFF)
      for (const literal of ALL_LITERALS) expect(code, `${id} ${literal}`).not.toContain(literal)
    }
  })

  it('cURL in bash, CMD and PowerShell, one line and multi-line', () => {
    for (const dialect of ['bash', 'cmd', 'powershell'] as const) {
      for (const multiLine of [true, false]) {
        const code = generateCode('curl', headerAndQuery(), { ...OFF, curl: { dialect, multiLine } })
        for (const literal of ALL_LITERALS) expect(code, `${dialect} ${literal}`).not.toContain(literal)
        expect(code).toContain(CODEGEN_MASK)
      }
    }
  })

  it('the cURL header line reads naturally: scheme kept, secret replaced', () => {
    const code = generateCode('curl', headerAndQuery(), OFF)
    expect(code).toContain(`-H 'Authorization: Bearer ${CODEGEN_MASK}'`)
    expect(code).toContain(`-H 'X-Api-Key: ${CODEGEN_MASK}'`)
  })
})

describe('variables', () => {
  const withRefs = (): CodeGenRequest => ({
    method: 'GET',
    url: '{{baseUrl}}/items?api_key={{apiKey}}&token={{tok}}',
    params: [],
    headers: [kv('X-Api-Key', '{{apiKey}}'), kv('Authorization', 'Bearer {{tok}}')],
    auth: { type: 'bearer', bearer: { token: '{{tok}}' } },
  })

  it('a {{reference}} stays readable (never turned into the mask)', () => {
    const code = generateSnippet('curl', withRefs(), OFF)
    expect(code).toContain('{{apiKey}}')
    expect(code).toContain('{{tok}}')
    expect(code).toContain('{{baseUrl}}')
    expect(code).not.toContain(CODEGEN_MASK)
  })

  it('a secret variable stays {{name}}; a literal next to it is masked; plain variables resolve', () => {
    const SECRET = 'SECRET-VAR-VALUE-1'
    const code = generateSnippet(
      'curl',
      {
        method: 'GET',
        url: 'https://{{host}}/items',
        params: [],
        headers: [kv('X-Api-Key', '{{tok}}'), kv('X-Auth-Token', HEADER_KEY)],
      },
      { ...OFF, envVars: { tok: SECRET, host: 'api.test' }, secretNames: new Set(['tok']) },
    )
    expect(code).not.toContain(SECRET)
    expect(code).not.toContain(HEADER_KEY)
    expect(code).toContain("-H 'X-Api-Key: {{tok}}'")
    expect(code).toContain(`-H 'X-Auth-Token: ${CODEGEN_MASK}'`)
    expect(code).toContain("'https://api.test/items'")
  })

  it('masking does not need envVars to be given', () => {
    const code = generateSnippet('curl', headerAndQuery(), OFF)
    expect(code).not.toContain(BEARER)
  })

  it('a NON-secret variable is not a typed literal: it resolves, as before (decision pinned)', () => {
    const code = generateSnippet(
      'curl',
      {
        method: 'GET',
        url: 'https://api.test/items',
        params: [],
        headers: [kv('X-Api-Key', '{{plainKey}}')],
      },
      { ...OFF, envVars: { plainKey: 'PLAIN-KEY-VALUE-1' }, secretNames: new Set() },
    )
    expect(code).toContain('X-Api-Key: PLAIN-KEY-VALUE-1')
  })

  it('"Include secret values" ON resolves the secret AND shows the literal', () => {
    const SECRET = 'SECRET-VAR-VALUE-1'
    const code = generateSnippet(
      'curl',
      {
        method: 'GET',
        url: 'https://api.test/items',
        params: [],
        headers: [kv('X-Api-Key', '{{tok}}'), kv('X-Auth-Token', HEADER_KEY)],
      },
      { ...ON, envVars: { tok: SECRET }, secretNames: new Set(['tok']) },
    )
    expect(code).toContain(SECRET)
    expect(code).toContain(HEADER_KEY)
  })
})

describe('purity', () => {
  it('does not mutate the request the editor holds', () => {
    const req = deepFreeze(headerAndQuery())
    const before = JSON.stringify(req)
    generateSnippet('curl', req, OFF)
    generateSnippet('python-requests', req, OFF)
    generateCode('curl', req, OFF)
    expect(JSON.stringify(req)).toBe(before)
  })
})
