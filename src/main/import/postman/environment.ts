/**
 * Postman variables → project environments and project variables (issues
 * #276 / #281).
 *
 * One writer for every variable source an import can bring:
 *  - an environment export (`_postman_variable_scope: "environment"`) → a
 *    project environment;
 *  - a globals export (`"globals"`) → the project variables (the "Globals"
 *    list, `global_variables` with the project's id);
 *  - a collection's `variable[]` (+ folder / request `variable[]`, which have
 *    no scope of their own in Testnizer) → the project variables. A
 *    Testnizer project IS the Postman collection: these are what
 *    `pm.collectionVariables` reads, always active below the environment.
 *    They used to become a "<collection> (imported)" environment, which did
 *    not resolve while another environment was active;
 *  - the environments / globals of a legacy data dump.
 *
 * Re-importing an environment with the same name replaces its variables
 * (Postman never shows duplicate names). A project variable that already
 * exists keeps its local value and the import report names it (decided
 * conflict policy: the user's own value is never overwritten by a file).
 * Secret values this machine already holds survive (issue #177 keep-local)
 * and every secret value is sealed at rest (issue #239) — project variables
 * through the repository's create path, like the editor. A value is a secret
 * when `type: "secret"` (environment exports, our own export) OR
 * `secret: true` (Postman SDK 5.3 / v3 form) OR it is linked to a vault
 * (`source`).
 */
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { getDb } from '../../db/database'
import {
  keepLocalSecretByKey,
  localSecretsByKey,
  type LocalSecretsByKey,
} from '../../lib/local-secrets'
import { storedVariableValue } from '../../lib/secret-at-rest'
import { invalidateSecretInventory } from '../../lib/secret-inventory-cache'
import { createGlobalVariable, getGlobalVariablesByProject } from '../../db/environment.repo'
import type { PostmanEnvironment } from './types'
import { descriptionText, toText } from './normalize'

export interface VariableRow {
  key: string
  value: string
  description: string | null
  enabled: boolean
  secret: boolean
}

/** A Postman variable / environment value → a row (null for a row without a key). */
export function toVariableRow(
  v: unknown,
  where: string,
  warnings: string[],
  enabledField: 'enabled' | 'disabled',
): VariableRow | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const key = typeof o.key === 'string' ? o.key : ''
  if (!key) return null
  let secret = o.type === 'secret' || o.secret === true
  let description = descriptionText(o.description)
  let value = toText(o.value)
  if (o.source && typeof o.source === 'object') {
    const provider = toText((o.source as Record<string, unknown>).provider) || 'external'
    warnings.push(
      `${where}: variable "${key}" is linked to a ${provider} vault secret; imported as an empty secret variable — re-enter its value in Testnizer.`,
    )
    value = ''
    secret = true
    description = description ?? `Linked to a ${provider} vault secret in Postman`
  }
  const enabled = enabledField === 'enabled' ? o.enabled !== false : o.disabled !== true
  return { key, value, description, enabled, secret }
}

/** The secret rows an environment holds right now, by key (read before a re-import's DELETE). */
function readEnvSecretsByKey(db: Database, envId: string): LocalSecretsByKey {
  return localSecretsByKey(
    db
      .prepare(
        'SELECT key, value, initial_value, secret FROM environment_variables WHERE environment_id = ? AND secret = 1',
      )
      .all(envId) as Record<string, unknown>[],
  )
}

export interface UpsertedEnvironment {
  environmentId: string
  created: boolean
  /** True when this environment is the project's active one after the write. */
  active: boolean
  /** Name of the OTHER environment that is active (so these variables are not visible). */
  activeOtherName?: string
  replacedExisting: boolean
}

/**
 * Create or replace a project environment named `name` with `rows`. Must run
 * inside the caller's transaction. A new environment becomes active only when
 * the project has none active (unchanged rule).
 */
export function upsertProjectEnvironment(
  db: Database,
  projectId: string,
  workspaceId: string,
  name: string,
  rows: VariableRow[],
  now: number,
): UpsertedEnvironment {
  const existing = db
    .prepare('SELECT id, is_active FROM environments WHERE project_id = ? AND name = ?')
    .get(projectId, name) as { id: string; is_active: number } | undefined
  let envId: string
  let created = false
  let active: boolean
  // Secret values this machine holds for the env being replaced (issue #177):
  // exports write them as '' — a re-import must not blank them.
  let localSecrets: LocalSecretsByKey = new Map()
  if (existing) {
    envId = existing.id
    active = existing.is_active === 1
    localSecrets = readEnvSecretsByKey(db, envId)
    db.prepare('DELETE FROM environment_variables WHERE environment_id = ?').run(envId)
  } else {
    envId = randomUUID()
    created = true
    const hasActive = db
      .prepare('SELECT 1 AS x FROM environments WHERE project_id = ? AND is_active = 1')
      .get(projectId) as { x: number } | undefined
    active = !hasActive
    db.prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(envId, workspaceId, projectId, name, active ? 1 : 0, now, now)
  }
  const insertVar = db.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, description, enabled, secret, initial_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const r of rows) {
    const kept = keepLocalSecretByKey(
      { key: r.key, secret: r.secret, value: r.value, initial_value: r.value },
      localSecrets,
    )
    // Sealed (issue #239): a kept local value is already ciphertext.
    insertVar.run(
      randomUUID(),
      envId,
      r.key,
      storedVariableValue(kept.value, r.secret),
      r.description,
      r.enabled ? 1 : 0,
      r.secret ? 1 : 0,
      storedVariableValue(kept.initial_value, r.secret),
    )
  }
  let activeOtherName: string | undefined
  if (!active) {
    const other = db
      .prepare('SELECT name FROM environments WHERE project_id = ? AND is_active = 1 LIMIT 1')
      .get(projectId) as { name: string } | undefined
    activeOtherName = other?.name
  }
  return { environmentId: envId, created, active, activeOtherName, replacedExisting: !!existing }
}

export interface EnvironmentImportResult {
  success: boolean
  error?: string
  environmentId?: string
  environmentName?: string
  /** Project variables the import added (a globals file) — issue #281. */
  projectVariableCount?: number
  endpointCount?: number
  folderCount?: number
  warnings?: string[]
}

/** One variable an import brings, with the place it came from (for the report). */
export interface SourcedVariable {
  row: VariableRow
  where: string
}

const MAX_LISTED = 25

function listKeys(keys: string[]): string {
  const shown = keys
    .slice(0, MAX_LISTED)
    .map((k) => `"${k}"`)
    .join(', ')
  return keys.length > MAX_LISTED ? `${shown} (+${keys.length - MAX_LISTED} more)` : shown
}

/**
 * Add `vars` to the project variables (issue #281) through the repository's
 * create path — the editor's: secret values are sealed at rest and the
 * secret-mask inventory is invalidated. Runs inside the caller's transaction
 * (the repository uses the same connection).
 *
 * Conflict policy (decided): a key the project already has keeps its LOCAL
 * value and is listed in the report — unless the import brings the same value
 * or a blank secret (an export strips secret values; issue #177). Within one
 * import the first definition wins (collection before folder / request).
 */
export function writeProjectVariables(
  projectId: string,
  workspaceId: string,
  vars: SourcedVariable[],
  label: string,
  warnings: string[],
): { added: number; conflicts: string[] } {
  if (vars.length === 0) return { added: 0, conflicts: [] }
  const existing = new Map(getGlobalVariablesByProject(projectId).map((r) => [r.key, r]))
  const imported = new Map<string, VariableRow>()
  const conflicts: string[] = []
  const duplicates: string[] = []
  let added = 0
  for (const { row } of vars) {
    const first = imported.get(row.key)
    if (first) {
      if (first.value !== row.value && !duplicates.includes(row.key)) duplicates.push(row.key)
      continue
    }
    const local = existing.get(row.key)
    if (local) {
      const localValue = local.value || local.initial_value || ''
      const blankSecret = row.secret && row.value === ''
      if (!blankSecret && (local.decryptFailed || localValue !== row.value)) {
        if (!conflicts.includes(row.key)) conflicts.push(row.key)
      }
      continue
    }
    createGlobalVariable({
      workspace_id: workspaceId,
      project_id: projectId,
      key: row.key,
      value: row.value,
      initial_value: row.value,
      description: row.description ?? undefined,
      enabled: row.enabled,
      secret: row.secret,
    })
    imported.set(row.key, row)
    added++
  }
  if (conflicts.length > 0) {
    warnings.push(
      `${label}: this project already has the variable(s) ${listKeys(conflicts)} in Globals with a different value; the project's value was kept.`,
    )
  }
  if (duplicates.length > 0) {
    warnings.push(
      `${label}: the variable(s) ${listKeys(duplicates)} are defined more than once with different values; the first definition was kept.`,
    )
  }
  return { added, conflicts }
}

/** Write one environment / globals document. Runs inside the caller's transaction. */
export function writeEnvironmentDocument(
  db: Database,
  projectId: string,
  workspaceId: string,
  env: PostmanEnvironment,
  scope: 'environment' | 'globals',
  warnings: string[],
  now: number,
): EnvironmentImportResult {
  if (scope === 'globals') {
    // Postman globals → the project variables (issue #281): always active,
    // below the environment — no environment to switch to.
    const where = 'Postman globals'
    const vars: SourcedVariable[] = []
    for (const v of Array.isArray(env.values) ? env.values : []) {
      const row = toVariableRow(v, where, warnings, 'enabled')
      if (row) vars.push({ row, where })
    }
    if (vars.length === 0) warnings.push(`${where} had no variables.`)
    const res = writeProjectVariables(projectId, workspaceId, vars, where, warnings)
    return { success: true, projectVariableCount: res.added, endpointCount: 0, folderCount: 0 }
  }
  const name = typeof env.name === 'string' && env.name.trim() ? env.name : ''
  if (!name) return { success: false, error: 'Postman environment file is missing `name`' }
  const where = `Environment "${name}"`
  const rows: VariableRow[] = []
  for (const v of Array.isArray(env.values) ? env.values : []) {
    const row = toVariableRow(v, where, warnings, 'enabled')
    if (row) rows.push(row)
  }
  const res = upsertProjectEnvironment(db, projectId, workspaceId, name, rows, now)
  if (rows.length === 0) {
    warnings.push(`${where} had no variables — created an empty environment.`)
  } else if (!res.active && res.activeOtherName) {
    warnings.push(
      `Environment "${name}" was imported but "${res.activeOtherName}" is the active environment; select "${name}" to use its variables.`,
    )
  }
  return {
    success: true,
    environmentId: res.environmentId,
    environmentName: name,
    endpointCount: 0,
    folderCount: 0,
  }
}

/**
 * Import a standalone Postman environment or globals export (`import:postmanEnvironment`
 * and the APIs import). One transaction; the secret mask inventory is refreshed after.
 */
export async function importPostmanEnvironment(
  projectId: string,
  env: PostmanEnvironment,
): Promise<EnvironmentImportResult> {
  const warnings: string[] = []
  if (!env || typeof env !== 'object') return { success: false, error: 'Not a Postman environment' }
  const scope = env._postman_variable_scope === 'globals' ? 'globals' : 'environment'
  if (scope === 'environment' && (!env.name || typeof env.name !== 'string')) {
    return { success: false, error: 'Postman environment file is missing `name`' }
  }
  const db = getDb()
  const projectRow = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as
    | { workspace_id: string }
    | undefined
  if (!projectRow) return { success: false, error: 'Project not found: ' + projectId }
  const result = db.transaction(() =>
    writeEnvironmentDocument(
      db,
      projectId,
      projectRow.workspace_id,
      env,
      scope,
      warnings,
      Date.now(),
    ),
  )()
  invalidateSecretInventory()
  return { ...result, warnings: warnings.length > 0 ? warnings : undefined }
}
