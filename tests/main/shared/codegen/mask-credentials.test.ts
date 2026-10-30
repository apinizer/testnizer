/**
 * Issue #256 — Generate Code with "Include secret values" OFF masks the
 * LITERAL credentials typed into the request too (secret VARIABLES already
 * stay `{{name}}`).
 *
 * ─── CONTRACT ────────────────────────────────────────────────────────────────
 * new `src/shared/codegen/mask-credentials.ts` (pure TS, both bundles):
 *
 *   CODEGEN_MASK   the placeholder a masked literal becomes. It is the
 *                  codebase's URL-safe inline mask `INLINE_MASK` ('***',
 *                  `src/shared/mcp-call.ts`, already used for MCP URLs / command
 *                  lines) — NOT `HISTORY_MASK` ('••••••'): that one would be
 *                  percent-encoded in a URL and breaks `base64(user:pass)`.
 *
 *   maskCredentialLiterals<T extends { url: string; params?; headers?; auth? }>(req: T): T
 *     Returns a NEW request (the input is never mutated — it is deep-frozen in
 *     the tests). Runs BEFORE `{{var}}` resolution (so only text the user typed
 *     is a "literal"; a secret variable is still handled by `snippetVariables`,
 *     and a NON-secret variable resolves to its value as before).
 *     Masks, and only these (the issue: headers, auth, query):
 *       - headers: value of a credential-named header (`isCredentialHeaderName`);
 *         `Authorization` / `Proxy-Authorization` keep a leading scheme word
 *         (`Bearer ***`, `Basic ***`), a value without one becomes `***`;
 *       - params table rows and the URL's own query string: credential-named
 *         keys (`isCredentialArgName`, whole words — `author`, `keyword`, `page`
 *         stay);
 *       - URL userinfo password (`https://ada:***@host`); the user name stays;
 *       - auth: bearer token (prefix stays), oauth2 token, API key VALUE (header
 *         or query, whatever the key is called), basic / digest / ntlm PASSWORD
 *         (user name and domain stay).
 *     A value that is only `{{var}}` references (plus an optional scheme word)
 *     is NOT a literal and stays as typed. A value mixing literal text and
 *     references (`abc-{{x}}`) is masked whole. Empty values stay empty.
 *     Bodies: credential-named urlencoded / form-data rows are masked (file parts
 *     untouched); JSON / raw / GraphQL bodies are left as typed — see
 *     mask-credentials-body.test.ts.
 *
 * `src/renderer/lib/code-generator.ts`: `generateSnippet` / `generateCode`
 *   apply it, before variable resolution, exactly when
 *   `options.includeSecrets === false`. `true` and `undefined` (callers that do
 *   not know the toggle — tests, legacy) leave the literals as typed. The
 *   toggle's hook (`useGeneratedCode`) always passes an explicit boolean.
 *   Independent of `envVars` being given.
 */
import { describe, expect, it } from 'vitest'
import {
  CODEGEN_MASK,
  maskCredentialLiterals,
} from '../../../../src/shared/codegen/mask-credentials'
import { INLINE_MASK } from '../../../../src/shared/mcp-call'
import type { CodegenInput, CodegenKv } from '../../../../src/shared/codegen'

const LIT = 'LITERAL-s3cr3t-9f2a'

const kv = (key: string, value: string, enabled = true): CodegenKv => ({ key, value, enabled })

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

const req = (over: Partial<CodegenInput> = {}): CodegenInput =>
  deepFreeze({ method: 'GET', url: 'https://api.test/items', ...over })

describe('the placeholder', () => {
  it('reuses the codebase inline mask (URL-safe, no non-ASCII)', () => {
    expect(CODEGEN_MASK).toBe(INLINE_MASK)
    expect(CODEGEN_MASK).toBe('***')
  })
})

describe('headers', () => {
  it('masks credential-named headers, keeps the others', () => {
    const out = maskCredentialLiterals(
      req({
        headers: [
          kv('X-Api-Key', LIT),
          kv('Ocp-Apim-Subscription-Key', LIT),
          kv('Cookie', `sid=${LIT}`),
          kv('X-Auth-Token', LIT),
          kv('Content-Type', 'application/json'),
          kv('Accept', 'application/json'),
          kv('X-Trace', 'abc'),
        ],
      }),
    )
    expect(out.headers).toEqual([
      kv('X-Api-Key', CODEGEN_MASK),
      kv('Ocp-Apim-Subscription-Key', CODEGEN_MASK),
      kv('Cookie', CODEGEN_MASK),
      kv('X-Auth-Token', CODEGEN_MASK),
      kv('Content-Type', 'application/json'),
      kv('Accept', 'application/json'),
      kv('X-Trace', 'abc'),
    ])
  })

  it('Authorization keeps the scheme word', () => {
    const out = maskCredentialLiterals(
      req({
        headers: [
          kv('Authorization', `Bearer ${LIT}`),
          kv('Proxy-Authorization', `Basic ${LIT}`),
        ],
      }),
    )
    expect(out.headers).toEqual([
      kv('Authorization', `Bearer ${CODEGEN_MASK}`),
      kv('Proxy-Authorization', `Basic ${CODEGEN_MASK}`),
    ])
    const bare = maskCredentialLiterals(req({ headers: [kv('authorization', LIT)] }))
    expect(bare.headers).toEqual([kv('authorization', CODEGEN_MASK)])
  })

  it('{{var}} references stay readable', () => {
    const headers = [
      kv('Authorization', 'Bearer {{token}}'),
      kv('X-Api-Key', '{{apiKey}}'),
      kv('Authorization', '{{auth}}'),
    ]
    expect(maskCredentialLiterals(req({ headers })).headers).toEqual(headers)
  })

  it('a value mixing literal text and references is masked whole', () => {
    const out = maskCredentialLiterals(req({ headers: [kv('X-Api-Key', `${LIT}-{{suffix}}`)] }))
    expect(out.headers).toEqual([kv('X-Api-Key', CODEGEN_MASK)])
  })

  it('empty values and disabled rows are left alone', () => {
    const headers = [kv('X-Api-Key', ''), kv('Authorization', '')]
    expect(maskCredentialLiterals(req({ headers })).headers).toEqual(headers)
  })
})

describe('query: Params table and the URL itself', () => {
  it('masks credential-named params (whole-word rule), keeps ordinary ones', () => {
    const out = maskCredentialLiterals(
      req({
        params: [
          kv('api_key', LIT),
          kv('access_token', LIT),
          kv('password', LIT),
          kv('key', LIT),
          kv('apiKey', '{{k}}'),
          kv('page', '2'),
          kv('author', 'ada'),
          kv('keyword', 'x'),
        ],
      }),
    )
    expect(out.params).toEqual([
      kv('api_key', CODEGEN_MASK),
      kv('access_token', CODEGEN_MASK),
      kv('password', CODEGEN_MASK),
      kv('key', CODEGEN_MASK),
      kv('apiKey', '{{k}}'),
      kv('page', '2'),
      kv('author', 'ada'),
      kv('keyword', 'x'),
    ])
  })

  it('masks credential values already typed into the URL query, keeps the rest and the fragment', () => {
    const out = maskCredentialLiterals(
      req({ url: `https://api.test/items?api_key=${LIT}&page=2&token={{tok}}&sig=${LIT}#frag` }),
    )
    expect(out.url).toBe(
      `https://api.test/items?api_key=${CODEGEN_MASK}&page=2&token={{tok}}&sig=${CODEGEN_MASK}#frag`,
    )
  })

  it('masks the password of URL userinfo, keeps the user name', () => {
    expect(maskCredentialLiterals(req({ url: `https://ada:${LIT}@api.test/x` })).url).toBe(
      `https://ada:${CODEGEN_MASK}@api.test/x`,
    )
    expect(maskCredentialLiterals(req({ url: 'https://ada@api.test/x' })).url).toBe(
      'https://ada@api.test/x',
    )
    expect(maskCredentialLiterals(req({ url: 'https://ada:{{pw}}@api.test/x' })).url).toBe(
      'https://ada:{{pw}}@api.test/x',
    )
  })

  it('a URL that is only a variable, or no URL at all, is returned as typed', () => {
    expect(maskCredentialLiterals(req({ url: '{{baseUrl}}/items?x=1' })).url).toBe(
      '{{baseUrl}}/items?x=1',
    )
    expect(maskCredentialLiterals(req({ url: '' })).url).toBe('')
  })
})

describe('Authorization tab', () => {
  it('bearer: token masked, prefix and {{ref}} kept', () => {
    expect(
      maskCredentialLiterals(req({ auth: { type: 'bearer', bearer: { token: LIT, prefix: 'Token' } } }))
        .auth,
    ).toEqual({ type: 'bearer', bearer: { token: CODEGEN_MASK, prefix: 'Token' } })
    const ref = { type: 'bearer', bearer: { token: '{{token}}' } }
    expect(maskCredentialLiterals(req({ auth: ref })).auth).toEqual(ref)
  })

  it('oauth2 token', () => {
    expect(
      maskCredentialLiterals(req({ auth: { type: 'oauth2', oauth2: { token: LIT } } })).auth,
    ).toEqual({ type: 'oauth2', oauth2: { token: CODEGEN_MASK } })
  })

  it('API key: the VALUE is masked in the header and in the query, whatever the key is called', () => {
    expect(
      maskCredentialLiterals(
        req({ auth: { type: 'api-key', apiKey: { key: 'X-Custom', value: LIT, in: 'header' } } }),
      ).auth,
    ).toEqual({ type: 'api-key', apiKey: { key: 'X-Custom', value: CODEGEN_MASK, in: 'header' } })
    expect(
      maskCredentialLiterals(
        req({ auth: { type: 'api-key', apiKey: { key: 'foo', value: LIT, in: 'query' } } }),
      ).auth,
    ).toEqual({ type: 'api-key', apiKey: { key: 'foo', value: CODEGEN_MASK, in: 'query' } })
    const ref = { type: 'api-key', apiKey: { key: 'X-Key', value: '{{k}}', in: 'header' } }
    expect(maskCredentialLiterals(req({ auth: ref })).auth).toEqual(ref)
  })

  it('basic / digest / ntlm: the PASSWORD is masked, user name and domain stay', () => {
    expect(
      maskCredentialLiterals(
        req({ auth: { type: 'basic', basic: { username: 'ada', password: LIT } } }),
      ).auth,
    ).toEqual({ type: 'basic', basic: { username: 'ada', password: CODEGEN_MASK } })
    expect(
      maskCredentialLiterals(
        req({ auth: { type: 'digest', digest: { username: 'ada', password: LIT } } }),
      ).auth,
    ).toEqual({ type: 'digest', digest: { username: 'ada', password: CODEGEN_MASK } })
    expect(
      maskCredentialLiterals(
        req({ auth: { type: 'ntlm', ntlm: { username: 'ada', password: LIT, domain: 'CORP' } } }),
      ).auth,
    ).toEqual({ type: 'ntlm', ntlm: { username: 'ada', password: CODEGEN_MASK, domain: 'CORP' } })
    const ref = { type: 'basic', basic: { username: '{{user}}', password: '{{pw}}' } }
    expect(maskCredentialLiterals(req({ auth: ref })).auth).toEqual(ref)
  })

  it('none / inherit / absent auth is untouched', () => {
    expect(maskCredentialLiterals(req({ auth: { type: 'none' } })).auth).toEqual({ type: 'none' })
    expect(maskCredentialLiterals(req()).auth).toBeUndefined()
  })
})

describe('purity', () => {
  it('never mutates the input (deep-frozen) and is idempotent', () => {
    const input = req({
      url: `https://ada:${LIT}@api.test/x?token=${LIT}`,
      headers: [kv('Authorization', `Bearer ${LIT}`), kv('X-Api-Key', LIT)],
      params: [kv('api_key', LIT)],
      auth: { type: 'basic', basic: { username: 'ada', password: LIT } },
    })
    const snapshot = JSON.parse(JSON.stringify(input))
    const once = maskCredentialLiterals(input)
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot) // untouched
    expect(JSON.stringify(once)).not.toContain(LIT)
    expect(maskCredentialLiterals(once)).toEqual(once)
  })

  it('keeps every other field (method, body, settings, path variables)', () => {
    const input = req({
      method: 'POST',
      body: { type: 'json', content: '{"a":1}' },
      settings: { timeout: 5, followRedirects: false },
      pathVariables: [{ key: 'id', value: '1' }],
      headers: [kv('X-Api-Key', LIT)],
    })
    const out = maskCredentialLiterals(input)
    expect(out).toMatchObject({
      method: 'POST',
      body: { type: 'json', content: '{"a":1}' },
      settings: { timeout: 5, followRedirects: false },
      pathVariables: [{ key: 'id', value: '1' }],
    })
  })
})
