/**
 * The rule for a document with several operations: what the select lists, which
 * name goes out and which path runs. Every caller reads it from here.
 */
import { describe, expect, it } from 'vitest'
import {
  chooseGraphqlOperation,
  importedOperationName,
  isSavedSubscription,
  readSavedGraphql,
  selectableGraphqlOperations,
  subscriptionPayload,
} from '../../../src/shared/graphql-row'
import { graphqlJson, normalizeRequest } from '../../../src/shared/codegen/normalize'

const TWO = 'query GetUser { user { id } }\nmutation Rename { rename }'
const MIXED = 'query Now { now }\nsubscription Feed { tick }'
const SUB_FIRST = 'subscription Feed { tick }\nquery Now { now }'

describe('selectableGraphqlOperations', () => {
  it('lists the operations, past comments and fragments', () => {
    const doc = `# query Hidden { a }
      fragment F on T { a }
      query A { ...F }
      mutation B { b }
      subscription C { c }`
    expect(selectableGraphqlOperations(doc)).toEqual([
      { name: 'A', type: 'query' },
      { name: 'B', type: 'mutation' },
      { name: 'C', type: 'subscription' },
    ])
  })

  it.each([
    ['one named operation', 'query A { a }'],
    ['one anonymous operation', '{ a }'],
    ['anonymous beside a named one', 'query A { a } { b }'],
    ['the same name twice', 'query A { a } query A { b }'],
    ['only a fragment', 'fragment F on T { a }'],
    ['a document that does not parse', 'query A { a } query B {'],
    ['plain text', 'not graphql at all'],
    ['empty', ''],
    ['a {{var}} in an operation name', 'query {{name}} { a } query B { b }'],
  ])('nothing to choose: %s', (_label, doc) => {
    expect(selectableGraphqlOperations(doc)).toEqual([])
  })

  it('handles null and undefined', () => {
    expect(selectableGraphqlOperations(null)).toEqual([])
    expect(selectableGraphqlOperations(undefined)).toEqual([])
  })

  it('a {{var}} anywhere else does not hide the select', () => {
    const doc = `query A { user(id: {{id}}) { name } }
      query B($x: {{type}}) { {{field}} }
      mutation C { set(v: "{{v}}") }`
    expect(selectableGraphqlOperations(doc).map((op) => op.name)).toEqual(['A', 'B', 'C'])
  })

  it('reads again when the document changes, after the cached one', () => {
    expect(selectableGraphqlOperations(TWO)).toHaveLength(2)
    expect(selectableGraphqlOperations('query A { a }')).toEqual([])
    expect(selectableGraphqlOperations(TWO)).toHaveLength(2)
  })

  it('a very deep document is no selector, not a crash', () => {
    const deep = `query A ${'{ a '.repeat(100_000)}${'}'.repeat(100_000)} query B { b }`
    expect(selectableGraphqlOperations(deep)).toEqual([])
  })
})

describe('chooseGraphqlOperation', () => {
  it('one operation: no select, no name, whatever is stored', () => {
    expect(chooseGraphqlOperation('query A { a }', 'A')).toEqual({
      operations: [],
      isSubscription: false,
    })
  })

  it('an unparsable or single-operation document routes as before', () => {
    expect(chooseGraphqlOperation('subscription { tick }', '').isSubscription).toBe(true)
    // Not GraphQL until `{{id}}` is resolved, and still a subscription.
    expect(chooseGraphqlOperation('subscription Feed { tick(a: {{{id}}) }', '')).toEqual({
      operations: [],
      isSubscription: true,
    })
    expect(
      chooseGraphqlOperation('query { subscription: a } # subscription', '').isSubscription,
    ).toBe(false)
  })

  it('nothing selected: the first operation, also for the path', () => {
    expect(chooseGraphqlOperation(TWO, '').operationName).toBe('GetUser')
    expect(chooseGraphqlOperation(MIXED, '')).toMatchObject({
      operationName: 'Now',
      isSubscription: false,
    })
    expect(chooseGraphqlOperation(SUB_FIRST, null)).toMatchObject({
      operationName: 'Feed',
      isSubscription: true,
    })
  })

  it('the selection decides the path', () => {
    expect(chooseGraphqlOperation(MIXED, 'Feed')).toMatchObject({
      operationName: 'Feed',
      isSubscription: true,
    })
    expect(chooseGraphqlOperation(SUB_FIRST, 'Now')).toMatchObject({
      operationName: 'Now',
      isSubscription: false,
    })
    expect(chooseGraphqlOperation(MIXED, 'Feed').staleSelection).toBeUndefined()
  })

  it('a stale selection falls back to the first and says so; the name is never sent', () => {
    const choice = chooseGraphqlOperation(TWO, 'Gone')
    expect(choice.operationName).toBe('GetUser')
    expect(choice.staleSelection).toBe('Gone')
  })
})

describe('what goes out', () => {
  it('graphqlJson: no name, the same bytes as ever', () => {
    expect(graphqlJson('{ me }', '{"a":1}')).toBe('{"query":"{ me }","variables":{"a":1}}')
    expect(graphqlJson('{ me }', '{"a":1}', undefined)).toBe(
      '{"query":"{ me }","variables":{"a":1}}',
    )
  })

  it('graphqlJson: a name goes between them', () => {
    expect(graphqlJson('q', '{}', 'B')).toBe('{"query":"q","operationName":"B","variables":{}}')
  })

  it('subscriptionPayload carries the name only when given', () => {
    expect(subscriptionPayload('q', '')).toEqual({ query: 'q', variables: {} })
    expect(subscriptionPayload('q', '', 'B')).toEqual({
      query: 'q',
      operationName: 'B',
      variables: {},
    })
  })

  it('Generate Code posts the same body', () => {
    const r = normalizeRequest({
      method: 'POST',
      url: 'http://a.test/graphql',
      params: [],
      headers: [],
      body: { type: 'graphql', graphql: { query: 'q', variables: '', operationName: 'B' } },
    })
    expect(r.body).toEqual({
      mode: 'raw',
      format: 'json',
      content: '{"query":"q","operationName":"B","variables":{}}',
    })
  })
})

describe('a saved row', () => {
  const row = (extra: Record<string, unknown>) => ({
    graphql: { url: 'u', query: MIXED, variables: '{}', headers: [], ...extra },
  })

  it('readSavedGraphql: the selection, the first when absent, the first when stale', () => {
    expect(readSavedGraphql(null, row({ operationName: 'Feed' }))?.operationName).toBe('Feed')
    expect(readSavedGraphql(null, row({}))?.operationName).toBe('Now')
    expect(readSavedGraphql(null, row({ operationName: 'Gone' }))?.operationName).toBe('Now')
  })

  it('readSavedGraphql: one operation has no name, a stored one is ignored', () => {
    const saved = readSavedGraphql(null, {
      graphql: { query: 'query A { a }', variables: '{}', operationName: 'A' },
    })
    expect(saved).toEqual({ query: 'query A { a }', variables: '{}' })
    expect(saved).not.toHaveProperty('operationName')
  })

  it('isSavedSubscription follows the selection', () => {
    expect(isSavedSubscription(null, row({ operationName: 'Feed' }))).toBe(true)
    expect(isSavedSubscription(null, row({ operationName: 'Now' }))).toBe(false)
    expect(isSavedSubscription(null, row({}))).toBe(false)
    expect(isSavedSubscription(null, row({ query: SUB_FIRST }))).toBe(true)
    expect(isSavedSubscription(null, row({ query: SUB_FIRST, operationName: 'Now' }))).toBe(false)
  })

  it('isSavedSubscription: an imported JSON body names its operation in the JSON', () => {
    const body = (operationName?: string) => ({
      type: 'json',
      content: JSON.stringify({ query: MIXED, variables: {}, operationName }),
    })
    expect(isSavedSubscription(body('Feed'), null)).toBe(true)
    expect(isSavedSubscription(body('Now'), null)).toBe(false)
    expect(isSavedSubscription(body(), null)).toBe(false)
  })
})

describe('importedOperationName', () => {
  it('keeps a name the document holds', () => {
    expect(importedOperationName(TWO, 'Rename')).toEqual({ keep: 'Rename', lost: false })
  })

  it('reports a name the document does not hold', () => {
    expect(importedOperationName(TWO, 'Gone')).toEqual({ lost: true })
    expect(importedOperationName('{ a }', 'Gone')).toEqual({ lost: true })
  })

  it('one operation: the name adds nothing on the wire and nothing is lost', () => {
    expect(importedOperationName('query A { a }', 'A')).toEqual({ lost: false })
  })

  it('no name, or not a string', () => {
    expect(importedOperationName(TWO, undefined)).toEqual({ lost: false })
    expect(importedOperationName(TWO, '  ')).toEqual({ lost: false })
    expect(importedOperationName(TWO, 7)).toEqual({ lost: false })
  })
})
