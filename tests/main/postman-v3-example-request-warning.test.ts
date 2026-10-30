/**
 * Issue #276 follow-up — a saved example's own request goes through the same
 * URL check as the request: when its query string and its query parameter
 * list disagree, the parameter list wins and the import report says so,
 * naming the example.
 *
 * Fail-before: `v2Responses` passed a throw-away `[]` as the warnings list,
 * so the example's URL was rewritten silently (and lint flagged the unused
 * `warnings` parameter).
 */
import { describe, it, expect } from 'vitest'
import { convertV3Collection } from '../../src/main/import/postman/v3/to-v2'

describe('issue #276 — Postman v3 example request URL', () => {
  it('a rewritten example query is reported under the example name', () => {
    const warnings: string[] = []
    const conv = convertV3Collection(
      {
        $kind: 'collection',
        name: 'C',
        items: [
          {
            $kind: 'http-request',
            name: 'Get',
            url: 'https://x.test/a?q=1',
            examples: [
              {
                $kind: 'http-example',
                name: 'OK',
                request: {
                  url: 'https://x.test/a?q=old',
                  queryParams: [{ key: 'q', value: 'new' }],
                },
                response: { statusCode: 200 },
              },
            ],
          },
        ],
      },
      warnings,
    )
    const original = conv.collection.item[0].response?.[0].originalRequest
    const raw = typeof original?.url === 'string' ? original.url : original?.url?.raw
    expect(raw).toBe('https://x.test/a?q=new')
    expect(warnings.join('\n')).toMatch(
      /Get \(example OK\).*query string and its query parameters disagreed/,
    )
  })
})
