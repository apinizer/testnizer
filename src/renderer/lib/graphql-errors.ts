/**
 * Pure helpers for parsing GraphQL response bodies. Lives outside any React
 * component so it can be unit-tested without bringing the Monaco-loaded
 * `GraphQLResponsePane` (and its window/`document` dependencies) into the
 * test environment.
 */

export interface GraphQLErrorEntry {
  message: string
  path: string | undefined
}

/**
 * Extract a flat list of `{message, path}` from a GraphQL JSON response body.
 *
 * Returns an empty list when:
 *   - body is empty / not JSON
 *   - body has no `errors[]` field
 *   - every entry lacks a `message`
 *
 * `path` is normalized to a dotted string when the original was an array
 * (e.g. `["user", "profile"]` → `"user.profile"`); left undefined otherwise.
 */
export function extractGraphQLErrors(body: string): GraphQLErrorEntry[] {
  if (!body) return []
  try {
    const parsed = JSON.parse(body) as { errors?: unknown }
    const errs = parsed.errors
    if (!Array.isArray(errs)) return []
    return errs
      .map<GraphQLErrorEntry | null>((e) => {
        if (!e || typeof e !== 'object') return null
        const obj = e as { message?: unknown; path?: unknown }
        const message = typeof obj.message === 'string' ? obj.message : ''
        if (!message) return null
        const path = Array.isArray(obj.path) ? obj.path.join('.') : undefined
        return { message, path }
      })
      .filter((x): x is GraphQLErrorEntry => x !== null)
  } catch {
    return []
  }
}
