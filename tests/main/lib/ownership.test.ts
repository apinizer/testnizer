/**
 * Unit tests for the cross-project ownership guards in
 * `src/main/lib/ownership.ts`.
 *
 * These helpers are the last line of defence at the IPC layer: a corrupted
 * sessionStorage payload, a project-switch race, or a buggy DOM script must not
 * let project A run/mutate project B's rows. Each helper resolves the owning
 * `project_id` of an id and returns a plain boolean.
 *
 * `projectIdOfRunnable` consults three tables in order — endpoints,
 * saved_requests, then test_suite_items JOIN test_suites — so we seed one of
 * each under project A and assert ownership resolves to A, refuses B, and
 * refuses an unknown id. `isFolderInProject` consults the folders table.
 *
 * The `getDb` mock + in-memory test DB pattern mirrors env-vars.test.ts. The
 * mock covers both the direct `getDb()` call in ownership.ts (the suite-item
 * JOIN) and the indirect ones inside endpoint.repo / project.repo.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestDb, seedWorkspace, seedProject } from '../handlers/helpers'

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { projectIdOfRunnable, isRunnableInProject, isFolderInProject } = await import(
  '../../../src/main/lib/ownership'
)

let workspaceId: string
let projectA: string
let projectB: string

// ─── Seed helpers (INSERT shapes mirror tests/main/handlers/helpers SCHEMA) ──

function seedEndpoint(projectId: string): string {
  const id = randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, name, protocol, method, path, created_at, updated_at)
       VALUES (?, ?, ?, 'http', 'GET', '/x', ?, ?)`,
    )
    .run(id, projectId, 'EP', now, now)
  return id
}

function seedSavedRequest(projectId: string): string {
  const id = randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO saved_requests (id, project_id, name, protocol, method, url, created_at, updated_at)
       VALUES (?, ?, ?, 'http', 'GET', 'https://x', ?, ?)`,
    )
    .run(id, projectId, 'SR', now, now)
  return id
}

function seedSuite(projectId: string): string {
  const id = randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .run(id, projectId, 'Suite', now, now)
  return id
}

function seedSuiteItem(suiteId: string): string {
  const id = randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO test_suite_items (id, suite_id, protocol, name, method, url, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, 'http', ?, 'GET', 'https://x', '{}', 0, ?, ?)`,
    )
    .run(id, suiteId, 'Item', now, now)
  return id
}

function seedFolder(projectId: string): string {
  const id = randomUUID()
  testDb
    .prepare(`INSERT INTO folders (id, project_id, name, sort_order) VALUES (?, ?, 'F', 0)`)
    .run(id, projectId)
  return id
}

beforeEach(() => {
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectA = seedProject(testDb, workspaceId, 'Project A')
  projectB = seedProject(testDb, workspaceId, 'Project B')
})

// ─── projectIdOfRunnable ────────────────────────────────────────────────────

describe('projectIdOfRunnable', () => {
  it('resolves an endpoint to its owning project', () => {
    const id = seedEndpoint(projectA)
    expect(projectIdOfRunnable(id)).toBe(projectA)
  })

  it('resolves a saved request to its owning project', () => {
    const id = seedSavedRequest(projectA)
    expect(projectIdOfRunnable(id)).toBe(projectA)
  })

  it('resolves a test-suite item to the parent suite project (via JOIN)', () => {
    const suite = seedSuite(projectA)
    const item = seedSuiteItem(suite)
    expect(projectIdOfRunnable(item)).toBe(projectA)
  })

  it('returns null for an unknown id', () => {
    expect(projectIdOfRunnable(randomUUID())).toBeNull()
  })

  it('returns null for a suite item whose parent suite is missing (orphaned JOIN)', () => {
    const item = seedSuiteItem(randomUUID()) // suite_id points at nothing
    expect(projectIdOfRunnable(item)).toBeNull()
  })
})

// ─── isRunnableInProject ────────────────────────────────────────────────────

describe('isRunnableInProject', () => {
  it('is true for an endpoint owned by the claimed project', () => {
    const id = seedEndpoint(projectA)
    expect(isRunnableInProject(id, projectA)).toBe(true)
  })

  it('is false for an endpoint owned by a DIFFERENT project (cross-project guard)', () => {
    const id = seedEndpoint(projectA)
    expect(isRunnableInProject(id, projectB)).toBe(false)
  })

  it('is true for a saved request owned by the claimed project', () => {
    const id = seedSavedRequest(projectA)
    expect(isRunnableInProject(id, projectA)).toBe(true)
  })

  it('is false for a saved request claimed by another project', () => {
    const id = seedSavedRequest(projectA)
    expect(isRunnableInProject(id, projectB)).toBe(false)
  })

  it('is true for a suite item under the claimed project and false for another', () => {
    const suite = seedSuite(projectA)
    const item = seedSuiteItem(suite)
    expect(isRunnableInProject(item, projectA)).toBe(true)
    expect(isRunnableInProject(item, projectB)).toBe(false)
  })

  it('is false (refusal, not a throw) for an unknown id — does not leak existence', () => {
    expect(isRunnableInProject(randomUUID(), projectA)).toBe(false)
  })

  it('endpoint takes precedence: an endpoint and a saved request can each be checked independently', () => {
    const ep = seedEndpoint(projectA)
    const sr = seedSavedRequest(projectB)
    expect(isRunnableInProject(ep, projectA)).toBe(true)
    expect(isRunnableInProject(ep, projectB)).toBe(false)
    expect(isRunnableInProject(sr, projectB)).toBe(true)
    expect(isRunnableInProject(sr, projectA)).toBe(false)
  })
})

// ─── isFolderInProject ──────────────────────────────────────────────────────

describe('isFolderInProject', () => {
  it('is true for a folder in the claimed project', () => {
    const id = seedFolder(projectA)
    expect(isFolderInProject(id, projectA)).toBe(true)
  })

  it('is false for a folder belonging to a different project', () => {
    const id = seedFolder(projectA)
    expect(isFolderInProject(id, projectB)).toBe(false)
  })

  it('is false for an unknown folder id', () => {
    expect(isFolderInProject(randomUUID(), projectA)).toBe(false)
  })
})
