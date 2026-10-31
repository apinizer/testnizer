/**
 * Upgrade safety for "the active environment is the DB `is_active` row"
 * (follow-up to issue #307).
 *
 * Before that fix the renderer store showed the FIRST environment of a project
 * as active when no row had `is_active = 1` (`hydrated[0]`, list order =
 * `getEnvironmentsByProject` → `ORDER BY created_at ASC`), and Send used it.
 * Without the fallback such a project would open with "No environment" and
 * Send would stop resolving `{{baseUrl}}`. The one-time migration persists what
 * those users saw: for every project with environments but no active one, the
 * environment the old store picked becomes active — once (settings marker), so
 * a later persisted "No environment" choice is never undone.
 *
 * Workspace-level environments (`project_id IS NULL`) are untouched: the store
 * only ever listed `environment:listByProject` rows, so the fallback never
 * applied to them.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, seedProject, seedWorkspace } from './handlers/helpers'

let db: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../src/main/db/database')>()),
  getDb: () => db,
}))

const { ACTIVE_ENVIRONMENT_MIGRATION_KEY, runActiveEnvironmentMigration } =
  await import('../../src/main/db/active-environment-migration')
const envRepo = await import('../../src/main/db/environment.repo')

let workspaceId: string

beforeEach(() => {
  db = createTestDb()
  workspaceId = seedWorkspace(db)
})
afterEach(() => db.close())

function env(projectId: string | null, name: string, createdAt: number, active = false): string {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, projectId, name, active ? 1 : 0, createdAt, createdAt)
  return id
}

function activeOf(projectId: string): string[] {
  return (
    db
      .prepare('SELECT id FROM environments WHERE project_id = ? AND is_active = 1')
      .all(projectId) as Array<{ id: string }>
  ).map((r) => r.id)
}

describe('one-time active-environment migration', () => {
  it('no active row: the environment the old store showed (list order [0]) becomes active', () => {
    const p = seedProject(db, workspaceId)
    // Inserted out of creation order — the store's list is created_at ASC.
    env(p, 'Prod', 2000)
    const staging = env(p, 'Staging', 1000)
    expect(envRepo.getEnvironmentsByProject(p)[0].id).toBe(staging)

    const res = runActiveEnvironmentMigration(db)
    expect(res).toEqual({ ran: true, activated: 1 })
    expect(activeOf(p)).toEqual([staging])
  })

  it('a project with an active row is untouched; a project without environments is untouched', () => {
    const withActive = seedProject(db, workspaceId)
    env(withActive, 'First', 1000)
    const chosen = env(withActive, 'Chosen', 2000, true)
    const empty = seedProject(db, workspaceId)

    const res = runActiveEnvironmentMigration(db)
    expect(res.activated).toBe(0)
    expect(activeOf(withActive)).toEqual([chosen])
    expect(activeOf(empty)).toEqual([])
  })

  it('workspace-level environments (no project) are never activated', () => {
    const ws = env(null, 'Workspace env', 1000)
    runActiveEnvironmentMigration(db)
    const row = db.prepare('SELECT is_active FROM environments WHERE id = ?').get(ws) as {
      is_active: number
    }
    expect(row.is_active).toBe(0)
  })

  it('runs once: a later "No environment" choice survives the next start', () => {
    const p = seedProject(db, workspaceId)
    const staging = env(p, 'Staging', 1000)
    expect(runActiveEnvironmentMigration(db).activated).toBe(1)
    expect(activeOf(p)).toEqual([staging])
    expect(
      db.prepare('SELECT 1 FROM settings WHERE key = ?').get(ACTIVE_ENVIRONMENT_MIGRATION_KEY),
    ).toBeDefined()

    // The user picks "No environment" (persisted through the IPC, issue #307 follow-up).
    envRepo.setActiveEnvironmentForProject(p, null)
    expect(activeOf(p)).toEqual([])

    const second = runActiveEnvironmentMigration(db)
    expect(second).toEqual({ ran: false, activated: 0 })
    expect(activeOf(p)).toEqual([])
  })
})
