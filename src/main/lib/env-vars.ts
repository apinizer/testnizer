/**
 * Load the variable map a request should see, given a project context.
 *
 * Layering (each step overrides the previous):
 *   1. The project's globals (`global_variables.project_id`) — the rows Send
 *      reads through `globalVariable:listByProject`, nothing wider
 *   2. The project's active environment's variables (highest priority)
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
import { openSecret } from './secret-at-rest'

export interface EnvVarLoadOptions {
  projectId?: string
  /** Explicit override — when omitted, the project's active env is used. */
  environmentId?: string
}

interface DualValueRow {
  key: string
  value: string | null
  initial_value: string | null
}

interface GlobalRow extends DualValueRow {
  secret: number | null
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
  // Secret values are ciphertext at rest (issue #239): decrypt first, so Run
  // and Mock see what Send sees (the renderer gets plaintext over IPC).
  // A value this machine cannot decrypt resolves to '' — never to the
  // ciphertext, and never silently to the (older) Initial Value.
  const value = openSecret(row.value)
  if (value.failed) return undecryptable(row.key)
  if (value.value.length > 0) return value.value
  const initial = openSecret(row.initial_value)
  if (initial.failed) return undecryptable(row.key)
  return initial.value
}

const warnedKeys = new Set<string>()
function undecryptable(key: string): string {
  if (!warnedKeys.has(key)) {
    warnedKeys.add(key)
    // The key only — never a value.
    console.warn(
      `[env-vars] the value of secret variable "${key}" cannot be decrypted on this machine (OS keychain changed?); it resolves to an empty string until it is entered again`,
    )
  }
  return ''
}

/**
 * The same variables, kept apart by scope: `globals` (the project's globals —
 * Postman's globals AND collection variables, issue #281) and `environment`
 * (the active / requested environment). `vaultKeys` names the project globals
 * marked secret: what `pm.vault` reads. The Collection Runner backs the separate `pm.globals` and
 * `pm.environment` script objects with these (issue #281); `loadEnvVars` is
 * their merge.
 */
export function loadEnvVarScopes(opts: EnvVarLoadOptions): {
  globals: Record<string, string>
  environment: Record<string, string>
  vaultKeys: string[]
} {
  const globals: Record<string, string> = {}
  const environment: Record<string, string> = {}
  const vaultKeys: string[] = []
  const db = getDb()

  // Project rows ONLY. This used to start from every row of the WORKSPACE
  // (`workspace_id = ?`) and overlay the project's: every row carries a
  // workspace id, so another project's globals — and legacy rows saved
  // without a project — resolved on Run and in the mock while Send, which
  // reads only the active project's rows, left them unresolved.
  if (opts.projectId) {
    const rows = db
      .prepare(
        'SELECT key, value, initial_value, secret FROM global_variables WHERE project_id = ? AND enabled = 1',
      )
      .all(opts.projectId) as GlobalRow[]
    for (const r of rows) {
      globals[r.key] = effectiveValue(r)
      if (r.secret === 1) vaultKeys.push(r.key)
    }
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
    for (const r of rows) environment[r.key] = effectiveValue(r)
  }

  return { globals, environment, vaultKeys }
}

export function loadEnvVars(opts: EnvVarLoadOptions): Record<string, string> {
  const { globals, environment } = loadEnvVarScopes(opts)
  return { ...globals, ...environment }
}
