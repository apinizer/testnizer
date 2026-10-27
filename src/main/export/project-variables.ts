/**
 * The project variables ("Globals") as Postman COLLECTION variables — the one
 * owner every Postman export reads (issue #281): v2.1 `variable[]`, v3 JSON
 * `variables` and the v3 folder's collection definition.
 *
 * A Testnizer project is the Postman collection, so its variables round-trip
 * as collection variables, the scope a Postman import writes them back to.
 * Environments travel as environment files of their own; they no longer
 * stand in for collection variables.
 *
 * Secrets (issues #177 / #239): rows go through `stripLocalSecrets`, the same
 * filter as the project file and git — a `secret` value becomes '' (the key
 * and the secret flag stay) and `enc:v1:` ciphertext never leaves.
 */
import { getDb } from '../db/database'
import { stripLocalSecrets } from '../lib/local-secrets'

export interface ExportedProjectVariable {
  key: string
  /** The value Send uses: Current Value, else Initial Value ('' for a secret). */
  value: string
  enabled: boolean
  secret: boolean
  description?: string
}

const flag = (v: unknown): boolean => v === 1 || v === true || v === '1'

export function exportedProjectVariables(projectId: string): ExportedProjectVariable[] {
  const rows = getDb()
    .prepare('SELECT * FROM global_variables WHERE project_id = ? ORDER BY rowid ASC')
    .all(projectId) as Array<Record<string, unknown>>
  const stripped = stripLocalSecrets({ globalVariables: rows }).globalVariables ?? []
  return stripped.map((v) => {
    const description = typeof v.description === 'string' && v.description ? v.description : ''
    return {
      key: String(v.key ?? ''),
      value: String((v.value as string) || (v.initial_value as string) || ''),
      enabled: v.enabled === undefined ? true : flag(v.enabled),
      secret: flag(v.secret),
      ...(description ? { description } : {}),
    }
  })
}
