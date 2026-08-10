/**
 * The QUERY HTTP method.
 *
 * QUERY is the safe, idempotent method that carries a request BODY — the
 * standardised answer to "GET with a body, or POST?" for read operations whose
 * parameters do not fit in a URL. It matters for machine-generated requests
 * too: a method whose intent is unambiguous is one a model can pick correctly.
 *
 * Nothing in the send path decides whether to include a body by looking at the
 * method, so QUERY works end to end once it is selectable — these tests pin the
 * places that enumerate methods, which is where a new one silently goes missing.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getMethodColors } from '../../src/renderer/styles/tokens'

const read = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8')

describe('QUERY is offered wherever a method is chosen', () => {
  it('is in the request bar’s method list', () => {
    expect(read('src/renderer/components/layout/UrlBar.tsx')).toMatch(/'QUERY'/)
  })

  it('is in the mock server’s method list', () => {
    expect(read('src/renderer/components/mock/MockServerEditor.tsx')).toMatch(/'QUERY'/)
  })

  it('is part of both method unions', () => {
    const types = read('src/renderer/types/index.ts')
    // `HttpMethod` and `MockMethod` are separate unions; a method added to one
    // and forgotten in the other is a type error waiting for the first mock.
    const httpUnion = types.slice(types.indexOf('export type HttpMethod'), types.indexOf('export type HttpMethod') + 300)
    const mockUnion = types.slice(types.indexOf('export type MockMethod'), types.indexOf('export type MockMethod') + 300)
    expect(httpUnion).toContain("'QUERY'")
    expect(mockUnion).toContain("'QUERY'")
  })

  it('is advertised by a mock server’s CORS defaults', () => {
    // A browser preflight that does not list QUERY makes the method unusable
    // against a mock, which is exactly where people try a new method first.
    expect(read('src/main/db/mock.repo.ts')).toContain('QUERY')
    expect(read('src/main/mock/server.ts')).toContain('QUERY')
  })
})

describe('QUERY renders like a first-class method', () => {
  it('has its own badge colours rather than falling back', () => {
    const query = getMethodColors('QUERY')
    const get = getMethodColors('GET')
    const unknown = getMethodColors('NOPE')

    expect(query).toBeTruthy()
    // Distinct from GET — the two are easy to confuse at a glance, and QUERY
    // exists precisely because it is NOT GET.
    expect(query).not.toEqual(get)
    // …and it is a real entry, not the unknown-method fallback.
    expect(query).not.toEqual(unknown)
  })

  it('keeps the CSS variables its badge reads', () => {
    const css = read('src/renderer/styles/globals.css')
    for (const v of ['--mb-query-bg', '--mb-query-fg', '--mb-query-br']) {
      // Defined twice: light theme and dark.
      expect(css.split(v).length - 1).toBeGreaterThanOrEqual(2)
    }
  })
})
