/**
 * Every importer's real rows through every feature that reads them.
 *
 * Each importer was tested against its own rows and each consumer against tidy
 * typed ones, so the seam stayed untested: `/pets/*` in the mock, `placeholder`
 * in an OpenAPI server, a gRPC row that opened empty (docs/e2e/test-rules.md,
 * rule 2). A format added to the Import modal fails here until it has a row.
 *
 * Real import handlers, repositories, mock server, Runner request building and
 * export builders on a test DB. Only the HTTP engine is replaced, to see the
 * request Run builds without reaching the network.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, makeElectronMock, seedProject, seedWorkspace, setupHandlerHarness } from './helpers'
import { freeTcpPort, realMockFromFolderApi } from './real-mock-bridge'

const harness = setupHandlerHarness()
const sent = vi.hoisted(() => ({ urls: [] as string[] }))

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
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

class FakeStore {
  get(): unknown {
    return undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

vi.mock('../../../src/main/protocols/http.engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/protocols/http.engine')>()),
  executeHttpRequest: async (options: { url: string }) => {
    sent.urls.push(options.url)
    return {
      requestId: 'matrix',
      protocol: 'http',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
      bodySize: 2,
      timing: { total: 1 },
    }
  },
}))

const handlers = await import('../../../src/main/ipc/import-export.handler')
const { registerEndpointHandlers } = await import('../../../src/main/ipc/endpoint.handler')
const { registerSavedResponseHandlers } = await import('../../../src/main/ipc/saved-response.handler')
const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')
const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { mockServerManager } = await import('../../../src/main/mock/server')
const { createGlobalVariable } = await import('../../../src/main/db/environment.repo')
const { createMockFromRequests } = await import(
  '../../../src/renderer/components/mock/mock-from-folder'
)
const { openEndpointTab } = await import('../../../src/renderer/lib/open-endpoint-tab')
const { useRequestStore } = await import('../../../src/renderer/stores/request.store')
const { useGrpcStore } = await import('../../../src/renderer/stores/grpc.store')
const { useGraphQLStore } = await import('../../../src/renderer/stores/graphql.store')
const { useTabsStore } = await import('../../../src/renderer/stores/tabs.store')
const { normalizeRequest, renderSnippet } = await import('../../../src/shared/codegen')
const { isHttpMockableProtocol, isRunnableProtocol } = await import(
  '../../../src/shared/request-protocols'
)

const FIXTURES = join(__dirname, '../../fixtures/importer-matrix')
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf-8')
const PROTO_PATH = join(__dirname, '../../fixtures/import-export/echo.proto')

interface Base {
  id: string
  url: string
  /** What the mock binds in front of `/pets`. */
  mockPrefix: string
  /** Swagger's `host`, gRPC's address. */
  host: string
}
const REAL: Base = {
  id: 'real base URL',
  url: 'https://api.example.test/v1',
  mockPrefix: '/v1',
  host: 'api.example.test',
}
const VAR: Base = { id: '{{baseUrl}}', url: '{{baseUrl}}', mockPrefix: '', host: '' }
const HOST: Base = {
  id: 'https://{{host}}',
  url: 'https://{{host}}/v1',
  mockPrefix: '/v1',
  host: '{{host}}',
}

interface Importer {
  /** Its card in the Import modal. */
  format: string
  name: string
  bases: Base[]
  run: (projectId: string, base: Base) => Promise<unknown>
}

const fill = (file: string, base: Base): string =>
  fixture(file).replaceAll('__BASE__', base.url).replaceAll('__HOST__', base.host)

const viaContent = (channel: string, file: string, extra: object = {}): Importer['run'] => {
  return (projectId, base) =>
    harness.invoke(channel, { projectId, content: fill(file, base), ...extra })
}

const ALL_BASES = [REAL, VAR, HOST]

const IMPORTERS: Importer[] = [
  {
    format: 'openapi',
    name: 'OpenAPI 3',
    bases: ALL_BASES,
    run: viaContent('import:openApi', 'openapi3.json', { format: 'openapi' }),
  },
  {
    format: 'openapi',
    name: 'Swagger 2',
    // `host` cannot hold a whole base URL.
    bases: [REAL, HOST],
    run: viaContent('import:openApi', 'swagger2.json', { format: 'openapi' }),
  },
  { format: 'postman', name: 'Postman v1', bases: ALL_BASES, run: viaContent('import:postman', 'postman-v1.json') },
  { format: 'postman', name: 'Postman v2.1', bases: ALL_BASES, run: viaContent('import:postman', 'postman-v2.json') },
  { format: 'postman', name: 'Postman v3', bases: ALL_BASES, run: viaContent('import:postman', 'postman-v3.json') },
  { format: 'apinizer', name: 'Apinizer (Postman v2.1)', bases: [REAL], run: viaContent('import:postman', 'postman-v2.json') },
  { format: 'insomnia', name: 'Insomnia v4', bases: ALL_BASES, run: viaContent('import:insomnia', 'insomnia-v4.json') },
  { format: 'insomnia', name: 'Insomnia v5', bases: ALL_BASES, run: viaContent('import:insomnia', 'insomnia-v5.yaml') },
  { format: 'har', name: 'HAR', bases: ALL_BASES, run: viaContent('import:har', 'sample.har') },
  {
    format: 'curl',
    name: 'cURL',
    bases: ALL_BASES,
    run: (projectId, base) =>
      harness.invoke('import:curl', { projectId, curlCommand: fill('curl.txt', base) }),
  },
  {
    format: 'wsdl',
    name: 'WSDL',
    bases: ALL_BASES,
    run: async (projectId, base) => {
      const parsed = (await harness.invoke('import:wsdl:parseFile', fill('service.wsdl', base))) as {
        data?: unknown
        error?: string
      }
      expect(parsed.error).toBeUndefined()
      return harness.invoke('import:wsdl', { projectId, parsedWsdl: parsed.data })
    },
  },
  {
    format: 'proto',
    name: '.proto',
    bases: [REAL, HOST],
    run: (projectId, base) =>
      harness.invoke('import:proto', {
        projectId,
        protoPath: PROTO_PATH,
        serverAddress: `${base.host}:443`,
      }),
  },
  { format: 'soapui', name: 'SoapUI', bases: ALL_BASES, run: viaContent('import:soapui', 'soapui.xml') },
  { format: 'raml', name: 'RAML', bases: ALL_BASES, run: viaContent('import:raml', 'api.raml') },
]

/** Cards with no row here, and why. */
const NOT_A_REQUEST_IMPORTER: Record<string, string> = {
  native: 'A Testnizer file carries rows Testnizer wrote; the git fidelity test owns it.',
}

const POSTMAN_V3_GRAPHQL = 'Search'

describe('the matrix covers the Import modal', () => {
  it('every format card has a row or a stated reason', () => {
    const modal = readFileSync(
      join(__dirname, '../../../src/renderer/components/modals/ImportModal.tsx'),
      'utf-8',
    )
    const list = modal.slice(modal.indexOf('const IMPORT_FORMATS'), modal.indexOf('const URL_IMPORTABLE'))
    const cards = [...list.matchAll(/\bid: '([\w-]+)'/g)].map((m) => m[1])
    expect(cards.length).toBeGreaterThanOrEqual(11)
    const covered = new Set([
      ...IMPORTERS.map((i) => i.format),
      ...Object.keys(NOT_A_REQUEST_IMPORTER),
    ])
    expect(cards.filter((card) => !covered.has(card))).toEqual([])
  })
})

interface Row {
  id: string
  name: string
  protocol: string | null
  method: string | null
  path: string | null
  request_schema: string | null
}

/** A variable-named request of the fixture: `petId` must survive every step. */
const namesPathVariable = (row: Row): boolean => /^Get pet|^GET .*pets\/./.test(row.name)
const HOSTS = /https?:\/\/|\{\{baseUrl\}\}|\{\{host\}\}|api\.example\.test/g

/** The invariants of a URL (or URL part) any consumer shows, sends or writes. */
function expectCleanUrl(where: string, url: string, row: Row): void {
  expect(url, `${where}: ${row.name}`).not.toContain('*')
  expect(url, `${where}: ${row.name}`).not.toContain('placeholder')
  expect(url, `${where}: ${row.name}`).not.toContain('undefined')
  expect(url, `${where}: ${row.name}`).not.toContain('{{var}}')
  expect(url, `${where}: ${row.name}`).not.toContain('__')
  const hosts = (url.match(HOSTS) ?? []).filter((h) => !/^https?:/.test(h))
  expect(hosts.length, `${where}: doubled host in ${url}`).toBeLessThanOrEqual(1)
}

function stubWindow(): void {
  const call = (channel: string) => (id: string) => harness.invoke(channel, id)
  vi.stubGlobal('window', {
    api: {
      savedRequest: { get: call('savedRequest:get') },
      endpoint: { get: call('endpoint:get') },
    },
  })
}

describe.each(
  IMPORTERS.flatMap((importer) => importer.bases.map((base) => ({ importer, base }))),
)('$importer.name, $base.id', ({ importer, base }) => {
  let projectId = ''
  let workspaceId = ''
  let rows: Row[] = []

  beforeEach(async () => {
    testDb = createTestDb()
    harness.reset()
    handlers.registerImportExportHandlers()
    registerEndpointHandlers()
    registerSavedResponseHandlers()
    registerMockHandlers()
    registerRunnerHandlers()
    workspaceId = seedWorkspace(testDb)
    projectId = seedProject(testDb, workspaceId)
    stubWindow()
    sent.urls.length = 0

    const result = (await importer.run(projectId, base)) as {
      success: boolean
      error?: string
      data?: { success?: boolean; error?: string }
    }
    expect(result.error ?? result.data?.error).toBeUndefined()
    rows = testDb
      .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order')
      .all(projectId) as Row[]
    expect(rows.length).toBeGreaterThan(0)
  })

  afterEach(async () => {
    await mockServerManager.stopAll()
    vi.unstubAllGlobals()
  })

  it('stores a clean path', () => {
    for (const row of rows) {
      expectCleanUrl('endpoints.path', row.path ?? '', row)
      if (namesPathVariable(row)) expect(row.path).toContain('petId')
    }
  })

  it('mock from folder binds a path a call matches', async () => {
    const result = await createMockFromRequests(realMockFromFolderApi(harness), {
      projectId,
      name: 'Matrix',
      ids: rows.map((r) => r.id),
    })
    const mockable = rows.filter((r) => isHttpMockableProtocol(r.protocol))
    if (mockable.length === 0) {
      expect(result.ok).toBe(false)
      return
    }
    expect(result.error).toBeUndefined()
    // Every row not bound is named, nothing just disappears.
    for (const row of rows) {
      if (!isHttpMockableProtocol(row.protocol)) {
        expect(result.warnings.join('\n')).toContain(row.name)
      }
    }
    const servers = (await harness.invoke('mock:server:list', projectId)) as {
      data: Array<{ id: string }>
    }
    const serverId = servers.data[0].id
    const endpoints = (await harness.invoke('mock:endpoint:list', serverId)) as {
      data: Array<{ method: string; path: string; pathMode: string }>
    }
    expect(endpoints.data.length + result.warnings.length).toBeGreaterThanOrEqual(mockable.length)
    const port = await freeTcpPort()
    await harness.invoke('mock:server:update', serverId, { port })
    await harness.invoke('mock:server:start', serverId)
    for (const endpoint of endpoints.data) {
      expect(endpoint.path).not.toContain('*')
      expect(endpoint.path).not.toContain('{')
      expect(endpoint.path.startsWith(`${base.mockPrefix}/`), endpoint.path).toBe(true)
      expect(endpoint.pathMode === 'wildcard').toBe(false)
      const call = endpoint.path.replace(/:[^/]+/g, '42')
      const res = await fetch(`http://127.0.0.1:${port}${call}`, { method: endpoint.method })
      expect(res.status, `${endpoint.method} ${call}`).toBe(200)
    }
    const named = rows.filter((r) => namesPathVariable(r) && isHttpMockableProtocol(r.protocol))
    if (named.length > 0) {
      expect(endpoints.data.map((e) => e.path).join(' ')).toContain(':petId')
    }
  })

  it('a tab opens with the URL and the protocol state', async () => {
    for (const row of rows) {
      await openEndpointTab(row.id)
      const tab = useTabsStore.getState().tabs.find((t) => t.endpointId === row.id)
      expect(tab, row.name).toBeDefined()
      const url = useRequestStore.getState().url
      expectCleanUrl('request tab', url, row)
      expect(url, row.name).not.toBe('')
      if (namesPathVariable(row)) {
        expect(url, row.name).toMatch(/\/pets\/(42|:petId|\{\{petId\}\})$/)
        if (url.includes(':petId')) {
          expect(
            useRequestStore.getState().pathVariables.map((v) => v.key),
            row.name,
          ).toEqual(['petId'])
        }
      }
      if (row.protocol === 'grpc') {
        const grpc = useGrpcStore.getState()
        expect(grpc.address).toBe(`${base.host}:443`)
        expect(grpc.protoPath).toBe(PROTO_PATH)
        expect(grpc.protoSource).toBe('file')
        expect(grpc.selectedService).toBe('echo.EchoService')
        expect(grpc.selectedMethod).toBe(row.name)
        expect(grpc.requestBody).toContain('message')
      }
      if (row.protocol === 'graphql') {
        const graphql = useGraphQLStore.getState()
        expect(graphql.query).toContain('Search')
        expectCleanUrl('graphql tab', graphql.url, row)
      }
    }
  })

  it('Run builds a resolved URL', async () => {
    createGlobalVariable({ project_id: projectId, workspace_id: workspaceId, key: 'baseUrl', value: 'https://run.example.test' })
    createGlobalVariable({ project_id: projectId, workspace_id: workspaceId, key: 'host', value: 'run.example.test' })
    createGlobalVariable({ project_id: projectId, workspace_id: workspaceId, key: 'petId', value: '42' })
    const runnable = rows.filter((r) => isRunnableProtocol(r.protocol))
    for (const row of runnable) {
      sent.urls.length = 0
      const res = (await harness.invoke('runner:execute', {
        projectId,
        workspaceId,
        endpointIds: [row.id],
      })) as { success: boolean; error?: string }
      expect(res.error).toBeUndefined()
      expect(sent.urls.length, row.name).toBe(1)
      const url = sent.urls[0]
      expect(url, row.name).toMatch(/^https:\/\/(run|api)\.example\.test\//)
      // A `:petId` of OpenAPI / RAML is named but has no value yet: it goes as written.
      expect(url, row.name).not.toContain('{{')
      expect(url, row.name).not.toContain('*')
      expect(url, row.name).not.toContain('undefined')
      if (namesPathVariable(row)) expect(url, row.name).toMatch(/\/pets\/(42|:petId)$/)
    }
  })

  it('code generation writes a usable snippet', async () => {
    for (const row of rows.filter((r) => isHttpMockableProtocol(r.protocol))) {
      await openEndpointTab(row.id)
      const s = useRequestStore.getState()
      const code = renderSnippet(
        'curl',
        normalizeRequest({
          method: s.method,
          url: s.url,
          params: s.params,
          headers: s.headers,
          pathVariables: s.pathVariables,
        }),
      )
      expect(code, row.name).not.toContain('placeholder')
      expect(code, row.name).not.toContain('undefined')
      expect(code, row.name).not.toContain('/pets/*')
      if (namesPathVariable(row)) expect(code, row.name).toMatch(/petId|\/pets\/42/)
    }
  })

  it('every export parses and keeps the URL', async () => {
    const collect = (node: unknown, out: Array<{ url: string; key: string }>, key = ''): void => {
      if (Array.isArray(node)) {
        for (const child of node) collect(child, out, key)
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) collect(v, out, k)
      } else if (typeof node === 'string' && ['url', 'raw', 'path', 'host'].includes(key)) {
        out.push({ url: node, key })
      }
    }
    const row: Row = { id: '', name: 'export', protocol: null, method: null, path: null, request_schema: null }
    const anyNamed = rows.some(namesPathVariable)
    const http = rows.some((r) => isHttpMockableProtocol(r.protocol))

    const postman = handlers.buildPostmanProjectExport(projectId)
    const insomnia = handlers.buildInsomniaProjectExport(projectId)
    const openApi = handlers.buildOpenApiProjectExport(projectId)
    const v3 = (await harness.invoke('export:postmanV3Json', projectId)) as {
      success: boolean
      data?: string | { content: string }
      error?: string
    }
    expect(v3.error).toBeUndefined()
    const v3Text = typeof v3.data === 'string' ? v3.data : (v3.data?.content ?? '')

    for (const [label, text] of [
      ['Postman v2.1', postman.content],
      ['Postman v3', v3Text],
      ['Insomnia', insomnia.content],
    ]) {
      expect(text, label).not.toContain('placeholder')
      const urls: Array<{ url: string; key: string }> = []
      collect(JSON.parse(text), urls)
      for (const { url } of urls) expectCleanUrl(label, url, row)
      if (anyNamed) expect(text, label).toContain('petId')
    }

    // A GraphQL row carries its query and editor headers in every collection file.
    if (rows.some((r) => r.name === POSTMAN_V3_GRAPHQL)) {
      for (const [label, text] of [
        ['Postman v2.1', postman.content],
        ['Insomnia', insomnia.content],
      ]) {
        expect(text, label).toContain('query Search')
        expect(text, label).toContain('X-Gql')
      }
    }

    const spec = JSON.parse(openApi.content) as {
      paths: Record<string, Record<string, { parameters?: Array<{ name: string; in: string }> }>>
      servers?: Array<{ url: string }>
    }
    expect(openApi.content).not.toContain('placeholder')
    for (const server of spec.servers ?? []) {
      expect(server.url).toMatch(/^https?:\/\/[^/{}]+$/)
    }
    for (const key of Object.keys(spec.paths)) {
      expect(key.startsWith('/'), key).toBe(true)
      expectCleanUrl('OpenAPI path', key, row)
      expect(key).not.toContain('{{')
    }
    if (http && anyNamed) {
      const named = Object.entries(spec.paths).find(([key]) => key.endsWith('/pets/{petId}'))
      expect(named, Object.keys(spec.paths).join(' ')).toBeDefined()
      const parameters = Object.values(named?.[1] ?? {}).flatMap((op) => op.parameters ?? [])
      expect(parameters).toContainEqual(expect.objectContaining({ name: 'petId', in: 'path' }))
    }
  })
})

describe('rows written by earlier versions', () => {
  let projectId = ''

  beforeEach(() => {
    testDb = createTestDb()
    harness.reset()
    handlers.registerImportExportHandlers()
    registerEndpointHandlers()
    registerSavedResponseHandlers()
    registerMockHandlers()
    projectId = seedProject(testDb, seedWorkspace(testDb))
    stubWindow()
  })

  afterEach(async () => {
    await mockServerManager.stopAll()
    vi.unstubAllGlobals()
  })

  /** A real import, then the one column an old build wrote differently. */
  async function oldStarRows(urls: string[]): Promise<void> {
    await harness.invoke('import:postman', {
      projectId,
      content: JSON.stringify({
        info: {
          name: 'Old',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: urls.map((url, i) => ({ name: `R${i}`, request: { method: 'GET', url } })),
      }),
    })
    testDb.prepare(`UPDATE endpoints SET path = '/pets/*'`).run()
  }

  it('a `/pets/*` row binds its real URL in the mock', async () => {
    await oldStarRows(['https://api.example.test/pets/{{petId}}'])
    const row = testDb.prepare('SELECT id FROM endpoints').get() as { id: string }
    await createMockFromRequests(realMockFromFolderApi(harness), {
      projectId,
      name: 'Old',
      ids: [row.id],
    })
    const servers = (await harness.invoke('mock:server:list', projectId)) as {
      data: Array<{ id: string }>
    }
    const port = await freeTcpPort()
    await harness.invoke('mock:server:update', servers.data[0].id, { port })
    await harness.invoke('mock:server:start', servers.data[0].id)
    expect((await fetch(`http://127.0.0.1:${port}/pets/42`)).status).toBe(200)
  })

  it('`/pets/*` rows keep their variables in OpenAPI and do not collide', async () => {
    await oldStarRows([
      'https://api.example.test/pets/{{a}}',
      'https://api.example.test/pets/{{b}}',
    ])
    const out = handlers.buildOpenApiProjectExport(projectId)
    const spec = JSON.parse(out.content) as { paths: Record<string, unknown> }
    expect(Object.keys(spec.paths).sort()).toEqual(['/pets/{a}', '/pets/{b}'])
    expect(out.skipped).toEqual([])
  })

  it('a host variable names no server in OpenAPI, and the path is kept', async () => {
    await oldStarRows(['https://{{host}}/v1/pets'])
    const spec = JSON.parse(handlers.buildOpenApiProjectExport(projectId).content) as {
      paths: Record<string, unknown>
      servers?: unknown
    }
    expect(spec.servers).toBeUndefined()
    expect(Object.keys(spec.paths)).toEqual(['/v1/pets'])
  })

  it('a gRPC row with only the old top-level block opens with its call', async () => {
    await harness.invoke('import:proto', {
      projectId,
      protoPath: PROTO_PATH,
      serverAddress: 'grpc.example.test:443',
    })
    const rows = testDb
      .prepare(`SELECT id, name, request_schema FROM endpoints WHERE name = 'ServerStream'`)
      .all() as Row[]
    const schema = JSON.parse(rows[0].request_schema ?? '{}') as Record<string, unknown>
    delete schema.metadata
    testDb
      .prepare('UPDATE endpoints SET request_schema = ? WHERE id = ?')
      .run(JSON.stringify(schema), rows[0].id)

    await openEndpointTab(rows[0].id)
    const grpc = useGrpcStore.getState()
    expect(grpc.address).toBe('grpc.example.test:443')
    expect(grpc.useTls).toBe(true)
    expect(grpc.protoPath).toBe(PROTO_PATH)
    expect(grpc.selectedService).toBe('echo.EchoService')
    expect(grpc.selectedMethod).toBe('ServerStream')
    // Send picks its stream path from this.
    expect(grpc.getSelectedMethod()?.type).toBe('server_streaming')
  })
})

describe('Mock from folder: what it cannot bind is named', () => {
  beforeEach(() => {
    testDb = createTestDb()
    harness.reset()
    handlers.registerImportExportHandlers()
    registerEndpointHandlers()
    registerSavedResponseHandlers()
    registerMockHandlers()
  })

  it('WSDL operations on one URL: the first binds, the others are warned by name', async () => {
    const projectId = seedProject(testDb, seedWorkspace(testDb))
    await IMPORTERS.find((i) => i.name === 'WSDL')?.run(projectId, REAL)
    const rows = testDb.prepare('SELECT id, name FROM endpoints ORDER BY sort_order').all() as Row[]
    expect(rows.map((r) => r.name)).toEqual(['Add', 'Sub'])

    const result = await createMockFromRequests(realMockFromFolderApi(harness), {
      projectId,
      name: 'SOAP',
      ids: rows.map((r) => r.id),
    })
    expect(result.endpointsCreated).toBe(1)
    expect(result.warnings).toEqual([expect.stringContaining('"Sub"')])
    expect(result.warnings[0]).toContain('"Add"')
    expect(result.warnings[0]).toContain('POST /v1/svc')
  })

  it('RAML: uriParameters fill the path variables, the nearest declaration winning', async () => {
    const projectId = seedProject(testDb, seedWorkspace(testDb))
    const content = `#%RAML 1.0
title: Pets
baseUri: https://api.example.test
/shops/{shopId}:
  uriParameters:
    shopId: { example: "7", description: Shop }
    petId: { default: "from-parent" }
  /pets/{petId}:
    uriParameters:
      petId: { default: "42" }
    get:
      displayName: Get pet
`
    await harness.invoke('import:raml', { projectId, content })
    const row = testDb
      .prepare('SELECT path, request_schema FROM endpoints WHERE project_id = ?')
      .get(projectId) as { path: string; request_schema: string }
    expect(row.path).toBe('https://api.example.test/shops/:shopId/pets/:petId')
    const vars = (JSON.parse(row.request_schema) as { pathVariables: object[] }).pathVariables
    expect(vars).toEqual([
      expect.objectContaining({ key: 'shopId', value: '7', description: 'Shop' }),
      expect.objectContaining({ key: 'petId', value: '42' }),
    ])
  })

  it('a WebSocket, gRPC or MCP row is not an HTTP endpoint, and a folder of them says why', async () => {
    const projectId = seedProject(testDb, seedWorkspace(testDb))
    await harness.invoke('import:proto', { projectId, protoPath: PROTO_PATH })
    const rows = testDb.prepare('SELECT id, name FROM endpoints').all() as Row[]

    const result = await createMockFromRequests(realMockFromFolderApi(harness), {
      projectId,
      name: 'gRPC',
      ids: rows.map((r) => r.id),
    })
    expect(result.ok).toBe(false)
    expect(result.endpointsCreated).toBe(0)
    expect(result.error).toContain('Echo')
    expect(result.warnings).toHaveLength(rows.length)
    const servers = (await harness.invoke('mock:server:list', projectId)) as { data: unknown[] }
    expect(servers.data).toEqual([])
  })
})

describe('an absolute file path in an import is named in the report', () => {
  const FILE = '/Users/x/.ssh/id_rsa'
  const postman = JSON.stringify({
    info: {
      name: 'C',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: 'Upload',
        request: {
          method: 'POST',
          url: 'https://x.test',
          body: { mode: 'formdata', formdata: [{ key: 'f', type: 'file', src: FILE }] },
        },
      },
    ],
  })
  const insomnia = JSON.stringify({
    _type: 'export',
    __export_format: 4,
    resources: [
      {
        _id: 'req_1',
        _type: 'request',
        parentId: 'wrk_1',
        name: 'Upload',
        method: 'POST',
        url: 'https://x.test',
        body: {
          mimeType: 'multipart/form-data',
          params: [{ name: 'f', type: 'file', fileName: FILE }],
        },
      },
    ],
  })

  it.each([
    ['Postman', 'import:postman', { content: postman }],
    ['Insomnia', 'import:insomnia', { content: insomnia }],
    ['cURL form part', 'import:curl', { curlCommand: `curl -F 'f=@${FILE}' https://x.test` }],
    ['cURL -d @file', 'import:curl', { curlCommand: `curl -d @${FILE} https://x.test` }],
    ['cURL -T', 'import:curl', { curlCommand: `curl -T ${FILE} https://x.test` }],
  ])('%s', async (_name, channel, payload) => {
    testDb = createTestDb()
    harness.reset()
    handlers.registerImportExportHandlers()
    const projectId = seedProject(testDb, seedWorkspace(testDb))
    const res = (await harness.invoke(channel, { projectId, ...payload })) as {
      success: boolean
      error?: string
      data?: { warnings?: string[] }
    }
    expect(res.error).toBeUndefined()
    const warnings = (res.data?.warnings ?? []).join('\n')
    expect(warnings).toContain(FILE)
    expect(warnings).toContain('Read files outside the working directory')
  })

  it('a relative path and a disabled part are not reported', async () => {
    testDb = createTestDb()
    harness.reset()
    handlers.registerImportExportHandlers()
    const projectId = seedProject(testDb, seedWorkspace(testDb))
    const res = (await harness.invoke('import:postman', {
      projectId,
      content: JSON.stringify({
        info: JSON.parse(postman).info,
        item: [
          {
            name: 'Upload',
            request: {
              method: 'POST',
              url: 'https://x.test',
              body: {
                mode: 'formdata',
                formdata: [
                  { key: 'a', type: 'file', src: 'data/a.bin' },
                  { key: 'b', type: 'file', src: FILE, disabled: true },
                ],
              },
            },
          },
        ],
      }),
    })) as { data?: { warnings?: string[] } }
    expect((res.data?.warnings ?? []).join('\n')).not.toContain('Working directory')
  })
})
