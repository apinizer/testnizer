/**
 * Review findings P0-1 and P0-2 on commit 5a2d083 (issue #256) — "Include
 * secret values" OFF must not leave a LITERAL credential in the snippet when
 * the credential's *location* is itself templated:
 *
 *  P0-1  URL with a templated scheme, `{{scheme}}://alice:literal-password@host/x`
 *        (`mask-credentials.ts` `URL_USERINFO` only accepts `scheme://`).
 *  P0-2  header NAME `{{header}}` (= Authorization), query KEY `{{k}}` (= api_key),
 *        form row key `{{k}}`, and an API key whose key NAME is a variable:
 *        names are classified BEFORE `{{var}}` resolution, so `{{header}}` is
 *        not seen as credential-bearing and its literal value is kept.
 *
 * Expected today: the P0-1 and P0-2 header/query/urlencoded/form-data cases are
 * RED (the finding reproduces). The API-key-with-variable-name case is a guard
 * (auth masks the apiKey VALUE regardless of the key name).
 */
import { describe, expect, it } from 'vitest'
import { ALL_VARIANTS } from '../../../../src/shared/codegen'
import { generateSnippet } from '../../../../src/renderer/lib/code-generator'
import type { CodeGenRequest } from '../../../../src/renderer/lib/code-generator'
import { kv } from '../../../fixtures/codegen-cases'

const OPTS = (envVars: Record<string, string>) => ({ includeSecrets: false as const, envVars })

describe('P0-1: templated scheme before URL userinfo', () => {
  const req = (): CodeGenRequest => ({
    method: 'GET',
    url: '{{scheme}}://alice:literal-password@api.test/x',
    params: [],
    headers: [],
  })

  it('cURL does not contain the userinfo password', () => {
    const code = generateSnippet('curl', req(), OPTS({ scheme: 'https' }))
    expect(code).not.toContain('literal-password')
  })

  for (const v of ALL_VARIANTS) {
    it(`${v.id} does not contain the userinfo password`, () => {
      const code = generateSnippet(v.id, req(), OPTS({ scheme: 'https' }))
      expect(code).not.toContain('literal-password')
    })
  }

  it('also without a variable scope (scheme stays {{scheme}})', () => {
    const code = generateSnippet('curl', req(), { includeSecrets: false })
    expect(code).not.toContain('literal-password')
  })
})

describe('P0-2: credential NAME supplied by a variable', () => {
  it('header {{header}} = Authorization with a literal Bearer token', () => {
    const code = generateSnippet(
      'curl',
      {
        method: 'GET',
        url: 'https://api.test/x',
        params: [],
        headers: [kv('{{header}}', 'Bearer literal-token')],
      },
      OPTS({ header: 'Authorization' }),
    )
    expect(code).not.toContain('literal-token')
  })

  it('every variant: header {{header}} = X-Api-Key', () => {
    for (const v of ALL_VARIANTS) {
      const code = generateSnippet(
        v.id,
        {
          method: 'GET',
          url: 'https://api.test/x',
          params: [],
          headers: [kv('{{header}}', 'literal-token')],
        },
        OPTS({ header: 'X-Api-Key' }),
      )
      expect(code, v.id).not.toContain('literal-token')
    }
  })

  it('Params row key {{k}} = api_key', () => {
    const code = generateSnippet(
      'curl',
      {
        method: 'GET',
        url: 'https://api.test/x',
        params: [kv('{{k}}', 'literal-qval')],
        headers: [],
      },
      OPTS({ k: 'api_key' }),
    )
    expect(code).not.toContain('literal-qval')
  })

  it('URL query key {{k}}=literal with k = api_key', () => {
    const code = generateSnippet(
      'curl',
      { method: 'GET', url: 'https://api.test/x?{{k}}=literal-qval', params: [], headers: [] },
      OPTS({ k: 'api_key' }),
    )
    expect(code).not.toContain('literal-qval')
  })

  it('urlencoded body row key {{k}} = password', () => {
    const code = generateSnippet(
      'curl',
      {
        method: 'POST',
        url: 'https://api.test/x',
        params: [],
        headers: [],
        body: {
          type: 'urlencoded',
          urlEncoded: [kv('{{k}}', 'literal-form-pw')],
        } as CodeGenRequest['body'],
      },
      OPTS({ k: 'password' }),
    )
    expect(code).not.toContain('literal-form-pw')
  })

  it('form-data body row key {{k}} = client_secret', () => {
    const code = generateSnippet(
      'curl',
      {
        method: 'POST',
        url: 'https://api.test/x',
        params: [],
        headers: [],
        body: {
          type: 'form-data',
          formData: [kv('{{k}}', 'literal-form-secret')],
        } as CodeGenRequest['body'],
      },
      OPTS({ k: 'client_secret' }),
    )
    expect(code).not.toContain('literal-form-secret')
  })

  it('GUARD: API key auth whose key NAME is a variable still masks the value', () => {
    for (const where of ['header', 'query'] as const) {
      const code = generateSnippet(
        'curl',
        {
          method: 'GET',
          url: 'https://api.test/x',
          params: [],
          headers: [],
          auth: { type: 'api-key', apiKey: { key: '{{k}}', value: 'literal-apikey', in: where } },
        },
        OPTS({ k: 'X-Thing' }),
      )
      expect(code, where).not.toContain('literal-apikey')
    }
  })
})
