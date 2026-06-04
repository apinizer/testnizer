/**
 * Pins `extractGraphQLErrors` — the helper that powers the
 * "GraphQL errors (N)" banner in `GraphQLResponsePane`. The banner only fires
 * for HTTP-200 responses that nevertheless carry an `errors[]` array, so the
 * helper has to be defensive about malformed JSON, non-array `errors`, and
 * entries that lack a `message`.
 */

import { describe, it, expect } from 'vitest'
import { extractGraphQLErrors } from '../../src/renderer/lib/graphql-errors'

describe('extractGraphQLErrors', () => {
  it('returns [] for an empty body', () => {
    expect(extractGraphQLErrors('')).toEqual([])
  })

  it('returns [] for non-JSON', () => {
    expect(extractGraphQLErrors('not json')).toEqual([])
  })

  it('returns [] when there is no errors[] field', () => {
    expect(extractGraphQLErrors(JSON.stringify({ data: { x: 1 } }))).toEqual([])
  })

  it('extracts message + dotted path', () => {
    const body = JSON.stringify({
      data: null,
      errors: [{ message: 'User not found', path: ['user', 'profile'] }],
    })
    expect(extractGraphQLErrors(body)).toEqual([
      { message: 'User not found', path: 'user.profile' },
    ])
  })

  it('skips entries without a message', () => {
    const body = JSON.stringify({
      errors: [{ path: ['x'] }, { message: 'ok' }, null, 'string', { message: '' }],
    })
    expect(extractGraphQLErrors(body)).toEqual([{ message: 'ok', path: undefined }])
  })

  it('handles multiple errors in order', () => {
    const body = JSON.stringify({
      errors: [
        { message: 'A', path: ['a'] },
        { message: 'B' },
      ],
    })
    expect(extractGraphQLErrors(body)).toEqual([
      { message: 'A', path: 'a' },
      { message: 'B', path: undefined },
    ])
  })
})
