/**
 * The run report says which iteration each row belongs to.
 *
 * The in-app results (PR #322, `src/renderer/lib/run-result-key.ts`) group a
 * multi-iteration run by iteration; the exported HTML report printed three
 * identical rows for a 3-iteration run of one request, with nothing to tell
 * them apart. `buildRunReport` now labels each main-phase row "Iteration N"
 * when the run has more than one iteration (the same rule as the in-app view:
 * some main row has iteration > 1). Setup / teardown rows belong to no
 * iteration and get no label. A single-iteration run's HTML is byte-identical
 * to what it was before.
 */
import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import type { EndpointRunResult } from '../../src/shared/runner-types'

// No DB in this test: the secret inventory reads null (buildRunReport tolerates it).
vi.mock('../../src/main/db/database', () => ({
  getDb: () => {
    throw new Error('no db in this test')
  },
}))

const { buildRunReport } = await import('../../src/main/lib/run-report')

const GENERATED_AT = Date.UTC(2026, 10, 12, 9, 30, 0)

function row(over: Partial<EndpointRunResult>): EndpointRunResult {
  return {
    endpointId: 'ep-1',
    endpointName: 'Get user',
    method: 'GET',
    url: 'https://api.example.test/users/1',
    status: 200,
    statusText: 'OK',
    duration: 12,
    passed: 1,
    failed: 0,
    skipped: 0,
    assertions: [{ name: 'status is 200', passed: true, actual: '200' }],
    phase: 'main',
    ...over,
  }
}

/** Row header labels, in document order. */
function iterationLabels(html: string): string[] {
  return [...html.matchAll(/<span data-iteration="(\d+)"[^>]*>([^<]*)<\/span>/g)].map(
    (m) => `${m[1]}|${m[2]}`,
  )
}

describe('run report — iteration label per row', () => {
  it('3 iterations → each main row says Iteration 1..3; setup/teardown rows say nothing', () => {
    const results: EndpointRunResult[] = [
      row({ endpointId: 'setup-1', endpointName: 'Create fixture', phase: 'setup' }),
      row({ iteration: 1 }),
      row({ iteration: 2 }),
      row({ iteration: 3, status: 500, statusText: 'Server Error', passed: 0, failed: 1 }),
      // A NOT_RUN teardown row carries `iteration: 1` from main (recordNotRun) —
      // it still belongs to no iteration.
      row({
        endpointId: 'td-1',
        endpointName: 'Delete fixture',
        phase: 'teardown',
        iteration: 1,
        method: '',
        url: '',
        status: null,
        statusText: 'NOT_RUN',
        passed: 0,
        skipped: 1,
        assertions: [],
      }),
    ]
    const html = buildRunReport(results, 'html', { generatedAt: GENERATED_AT })

    expect(iterationLabels(html)).toEqual(['1|Iteration 1', '2|Iteration 2', '3|Iteration 3'])
    // Exactly the three main rows, none on setup / teardown.
    expect(html.match(/data-iteration=/g)).toHaveLength(3)
    const setupRow = html.slice(
      html.indexOf('Create fixture') - 400,
      html.indexOf('Create fixture'),
    )
    expect(setupRow).not.toContain('data-iteration')
    const teardownStart = html.indexOf('<h3')
    expect(teardownStart).toBeGreaterThan(-1)
    expect(html.slice(teardownStart)).not.toContain('data-iteration')
  })

  it('a row with no iteration field in a multi-iteration run reads as Iteration 1 (in-app default)', () => {
    const results = [row({ iteration: undefined }), row({ iteration: 2 })]
    const html = buildRunReport(results, 'html', { generatedAt: GENERATED_AT })
    expect(iterationLabels(html)).toEqual(['1|Iteration 1', '2|Iteration 2'])
  })

  it('1 iteration → no label, and the HTML is byte-identical to the report before this change', () => {
    const results: EndpointRunResult[] = [
      row({ endpointId: 'setup-1', endpointName: 'Create fixture', phase: 'setup' }),
      row({ iteration: 1 }),
      row({
        endpointId: 'ep-2',
        endpointName: 'List users',
        url: 'https://api.example.test/users',
        iteration: 1,
      }),
      row({ endpointId: 'td-1', endpointName: 'Delete fixture', phase: 'teardown' }),
    ]
    const html = buildRunReport(results, 'html', { generatedAt: GENERATED_AT })

    expect(html).not.toContain('data-iteration')
    expect(html).not.toContain('Iteration')
    // sha256 of this exact fixture's report as produced by the code BEFORE the
    // iteration label existed (9820e14). If you change the report on purpose,
    // regenerate it — but a single-iteration report must not change because of
    // the iteration label.
    expect(createHash('sha256').update(html).digest('hex')).toBe(SINGLE_ITERATION_SHA256)
  })

  it('JSON export carries the iteration number on each row (existing field, unchanged name)', () => {
    const results = [
      row({ endpointId: 'setup-1', phase: 'setup' }),
      row({ iteration: 1 }),
      row({ iteration: 2 }),
      row({ iteration: 3 }),
    ]
    const parsed = JSON.parse(buildRunReport(results, 'json')) as EndpointRunResult[]
    expect(parsed.map((r) => [r.phase, r.iteration])).toEqual([
      ['setup', undefined],
      ['main', 1],
      ['main', 2],
      ['main', 3],
    ])
    // The environment variant (issue #307) keeps it too.
    const withEnv = JSON.parse(
      buildRunReport(results, 'json', { environmentName: 'Staging' }),
    ) as EndpointRunResult[]
    expect(withEnv.map((r) => r.iteration)).toEqual([undefined, 1, 2, 3])
  })
})

const SINGLE_ITERATION_SHA256 = '398e0f49ca8ac6cc08481d15836f9c5d0f0450ca9e2b6b4fee44f36740a8e5a5'
