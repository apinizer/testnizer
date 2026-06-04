import { randomUUID } from 'crypto'
import { getDb } from './database'

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

/** Set the active environment within a single project's scope. */
export function setActiveEnvironmentForProject(projectId: string, environmentId: string): void {
  const db = getDb()
  const now = Date.now()
  db.prepare('UPDATE environments SET is_active = 0, updated_at = ? WHERE project_id = ?').run(
    now,
    projectId,
  )
  db.prepare('UPDATE environments SET is_active = 1, updated_at = ? WHERE id = ?').run(
    now,
    environmentId,
  )
}

export function deleteEnvironment(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM environments WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Environment Variables ───────────────────────────────────

export function getVariablesByEnvironment(environmentId: string): EnvironmentVariableRow[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM environment_variables WHERE environment_id = ? ORDER BY key ASC')
    .all(environmentId) as EnvironmentVariableRow[]
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
    data.value,
    data.description ?? null,
    data.enabled !== false ? 1 : 0,
    data.secret ? 1 : 0,
    data.initial_value ?? null,
  )
  return db
    .prepare('SELECT * FROM environment_variables WHERE id = ?')
    .get(id) as EnvironmentVariableRow
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
  const db = getDb()
  const existing = db.prepare('SELECT * FROM environment_variables WHERE id = ?').get(id) as
    | EnvironmentVariableRow
    | undefined
  if (!existing) return undefined

  db.prepare(
    `
    UPDATE environment_variables SET key = ?, value = ?, description = ?, enabled = ?, secret = ?, initial_value = ?
    WHERE id = ?
  `,
  ).run(
    data.key ?? existing.key,
    data.value ?? existing.value,
    data.description ?? existing.description,
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    data.secret !== undefined ? (data.secret ? 1 : 0) : existing.secret,
    data.initial_value ?? existing.initial_value,
    id,
  )
  return db
    .prepare('SELECT * FROM environment_variables WHERE id = ?')
    .get(id) as EnvironmentVariableRow
}

export function deleteVariable(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM environment_variables WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Global Variables ────────────────────────────────────────

export function getGlobalVariables(workspaceId: string): GlobalVariableRow[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM global_variables WHERE workspace_id = ? ORDER BY key ASC')
    .all(workspaceId) as GlobalVariableRow[]
}

export function getGlobalVariablesByProject(projectId: string): GlobalVariableRow[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM global_variables WHERE project_id = ? ORDER BY key ASC')
    .all(projectId) as GlobalVariableRow[]
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
    data.value,
    data.description ?? null,
    data.enabled !== false ? 1 : 0,
    data.secret ? 1 : 0,
    data.initial_value ?? null,
  )
  return db.prepare('SELECT * FROM global_variables WHERE id = ?').get(id) as GlobalVariableRow
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
  const db = getDb()
  const existing = db.prepare('SELECT * FROM global_variables WHERE id = ?').get(id) as
    | GlobalVariableRow
    | undefined
  if (!existing) return undefined

  db.prepare(
    `
    UPDATE global_variables SET key = ?, value = ?, description = ?, enabled = ?, secret = ?, initial_value = ?
    WHERE id = ?
  `,
  ).run(
    data.key ?? existing.key,
    data.value ?? existing.value,
    data.description ?? existing.description,
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    data.secret !== undefined ? (data.secret ? 1 : 0) : existing.secret,
    data.initial_value ?? existing.initial_value,
    id,
  )
  return db.prepare('SELECT * FROM global_variables WHERE id = ?').get(id) as GlobalVariableRow
}

export function deleteGlobalVariable(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM global_variables WHERE id = ?').run(id)
  return result.changes > 0
}
