/**
 * Where a GraphQL row's `operationName` and `connection_init` go, per export route.
 * Every row comes out of the real editor save (`saveActiveRequestInPlace`), and every
 * re-import goes through the real importer. A silent loss is the bug: each route
 * carries the field or reports it.
 *
 *              operationName          connection_init
 *  Postman 2.1 graphql.operationName  note (a re-import is an HTTP row)
 *  Postman v3  operationName          note (no field)
 *  Insomnia    body text JSON         note (no field, no x- channel)
 *  OpenAPI     request body JSON      note
 *  project/git metadata.graphql       metadata.graphql
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))
vi.mock('../../../src/main/protocols/grpc.engine', () => ({
  loadProto: () => Promise.resolve({}),
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { registerEndpointHandlers } = await import('../../../src/main/ipc/endpoint.handler')
const { registerTestSuiteHandlers } = await import('../../../src/main/ipc/test-suite.handler')
const {
  buildInsomniaProjectExport,
  buildInsomniaSuiteExport,
  buildOpenApiProjectExport,
  buildPostmanProjectExport,
  buildPostmanSuiteExport,
  importInsomnia,
} = await import('../../../src/main/ipc/import-export.handler')
const { buildPostmanV3ProjectExport, buildPostmanV3SuiteExport, v3JsonText } =
  await import('../../../src/main/export/postman-v3')
const { importPostman } = await import('../../../src/main/import/postman')
const { exportProjectData, importProjectDataFromJson } =
  await import('../../../src/main/ipc/save.handler')
const { stripLocalSecrets } = await import('../../../src/main/lib/local-secrets')
const { restoreProtocolFromMetadata, saveActiveRequestInPlace } =
  await import('../../../src/renderer/lib/save-active-request')
const { useGraphQLStore } = await import('../../../src/renderer/stores/graphql.store')
const { useRequestStore } = await import('../../../src/renderer/stores/request.store')
const { useTabsStore } = await import('../../../src/renderer/stores/tabs.store')
const { useWorkspaceStore } = await import('../../../src/renderer/stores/workspace.store')

const SCHEMA = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/postman/v3-schema/collection.json'), 'utf-8'),
)
const validateV3 = new Ajv({ strict: false, allErrors: true }).compile(SCHEMA)

const DOC = 'query GetUser { user { id } }\nmutation Rename { rename }'
const SUB_DOC = 'query Now { now }\nsubscription Feed { tick }'
const INIT = '{"tenant":"t-init-canary"}'

const ok = (data: unknown): { success: true; data: unknown } => ({ success: true, data })

let workspaceId = ''
let projectId = ''
let suiteId = ''

type RowKind = 'endpoint' | 'savedRequest' | 'testSuiteItem'

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  suiteId = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, 'S', 0, ?, ?)`,
    )
    .run(suiteId, projectId, now, now)
  registerEndpointHandlers()
  registerTestSuiteHandlers()
  const rowApi = (table: string, channel: string): Record<string, unknown> => ({
    get: async (id: string) => ok(testDb.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)),
    update: (id: string, data: unknown) => harness.invoke(`${channel}:update`, id, data),
  })
  ;(globalThis as unknown as { window: unknown }).window = {
    dispatchEvent: () => true,
    api: {
      endpoint: rowApi('endpoints', 'endpoint'),
      savedRequest: rowApi('saved_requests', 'savedRequest'),
      testSuiteItem: rowApi('test_suite_items', 'testSuiteItem'),
      folder: { list: async () => ok([]) },
      settings: { get: async () => ok(undefined) },
    },
  }
  useWorkspaceStore.setState({ activeWorkspaceId: workspaceId, activeProjectId: projectId })
})
afterEach(() => {
  testDb.close()
})

function emptyRow(kind: RowKind, name: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  if (kind === 'endpoint') {
    testDb
      .prepare(
        `INSERT INTO endpoints
          (id, project_id, folder_id, name, protocol, method, path, status,
           request_schema, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'graphql', 'POST', '', 'developing', '{}', 0, ?, ?)`,
      )
      .run(id, projectId, name, now, now)
  } else if (kind === 'savedRequest') {
    testDb
      .prepare(
        `INSERT INTO saved_requests
          (id, project_id, folder_id, name, protocol, method, url, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'graphql', 'POST', '', ?, ?)`,
      )
      .run(id, projectId, name, now, now)
  } else {
    testDb
      .prepare(
        `INSERT INTO test_suite_items
          (id, suite_id, folder_id, protocol, name, method, url, request_schema, assertions,
           sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'graphql', ?, 'POST', '', '{}', '[]', 0, ?, ?)`,
      )
      .run(id, suiteId, name, now, now)
  }
  return id
}

/** A row exactly as the GraphQL tab's Ctrl+S writes it. */
async function saved(
  kind: RowKind,
  name: string,
  editor: { query: string; operationName?: string; connectionInit?: string },
): Promise<string> {
  const id = emptyRow(kind, name)
  const tabId = `tab-${id}`
  useTabsStore.setState({
    tabs: [
      {
        id: tabId,
        name,
        protocol: 'graphql',
        method: 'POST',
        url: '',
        isDirty: true,
        ...(kind === 'endpoint' ? { endpointId: id } : {}),
        ...(kind === 'savedRequest' ? { savedRequestId: id } : {}),
        ...(kind === 'testSuiteItem' ? { testSuiteItemId: id } : {}),
      } as never,
    ],
    activeTabId: tabId,
  })
  useRequestStore.getState().switchToTab(tabId)
  useGraphQLStore.getState().switchToTab(tabId)
  useGraphQLStore.setState({
    url: 'http://gql.test/graphql',
    variables: '{"a":1}',
    headers: [] as never,
    withheldCredentials: [],
    operationName: '',
    connectionInit: '',
    ...editor,
  })
  expect(await saveActiveRequestInPlace()).toEqual({ success: true })
  return id
}

function otherProject(): string {
  return seedProject(testDb, workspaceId)
}

const importedBody = (project: string): { type: string; content: string } => {
  const row = testDb
    .prepare('SELECT request_schema FROM endpoints WHERE project_id = ?')
    .get(project) as { request_schema: string }
  return (JSON.parse(row.request_schema) as { body: { type: string; content: string } }).body
}

interface V21Item {
  request: { body?: { mode: string; graphql?: Record<string, unknown> } }
}
const v21Items = (content: string): V21Item[] => (JSON.parse(content) as { item: V21Item[] }).item

const CONNECTION_INIT_NOTE = /"Feed row": the subscription connection_init payload/

describe('Postman v2.1', () => {
  it.each<RowKind>(['endpoint', 'savedRequest'])(
    '%s: the selection goes in graphql.operationName and comes back',
    async (kind) => {
      await saved(kind, 'R', { query: DOC, operationName: 'Rename' })
      const { content, notes } = buildPostmanProjectExport(projectId)
      expect(v21Items(content)[0].request.body?.graphql).toEqual({
        query: DOC,
        operationName: 'Rename',
        variables: '{"a":1}',
      })
      expect(notes).toEqual([])

      const dest = otherProject()
      await importPostman(dest, content, null, { apisTree: true })
      const body = importedBody(dest)
      expect(body.type).toBe('json')
      expect(JSON.parse(body.content).operationName).toBe('Rename')

      // Export again: still the selected one.
      expect(v21Items(buildPostmanProjectExport(dest).content)[0].request.body?.graphql).toEqual({
        query: DOC,
        operationName: 'Rename',
        variables: '{"a":1}',
      })
    },
  )

  it('nothing selected: the file sends what Send sends, the first operation', async () => {
    await saved('endpoint', 'R', { query: DOC })
    const g = v21Items(buildPostmanProjectExport(projectId).content)[0].request.body?.graphql
    expect(g?.operationName).toBe('GetUser')
  })

  it('one operation: no key, the same body as before', async () => {
    await saved('endpoint', 'R', { query: 'query Only { only }', operationName: 'Only' })
    expect(v21Items(buildPostmanProjectExport(projectId).content)[0].request.body).toEqual({
      mode: 'graphql',
      graphql: { query: 'query Only { only }', variables: '{"a":1}' },
    })
  })

  it.each<RowKind>(['endpoint', 'savedRequest'])(
    '%s: connection_init has no field: it is reported by name, never by value',
    async (kind) => {
      await saved(kind, 'Feed row', { query: 'subscription { tick }', connectionInit: INIT })
      const { content, notes } = buildPostmanProjectExport(projectId)
      expect(content).not.toContain('t-init-canary')
      expect(notes.join('\n')).toMatch(CONNECTION_INIT_NOTE)
      expect(notes.join('\n')).toContain('Postman v2.1')
      expect(notes.join('\n')).not.toContain('t-init-canary')
    },
  )

  it('a blank connection_init is nothing to report', async () => {
    await saved('endpoint', 'R', { query: 'subscription { tick }', connectionInit: '   ' })
    expect(buildPostmanProjectExport(projectId).notes).toEqual([])
  })

  it('a suite item keeps its query, its selection and its note', async () => {
    await saved('testSuiteItem', 'Feed row', {
      query: SUB_DOC,
      operationName: 'Now',
      connectionInit: INIT,
    })
    const { content, notes } = buildPostmanSuiteExport(suiteId)
    expect(v21Items(content)[0].request.body?.graphql).toEqual({
      query: SUB_DOC,
      operationName: 'Now',
      variables: '{"a":1}',
    })
    expect(notes.join('\n')).toMatch(CONNECTION_INIT_NOTE)
  })
})

describe('Postman v2.1 import of a name it cannot use', () => {
  const collection = (graphql: Record<string, unknown>): string =>
    JSON.stringify({
      info: {
        name: 'C',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'R',
          request: {
            method: 'POST',
            url: 'http://gql.test/graphql',
            body: { mode: 'graphql', graphql },
          },
        },
      ],
    })

  it('a name the document does not hold is dropped and reported', async () => {
    const dest = otherProject()
    const res = await importPostman(
      dest,
      collection({ query: DOC, variables: '{}', operationName: 'Gone' }),
      null,
      { apisTree: true },
    )
    expect(JSON.parse(importedBody(dest).content)).not.toHaveProperty('operationName')
    expect((res.warnings ?? []).join('\n')).toMatch(/operation name "Gone" is not in the query/)
  })

  it('the name of a lone operation adds nothing: no key, no warning', async () => {
    const dest = otherProject()
    const res = await importPostman(
      dest,
      collection({ query: 'query Only { only }', variables: '{}', operationName: 'Only' }),
      null,
      { apisTree: true },
    )
    expect(JSON.parse(importedBody(dest).content)).toEqual({
      query: 'query Only { only }',
      variables: {},
    })
    expect((res.warnings ?? []).join('\n')).not.toMatch(/operation name/)
  })
})

interface V3Item {
  name: string
  $kind: string
  query?: string
  operationName?: string
}

describe('Postman v3', () => {
  it.each<RowKind>(['endpoint', 'savedRequest'])(
    '%s: operationName is a real field, the file validates, and it comes back',
    async (kind) => {
      await saved(kind, 'R', { query: DOC, operationName: 'Rename' })
      const built = buildPostmanV3ProjectExport(projectId)
      const doc = JSON.parse(v3JsonText(built)) as { items: V3Item[] }
      expect(validateV3(doc), JSON.stringify(validateV3.errors?.slice(0, 3))).toBe(true)
      expect(doc.items[0]).toMatchObject({
        $kind: 'graphql-request',
        query: DOC,
        operationName: 'Rename',
      })
      expect(built.notes).toEqual([])

      const dest = otherProject()
      const res = await importPostman(dest, v3JsonText(built), null, { apisTree: true })
      expect((res.warnings ?? []).join('\n')).not.toMatch(/operation name/)
      const row = testDb
        .prepare('SELECT protocol, request_schema FROM endpoints WHERE project_id = ?')
        .get(dest) as { protocol: string; request_schema: string }
      expect(row.protocol).toBe('graphql')
      const metadata = (JSON.parse(row.request_schema) as { metadata: Record<string, unknown> })
        .metadata

      // The editor opens the imported row on the same operation.
      useGraphQLStore.setState({ operationName: 'left over' })
      restoreProtocolFromMetadata('graphql', metadata)
      expect(useGraphQLStore.getState().operationName).toBe('Rename')
    },
  )

  it('one operation: no field', async () => {
    await saved('endpoint', 'R', { query: 'query Only { only }', operationName: 'Only' })
    const doc = JSON.parse(v3JsonText(buildPostmanV3ProjectExport(projectId))) as {
      items: V3Item[]
    }
    expect(doc.items[0]).not.toHaveProperty('operationName')
  })

  it('a suite item carries both the selection and the note', async () => {
    await saved('testSuiteItem', 'Feed row', {
      query: SUB_DOC,
      operationName: 'Feed',
      connectionInit: INIT,
    })
    const built = buildPostmanV3SuiteExport(suiteId)
    const text = v3JsonText(built)
    expect((JSON.parse(text) as { items: V3Item[] }).items[0].operationName).toBe('Feed')
    expect(text).not.toContain('t-init-canary')
    expect(built.notes.join('\n')).toMatch(CONNECTION_INIT_NOTE)
  })
})

interface InsomniaResource {
  _type: string
  body?: { mimeType?: string; text?: string }
}
const insomniaRequest = (content: string): InsomniaResource =>
  (JSON.parse(content) as { resources: InsomniaResource[] }).resources.find(
    (r) => r._type === 'request',
  )!

describe('Insomnia', () => {
  it.each<RowKind>(['endpoint', 'savedRequest'])(
    '%s: the selection rides in the GraphQL body and comes back as a GraphQL body',
    async (kind) => {
      await saved(kind, 'R', { query: DOC, operationName: 'Rename' })
      const { content, notes } = buildInsomniaProjectExport(projectId)
      const request = insomniaRequest(content)
      expect(request.body?.mimeType).toBe('application/graphql')
      expect(JSON.parse(request.body?.text ?? '')).toEqual({
        query: DOC,
        operationName: 'Rename',
        variables: { a: 1 },
      })
      expect(notes).toEqual([])

      const dest = otherProject()
      await importInsomnia(dest, content, null)
      const body = importedBody(dest)
      expect(body.type).toBe('json')
      expect(JSON.parse(body.content).operationName).toBe('Rename')
      // A second trip keeps Insomnia's GraphQL mode.
      expect(insomniaRequest(buildInsomniaProjectExport(dest).content).body?.mimeType).toBe(
        'application/graphql',
      )
    },
  )

  it.each(['application/graphql', 'graphql/json'])(
    'import of %s: a JSON body; an empty one stays no body',
    async (mimeType) => {
      const file = (text?: string): string =>
        JSON.stringify({
          __export_format: 4,
          resources: [
            {
              _id: 'req_1',
              _type: 'request',
              parentId: null,
              name: 'R',
              method: 'POST',
              url: 'http://gql.test/graphql',
              body: { mimeType, ...(text !== undefined ? { text } : {}) },
            },
          ],
        })
      const withBody = otherProject()
      await importInsomnia(withBody, file('{"query":"{ a }"}'), null)
      expect(importedBody(withBody)).toMatchObject({ type: 'json', content: '{"query":"{ a }"}' })

      const empty = otherProject()
      await importInsomnia(empty, file(), null)
      expect(importedBody(empty).type).toBe('none')
    },
  )

  it('connection_init is reported, project and suite', async () => {
    await saved('endpoint', 'Feed row', { query: 'subscription { tick }', connectionInit: INIT })
    await saved('testSuiteItem', 'Feed row', {
      query: 'subscription { tick }',
      connectionInit: INIT,
    })
    const project = buildInsomniaProjectExport(projectId)
    const suite = buildInsomniaSuiteExport(suiteId)
    for (const built of [project, suite]) {
      expect(built.content).not.toContain('t-init-canary')
      expect(built.notes.join('\n')).toMatch(CONNECTION_INIT_NOTE)
      expect(built.notes.join('\n')).toContain('Insomnia')
    }
  })

  it('a suite item keeps its query and selection', async () => {
    await saved('testSuiteItem', 'R', { query: DOC, operationName: 'Rename' })
    const request = insomniaRequest(buildInsomniaSuiteExport(suiteId).content)
    expect(JSON.parse(request.body?.text ?? '').operationName).toBe('Rename')
  })
})

describe('OpenAPI', () => {
  it('the selection stays in the request body, connection_init is reported', async () => {
    await saved('endpoint', 'Feed row', {
      query: SUB_DOC,
      operationName: 'Feed',
      connectionInit: INIT,
    })
    const { content, notes } = buildOpenApiProjectExport(projectId)
    expect(content).toContain('operationName')
    expect(content).not.toContain('t-init-canary')
    expect(notes.join('\n')).toMatch(CONNECTION_INIT_NOTE)
  })
})

describe('the project file (and git, which writes the same file)', () => {
  it.each<RowKind>(['endpoint', 'savedRequest'])(
    '%s: both fields survive, as request-level values, and reopen in the editor',
    async (kind) => {
      const id = await saved(kind, 'R', {
        query: SUB_DOC,
        operationName: 'Feed',
        connectionInit: INIT,
      })
      const file = JSON.stringify(stripLocalSecrets(exportProjectData(projectId)))
      expect(file).toContain('t-init-canary')

      const table = kind === 'endpoint' ? 'endpoints' : 'saved_requests'
      testDb.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
      testDb.prepare('DELETE FROM test_suites WHERE project_id = ?').run(projectId)
      testDb.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
      const dest = otherProject()
      await importProjectDataFromJson(file, dest)

      const row = testDb.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as {
        request_schema?: string
        metadata?: string
      }
      const metadata =
        kind === 'endpoint'
          ? (JSON.parse(row.request_schema ?? '{}') as { metadata: Record<string, unknown> })
              .metadata
          : (JSON.parse(row.metadata ?? '{}') as Record<string, unknown>)
      useGraphQLStore.setState({ operationName: '', connectionInit: '' })
      restoreProtocolFromMetadata('graphql', metadata)
      expect(useGraphQLStore.getState().operationName).toBe('Feed')
      expect(useGraphQLStore.getState().connectionInit).toBe(INIT)
    },
  )
})
