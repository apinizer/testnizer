/**
 * Importing a suite must not reintroduce the URL truncation the startup
 * migration just repaired.
 *
 * The import copies `test_suite_items.url` verbatim from the export. An export
 * taken on a build that still had the creation-time bug therefore carries
 * `/test/healthcheck` where the schema says `{{AccessURL}}/test/healthcheck` —
 * and re-importing it would put the damage right back, on a machine that had
 * already been fixed. Same rule at both doors.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'

setupHandlerHarness()

vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

vi.mock('../../../src/main/ipc/import-export.handler', () => ({
  importPostman: vi.fn(),
  importInsomnia: vi.fn(),
}))

vi.mock('../../../src/main/ipc/test-suite.handler', () => ({
  snapshotEndpointForSuite: vi.fn(() => ({})),
  ensureUniqueSuiteName: (_db: unknown, _p: string, name: string) => name,
}))

const { importTestSuiteData } = await import('../../../src/main/ipc/save.handler')

let projectId: string

beforeEach(() => {
  testDb = createTestDb()
  const workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
})

/** An export blob shaped like the one `exportTestSuite` produces. */
function exportWith(items: Array<{ url: string | null; schemaUrl?: unknown }>): {
  version: string
  kind: string
  suite: Record<string, unknown>
  folders: unknown[]
  items: Array<Record<string, unknown>>
} {
  return {
    version: '2.0.0',
    kind: 'testSuite',
    suite: { id: 'src-suite', name: 'Imported', description: null, sort_order: 0 },
    folders: [],
    items: items.map((it, i) => ({
      id: `src-item-${i}`,
      suite_id: 'src-suite',
      folder_id: null,
      protocol: 'http',
      name: `Item ${i}`,
      method: 'GET',
      url: it.url,
      request_schema:
        it.schemaUrl === undefined ? '{}' : JSON.stringify({ method: 'GET', url: it.schemaUrl }),
      assertions: null,
      sort_order: i,
    })),
  }
}

const urls = (): Array<string | null> =>
  (
    testDb
      .prepare('SELECT url FROM test_suite_items ORDER BY sort_order')
      .all() as Array<{ url: string | null }>
  ).map((r) => r.url)

describe('importing a suite exported from an affected build', () => {
  it('puts the dropped {{variable}} back', () => {
    importTestSuiteData(
      exportWith([{ url: '/test/healthcheck', schemaUrl: '{{AccessURL}}/test/healthcheck' }]) as never,
      projectId,
    )

    expect(urls()).toEqual(['{{AccessURL}}/test/healthcheck'])
  })

  it('leaves a correctly exported suite untouched', () => {
    importTestSuiteData(
      exportWith([{ url: '{{baseUrl}}/employee', schemaUrl: '{{baseUrl}}/employee' }]) as never,
      projectId,
    )

    expect(urls()).toEqual(['{{baseUrl}}/employee'])
  })

  it('does not rewrite a URL the user shortened on purpose', () => {
    importTestSuiteData(
      exportWith([{ url: '/health', schemaUrl: 'https://api.example.com/health' }]) as never,
      projectId,
    )

    expect(urls()).toEqual(['/health'])
  })

  it('keeps a null URL null rather than inventing one', () => {
    importTestSuiteData(exportWith([{ url: null, schemaUrl: '{{A}}/x' }]) as never, projectId)

    expect(urls()).toEqual([null])
  })
})
