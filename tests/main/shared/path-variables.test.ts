/**
 * Issue #276 — the one path-variable helper Send, Run, codegen and
 * `export:curl` share (`src/shared/path-variables.ts`).
 */
import { describe, expect, it } from 'vitest'
import {
  applyPathVariables,
  pathVariableNames,
  pathVariablesField,
  readPathVariables,
  readPathVariablesJson,
  syncPathVariables,
} from '../../../src/shared/path-variables'

describe('pathVariableNames', () => {
  it('finds :name path segments in order, once each', () => {
    expect(pathVariableNames('{{baseUrl}}/users/:id/posts/:postId/:id')).toEqual(['id', 'postId'])
    expect(pathVariableNames('https://api.test/v1/:org/repos?x=:notThis#:nor')).toEqual(['org'])
    expect(pathVariableNames('/relative/:a')).toEqual(['a'])
  })

  it('ignores the port, a mid-segment colon, a bare ":" and URLs without a path', () => {
    expect(pathVariableNames('http://localhost:8080/items')).toEqual([])
    expect(pathVariableNames('localhost:3000/items/:id')).toEqual(['id'])
    expect(pathVariableNames('https://x.test/v1/files:batchGet')).toEqual([])
    expect(pathVariableNames('https://x.test/a/:/b')).toEqual([])
    expect(pathVariableNames('https://x.test')).toEqual([])
    expect(pathVariableNames('')).toEqual([])
  })
})

describe('applyPathVariables', () => {
  const rows = [
    { key: 'id', value: '42' },
    { key: 'postId', value: '{{post}}' },
  ]
  it('substitutes path segments only (host, port, query and fragment untouched)', () => {
    expect(
      applyPathVariables('http://h.test:8080/users/:id/posts/:postId?id=:id#:id', rows),
    ).toBe('http://h.test:8080/users/42/posts/{{post}}?id=:id#:id')
    expect(applyPathVariables('{{baseUrl}}/users/:id', rows)).toBe('{{baseUrl}}/users/42')
  })

  it('keeps :name literal when there is no row or the value is empty (old requests unchanged)', () => {
    expect(applyPathVariables('/users/:id/:other', [{ key: 'id', value: '' }])).toBe(
      '/users/:id/:other',
    )
    expect(applyPathVariables('/users/:id', [])).toBe('/users/:id')
    expect(applyPathVariables('/users/:id', undefined)).toBe('/users/:id')
  })

  it('does not match a longer name as a prefix', () => {
    expect(applyPathVariables('/a/:idx', [{ key: 'id', value: '1' }])).toBe('/a/:idx')
  })
})

describe('syncPathVariables', () => {
  let n = 0
  const create = (key: string) => ({ id: `new-${++n}`, key, value: '' })

  it('adds rows for new names, keeps values of existing ones, drops removed ones', () => {
    const start = [{ id: 'a', key: 'id', value: '7', description: 'd' }]
    const next = syncPathVariables('/u/:org/:id', start, create)
    expect(next).toEqual([
      { id: expect.stringMatching(/^new-/), key: 'org', value: '' },
      { id: 'a', key: 'id', value: '7', description: 'd' },
    ])
    expect(syncPathVariables('/u/:org', next, create)).toEqual([next[0]])
  })

  it('returns the same array when nothing changed', () => {
    const rows = [{ id: 'a', key: 'id', value: '1' }]
    expect(syncPathVariables('/u/:id?q=1', rows, create)).toBe(rows)
  })
})

describe('stored form', () => {
  it('reads tolerant input and writes nothing for no rows', () => {
    expect(
      readPathVariables({
        pathVariables: [
          { key: 'id', value: 5 },
          { key: '', value: 'x' },
          'junk',
          { id: 'r1', key: 'a', value: 'b', description: 'c' },
        ],
      }),
    ).toEqual([
      { key: 'id', value: '5' },
      { id: 'r1', key: 'a', value: 'b', description: 'c' },
    ])
    expect(readPathVariables({})).toEqual([])
    expect(readPathVariablesJson('{bad')).toEqual([])
    expect(readPathVariablesJson(JSON.stringify({ pathVariables: [{ key: 'k', value: 'v' }] })))
      .toEqual([{ key: 'k', value: 'v' }])
    expect(pathVariablesField([])).toEqual({})
    expect(
      pathVariablesField([{ id: 'x', key: 'k', value: 'v', description: '' }]),
    ).toEqual({ pathVariables: [{ id: 'x', key: 'k', value: 'v' }] })
  })
})

describe('History masking (issue #276 + #195)', () => {
  it('a credential-named path variable is masked in the stored configured request', async () => {
    const { createScrubber, maskRequestLike } = await import('../../../src/main/lib/sensitive-scrub')
    const out = maskRequestLike(
      {
        configured: {
          url: 'https://x.test/:token/:id',
          pathVariables: [
            { key: 'token', value: 'LITERAL-SECRET-123' },
            { key: 'id', value: '42' },
            { key: 'apiKey', value: '{{key}}' },
          ],
        },
      },
      createScrubber([]),
    ) as { configured: { pathVariables: Array<{ key: string; value: string }> } }
    const values = out.configured.pathVariables.map((r) => r.value)
    expect(values[0]).not.toBe('LITERAL-SECRET-123')
    expect(values[1]).toBe('42')
    expect(values[2]).toBe('{{key}}')
  })
})
