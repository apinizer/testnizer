/**
 * What a saved GraphQL row sends. The GraphQL tab keeps its state in
 * `metadata.graphql` (`snapshotProtocol`, the Postman v3 importer) and Send posts
 * that state, so this reads the same place: the query, the variables as typed, and
 * the editor's headers, which replace the `headers` column on that tab.
 *
 * `null` for a row with neither: an imported JSON `{query, variables}` body is an
 * ordinary JSON request.
 */
import { graphqlJson, graphqlParts } from './codegen/normalize'
import type { CodegenInputBody } from './codegen/types'

export interface SavedGraphql {
  query: string
  variables: string
  /** Absent when the row has no editor headers: the `headers` column then applies. */
  headers?: unknown[]
}

export function readSavedGraphql(body: unknown, metadata: unknown): SavedGraphql | null {
  const meta = (metadata as { graphql?: Record<string, unknown> } | null | undefined)?.graphql
  const stored = body as CodegenInputBody | null | undefined
  const fromBody = stored?.type === 'graphql' ? graphqlParts(stored) : null

  const query = typeof meta?.query === 'string' ? meta.query : fromBody?.query
  if (query === undefined) return null

  const variables =
    typeof meta?.variables === 'string'
      ? meta.variables
      : meta?.variables && typeof meta.variables === 'object'
        ? JSON.stringify(meta.variables)
        : (fromBody?.variables ?? '{}')

  return {
    query,
    variables,
    ...(Array.isArray(meta?.headers) ? { headers: meta.headers as unknown[] } : {}),
  }
}

/**
 * Is the document's operation a subscription? ONE rule for the editor (Run vs
 * Subscribe), Run and Generate Code. Reads the first operation definition, past
 * comments, strings and fragments, so `fragment F on T { a } subscription { … }`
 * counts and a `subscription` word in a comment does not. Anything it cannot read
 * is not a subscription, and stays the ordinary POST it was.
 */
export function isSubscriptionQuery(query: string | null | undefined): boolean {
  const src = query ?? ''
  let depth = 0
  let inFragment = false
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '"') {
      const fence = src.startsWith('"""', i) ? '"""' : '"'
      i += fence.length
      while (i < src.length && !src.startsWith(fence, i)) i += src[i] === '\\' ? 2 : 1
      i += fence.length
    } else if (c === '{') {
      if (depth === 0 && !inFragment) return false // shorthand `{ … }`: a query
      depth++
      i++
    } else if (c === '}') {
      depth--
      if (depth === 0) inFragment = false
      i++
    } else if (depth === 0 && !inFragment && /[A-Za-z_]/.test(c)) {
      const start = i
      while (i < src.length && /\w/.test(src[i])) i++
      const word = src.slice(start, i)
      if (word === 'fragment') inFragment = true
      else return word === 'subscription'
    } else {
      i++
    }
  }
  return false
}

/** Saved row → subscription? Covers the editor's shape and an imported `{query}` JSON body. */
export function isSavedSubscription(body: unknown, metadata: unknown): boolean {
  const saved = readSavedGraphql(body, metadata)
  if (saved) return isSubscriptionQuery(saved.query)
  const content = (body as { content?: unknown } | null | undefined)?.content
  if (typeof content !== 'string') return false
  try {
    const parsed = JSON.parse(content) as { query?: unknown } | null
    return typeof parsed?.query === 'string' && isSubscriptionQuery(parsed.query)
  } catch {
    return false
  }
}

/** The `{query, variables}` of a subscription: Send's exact JSON (`graphqlJson`). */
export function subscriptionPayload(
  query: string,
  variables: string,
): { query: string; variables: Record<string, unknown> } {
  return JSON.parse(graphqlJson(query, variables)) as {
    query: string
    variables: Record<string, unknown>
  }
}
