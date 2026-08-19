/**
 * Issue #114 — Run results needed a search box and a method filter.
 *
 * A 500-request run is not navigable with All / Passed / Failed alone: users
 * need to find one request by name or URL, or review one verb at a time (all
 * the DELETE cleanup steps, say). All three narrowings compose in one pure
 * predicate so the iteration bucketing and the setup/teardown sections keep
 * working unchanged.
 */
import { describe, it, expect } from 'vitest'
import {
  filterRunResults,
  matchesRunResultFilter,
  runResultMethods,
  isRunResultFilterActive,
  EMPTY_RUN_RESULT_FILTER,
} from '../../src/renderer/lib/runner-result-filter'
import type { EndpointRunResult } from '../../src/shared/runner-types'

function res(over: Partial<EndpointRunResult>): EndpointRunResult {
  return {
    endpointId: over.endpointName ?? 'id',
    endpointName: 'Request',
    method: 'GET',
    url: 'https://api.test/v1/thing',
    status: 200,
    statusText: 'OK',
    duration: 5,
    passed: 1,
    failed: 0,
    skipped: 0,
    assertions: [],
    ...over,
  } as EndpointRunResult
}

const RUN: EndpointRunResult[] = [
  res({ endpointName: 'List users', method: 'GET', url: 'https://api.test/users' }),
  res({ endpointName: 'Create user', method: 'POST', url: 'https://api.test/users' }),
  res({ endpointName: 'Delete user', method: 'DELETE', url: 'https://api.test/users/1' }),
  res({
    endpointName: 'Delete order',
    method: 'DELETE',
    url: 'https://api.test/orders/9',
    folderName: 'Cleanup',
    status: 500,
    passed: 0,
    failed: 1,
  }),
]

const filter = (over: Partial<typeof EMPTY_RUN_RESULT_FILTER>) => ({
  ...EMPTY_RUN_RESULT_FILTER,
  ...over,
})

describe('search', () => {
  it('matches the request name, case-insensitively', () => {
    const hit = filterRunResults(RUN, filter({ text: 'create' }))
    expect(hit.map((r) => r.endpointName)).toEqual(['Create user'])
  })

  it('matches the URL, so two requests with the same name stay distinguishable', () => {
    const hit = filterRunResults(RUN, filter({ text: '/orders/' }))
    expect(hit.map((r) => r.endpointName)).toEqual(['Delete order'])
  })

  it('matches the folder name', () => {
    const hit = filterRunResults(RUN, filter({ text: 'cleanup' }))
    expect(hit.map((r) => r.endpointName)).toEqual(['Delete order'])
  })

  it('trims the query so a pasted trailing space does not empty the list', () => {
    expect(filterRunResults(RUN, filter({ text: '  users ' }))).toHaveLength(3)
  })

  it('an empty query narrows nothing', () => {
    expect(filterRunResults(RUN, filter({ text: '   ' }))).toHaveLength(RUN.length)
  })
})

describe('method filter', () => {
  it('keeps only the selected verb', () => {
    const hit = filterRunResults(RUN, filter({ methods: ['DELETE'] }))
    expect(hit.map((r) => r.endpointName)).toEqual(['Delete user', 'Delete order'])
  })

  it('is multi-select', () => {
    const hit = filterRunResults(RUN, filter({ methods: ['POST', 'DELETE'] }))
    expect(hit).toHaveLength(3)
  })

  it('an empty selection means every method, not none', () => {
    // Clearing the last chip must not look like a broken list.
    expect(filterRunResults(RUN, filter({ methods: [] }))).toHaveLength(RUN.length)
  })

  it('compares case-insensitively', () => {
    const lower = [res({ endpointName: 'x', method: 'delete' })]
    expect(filterRunResults(lower, filter({ methods: ['DELETE'] }))).toHaveLength(1)
  })
})

describe('the three narrowings compose', () => {
  it('search + method + outcome tab all apply together', () => {
    const hit = filterRunResults(RUN, { tab: 'failed', text: 'user', methods: ['DELETE'] })
    // "Delete user" passed, "Delete order" failed but does not match "user".
    expect(hit).toHaveLength(0)

    const hit2 = filterRunResults(RUN, { tab: 'failed', text: 'order', methods: ['DELETE'] })
    expect(hit2.map((r) => r.endpointName)).toEqual(['Delete order'])
  })

  it('the outcome tabs behave exactly as before on their own', () => {
    expect(filterRunResults(RUN, filter({ tab: 'passed' }))).toHaveLength(3)
    expect(filterRunResults(RUN, filter({ tab: 'failed' }))).toHaveLength(1)
    expect(filterRunResults(RUN, filter({ tab: 'all' }))).toHaveLength(4)
  })

  it('a skipped row appears only under Skipped', () => {
    const skipped = res({
      endpointName: 'Skipped one',
      status: null,
      statusText: 'Skipped',
      passed: 0,
      skipped: 1,
    })
    const all = [...RUN, skipped]
    expect(filterRunResults(all, filter({ tab: 'skipped' })).map((r) => r.endpointName)).toEqual([
      'Skipped one',
    ])
    expect(
      filterRunResults(all, filter({ tab: 'passed' })).map((r) => r.endpointName),
    ).not.toContain('Skipped one')
  })
})

describe('the method chips offered', () => {
  it('lists only verbs the run actually contains, in REST reading order', () => {
    expect(runResultMethods(RUN)).toEqual(['GET', 'POST', 'DELETE'])
  })

  it('does not offer a chip that could only ever produce an empty list', () => {
    expect(runResultMethods(RUN)).not.toContain('PATCH')
  })

  it('ignores rows with no verb rather than offering a blank chip', () => {
    expect(runResultMethods([res({ method: '' }), res({ method: 'GET' })])).toEqual(['GET'])
  })

  it('puts non-REST verbs after the known ones', () => {
    expect(runResultMethods([res({ method: 'GRPC' }), res({ method: 'GET' })])).toEqual([
      'GET',
      'GRPC',
    ])
  })
})

describe('filter-active flag', () => {
  it('is false for the untouched default', () => {
    expect(isRunResultFilterActive(EMPTY_RUN_RESULT_FILTER)).toBe(false)
  })

  it('is true once any of the three narrows', () => {
    expect(isRunResultFilterActive(filter({ text: 'a' }))).toBe(true)
    expect(isRunResultFilterActive(filter({ methods: ['GET'] }))).toBe(true)
    expect(isRunResultFilterActive(filter({ tab: 'failed' }))).toBe(true)
  })
})

describe('matchesRunResultFilter is the single row predicate', () => {
  it('agrees with the list filter', () => {
    const f = { tab: 'all' as const, text: 'delete', methods: ['DELETE'] }
    expect(RUN.filter((r) => matchesRunResultFilter(r, f))).toEqual(filterRunResults(RUN, f))
  })
})
