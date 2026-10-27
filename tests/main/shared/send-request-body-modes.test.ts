/**
 * Issue #281 — `pm.sendRequest` `graphql` and `file` body modes. Both used to
 * fall through the normaliser's `default` and the request went out with NO
 * body, silently. The normaliser is the one Send and Run share
 * (`src/shared/script/send-request.ts`).
 *
 *  - `graphql` → Postman's wire shape: a JSON body `{query, variables}`
 *    (`operationName` too when given), sent as `application/json` (the engine's
 *    `json` body type adds the header unless the script set one). A string
 *    `variables` is parsed the way the GraphQL editor's Send parses it — an
 *    unparsable / empty string becomes `{}`.
 *  - `file` → refused loudly, like a formdata file part: scripts have no file
 *    sandbox, and a script must not read arbitrary local paths from main.
 */
import { describe, it, expect } from 'vitest'
import { normalizePmSendInput } from '../../../src/shared/script/send-request'

const send = (body: unknown) =>
  normalizePmSendInput({ url: 'https://api.test/graphql', method: 'POST', body })

describe('pm.sendRequest graphql body', () => {
  it('a string `variables` is parsed into the JSON body', () => {
    const out = send({
      mode: 'graphql',
      graphql: { query: 'query Q($id: ID!) { user(id: $id) { name } }', variables: '{"id":"7"}' },
    })
    expect(out.body?.type).toBe('json')
    expect(JSON.parse(out.body?.content ?? '')).toEqual({
      query: 'query Q($id: ID!) { user(id: $id) { name } }',
      variables: { id: '7' },
    })
  })

  it('an object `variables` is used as-is; operationName is carried', () => {
    const out = send({
      mode: 'graphql',
      graphql: { query: '{ a }', variables: { n: 1 }, operationName: 'Op' },
    })
    expect(JSON.parse(out.body?.content ?? '')).toEqual({
      query: '{ a }',
      operationName: 'Op',
      variables: { n: 1 },
    })
  })

  it('empty or unparsable variables become {} (the GraphQL editor rule)', () => {
    for (const variables of ['', 'not json', undefined]) {
      const out = send({ mode: 'graphql', graphql: { query: '{ a }', variables } })
      expect(JSON.parse(out.body?.content ?? '')).toEqual({ query: '{ a }', variables: {} })
    }
    expect(JSON.parse(send({ mode: 'graphql' }).body?.content ?? '')).toEqual({
      query: '',
      variables: {},
    })
  })

  it('keeps the script headers untouched (the engine adds Content-Type only when absent)', () => {
    const out = normalizePmSendInput({
      url: 'https://api.test/graphql',
      method: 'POST',
      header: { 'Content-Type': 'application/graphql+json' },
      body: { mode: 'graphql', graphql: { query: '{ a }' } },
    })
    expect(out.headers).toEqual([
      { key: 'Content-Type', value: 'application/graphql+json', enabled: true },
    ])
  })
})

describe('pm.sendRequest file body', () => {
  it('is refused with a clear message instead of sending no body', () => {
    expect(() => send({ mode: 'file', file: { src: '/etc/hosts' } })).toThrow(
      'pm.sendRequest: a "file" body (/etc/hosts) is not supported in scripts',
    )
    expect(() => send({ mode: 'file' })).toThrow(
      'pm.sendRequest: a "file" body is not supported in scripts',
    )
  })
})
