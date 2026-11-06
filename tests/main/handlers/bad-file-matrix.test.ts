/**
 * Try the bad file (docs/e2e/test-rules.md rule 3), as a class: every import
 * format × every bad input, through the real IPC handlers and the production
 * schema. A new importer without a row fails `every importer has a row`.
 *
 * Each bad input must end in a refusal or a warned result: never a silent
 * success, never a JavaScript error text, never rows left behind by a refusal,
 * nothing read outside the input, and quickly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import { createServer, type Server } from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock, seedProject, seedWorkspace } from './helpers'

const harness = setupHandlerHarness()
const dialogCalls = vi.hoisted(() => ({ count: 0 }))

vi.mock('electron', () => {
  const base = makeElectronMock()
  return {
    ...base,
    dialog: {
      showOpenDialog: async () => {
        dialogCalls.count++
        return { canceled: true, filePaths: [] }
      },
      showSaveDialog: async () => ({ canceled: true }),
    },
  }
})

let testDb: Database.Database
const realDb = await vi.importActual<typeof import('../../../src/main/db/database')>(
  '../../../src/main/db/database',
)
vi.mock('../../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/db/database')>()),
  getDb: () => testDb,
}))
vi.mock('../../../src/main/lib/secure-storage', () => ({
  encryptSecret: (s: string | null | undefined) =>
    s ? (s.startsWith('enc:') ? s : `enc:${s}`) : null,
  decryptSecret: (s: string | null | undefined) => (s ? s.replace(/^enc:/, '') : null),
  isEncryptedSecret: (s: unknown): s is string => typeof s === 'string' && s.startsWith('enc:'),
  isEncryptionAvailable: () => true,
}))
vi.mock('electron-store', () => ({
  default: class {
    get(): unknown {
      return undefined
    }
    set(): void {}
    delete(): void {}
  },
}))

const { registerImportExportHandlers } = await import('../../../src/main/ipc/import-export.handler')
const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')
const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')

// ─── The world each case runs in ────────────────────────────────────

// Not the OS temp dir: `save:importLocal` refuses system directories, /var among them.
const work = fs.mkdtempSync(join(process.cwd(), 'node_modules', '.bad-file-matrix-'))
const CANARY_TEXT = 'CANARY-c0ffee-must-never-be-read'
const canaryDir = join(work, 'canary')
fs.mkdirSync(canaryDir)
const canaryFile = join(canaryDir, 'secret.yaml')
fs.writeFileSync(canaryFile, `${CANARY_TEXT}: true\n`)

let server: Server
let serverHits = 0
let serverUrl = ''
const reads: string[] = []
type AnyFn = (...args: unknown[]) => unknown
const realFs: Record<string, AnyFn> = {}

/** Records any read of a canary path, by every route a parser could take. */
function watchReads(): void {
  const mutableFs = fs.default as unknown as Record<string, AnyFn>
  const promises = fs.default.promises as unknown as Record<string, AnyFn>
  for (const name of ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream']) {
    realFs[name] = mutableFs[name]
    mutableFs[name] = (...args: unknown[]) => {
      if (String(args[0]).includes(canaryDir)) reads.push(`${name}(${String(args[0])})`)
      return realFs[name](...args)
    }
  }
  for (const name of ['readFile', 'open']) {
    realFs[`p.${name}`] = promises[name]
    promises[name] = (...args: unknown[]) => {
      if (String(args[0]).includes(canaryDir)) reads.push(`promises.${name}(${String(args[0])})`)
      return realFs[`p.${name}`](...args)
    }
  }
  syncBuiltinESMExports()
}

function unwatchReads(): void {
  const mutableFs = fs.default as unknown as Record<string, AnyFn>
  const promises = fs.default.promises as unknown as Record<string, AnyFn>
  for (const name of ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream']) {
    mutableFs[name] = realFs[name]
  }
  for (const name of ['readFile', 'open']) promises[name] = realFs[`p.${name}`]
  syncBuiltinESMExports()
}

beforeAll(async () => {
  server = createServer((_req, res) => {
    serverHits++
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  watchReads()
})

afterAll(async () => {
  unwatchReads()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(work, { recursive: true, force: true })
})

let projectId = ''
let workspaceId = ''
let mockServerId = ''

beforeEach(() => {
  harness.reset()
  testDb = realDb.openAndMigrate(':memory:')
  registerImportExportHandlers()
  registerSaveHandlers()
  registerMockHandlers()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId, 'Bad files')
  mockServerId = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO mock_servers (id, project_id, name, port, created_at, updated_at)
       VALUES (?, ?, 'M', 45999, 0, 0)`,
    )
    .run(mockServerId, projectId)
  reads.length = 0
  serverHits = 0
  dialogCalls.count = 0
})

// ─── Reading the outcome ────────────────────────────────────────────

interface Outcome {
  kind: 'refused' | 'warned' | 'accepted'
  message: string
  warnings: string[]
}

function outcomeOf(raw: unknown): Outcome {
  const r = raw as {
    success?: boolean
    error?: string
    data?: { success?: boolean; ok?: boolean; error?: string; warnings?: string[] }
  }
  if (r.success === false) return { kind: 'refused', message: r.error ?? '', warnings: [] }
  const d = r.data
  if (d && (d.success === false || d.ok === false)) {
    return { kind: 'refused', message: d.error ?? '', warnings: d.warnings ?? [] }
  }
  const warnings = d?.warnings ?? []
  return warnings.length > 0
    ? { kind: 'warned', message: warnings.join(' | '), warnings }
    : { kind: 'accepted', message: '', warnings }
}

/** Text a person must never read: a JavaScript failure, not a file problem. */
const JS_ERROR =
  /Cannot read propert|Cannot convert|is not iterable|\bundefined\b|is not a function|Maximum call stack|circular structure|Invalid string length|NOT NULL constraint|FOREIGN KEY constraint/
const BARE_PARSER_ERROR = /^(Unexpected|Expected|Unterminated|Bad control|Bad escaped)/

function rowCounts(): Record<string, number> {
  const tables = testDb
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>
  const out: Record<string, number> = {}
  for (const { name } of tables) {
    out[name] = (testDb.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n
  }
  return out
}

function databaseText(): string {
  const tables = Object.keys(rowCounts())
  return tables.map((t) => JSON.stringify(testDb.prepare(`SELECT * FROM "${t}"`).all())).join('\n')
}

// ─── The formats ────────────────────────────────────────────────────

const POSTMAN_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
const OPENAPI_HEAD = { openapi: '3.0.3', info: { title: 'T', version: '1' } }
const okOp = { summary: 'ok', responses: { 200: { description: 'fine' } } }

const FIXTURES = join(__dirname, '../../fixtures/import-export')
const fixture = (name: string): string => fs.readFileSync(join(FIXTURES, name), 'utf-8')

type Send = (text: string) => Promise<unknown>

interface Format {
  /** Display name in the test title. */
  name: string
  channel: string
  /** The Import modal cards that reach this handler. */
  cards?: string[]
  yaml: boolean
  /** A real, good input: proves the row can succeed at all. */
  valid: () => string
  /** Other formats' valid samples this importer is right to accept. */
  alsoAccepts?: string[]
  /**
   * Wraps an arbitrarily deep JSON value in this format's own shape. Absent where
   * deep text is no structure at all (a cURL body is just a string).
   */
  deep?: (deepJson: string) => string
  /** Lines that make a YAML document look like this format. */
  yamlHead?: string
  /** Valid outer shape, broken inside (some rows good, some bad). */
  brokenInside: () => string[]
  /** Refers to a file and a URL that must stay untouched. */
  elsewhere: () => string
  send: (text: string) => Promise<unknown>
}

const openApiElsewhere = (): string =>
  JSON.stringify({
    ...OPENAPI_HEAD,
    paths: {
      '/ok': { get: okOp },
      '/file': { get: { parameters: [{ $ref: canaryFile }], responses: {} } },
      '/url': { get: { requestBody: { $ref: `${serverUrl}/x.yaml` }, responses: {} } },
      '/whole': { $ref: `file://${canaryFile}` },
    },
  })

const openApiBroken = (): string[] => [
  JSON.stringify({ ...OPENAPI_HEAD, paths: { '/ok': { get: okOp }, '/bad': null } }),
  JSON.stringify({ ...OPENAPI_HEAD, paths: { '/ok': { get: okOp }, '/bad': { get: 5 } } }),
  JSON.stringify({ ...OPENAPI_HEAD, paths: 'nope' }),
  JSON.stringify({ ...OPENAPI_HEAD, servers: [{}], paths: { '/ok': { get: okOp } } }),
  JSON.stringify({ ...OPENAPI_HEAD, servers: 'x', paths: { '/ok': { get: okOp } } }),
  JSON.stringify({ ...OPENAPI_HEAD, tags: [null, {}], paths: { '/ok': { get: okOp } } }),
  JSON.stringify({
    ...OPENAPI_HEAD,
    paths: { '/ok': { get: { parameters: [null, {}, { name: 5 }], responses: {} } } },
  }),
  JSON.stringify({
    ...OPENAPI_HEAD,
    paths: { '/ok': { get: { parameters: [{ $ref: '#/components/parameters/none' }] } } },
  }),
  JSON.stringify({
    ...OPENAPI_HEAD,
    paths: { '/ok': { get: { requestBody: 5, tags: 'x', security: [null], responses: 5 } } },
  }),
]

const FORMATS: Format[] = [
  {
    name: 'OpenAPI',
    channel: 'import:openApi',
    cards: ['openapi'],
    yaml: true,
    valid: () => fixture('openapi-3.0.json'),
    yamlHead: 'openapi: 3.0.3\ninfo: {title: T, version: "1"}\npaths: {}\n',
    deep: (d) =>
      `{"openapi":"3.0.3","info":{"title":"T","version":"1"},"paths":{"/a":{"get":{"responses":${d}}}}}`,
    brokenInside: openApiBroken,
    elsewhere: openApiElsewhere,
    send: (content) => harness.invoke('import:openApi', { projectId, content, format: 'openapi' }),
  },
  {
    name: 'Postman',
    // The Postman card detects an environment export too (issue #276).
    alsoAccepts: ['Postman environment'],
    channel: 'import:postman',
    cards: ['postman', 'apinizer'],
    yaml: true,
    valid: () => fixture('postman-v2.1.json'),
    yamlHead: `info: {name: X, schema: "${POSTMAN_SCHEMA}"}\nitem: []\n`,
    deep: (d) => `{"info":{"name":"X","schema":"${POSTMAN_SCHEMA}"},"item":${d}}`,
    brokenInside: () => [
      JSON.stringify({ info: { name: 'X', schema: POSTMAN_SCHEMA }, item: 5 }),
      JSON.stringify({
        info: { name: 'X', schema: POSTMAN_SCHEMA },
        item: [
          { name: 'ok', request: { method: 'GET', url: 'http://x/a' } },
          null,
          { name: 'bad', request: 5 },
          { name: 'bad2', request: { method: 5, url: 5, header: 5, body: 5, auth: 5 } },
        ],
      }),
    ],
    elsewhere: () =>
      JSON.stringify({
        info: { name: 'X', schema: POSTMAN_SCHEMA },
        item: [
          {
            name: 'r',
            request: { method: 'GET', url: `${serverUrl}/x` },
            event: [{ listen: 'test', script: { src: canaryFile } }],
          },
        ],
      }),
    send: (content) => harness.invoke('import:postman', { projectId, content }),
  },
  {
    name: 'Insomnia',
    channel: 'import:insomnia',
    cards: ['insomnia'],
    yaml: true,
    valid: () => fixture('insomnia-v5.yaml'),
    alsoAccepts: ['Insomnia v4'],
    yamlHead: 'type: collection.insomnia.rest/5.0\nname: X\ncollection: []\n',
    deep: (d) => `{"type":"collection.insomnia.rest/5.0","collection":${d}}`,
    brokenInside: () => [
      JSON.stringify({
        type: 'collection.insomnia.rest/5.0',
        collection: [
          { name: 'ok', method: 'GET', url: 'http://x/a' },
          null,
          { name: 'bad', method: 5, url: 5, headers: [null], parameters: 5, body: 5 },
        ],
      }),
      JSON.stringify({
        type: 'collection.insomnia.rest/5.0',
        collection: [{ name: 'ok', method: 'GET', url: 'http://x/a' }],
        environments: { data: 5, subEnvironments: [null, { data: [] }] },
      }),
    ],
    elsewhere: () =>
      JSON.stringify({
        type: 'collection.insomnia.rest/5.0',
        collection: [
          {
            name: 'r',
            method: 'GET',
            url: `${serverUrl}/x`,
            body: { mimeType: 'application/octet-stream', fileName: canaryFile },
          },
        ],
      }),
    send: (content) => harness.invoke('import:insomnia', { projectId, content }),
  },
  {
    name: 'Insomnia v4',
    channel: 'import:insomnia',
    yaml: true,
    valid: () => fixture('insomnia-v4.json'),
    alsoAccepts: ['Insomnia'],
    yamlHead: '__export_format: 4\nresources: []\n',
    deep: (d) => `{"__export_format":4,"resources":${d}}`,
    brokenInside: () => [
      JSON.stringify({ __export_format: 4, resources: 5 }),
      JSON.stringify({
        __export_format: 4,
        resources: [
          { _id: 'r1', _type: 'request', name: 'ok', method: 'GET', url: 'http://x/a' },
          null,
          { _id: 'r2', _type: 'request', method: 5, url: 5, headers: [null], parameters: 5 },
          { _id: 'e1', _type: 'environment', data: 5 },
        ],
      }),
    ],
    elsewhere: () =>
      JSON.stringify({
        __export_format: 4,
        resources: [
          {
            _id: 'r1',
            _type: 'request',
            url: `${serverUrl}/x`,
            body: { fileName: canaryFile },
          },
        ],
      }),
    send: (content) => harness.invoke('import:insomnia', { projectId, content }),
  },
  {
    name: 'HAR',
    channel: 'import:har',
    cards: ['har'],
    yaml: false,
    valid: () => fixture('sample.har'),
    deep: (d) => `{"log":{"version":"1.2","entries":${d}}}`,
    brokenInside: () => {
      const entry = { request: { method: 'GET', url: 'http://x/a' } }
      return [
        JSON.stringify({ log: { version: '1.2', entries: 5 } }),
        JSON.stringify({
          log: {
            version: '1.2',
            entries: [entry, { request: { method: 'GET', url: 'http://x/b', headers: [{}] } }],
          },
        }),
        JSON.stringify({
          log: {
            version: '1.2',
            entries: [
              entry,
              null,
              { request: { url: 5, method: 5 } },
              {
                request: {
                  url: 'http://x/c',
                  queryString: [null],
                  headers: [null],
                  postData: { mimeType: 5, text: 5, params: [null] },
                },
                response: 5,
              },
            ],
          },
        }),
      ]
    },
    elsewhere: () =>
      JSON.stringify({
        log: {
          version: '1.2',
          entries: [
            {
              request: {
                method: 'POST',
                url: `${serverUrl}/x`,
                postData: { mimeType: 'text/plain', text: canaryFile },
              },
            },
          ],
        },
      }),
    send: (content) => harness.invoke('import:har', { projectId, content }),
  },
  {
    name: 'cURL',
    channel: 'import:curl',
    cards: ['curl'],
    yaml: false,
    valid: () => 'curl -X POST https://api.example.com/users -d "{}"',
    brokenInside: () => ['curl', 'curl -X POST', 'curl --url', `curl "unterminated`],
    elsewhere: () => `curl ${serverUrl}/x -d @${canaryFile} -T ${canaryFile} -K ${canaryFile}`,
    send: (curlCommand) => harness.invoke('import:curl', { projectId, curlCommand }),
  },
  {
    name: 'WSDL',
    channel: 'import:wsdl',
    cards: ['wsdl'],
    yaml: false,
    valid: () => fixture('sample.wsdl'),
    deep: (d) => `<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">${d}</definitions>`,
    brokenInside: () => [
      '<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"></definitions>',
      '<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"><service/></definitions>',
      '<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"><service',
    ],
    elsewhere: () =>
      `<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
         <import namespace="urn:a" location="${canaryFile}"/>
         <import namespace="urn:b" location="${serverUrl}/x.wsdl"/>
         <types><xsd:schema>
           <xsd:import namespace="urn:c" schemaLocation="file://${canaryFile}"/>
           <xsd:include schemaLocation="${serverUrl}/x.xsd"/>
         </xsd:schema></types>
       </definitions>`,
    send: (wsdlContent) => harness.invoke('import:wsdl', { projectId, wsdlContent }),
  },
  {
    name: 'WSDL preview',
    channel: 'import:wsdl:parseFile',
    yaml: false,
    valid: () => fixture('sample.wsdl'),
    alsoAccepts: ['WSDL'],
    deep: (d) => `<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">${d}</definitions>`,
    brokenInside: () => ['<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"><service'],
    elsewhere: () =>
      `<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">
         <import namespace="urn:a" location="${canaryFile}"/>
         <import namespace="urn:b" location="${serverUrl}/x.wsdl"/>
       </definitions>`,
    send: (content) => harness.invoke('import:wsdl:parseFile', content),
  },
  {
    name: 'proto',
    channel: 'import:proto',
    cards: ['proto'],
    yaml: false,
    valid: () => fixture('echo.proto'),
    deep: (d) => `syntax = "proto3"; // ${d}\n`,
    brokenInside: () => ['syntax = "proto3"; service {', 'syntax = "proto3"; message M { int32 }'],
    elsewhere: () =>
      `syntax = "proto3";
       import "${canaryFile}";
       service S { rpc A(M) returns (M); }
       message M {}`,
    send: async (text) => {
      const protoPath = join(work, `${crypto.randomUUID()}.proto`)
      fs.writeFileSync(protoPath, text)
      return harness.invoke('import:proto', { projectId, protoPath })
    },
  },
  {
    name: 'SoapUI',
    channel: 'import:soapui',
    cards: ['soapui'],
    yaml: false,
    valid: () => fixture('soapui-project.xml'),
    deep: (d) => `<con:soapui-project name="x" xmlns:con="u">${d}</con:soapui-project>`,
    brokenInside: () => [
      '<con:soapui-project name="x" xmlns:con="u">',
      '<con:soapui-project name="x" xmlns:con="u"></con:soapui-project>',
      '<con:soapui-project><con:interface><con:operation><con:call/></con:operation></con:interface></con:soapui-project>',
    ],
    elsewhere: () =>
      `<!DOCTYPE p [<!ENTITY x SYSTEM "file://${canaryFile}">]>
       <con:soapui-project name="&x;" xmlns:con="u">
         <con:interface name="I" definition="${serverUrl}/x.wsdl">
           <con:operation name="O"><con:call name="C">
             <con:endpoint>${serverUrl}/x</con:endpoint><con:request>&x;</con:request>
           </con:call></con:operation>
         </con:interface>
       </con:soapui-project>`,
    send: (content) => harness.invoke('import:soapui', { projectId, content }),
  },
  {
    name: 'RAML',
    channel: 'import:raml',
    cards: ['raml'],
    yaml: true,
    valid: () => fixture('sample.raml'),
    yamlHead: '#%RAML 1.0\ntitle: X\n',
    deep: (d) => `{"title":"X","/a":{"get":${d}}}`,
    brokenInside: () => [
      '#%RAML 1.0\ntitle: X\n/a: 5\n/b:\n  get: 5\n',
      '#%RAML 1.0\ntitle: [\n',
      '#%RAML 1.0\ntitle: X\nbaseUri: 5\n/a:\n  get:\n    queryParameters: 5\n    headers: [1]\n    body: 5\n',
    ],
    elsewhere: () =>
      `#%RAML 1.0\ntitle: X\nbaseUri: ${serverUrl}\ntypes: !include ${canaryFile}\n/a:\n  get:\n    body: !include ${canaryFile}\n`,
    send: (content) => harness.invoke('import:raml', { projectId, content }),
  },
  {
    name: 'Project file',
    channel: 'save:importProjectFromContent',
    cards: ['native'],
    yaml: false,
    valid: () => JSON.stringify(projectFile({ folders: [{ id: 'f1', name: 'F', sort_order: 0 }] })),
    deep: (d) => JSON.stringify(projectFile({})).replace('"folders":[]', `"folders":${d}`),
    brokenInside: projectFileBroken,
    elsewhere: projectFileElsewhere,
    send: (content) => harness.invoke('save:importProjectFromContent', { workspaceId, content }),
  },
  {
    name: 'Project file (Open local)',
    channel: 'save:importLocal',
    yaml: false,
    valid: () => JSON.stringify(projectFile({ folders: [{ id: 'f1', name: 'F', sort_order: 0 }] })),
    alsoAccepts: ['Project file'],
    deep: (d) => JSON.stringify(projectFile({})).replace('"folders":[]', `"folders":${d}`),
    brokenInside: projectFileBroken,
    elsewhere: projectFileElsewhere,
    send: (text) => {
      const filePath = join(work, `${crypto.randomUUID()}.json`)
      fs.writeFileSync(filePath, text)
      return harness.invoke('save:importLocal', { filePath, projectId })
    },
  },
  {
    name: 'Folder file',
    channel: 'save:importFolder',
    yaml: false,
    valid: () =>
      JSON.stringify({
        version: '1',
        kind: 'folder',
        rootFolderId: 'f1',
        folders: [{ id: 'f1', name: 'F', sort_order: 0 }],
        endpoints: [],
        endpointCases: [],
        savedRequests: [],
      }),
    deep: (d) => `{"version":"1","kind":"folder","folder":${d}}`,
    brokenInside: () => [
      '{"version":"1","kind":"folder"}',
      '{"version":"1","kind":"folder","folder":5,"folders":5,"endpoints":5}',
      '{"version":"1","kind":"folder","folder":{"id":"f"},"folders":[null],"endpoints":[{}]}',
    ],
    elsewhere: () =>
      JSON.stringify({
        version: '1',
        kind: 'folder',
        rootFolderId: 'f1',
        folders: [{ id: 'f1', name: canaryFile, sort_order: 0 }],
        endpoints: [
          {
            id: 'e1',
            name: 'E',
            protocol: 'http',
            method: 'GET',
            path: `${serverUrl}/x`,
            status: 'developing',
          },
        ],
        endpointCases: [],
        savedRequests: [],
      }),
    send: (content) => harness.invoke('save:importFolder', { projectId, content }),
  },
  {
    name: 'Test suite file',
    channel: 'save:importTestSuite',
    yaml: true,
    valid: () =>
      JSON.stringify({
        version: '1',
        kind: 'testSuite',
        suite: { id: 's1', name: 'S' },
        items: [],
        folders: [],
      }),
    alsoAccepts: ['Postman', 'Mock Postman', 'Insomnia', 'Insomnia v4'],
    yamlHead: 'type: collection.insomnia.rest/5.0\nname: X\ncollection: []\n',
    deep: (d) =>
      `{"version":"1","kind":"testSuite","suite":{"name":"S"},"folders":[],"items":${d}}`,
    brokenInside: () => [
      '{"version":"1","kind":"testSuite"}',
      '{"version":"1","kind":"testSuite","suite":5,"items":5,"folders":5}',
      '{"version":"1","kind":"testSuite","suite":{"name":"S"},"items":[null,{}],"folders":[null]}',
    ],
    elsewhere: () =>
      JSON.stringify({
        version: '1',
        kind: 'testSuite',
        suite: { id: 's1', name: 'S' },
        folders: [],
        items: [{ id: 'i', name: 'I', protocol: 'http', method: 'GET', url: `${serverUrl}/x` }],
      }),
    send: (content) => harness.invoke('save:importTestSuite', { projectId, content }),
  },
  {
    name: 'Postman environment',
    channel: 'import:postmanEnvironment',
    yaml: false,
    valid: () => fixture('postman-env-sample.json'),
    deep: (d) => `{"name":"E","_postman_variable_scope":"environment","values":${d}}`,
    brokenInside: () => [
      '{"name":"E","_postman_variable_scope":"environment","values":5}',
      '{"name":"E","_postman_variable_scope":"environment","values":[null,{},{"key":5,"value":{}}]}',
    ],
    elsewhere: () =>
      JSON.stringify({
        name: 'E',
        _postman_variable_scope: 'environment',
        values: [{ key: 'a', value: `${serverUrl}/x`, type: 'file', src: canaryFile }],
      }),
    send: (content) => harness.invoke('import:postmanEnvironment', { projectId, content }),
  },
  {
    name: 'Insomnia environment',
    channel: 'import:insomniaEnvironment',
    yaml: true,
    valid: () => 'type: environment.insomnia.rest/5.0\nname: E\ndata:\n  a: "1"\n',
    yamlHead: 'type: environment.insomnia.rest/5.0\nname: E\ndata: {}\n',
    deep: (d) => `{"type":"environment.insomnia.rest/5.0","name":"E","data":${d}}`,
    brokenInside: () => [
      '{"type":"environment.insomnia.rest/5.0","name":5,"data":[1,null]}',
      '{"type":"environment.insomnia.rest/5.0","name":"E","data":5}',
    ],
    elsewhere: () =>
      `type: environment.insomnia.rest/5.0\nname: E\ndata:\n  a: ${serverUrl}/x\n  b: ${canaryFile}\n`,
    send: (content) => harness.invoke('import:insomniaEnvironment', { projectId, content }),
  },
  {
    name: 'Mock OpenAPI',
    channel: 'mock:import:openapi',
    yaml: true,
    valid: () => fixture('openapi-3.0.json'),
    alsoAccepts: ['OpenAPI'],
    yamlHead: 'openapi: 3.0.3\ninfo: {title: T, version: "1"}\npaths: {}\n',
    deep: (d) =>
      `{"openapi":"3.0.3","info":{"title":"T","version":"1"},"paths":{"/a":{"get":{"responses":${d}}}}}`,
    // Only the sections a mock reads; it has no use for tags or parameters.
    brokenInside: () => [
      JSON.stringify({ ...OPENAPI_HEAD, paths: { '/ok': { get: okOp }, '/bad': null } }),
      JSON.stringify({ ...OPENAPI_HEAD, paths: { '/ok': { get: okOp }, '/bad': { get: 5 } } }),
      JSON.stringify({ ...OPENAPI_HEAD, paths: 'nope' }),
      JSON.stringify({ ...OPENAPI_HEAD, servers: [{}], paths: { '/ok': { get: okOp } } }),
      JSON.stringify({ ...OPENAPI_HEAD, servers: 'x', paths: { '/ok': { get: okOp } } }),
      JSON.stringify({ paths: { '/health': { get: {} } } }),
      JSON.stringify({ openapi: '9.9.9', paths: { '/health': { get: {} } } }),
    ],
    elsewhere: openApiElsewhere,
    send: (text) => harness.invoke('mock:import:openapi', mockServerId, text),
  },
  {
    name: 'Mock Postman',
    channel: 'mock:import:postman',
    yaml: true,
    valid: () => fixture('postman-v2.1.json'),
    alsoAccepts: ['Postman'],
    yamlHead: `info: {name: X, schema: "${POSTMAN_SCHEMA}"}\nitem: []\n`,
    deep: (d) => `{"info":{"name":"X","schema":"${POSTMAN_SCHEMA}"},"item":${d}}`,
    brokenInside: () => [
      JSON.stringify({ info: { name: 'X', schema: POSTMAN_SCHEMA }, item: 5 }),
      JSON.stringify({
        info: { name: 'X', schema: POSTMAN_SCHEMA },
        item: [
          { name: 'ok', request: { method: 'GET', url: 'http://x/a' } },
          null,
          { name: 'bad', request: { method: 5, url: 5 }, response: [null, 5] },
        ],
      }),
    ],
    elsewhere: () =>
      JSON.stringify({
        info: { name: 'X', schema: POSTMAN_SCHEMA },
        item: [
          {
            name: 'r',
            request: { method: 'GET', url: `${serverUrl}/x` },
            response: [{ code: 200, body: canaryFile }],
          },
        ],
      }),
    send: (text) => harness.invoke('mock:import:postman', mockServerId, text),
  },
]

function projectFile(over: Record<string, unknown>): Record<string, unknown> {
  return {
    version: '1',
    kind: 'project',
    project: { id: crypto.randomUUID(), name: 'Imported' },
    folders: [],
    endpoints: [],
    savedRequests: [],
    environments: [],
    ...over,
  }
}

function projectFileBroken(): string[] {
  const noEnvironments = projectFile({ folders: [{ id: 'f1', name: 'F', sort_order: 0 }] })
  delete noEnvironments.environments
  return [
    JSON.stringify({ ...noEnvironments, environments: 'nope' }),
    JSON.stringify(projectFile({ folders: [null] })),
    JSON.stringify(projectFile({ folders: 5 })),
    JSON.stringify(projectFile({ endpoints: [{}] })),
    JSON.stringify(projectFile({ folders: [{ id: 'f1', name: 'F' }], endpoints: [{ id: 'e' }] })),
    JSON.stringify(projectFile({ project: 5 })),
    JSON.stringify(projectFile({ testSuites: 5, folders: [{ id: 'f1', name: 'F' }] })),
  ]
}

function projectFileElsewhere(): string {
  return JSON.stringify(
    projectFile({
      folders: [{ id: 'f1', name: 'F', sort_order: 0 }],
      certificates: [
        {
          id: 'c1',
          kind: 'client',
          created_at: 1,
          host: '127.0.0.1',
          crt_path: canaryFile,
          key_path: canaryFile,
          pfx_path: canaryFile,
          enabled: 1,
        },
      ],
    }),
  )
}

/** Handlers whose input is not file text: dialogs, URLs, one-time handles. */
const NOT_CONTENT_CHANNELS = new Set([
  'import:openFile',
  'import:fetchUrl',
  'import:pickPostmanFolder',
  'import:postmanFolder',
  'import:wsdl:parse',
  'save:importProject',
])

// ─── Bad inputs every format gets ───────────────────────────────────

const deepArray = (n: number): string => '['.repeat(n) + ']'.repeat(n)
const deepObject = (n: number): string => '{"a":'.repeat(n) + '1' + '}'.repeat(n)

/** 2^40 uses of one line once walked: small on disk, endless to expand. */
function aliasBomb(head: string): string {
  let out = `${head}a0: &a0 [x, x]\n`
  for (let i = 1; i <= 40; i++) out += `a${i}: &a${i} [*a${i - 1}, *a${i - 1}]\n`
  return out
}

const GENERIC_BAD: Array<[string, string]> = [
  ['empty', ''],
  ['whitespace', ' \n\t '],
  ['null', 'null'],
  ['a number', '42'],
  ['a JSON string', '"hello"'],
  ['an array', '[1, null]'],
  ['broken JSON', '{"a": '],
  ['broken YAML', 'a: [\n  - b: {'],
  ['an unrelated object', '{"foo":"bar"}'],
  ['unrelated YAML', 'foo: bar\n'],
  ['unrelated XML', '<?xml version="1.0"?><foo/>'],
  ['plain text', 'just some words'],
  ['binary', '\u0000\u0001\u0002PK\u0003\u0004'],
]

const TIME_LIMIT_MS = 5000

async function expectBad(
  format: Format,
  text: string,
  allow: Array<Outcome['kind']> = ['refused', 'warned'],
): Promise<Outcome> {
  const before = rowCounts()
  const started = Date.now()
  const outcome = outcomeOf(await format.send(text))
  const elapsed = Date.now() - started

  expect(elapsed, `took ${elapsed} ms`).toBeLessThan(TIME_LIMIT_MS)
  expect(
    allow,
    `outcome was "${outcome.kind}" (${outcome.message}) for: ${text.slice(0, 240)}`,
  ).toContain(outcome.kind)
  expect(outcome.message).not.toMatch(JS_ERROR)
  expect(outcome.message).not.toMatch(BARE_PARSER_ERROR)
  if (outcome.kind === 'refused') {
    expect(outcome.message.trim(), 'a refusal says why').not.toBe('')
    expect(rowCounts(), 'a refused import leaves the project unchanged').toEqual(before)
  }
  expect(dialogCalls.count, 'bad content never opens a second picker').toBe(0)
  expect(reads, 'nothing outside the input is read').toEqual([])
  expect(serverHits, 'no request leaves the machine').toBe(0)
  expect(databaseText()).not.toContain(CANARY_TEXT)
  return outcome
}

// ─── The guards ─────────────────────────────────────────────────────

describe('a failure halfway leaves the project as it was', () => {
  /** The database refuses the second row: earlier rows of the import must go too. */
  const failSecondRow = (table: string): void => {
    testDb.exec(`
      CREATE TRIGGER fail_second_row BEFORE INSERT ON ${table}
      WHEN (SELECT COUNT(*) FROM ${table}) >= 1
      BEGIN SELECT RAISE(ABORT, 'The disk is full'); END
    `)
  }

  /** Where a format's good sample holds only one request. */
  const TWO_REQUESTS: Record<string, string> = {
    WSDL: `<definitions name="S" targetNamespace="urn:s" xmlns="http://schemas.xmlsoap.org/wsdl/"
        xmlns:tns="urn:s" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">
      <message name="M"/>
      <portType name="P">
        <operation name="One"><input message="tns:M"/><output message="tns:M"/></operation>
        <operation name="Two"><input message="tns:M"/><output message="tns:M"/></operation>
      </portType>
      <binding name="B" type="tns:P">
        <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
        <operation name="One"><soap:operation soapAction="urn:one"/></operation>
        <operation name="Two"><soap:operation soapAction="urn:two"/></operation>
      </binding>
      <service name="S"><port name="Q" binding="tns:B">
        <soap:address location="http://x.example/s"/>
      </port></service>
    </definitions>`,
  }

  const ENDPOINT_FORMATS = [
    'OpenAPI',
    'Postman',
    'Insomnia',
    'Insomnia v4',
    'HAR',
    'WSDL',
    'proto',
    'SoapUI',
    'RAML',
  ]

  it.each(ENDPOINT_FORMATS)('%s', async (name) => {
    const format = FORMATS.find((f) => f.name === name)
    if (!format) throw new Error(`No row named ${name}`)
    failSecondRow('endpoints')
    const before = rowCounts()
    const outcome = outcomeOf(await format.send(TWO_REQUESTS[name] ?? format.valid()))
    expect(outcome.kind, 'the sample must hold at least two requests').toBe('refused')
    expect(rowCounts()).toEqual(before)
  })

  it.each(['Mock OpenAPI', 'Mock Postman'])('%s', async (name) => {
    const format = FORMATS.find((f) => f.name === name)
    if (!format) throw new Error(`No row named ${name}`)
    failSecondRow('mock_endpoints')
    const before = rowCounts()
    const outcome = outcomeOf(await format.send(format.valid()))
    expect(outcome.kind, 'the sample must hold at least two requests').toBe('refused')
    expect(rowCounts()).toEqual(before)
  })

  it('Project file (Open local): a row the database refuses keeps the project', async () => {
    const format = FORMATS.find((f) => f.name === 'Project file (Open local)')
    if (!format) throw new Error('No row')
    const before = rowCounts()
    const text = JSON.stringify(
      projectFile({
        folders: [{ id: 'f1', name: 'F', sort_order: 0 }],
        endpoints: [{ id: 'e' }],
      }),
    )
    const outcome = await expectBad(format, text, ['refused'])
    expect(outcome.message).toMatch(/damaged/)
    expect(rowCounts()).toEqual(before)
  })

  it('Insomnia environment: the old variables survive a failed re-import', async () => {
    const format = FORMATS.find((f) => f.name === 'Insomnia environment')
    if (!format) throw new Error('No row')
    const text = `${format.valid()}  b: "2"\n`
    expect(outcomeOf(await format.send(text)).kind).not.toBe('refused')
    const before = rowCounts()
    const values = testDb.prepare('SELECT key FROM environment_variables ORDER BY key').all()
    expect(values.length).toBeGreaterThan(1)

    testDb.exec(`
      CREATE TRIGGER fail_variable BEFORE INSERT ON environment_variables
      BEGIN SELECT RAISE(ABORT, 'The disk is full'); END
    `)
    expect(outcomeOf(await format.send(text)).kind).toBe('refused')
    expect(rowCounts()).toEqual(before)
    expect(testDb.prepare('SELECT key FROM environment_variables ORDER BY key').all()).toEqual(
      values,
    )
  })
})

describe('every importer has a row', () => {
  it('every registered import channel is in the table', () => {
    registerImportExportHandlers()
    registerSaveHandlers()
    registerMockHandlers()
    const channels = [...harness.handlers.keys()].filter((c) =>
      /^(import:|save:import|mock:import:)/.test(c),
    )
    expect(channels.length).toBeGreaterThan(10)
    const covered = new Set(FORMATS.map((f) => f.channel))
    const missing = channels.filter((c) => !covered.has(c) && !NOT_CONTENT_CHANNELS.has(c))
    expect(missing, 'add a FORMATS row for each new importer').toEqual([])
  })

  it('every Import modal card is in the table', () => {
    const source = fs.readFileSync(
      join(__dirname, '../../../src/renderer/components/modals/ImportModal.tsx'),
      'utf-8',
    )
    const block = /const IMPORT_FORMATS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(source)?.[1] ?? ''
    const cards = [...block.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1])
    expect(cards.length).toBeGreaterThan(5)
    const covered = new Set(FORMATS.flatMap((f) => f.cards ?? []))
    expect(cards.filter((c) => !covered.has(c))).toEqual([])
  })
})

describe.each(FORMATS.map((f) => [f.name, f] as const))('%s', (_name, format) => {
  it('takes a good file (the row can succeed at all)', async () => {
    const outcome = outcomeOf(await format.send(format.valid()))
    expect(outcome.kind, outcome.message).not.toBe('refused')
    const counts = rowCounts()
    const wrote = Object.entries(counts).some(
      ([t, n]) => !['workspaces', 'projects', 'settings', 'mock_servers'].includes(t) && n > 0,
    )
    if (format.channel !== 'import:wsdl:parseFile') expect(wrote).toBe(true)
  })

  it.each(GENERIC_BAD)('%s', async (_label, text) => {
    await expectBad(format, text)
  })

  it('another format’s file', async () => {
    for (const other of FORMATS) {
      if (other === format) continue
      if (other.channel === format.channel) continue
      if (format.alsoAccepts?.includes(other.name) || other.alsoAccepts?.includes(format.name)) {
        continue
      }
      await expectBad(format, other.valid())
    }
  })

  it('nested far too deep', async () => {
    if (!format.deep) return
    await expectBad(format, format.deep(deepArray(100_000)))
    await expectBad(format, format.deep(deepObject(100_000)))
  })

  it('broken inside a valid shape: refused, or warned with the good rows kept', async () => {
    for (const text of format.brokenInside()) {
      await expectBad(format, text, ['refused', 'warned'])
    }
  })

  it('content pointing elsewhere is not followed', async () => {
    await expectBad(format, format.elsewhere(), ['refused', 'warned', 'accepted'])
  })

  if (format.yaml) {
    it('YAML alias bomb is refused quickly', async () => {
      const outcome = await expectBad(format, aliasBomb(format.yamlHead ?? ''), ['refused'])
      expect(outcome.message).toMatch(/too large|aliases/i)
    })

    it('YAML recursive alias is refused', async () => {
      const outcome = await expectBad(format, `${format.yamlHead ?? ''}self: &s {self: *s}\n`, [
        'refused',
      ])
      expect(outcome.message).toMatch(/recursive|too large/i)
    })
  }
})

describe('format-shaped alias bombs reach no walker', () => {
  const folderBomb = (): string => {
    let out = `info: {name: X, schema: "${POSTMAN_SCHEMA}"}\ndefs:\n  f0: &f0 {name: r, request: {method: GET, url: "http://x/a"}}\n`
    for (let i = 1; i <= 40; i++) {
      out += `  f${i}: &f${i} {name: f${i}, item: [*f${i - 1}, *f${i - 1}]}\n`
    }
    return `${out}item: [*f40]\n`
  }
  const looping = `info: {name: X, schema: "${POSTMAN_SCHEMA}"}\nitem: &loop [{item: *loop}]\n`

  it.each(['Postman', 'Mock Postman', 'Test suite file'])('%s folder bomb', async (name) => {
    const format = FORMATS.find((f) => f.name === name)!
    await expectBad(format, folderBomb(), ['refused'])
  })

  it.each(['Postman', 'Mock Postman', 'Test suite file'])('%s looping folder', async (name) => {
    const format = FORMATS.find((f) => f.name === name)!
    await expectBad(format, looping, ['refused'])
  })

  it('an OpenAPI $ref bomb in JSON (shared schemas, doubling) stays cheap', async () => {
    const schemas: Record<string, unknown> = { s40: { type: 'string' } }
    for (let i = 0; i < 40; i++) {
      const next = { $ref: `#/components/schemas/s${i + 1}` }
      schemas[`s${i}`] = { type: 'object', properties: { a: next, b: next } }
    }
    const text = JSON.stringify({
      ...OPENAPI_HEAD,
      components: { schemas },
      paths: {
        '/a': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/s0' } } },
            },
            responses: {
              200: {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/s0' } } },
              },
            },
          },
        },
      },
    })
    for (const name of ['OpenAPI', 'Mock OpenAPI']) {
      const format = FORMATS.find((f) => f.name === name)!
      await expectBad(format, text, ['refused', 'warned', 'accepted'])
    }
  })
})
