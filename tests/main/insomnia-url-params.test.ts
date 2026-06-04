/**
 * #12 — Insomnia keeps query params in a separate array and a clean URL, so
 * imported requests showed no query in the URL bar (unlike Postman). The
 * importer now folds enabled params back into the URL. Pins that mapping.
 */
import { describe, it, expect } from 'vitest'
import { insomniaUrlWithParams } from '../../src/main/ipc/import-export.handler'

describe('insomniaUrlWithParams (#12)', () => {
  it('appends enabled params as a query string', () => {
    const url = insomniaUrlWithParams('https://api.example.com/emp', [
      { key: 'empNo', value: '{{test_empNo}}', enabled: true },
      { key: 'active', value: 'true', enabled: true },
    ])
    expect(url).toBe('https://api.example.com/emp?empNo={{test_empNo}}&active=true')
  })

  it('keeps {{variables}} unencoded', () => {
    expect(
      insomniaUrlWithParams('https://x/y', [{ key: 'token', value: '{{authToken}}', enabled: true }]),
    ).toBe('https://x/y?token={{authToken}}')
  })

  it('skips disabled + empty-key params', () => {
    const url = insomniaUrlWithParams('https://x/y', [
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: false },
      { key: '', value: '3', enabled: true },
    ])
    expect(url).toBe('https://x/y?a=1')
  })

  it('leaves the URL untouched when it already carries a query', () => {
    expect(
      insomniaUrlWithParams('https://x/y?already=1', [{ key: 'a', value: '1', enabled: true }]),
    ).toBe('https://x/y?already=1')
  })

  it('returns the bare URL when there are no enabled params', () => {
    expect(insomniaUrlWithParams('https://x/y', [])).toBe('https://x/y')
  })
})
