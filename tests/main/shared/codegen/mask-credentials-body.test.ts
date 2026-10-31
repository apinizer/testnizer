/**
 * Issue #256 — request BODIES, the structured kinds: with "Include secret
 * values" OFF the credential-named rows of a urlencoded / form-data body are
 * masked like the Params table (`isCredentialArgName`, whole words); file
 * parts, ordinary rows and `{{var}}` references stay. JSON / raw / GraphQL
 * text bodies are NOT scrubbed (the format-preserving JSON scrubbers live in
 * the renderer and in main, not in `src/shared`) — pinned here so a change is
 * deliberate. Contract of the rest: `mask-credentials.test.ts`.
 *
 * Fail-before: `client_secret=…` / a `password` form field were in every
 * snippet regardless of the toggle.
 */
import { describe, expect, it } from 'vitest'
import {
  CODEGEN_MASK,
  maskCredentialLiterals,
} from '../../../../src/shared/codegen/mask-credentials'
import type { CodegenInput, CodegenKv } from '../../../../src/shared/codegen'
import { generateSnippet } from '../../../../src/renderer/lib/code-generator'
import type { CodeGenRequest } from '../../../../src/renderer/lib/code-generator'
import { kv as rkv } from '../../../fixtures/codegen-cases'

const LIT = 'BODY-LITERAL-s3cr3t-4b1d'

const kv = (key: string, value: string, extra: Partial<CodegenKv> = {}): CodegenKv => ({
  key,
  value,
  enabled: true,
  ...extra,
})

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

const req = (over: Partial<CodegenInput> = {}): CodegenInput =>
  deepFreeze({ method: 'POST', url: 'https://api.test/token', ...over })

describe('urlencoded body', () => {
  it('masks credential-named fields, keeps the others and {{refs}}', () => {
    const out = maskCredentialLiterals(
      req({
        body: {
          type: 'urlencoded',
          urlEncoded: [
            kv('grant_type', 'client_credentials'),
            kv('client_id', 'my-app'),
            kv('client_secret', LIT),
            kv('password', LIT),
            kv('refresh_token', '{{rt}}'),
            kv('author', 'ada'),
            kv('api_key', ''),
          ],
        },
      }),
    )
    expect(out.body).toEqual({
      type: 'urlencoded',
      urlEncoded: [
        kv('grant_type', 'client_credentials'),
        kv('client_id', 'my-app'),
        kv('client_secret', CODEGEN_MASK),
        kv('password', CODEGEN_MASK),
        kv('refresh_token', '{{rt}}'),
        kv('author', 'ada'),
        kv('api_key', ''),
      ],
    })
  })

  it('a disabled row is not sent, so it is left alone', () => {
    const rows = [kv('password', LIT, { enabled: false })]
    expect(maskCredentialLiterals(req({ body: { type: 'urlencoded', urlEncoded: rows } })).body)
      .toEqual({ type: 'urlencoded', urlEncoded: rows })
  })
})

describe('form-data body', () => {
  it('masks credential-named text parts, never a file part', () => {
    const out = maskCredentialLiterals(
      req({
        body: {
          type: 'form-data',
          formData: [
            kv('username', 'ada'),
            kv('password', LIT, { type: 'text' }),
            kv('token', 'avatar.png', { type: 'file', filePath: '/tmp/avatar.png' }),
            kv('note', 'hello'),
          ],
        },
      }),
    )
    expect(out.body).toEqual({
      type: 'form-data',
      formData: [
        kv('username', 'ada'),
        kv('password', CODEGEN_MASK, { type: 'text' }),
        kv('token', 'avatar.png', { type: 'file', filePath: '/tmp/avatar.png' }),
        kv('note', 'hello'),
      ],
    })
  })
})

describe('text bodies are out of scope (no shared JSON scrubber)', () => {
  it('a JSON / raw / GraphQL body is returned as typed', () => {
    for (const body of [
      { type: 'json', content: `{"password":"${LIT}"}` },
      { type: 'text', content: `password=${LIT}` },
      { type: 'graphql', graphql: { query: '{ me }', variables: `{"token":"${LIT}"}` } },
    ]) {
      expect(maskCredentialLiterals(req({ body })).body).toEqual(body)
    }
  })
})

describe('a scheme word in front of a reference (any credential header)', () => {
  it('`Token {{k}}` carries no secret and stays; `Token abc` is masked', () => {
    const headers = [kv('X-Api-Key', 'Token {{k}}'), kv('X-Auth', 'Bearer {{t}}')]
    expect(maskCredentialLiterals(req({ headers })).headers).toEqual(headers)
    expect(maskCredentialLiterals(req({ headers: [kv('X-Api-Key', `Token ${LIT}`)] })).headers)
      .toEqual([kv('X-Api-Key', CODEGEN_MASK)])
  })
})

describe('through the facade', () => {
  const tokenRequest = (): CodeGenRequest => ({
    method: 'POST',
    url: 'https://api.test/token',
    params: [],
    headers: [],
    body: {
      type: 'urlencoded',
      urlEncoded: [rkv('grant_type', 'password'), rkv('password', LIT)],
    },
  })
  const upload = (): CodeGenRequest => ({
    method: 'POST',
    url: 'https://api.test/upload',
    params: [],
    headers: [],
    body: {
      type: 'form-data',
      formData: [rkv('api_key', LIT), rkv('file', 'a.txt', { type: 'file', filePath: '/tmp/a.txt' })],
    },
  })

  it('toggle OFF: the literal is not in the cURL / Python snippet, the field name is', () => {
    for (const id of ['curl', 'python-requests']) {
      for (const make of [tokenRequest, upload]) {
        const code = generateSnippet(id, deepFreeze(make()), { includeSecrets: false })
        expect(code, id).not.toContain(LIT)
        expect(code, id).toContain(CODEGEN_MASK)
      }
    }
    const curl = generateSnippet('curl', upload(), { includeSecrets: false })
    expect(curl).toContain('/tmp/a.txt')
  })

  it('toggle ON / unknown: as typed', () => {
    expect(generateSnippet('curl', tokenRequest(), { includeSecrets: true })).toContain(LIT)
    expect(generateSnippet('curl', upload())).toContain(LIT)
  })
})
