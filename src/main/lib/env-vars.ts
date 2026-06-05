/**
 * Load the variable map a request should see, given a project context.
 *
 * Layering (each step overrides the previous):
 *   1. Workspace-level globals (broadest scope)
 *   2. Project-level globals
 *   3. The project's active environment's variables (highest priority)
 *
 * Used by:
 *   - The Collection Runner (`runner.handler.ts`) when executing a
 *     request without an explicit environmentId.
 *   - The Mock Server (`mock/server.ts`) when rendering response
 *     templates that reference `{{var}}` placeholders.
 *
 * Both surfaces previously had their own subset of this loader and the
 * resulting drift was a recurring source of "why is `{{baseUrl}}` empty
 * in the mock but not in Send?" bugs. Single source of truth here.
 */
import { getDb } from '../db/database'

export interface EnvVarLoadOptions {
  workspaceId?: string
  projectId?: string
  /** Explicit override — when omitted, the project's active env is used. */
  environmentId?: string
}

interface DualValueRow {
  key: string
  value: string | null
  initial_value: string | null
}

/**
 * Resolve a variable to the string a request should actually see, mirroring
 * the renderer's dual-value model (environment.store `v()`): prefer the
 * **Current Value**, fall back to the **Initial Value** when it's empty.
 *
 * Without this fallback the Runner / Mock surfaces only read the `value`
 * (Current Value) column, so a variable whose value lives only in the
 * "Initial Value" column — the common case after importing a Postman/Insomnia
 * collection, or when a user fills just the leftmost column in the env editor —
 * resolved fine under **Send** (renderer) but came back **empty** here. That
 * left `{{AccessURL}}` unsubstituted and the request failed with "Invalid URL"
 * on Run while Send returned 200 (issue #4).
 */
function effectiveValue(row: DualValueRow): string {
  return row.value && row.value.length > 0 ? row.value : (row.initial_value ?? '')
}

export function loadEnvVars(opts: EnvVarLoadOptions): Record<string, string> {
  const vars: Record<string, string> = {}
  const db = getDb()

  if (opts.workspaceId) {
    const rows = db
      .prepare(
        'SELECT key, value, initial_value FROM global_variables WHERE workspace_id = ? AND enabled = 1',
      )
      .all(opts.workspaceId) as DualValueRow[]
    for (const r of rows) vars[r.key] = effectiveValue(r)
  }

  if (opts.projectId) {
    const rows = db
      .prepare(
        'SELECT key, value, initial_value FROM global_variables WHERE project_id = ? AND enabled = 1',
      )
      .all(opts.projectId) as DualValueRow[]
    for (const r of rows) vars[r.key] = effectiveValue(r)
  }

  let effectiveEnvId = opts.environmentId
  if (!effectiveEnvId && opts.projectId) {
    try {
      const row = db
        .prepare('SELECT id FROM environments WHERE project_id = ? AND is_active = 1 LIMIT 1')
        .get(opts.projectId) as { id: string } | undefined
      effectiveEnvId = row?.id
    } catch {
      /* no active env table row — fall through with globals only */
    }
  }
  if (effectiveEnvId) {
    const rows = db
      .prepare(
        'SELECT key, value, initial_value FROM environment_variables WHERE environment_id = ? AND enabled = 1',
      )
      .all(effectiveEnvId) as DualValueRow[]
    for (const r of rows) vars[r.key] = effectiveValue(r)
  }

  return vars
}
