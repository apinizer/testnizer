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

export function loadEnvVars(opts: EnvVarLoadOptions): Record<string, string> {
  const vars: Record<string, string> = {}
  const db = getDb()

  if (opts.workspaceId) {
    const rows = db
      .prepare('SELECT key, value FROM global_variables WHERE workspace_id = ? AND enabled = 1')
      .all(opts.workspaceId) as Array<{ key: string; value: string }>
    for (const r of rows) vars[r.key] = r.value
  }

  if (opts.projectId) {
    const rows = db
      .prepare('SELECT key, value FROM global_variables WHERE project_id = ? AND enabled = 1')
      .all(opts.projectId) as Array<{ key: string; value: string }>
    for (const r of rows) vars[r.key] = r.value
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
        'SELECT key, value FROM environment_variables WHERE environment_id = ? AND enabled = 1',
      )
      .all(effectiveEnvId) as Array<{ key: string; value: string }>
    for (const r of rows) vars[r.key] = r.value
  }

  return vars
}
