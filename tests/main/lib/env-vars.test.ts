/**
 * Unit tests for `loadEnvVars` — the single source of truth for the variable
 * map the Collection Runner and Mock Server resolve `{{var}}` against.
 *
 * Regression guard for issue #4: a variable whose value lives only in the
 * "Initial Value" column resolved under **Send** (renderer falls back to the
 * initial value) but came back empty in the Runner, so `{{AccessURL}}` stayed
 * unsubstituted and the request failed with "Invalid URL" on Run. `loadEnvVars`
 * must mirror the renderer's dual-value model: Current Value, else Initial Value.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, seedWorkspace, seedProject } from '../handlers/helpers'
import { randomUUID } from 'crypto'

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { loadEnvVars } = await import('../../../src/main/lib/env-vars')

let workspaceId: string
let projectId: string

function seedEnvironment(active: boolean): string {
  const id = randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, projectId, 'Prod', active ? 1 : 0, now, now)
  return id
}

function seedEnvVar(
  envId: string,
  key: string,
  value: string,
  initialValue: string | null,
  enabled = 1,
): void {
  testDb
    .prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(randomUUID(), envId, key, value, enabled, initialValue)
}

function seedGlobalVar(key: string, value: string, initialValue: string | null): void {
  testDb
    .prepare(
      `INSERT INTO global_variables (id, workspace_id, project_id, key, value, enabled, secret, initial_value)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?)`,
    )
    .run(randomUUID(), workspaceId, projectId, key, value, initialValue)
}

beforeEach(() => {
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
})

describe('loadEnvVars — dual-value (Current → Initial) fallback', () => {
  it('falls back to the Initial Value when Current Value is empty (issue #4)', () => {
    const envId = seedEnvironment(true)
    // The exact shape a Postman import / "Initial Value column only" edit leaves:
    // Current Value empty, the real URL parked in initial_value.
    seedEnvVar(envId, 'AccessURL', '', 'https://api.example.com')

    const vars = loadEnvVars({ workspaceId, projectId, environmentId: envId })
    expect(vars.AccessURL).toBe('https://api.example.com')
  })

  it('prefers the Current Value when it is set', () => {
    const envId = seedEnvironment(true)
    seedEnvVar(envId, 'AccessURL', 'https://current.example.com', 'https://initial.example.com')

    const vars = loadEnvVars({ workspaceId, projectId, environmentId: envId })
    expect(vars.AccessURL).toBe('https://current.example.com')
  })

  it('resolves via the active environment when no explicit environmentId is passed', () => {
    const envId = seedEnvironment(true)
    seedEnvVar(envId, 'AccessURL', '', 'https://active.example.com')

    // Mirrors the folder-run / right-click path: runner passes no environmentId,
    // loadEnvVars must find the project's active env on its own.
    const vars = loadEnvVars({ workspaceId, projectId })
    expect(vars.AccessURL).toBe('https://active.example.com')
  })

  it('applies the same fallback to global variables', () => {
    seedGlobalVar('GlobalToken', '', 'fallback-token')

    const vars = loadEnvVars({ workspaceId, projectId })
    expect(vars.GlobalToken).toBe('fallback-token')
  })

  it('treats a missing initial_value (NULL) as empty rather than throwing', () => {
    const envId = seedEnvironment(true)
    seedEnvVar(envId, 'Empty', '', null)

    const vars = loadEnvVars({ workspaceId, projectId, environmentId: envId })
    expect(vars.Empty).toBe('')
  })

  it('lets the active environment override a global of the same name', () => {
    seedGlobalVar('AccessURL', '', 'https://global.example.com')
    const envId = seedEnvironment(true)
    seedEnvVar(envId, 'AccessURL', '', 'https://env.example.com')

    const vars = loadEnvVars({ workspaceId, projectId })
    expect(vars.AccessURL).toBe('https://env.example.com')
  })
})
