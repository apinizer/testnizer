import { JSONPath } from 'jsonpath-plus'

export type JsonPathResult =
  | { ok: true; matches: unknown[]; paths: string[] }
  | { ok: false; error: string }

/**
 * Evaluate a JSONPath expression against a JSON document (string).
 * Returns matched values + their resolved paths.
 *
 * Examples:
 *   $.store.book[*].author        — all authors
 *   $..price                      — every price recursively
 *   $.book[?(@.price < 10)].title — filter expression
 */
export function evaluateJsonPath(json: string, expression: string): JsonPathResult {
  if (!expression || !expression.trim()) {
    return { ok: false, error: 'Path expression is empty' }
  }
  type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
  let parsed: JsonValue
  try {
    parsed = JSON.parse(json) as JsonValue
  } catch (e) {
    return { ok: false, error: 'Invalid JSON: ' + (e instanceof Error ? e.message : String(e)) }
  }
  try {
    const matches = JSONPath({ path: expression, json: parsed }) as unknown as unknown[]
    const paths = JSONPath({
      path: expression,
      json: parsed,
      resultType: 'path',
    }) as unknown as string[]
    return { ok: true, matches, paths }
  } catch (e) {
    return {
      ok: false,
      error: 'JSONPath error: ' + (e instanceof Error ? e.message : String(e)),
    }
  }
}

/** Goessner-style "store" document used by the canonical JSONPath samples. */
export const JSONPATH_SAMPLE_DOC = JSON.stringify(
  {
    store: {
      book: [
        {
          category: 'reference',
          author: 'Nigel Rees',
          title: 'Sayings of the Century',
          price: 8.95,
        },
        {
          category: 'fiction',
          author: 'Evelyn Waugh',
          title: 'Sword of Honour',
          price: 12.99,
        },
        {
          category: 'fiction',
          author: 'Herman Melville',
          title: 'Moby Dick',
          isbn: '0-553-21311-3',
          price: 8.99,
        },
        {
          category: 'fiction',
          author: 'J. R. R. Tolkien',
          title: 'The Lord of the Rings',
          isbn: '0-395-19395-8',
          price: 22.99,
        },
      ],
      bicycle: { color: 'red', price: 19.95 },
    },
    expensive: 10,
  },
  null,
  2,
)

export interface JsonPathExample {
  label: string
  path: string
  /** Optional document — when picked, replaces the document too. */
  json?: string
}

/**
 * Canonical JSONPath samples (Goessner reference + common patterns).
 * Designed to be loaded against `JSONPATH_SAMPLE_DOC`.
 */
export const JSONPATH_EXAMPLES: JsonPathExample[] = [
  {
    label: '1. The authors of all books',
    path: '$.store.book[*].author',
    json: JSONPATH_SAMPLE_DOC,
  },
  { label: '2. All authors', path: '$..author', json: JSONPATH_SAMPLE_DOC },
  { label: '3. All things, both books and bicycles', path: '$.store.*', json: JSONPATH_SAMPLE_DOC },
  { label: '4. The price of everything', path: '$.store..price', json: JSONPATH_SAMPLE_DOC },
  { label: '5. The third book', path: '$..book[2]', json: JSONPATH_SAMPLE_DOC },
  { label: '6. The second to last book', path: '$..book[-2]', json: JSONPATH_SAMPLE_DOC },
  { label: '7. The first two books', path: '$..book[0,1]', json: JSONPATH_SAMPLE_DOC },
  {
    label: '8. From index 0 (inclusive) until 2 (exclusive)',
    path: '$..book[:2]',
    json: JSONPATH_SAMPLE_DOC,
  },
  {
    label: '9. From index 1 (inclusive) until 2 (exclusive)',
    path: '$..book[1:2]',
    json: JSONPATH_SAMPLE_DOC,
  },
  { label: '10. Last two books', path: '$..book[-2:]', json: JSONPATH_SAMPLE_DOC },
  { label: '11. Book number two from tail', path: '$..book[-2]', json: JSONPATH_SAMPLE_DOC },
  {
    label: '12. All books with an ISBN number',
    path: '$..book[?(@.isbn)]',
    json: JSONPATH_SAMPLE_DOC,
  },
  {
    label: '13. All books in store cheaper than 10',
    path: '$.store.book[?(@.price < 10)]',
    json: JSONPATH_SAMPLE_DOC,
  },
  {
    label: '14. All fiction books',
    path: '$..book[?(@.category=="fiction")]',
    json: JSONPATH_SAMPLE_DOC,
  },
  {
    label: '15. Books whose title contains "of"',
    path: '$..book[?(@.title.indexOf("of") > -1)]',
    json: JSONPATH_SAMPLE_DOC,
  },
  { label: '16. Give me everything', path: '$..*', json: JSONPATH_SAMPLE_DOC },
  { label: '17. The number of books', path: '$..book.length', json: JSONPATH_SAMPLE_DOC },
]
