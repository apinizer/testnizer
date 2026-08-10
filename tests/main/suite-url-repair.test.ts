/**
 * The rule that decides whether a suite item's URL lost a `{{variable}}` prefix
 * — tested as a pure function, away from any database.
 *
 * It rewrites user data, so most of these cases are about what it must NOT
 * touch. The migration and BOTH import paths share this one function; a change
 * here changes all three, which is the point.
 */
import { describe, it, expect } from 'vitest'
import { repairedSuiteItemUrl } from '../../src/main/lib/suite-url-repair'

const schema = (url: unknown): string => JSON.stringify({ method: 'GET', url })

describe('a dropped variable prefix is detected', () => {
  it('restores the reported shape', () => {
    expect(repairedSuiteItemUrl('/test/healthcheck', schema('{{AccessURL}}/test/healthcheck'))).toBe(
      '{{AccessURL}}/test/healthcheck',
    )
  })

  it('handles a variable that is not the whole prefix', () => {
    expect(repairedSuiteItemUrl('/employee', schema('{{baseUrl}}/api/v2/employee'))).toBe(
      '{{baseUrl}}/api/v2/employee',
    )
  })

  it('is idempotent — a repaired value reports nothing further to do', () => {
    const once = repairedSuiteItemUrl('/x', schema('{{Host}}/x'))
    expect(once).toBe('{{Host}}/x')
    expect(repairedSuiteItemUrl(once, schema('{{Host}}/x'))).toBeNull()
  })
})

describe('what it must leave alone', () => {
  it('a URL shortened on purpose, with no variable in the missing part', () => {
    // Still a tail of the schema URL, but only a host was lost — an edit, not
    // the bug.
    expect(repairedSuiteItemUrl('/health', schema('https://api.example.com/health'))).toBeNull()
  })

  it('a URL that is not a tail of the schema URL at all', () => {
    expect(
      repairedSuiteItemUrl('/completely/different', schema('{{AccessURL}}/test/health')),
    ).toBeNull()
  })

  it('a URL that is already correct', () => {
    expect(repairedSuiteItemUrl('{{AccessURL}}/x', schema('{{AccessURL}}/x'))).toBeNull()
  })

  it('an empty or missing stored URL', () => {
    expect(repairedSuiteItemUrl('', schema('{{A}}/x'))).toBeNull()
    expect(repairedSuiteItemUrl(null, schema('{{A}}/x'))).toBeNull()
    expect(repairedSuiteItemUrl(undefined, schema('{{A}}/x'))).toBeNull()
  })

  it('a schema that is absent, unparseable, or carries a non-string url', () => {
    expect(repairedSuiteItemUrl('/a', null)).toBeNull()
    expect(repairedSuiteItemUrl('/a', '')).toBeNull()
    expect(repairedSuiteItemUrl('/a', 'not json')).toBeNull()
    expect(repairedSuiteItemUrl('/a', '{}')).toBeNull()
    expect(repairedSuiteItemUrl('/a', schema(42))).toBeNull()
    expect(repairedSuiteItemUrl('/a', schema(''))).toBeNull()
  })
})
