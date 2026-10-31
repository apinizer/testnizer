import { randomUUID } from 'crypto'
import { getDb } from './database'
import { invalidateSecretInventory } from '../lib/secret-inventory-cache'
import { keepUndecryptable, openVariableRow, storedVariableValue } from '../lib/secret-at-rest'

export interface EnvironmentRow {
  id: string
  workspace_id: string
  project_id: string | null
  name: string
  is_active: number
  created_at: number
  updated_at: number
}

export interface EnvironmentVariableRow {
  id: string
  environment_id: string
  key: string
  value: string
  description: string | null
  enabled: number
  secret: number
  initial_value: string | null
  /**
   * Set (only) when `value` / `initial_value` is ciphertext this machine's
   * keychain cannot decrypt (issue #239): that field reads '' and the stored
   * value is kept until the user enters a new one.
   */
  decryptFailed?: true
}

export interface GlobalVariableRow {
  id: string
  workspace_id: string
  project_id: string | null
  key: string
  value: string
  description: string | null
  enabled: number
  secret: number
  initial_value: string | null
  /** See `EnvironmentVariableRow.decryptFailed`. */
  decryptFailed?: true
}

/*
 * Values of variables marked secret are encrypted at rest (issue #239,
 * `secret-at-rest.ts`): sealed here on every write, opened on every read —
 * callers (IPC, Runner) only ever see plaintext.
 */

/**
 * The stored form of one value column on update. `incoming` undefined keeps
 * the stored value (re-sealed / opened when the secret flag flips); an
 * incoming '' never replaces ciphertext the keychain cannot decrypt (the
 * editor showed '' for it and sends it back with any other edit).
 */
function nextStoredValue(
  incoming: string | null | undefined,
  stored: string | null,
  secret: boolean,
): string | null {
  const kept = keepUndecryptable(incoming, stored)
  if (kept !== incoming) return kept as string
  return storedVariableValue(incoming ?? stored, secret)
}

// ─── Environments ────────────────────────────────────────────

export function getEnvironmentsByWorkspace(workspaceId: string): EnvironmentRow[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM environments WHERE workspace_id = ? ORDER BY created_at ASC')
    .all(workspaceId) as EnvironmentRow[]
}

/** Per-project environments — excludes globally-scoped (project_id IS NULL). */
export function getEnvironmentsByProject(projectId: string): EnvironmentRow[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as EnvironmentRow[]
}

export function getEnvironmentById(id: string): EnvironmentRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as EnvironmentRow | undefined
}

export function createEnvironment(data: {
  workspace_id: string
  project_id?: string | null
  name: string
  is_active?: boolean
}): EnvironmentRow {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()

  db.prepare(
    `
    INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(id, data.workspace_id, data.project_id ?? null, data.name, data.is_active ? 1 : 0, now, now)
  return getEnvironmentById(id)!
}

export function updateEnvironment(
  id: string,
  data: {
    name?: string
    is_active?: boolean
  },
): EnvironmentRow | undefined {
  const db = getDb()
  const now = Date.now()
  const existing = getEnvironmentById(id)
  if (!existing) return undefined

  db.prepare(
    `
    UPDATE environments SET name = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    data.name ?? existing.name,
    data.is_active !== undefined ? (data.is_active ? 1 : 0) : existing.is_active,
    now,
    id,
  )
  return getEnvironmentById(id)
}

export function setActiveEnvironment(workspaceId: string, environmentId: string): void {
  const db = getDb()
  const now = Date.now()
  db.prepare('UPDATE environments SET is_active = 0, updated_at = ? WHERE workspace_id = ?').run(
    now,
    workspaceId,
  )
  db.prepare('UPDATE environments SET is_active = 1, updated_at = ? WHERE id = ?').run(
    now,
    environmentId,
  )
}

/**
 * Set the active environment within a single project's scope. `null` =
 * "No environment": no row stays active, so Run / Mock / Scheduler resolve no
 * environment variables — the same as Send.
 */
export function setActiveEnvironmentForProject(
  projectId: string,
  environmentId: string | null,
): void {
  const db = getDb()
  const now = Date.now()
  db.prepare('UPDATE environments SET is_active = 0, updated_at = ? WHERE project_id = ?').run(
    now,
    projectId,
  )
  if (!environmentId) return
  db.prepare('UPDATE environments SET is_active = 1, updated_at = ? WHERE id = ?').run(
    now,
    environmentId,
  )
}

/**
 * Move an environment's variables into its project's variables ("Globals",
 * issue #281) — the user-triggered way out of the "<collection> (imported)"
 * environments older builds created for Postman collection variables.
 *
 * One transaction. Values are copied AS STORED: a secret stays sealed (same
 * machine, same keychain) and a value this machine cannot decrypt is carried
 * over instead of being blanked. A key the project already has keeps its
 * LOCAL value (decided conflict policy) — listed in `conflicts` unless both
 * hold the same value. The environment itself is left alone: deleting it is
 * a separate, confirmed step in the UI.
 */
export function moveEnvironmentToProjectVariables(environmentId: string): {
  moved: string[]
  conflicts: string[]
} {
  const db = getDb()
  const env = db
    .prepare('SELECT workspace_id, project_id FROM environments WHERE id = ?')
    .get(environmentId) as { workspace_id: string; project_id: string | null } | undefined
  if (!env) throw new Error('Environment not found')
  if (!env.project_id) throw new Error('This environment does not belong to a project')
  const projectId = env.project_id
  const result = db.transaction(() => {
    const existing = new Map(
      (
        db
          .prepare('SELECT * FROM global_variables WHERE project_id = ?')
          .all(projectId) as GlobalVariableRow[]
      ).map((r) => [r.key, openVariableRow(r)]),
    )
    const rows = db
      .prepare('SELECT * FROM environment_variables WHERE environment_id = ? ORDER BY rowid')
      .all(environmentId) as EnvironmentVariableRow[]
    const insert = db.prepare(
      `INSERT INTO global_variables (id, workspace_id, project_id, key, value, description, enabled, secret, initial_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const moved: string[] = []
    const conflicts: string[] = []
    for (const row of rows) {
      // A key the environment holds twice: the first row wins.
      if (moved.includes(row.key)) continue
      const local = existing.get(row.key)
      if (local) {
        const incoming = openVariableRow(row)
        const same =
          !local.decryptFailed &&
          !incoming.decryptFailed &&
          local.value === incoming.value &&
          (local.initial_value ?? '') === (incoming.initial_value ?? '')
        if (!same && !conflicts.includes(row.key)) conflicts.push(row.key)
        continue
      }
      insert.run(
        randomUUID(),
        env.workspace_id,
        projectId,
        row.key,
        row.value,
        row.description,
        row.enabled,
        row.secret,
        row.initial_value,
      )
      moved.push(row.key)
    }
    return { moved, conflicts }
  })()
  // Console mask cache (issues #195 / #196): secret rows were added.
  invalidateSecretInventory()
  return result
}

export function deleteEnvironment(id: string): boolean {
  // Console mask cache (issues #195 / #196): a secret flag / value may change.
  invalidateSecretInventory()
  const db = getDb()
  const result = db.prepare('DELETE FROM environments WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Environment Variables ───────────────────────────────────

export function getVariablesByEnvironment(environmentId: string): EnvironmentVariableRow[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM environment_variables WHERE environment_id = ? ORDER BY key ASC')
    .all(environmentId) as EnvironmentVariableRow[]
  return rows.map(openVariableRow)
}

export function createVariable(data: {
  environment_id: string
  key: string
  value: string
  description?: string
  enabled?: boolean
  secret?: boolean
  initial_value?: string
}): EnvironmentVariableRow {
  // Console mask cache (issues #195 / #196): a secret flag / value may change.
  invalidateSecretInventory()
  const db = getDb()
  const id = randomUUID()

  db.prepare(
    `
    INSERT INTO environment_variables (id, environment_id, key, value, description, enabled, secret, initial_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    data.environment_id,
    data.key,
    storedVariableValue(data.value, !!data.secret),
    data.description ?? null,
    data.enabled !== false ? 1 : 0,
    data.secret ? 1 : 0,
    storedVariableValue(data.initial_value ?? null, !!data.secret),
  )
  return openVariableRow(
    db
      .prepare('SELECT * FROM environment_variables WHERE id = ?')
      .get(id) as EnvironmentVariableRow,
  )
}

export function updateVariable(
  id: string,
  data: {
    key?: string
    value?: string
    description?: string
    enabled?: boolean
    secret?: boolean
    initial_value?: string
  },
): EnvironmentVariableRow | undefined {
  // Console mask cache (issues #195 / #196): a secret flag / value may change.
  invalidateSecretInventory()
  const db = getDb()
  const existing = db.prepare('SELECT * FROM environment_variables WHERE id = ?').get(id) as
    | EnvironmentVariableRow
    | undefined
  if (!existing) return undefined
  const secret = data.secret !== undefined ? !!data.secret : existing.secret === 1

  db.prepare(
    `
    UPDATE environment_variables SET key = ?, value = ?, description = ?, enabled = ?, secret = ?, initial_value = ?
    WHERE id = ?
  `,
  ).run(
    data.key ?? existing.key,
    nextStoredValue(data.value, existing.value, secret) ?? '',
    data.description ?? existing.description,
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    secret ? 1 : 0,
    nextStoredValue(data.initial_value, existing.initial_value, secret),
    id,
  )
  return openVariableRow(
    db
      .prepare('SELECT * FROM environment_variables WHERE id = ?')
      .get(id) as EnvironmentVariableRow,
  )
}

export function deleteVariable(id: string): boolean {
  // Console mask cache (issues #195 / #196): a secret flag / value may change.
  invalidateSecretInventory()
  const db = getDb()
  const result = db.prepare('DELETE FROM environment_variables WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Global Variables ────────────────────────────────────────

export function getGlobalVariables(workspaceId: string): GlobalVariableRow[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM global_variables WHERE workspace_id = ? ORDER BY key ASC')
    .all(workspaceId) as GlobalVariableRow[]
  return rows.map(openVariableRow)
}

export function getGlobalVariablesByProject(projectId: string): GlobalVariableRow[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM global_variables WHERE project_id = ? ORDER BY key ASC')
    .all(projectId) as GlobalVariableRow[]
  return rows.map(openVariableRow)
}

export function createGlobalVariable(data: {
  workspace_id: string
  project_id?: string | null
  key: string
  value: string
  description?: string
  enabled?: boolean
  secret?: boolean
  initial_value?: string
}): GlobalVariableRow {
  // Console mask cache (issues #195 / #196): a secret flag / value may change.
  invalidateSecretInventory()
  const db = getDb()
  const id = randomUUID()

  db.prepare(
    `
    INSERT INTO global_variables (id, workspace_id, project_id, key, value, description, enabled, secret, initial_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    data.workspace_id,
    data.project_id ?? null,
    data.key,
    storedVariableValue(data.value, !!data.secret),
    data.description ?? null,
    data.enabled !== false ? 1 : 0,
    data.secret ? 1 : 0,
    storedVariableValue(data.initial_value ?? null, !!data.secret),
  )
  return openVariableRow(
    db.prepare('SELECT * FROM global_variables WHERE id = ?').get(id) as GlobalVariableRow,
  )
}

export function updateGlobalVariable(
  id: string,
  data: {
    key?: string
    value?: string
    description?: string
    enabled?: boolean
    secret?: boolean
    initial_value?: string
  },
): GlobalVariableRow | undefined {
  // Console mask cache (issues #195 / #196): a secret flag / value may change.
  invalidateSecretInventory()
  const db = getDb()
  const existing = db.prepare('SELECT * FROM global_variables WHERE id = ?').get(id) as
    | GlobalVariableRow
    | undefined
  if (!existing) return undefined
  const secret = data.secret !== undefined ? !!data.secret : existing.secret === 1

  db.prepare(
    `
    UPDATE global_variables SET key = ?, value = ?, description = ?, enabled = ?, secret = ?, initial_value = ?
    WHERE id = ?
  `,
  ).run(
    data.key ?? existing.key,
    nextStoredValue(data.value, existing.value, secret) ?? '',
    data.description ?? existing.description,
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    secret ? 1 : 0,
    nextStoredValue(data.initial_value, existing.initial_value, secret),
    id,
  )
  return openVariableRow(
    db.prepare('SELECT * FROM global_variables WHERE id = ?').get(id) as GlobalVariableRow,
  )
}

export function deleteGlobalVariable(id: string): boolean {
  // Console mask cache (issues #195 / #196): a secret flag / value may change.
  invalidateSecretInventory()
  const db = getDb()
  const result = db.prepare('DELETE FROM global_variables WHERE id = ?').run(id)
  return result.changes > 0
}
