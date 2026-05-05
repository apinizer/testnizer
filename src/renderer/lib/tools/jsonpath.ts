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

/** Common JSONPath examples for the in-tool palette. */
export const JSONPATH_EXAMPLES = [
  { label: 'Root', path: '$' },
  { label: 'All keys', path: '$.*' },
  { label: 'Recursive descent', path: '$..*' },
  { label: 'Filter (price < 10)', path: '$..[?(@.price < 10)]' },
  { label: 'Array slice', path: '$.items[0:3]' },
  { label: 'Array last', path: '$.items[-1:]' },
  { label: 'Union', path: '$.a,$.b' },
]
