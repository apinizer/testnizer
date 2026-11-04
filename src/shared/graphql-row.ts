/**
 * What a saved GraphQL row sends. The GraphQL tab keeps its state in
 * `metadata.graphql` (`snapshotProtocol`, the Postman v3 importer) and Send posts
 * that state, so this reads the same place: the query, the variables as typed, and
 * the editor's headers, which replace the `headers` column on that tab.
 *
 * `null` for a row with neither: an imported JSON `{query, variables}` body is an
 * ordinary JSON request.
 */
import { graphqlParts } from './codegen/normalize'
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
