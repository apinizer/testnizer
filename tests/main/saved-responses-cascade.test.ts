/**
 * Issue #125 follow-up — saved response examples must die with their owner.
 * The owner tables carry no FK to saved_responses, so the schema cascades via
 * triggers (endpoint / saved request / suite item / project). This pins that
 * every delete path the app has leaves no orphan behind.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, seedProject, seedWorkspace } from './handlers/helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', () => ({ getDb: () => testDb }))

const repo = await import('../../src/main/db/saved-response.repo')
const endpointRepo = await import('../../src/main/db/endpoint.repo')
const projectRepo = await import('../../src/main/db/project.repo')
const itemRepo = await import('../../src/main/db/test-suite-item.repo')

let projectId: string
const now = Date.now()

function addExample(ownerType: 'endpoint' | 'saved_request' | 'test_suite_item', ownerId: string) {
  return repo.createSavedResponse({
    project_id: projectId,
    owner_type: ownerType,
    owner_id: ownerId,
    name: 'ex',
    response_json: '{"status":200}',
  })
}
const count = () =>
  (testDb.prepare('SELECT count(*) AS c FROM saved_responses').get() as { c: number }).c

beforeEach(() => {
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
})

describe('saved_responses cascade', () => {
  it('endpoint delete removes its examples (repo path)', () => {
    testDb
      .prepare(
        `INSERT INTO endpoints (id, project_id, name, protocol, method, path, status, sort_order, created_at, updated_at)
         VALUES ('ep1', ?, 'E', 'http', 'GET', '/x', 'developing', 0, ?, ?)`,
      )
      .run(projectId, now, now)
    addExample('endpoint', 'ep1')
    expect(count()).toBe(1)
    endpointRepo.deleteEndpoint('ep1')
    expect(count()).toBe(0)
  })

  it('saved request delete removes its examples', () => {
    testDb
      .prepare(
        `INSERT INTO saved_requests (id, project_id, name, protocol, method, url, params, headers, assertions, sort_order, created_at, updated_at)
         VALUES ('sr1', ?, 'S', 'http', 'GET', 'http://x', '[]', '[]', '[]', 0, ?, ?)`,
      )
      .run(projectId, now, now)
    addExample('saved_request', 'sr1')
    endpointRepo.deleteSavedRequest('sr1')
    expect(count()).toBe(0)
  })

  it('folder delete (bulk DELETE … WHERE folder_id IN) fires the triggers row by row', () => {
    testDb
      .prepare(
        `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES ('f1', ?, NULL, 'F', 0)`,
      )
      .run(projectId)
    testDb
      .prepare(
        `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, sort_order, created_at, updated_at)
         VALUES ('ep2', ?, 'f1', 'E', 'http', 'GET', '/x', 'developing', 0, ?, ?)`,
      )
      .run(projectId, now, now)
    testDb
      .prepare(
        `INSERT INTO saved_requests (id, project_id, folder_id, name, protocol, method, url, params, headers, assertions, sort_order, created_at, updated_at)
         VALUES ('sr2', ?, 'f1', 'S', 'http', 'GET', 'http://x', '[]', '[]', '[]', 0, ?, ?)`,
      )
      .run(projectId, now, now)
    addExample('endpoint', 'ep2')
    addExample('saved_request', 'sr2')
    expect(count()).toBe(2)
    projectRepo.deleteFolder('f1')
    expect(count()).toBe(0)
  })

  it('suite item delete — direct and via suite cascade — removes its examples', () => {
    testDb
      .prepare(
        `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES ('ts1', ?, 'T', 0, ?, ?)`,
      )
      .run(projectId, now, now)
    testDb
      .prepare(
        `INSERT INTO test_suite_items (id, suite_id, protocol, name, request_schema, sort_order, created_at, updated_at)
         VALUES ('it1', 'ts1', 'http', 'I', '{}', 0, ?, ?), ('it2', 'ts1', 'http', 'I2', '{}', 1, ?, ?)`,
      )
      .run(now, now, now, now)
    addExample('test_suite_item', 'it1')
    addExample('test_suite_item', 'it2')
    itemRepo.deleteItem('it1')
    expect(count()).toBe(1)
    // Suite delete → FK cascade removes items → trigger removes the example.
    testDb.prepare('DELETE FROM test_suites WHERE id = ?').run('ts1')
    expect(count()).toBe(0)
  })

  it('workspace delete (projects cascade) removes the examples too', () => {
    const wsId = (
      testDb.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as {
        workspace_id: string
      }
    ).workspace_id
    testDb
      .prepare(
        `INSERT INTO saved_requests (id, project_id, name, protocol, method, url, params, headers, assertions, sort_order, created_at, updated_at)
         VALUES ('sr4', ?, 'S', 'http', 'GET', 'http://x', '[]', '[]', '[]', 0, ?, ?)`,
      )
      .run(projectId, now, now)
    addExample('saved_request', 'sr4')
    testDb.prepare('DELETE FROM workspaces WHERE id = ?').run(wsId)
    expect(count()).toBe(0)
  })

  it('project delete removes every example of the project', () => {
    testDb
      .prepare(
        `INSERT INTO saved_requests (id, project_id, name, protocol, method, url, params, headers, assertions, sort_order, created_at, updated_at)
         VALUES ('sr3', ?, 'S', 'http', 'GET', 'http://x', '[]', '[]', '[]', 0, ?, ?)`,
      )
      .run(projectId, now, now)
    addExample('saved_request', 'sr3')
    projectRepo.deleteProject(projectId)
    expect(count()).toBe(0)
  })

  it('resolveOwnerProjectId reads the project from the owner row (suite item via its suite)', () => {
    testDb
      .prepare(
        `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES ('ts2', ?, 'T', 0, ?, ?)`,
      )
      .run(projectId, now, now)
    testDb
      .prepare(
        `INSERT INTO test_suite_items (id, suite_id, protocol, name, request_schema, sort_order, created_at, updated_at)
         VALUES ('it3', 'ts2', 'http', 'I', '{}', 0, ?, ?)`,
      )
      .run(now, now)
    expect(repo.resolveOwnerProjectId('test_suite_item', 'it3')).toBe(projectId)
    expect(repo.resolveOwnerProjectId('endpoint', 'nope')).toBeNull()
    expect(repo.ownerExists('test_suite_item', 'it3')).toBe(true)
    expect(repo.ownerExists('saved_request', 'nope')).toBe(false)
  })
})
