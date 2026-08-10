/**
 * "Create Test Suite from this folder" must carry the URL the user sees.
 *
 * Reported 30 July: a Postman collection using `{{baseUrl}}/employee` produced
 * suite items whose URL was just `/employee` — the variable neither preserved
 * nor resolved, so no request in the new suite ran without being edited first.
 *
 * The cause is a split the importers make and only one reader honoured:
 *
 *   endpoints.path          '/employee'                 — the path alone
 *   request_schema.url      '{{baseUrl}}/employee'      — what the editor shows
 *
 * `open-endpoint-tab.ts` reads `ep.path` and then overrides it with
 * `schema.url`; `snapshotEndpointForSuite` only ever read `ep.path`. Same data,
 * two readers, one of them wrong — so these tests pin the snapshot against the
 * rule the editor follows.
 *
 * The placeholder is KEPT rather than expanded: collection variables import
 * into a project-scoped environment and a suite lives in the same project, so
 * `{{baseUrl}}` resolves at run time and keeps tracking the active environment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb, seedProject, seedWorkspace } from './helpers'
import crypto from 'node:crypto'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({ ...makeElectronMock() }))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { snapshotEndpointForSuite } = await import('../../../src/main/ipc/test-suite.handler')

let projectId: string

/** Insert an endpoint the way an importer does: path split from the full URL. */
function seedEndpoint(opts: { path: string; schema?: Record<string, unknown> }): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints
         (id, project_id, folder_id, name, description, protocol, method, path, status,
          request_schema, response_schemas, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, NULL, 'http', 'GET', ?, 'developing', ?, NULL, 0, ?, ?)`,
    )
    .run(
      id,
      projectId,
      'Get employee',
      opts.path,
      opts.schema ? JSON.stringify(opts.schema) : null,
      now,
      now,
    )
  return id
}

beforeEach(() => {
  testDb = createTestDb()
  harness.reset?.()
  const wsId = seedWorkspace(testDb)
  projectId = seedProject(testDb, wsId)
})

describe('snapshotEndpointForSuite keeps the URL the editor shows', () => {
  it('preserves a {{variable}} prefix instead of dropping it', () => {
    const id = seedEndpoint({
      path: '/employee',
      schema: { method: 'GET', url: '{{baseUrl}}/employee' },
    })

    const snap = snapshotEndpointForSuite(id)

    // The reported bug: this was '/employee'.
    expect(snap?.url).toBe('{{baseUrl}}/employee')
  })

  it('does not expand the variable at creation time', () => {
    const id = seedEndpoint({
      path: '/employee',
      schema: { method: 'GET', url: '{{baseUrl}}/employee' },
    })

    // Freezing one environment's value into the suite would silently pin it to
    // whichever environment happened to be active when the suite was built.
    expect(snapshotEndpointForSuite(id)?.url).toContain('{{baseUrl}}')
  })

  it('falls back to the path when the schema carries no url', () => {
    const id = seedEndpoint({ path: '/employee', schema: { method: 'GET' } })
    expect(snapshotEndpointForSuite(id)?.url).toBe('/employee')
  })

  it('falls back to the path when there is no schema at all', () => {
    const id = seedEndpoint({ path: '/employee' })
    expect(snapshotEndpointForSuite(id)?.url).toBe('/employee')
  })

  it('keeps an absolute URL untouched', () => {
    const id = seedEndpoint({
      path: '/employee',
      schema: { method: 'GET', url: 'https://api.example.test/employee' },
    })
    expect(snapshotEndpointForSuite(id)?.url).toBe('https://api.example.test/employee')
  })

  it('ignores a non-string url rather than trusting it', () => {
    const id = seedEndpoint({ path: '/employee', schema: { method: 'GET', url: 42 } })
    expect(snapshotEndpointForSuite(id)?.url).toBe('/employee')
  })
})
