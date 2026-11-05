/**
 * Who marks a project blocked: every importer, fed its real input from the real
 * fixtures (docs/e2e/test-rules.md rule 2), on the real migrated schema. A scripted
 * input marks the project, a script-free one does not, and a bad file leaves nothing.
 * The Clone wizard's path runs on real git.
 *
 * Each case also reads the rows the importer wrote and states that they do or do
 * not hold scripts, so a fixture that stops carrying one fails here rather than
 * quietly testing nothing.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { rawZip } from '../../fixtures/raw-zip'
import { setupHandlerHarness, makeElectronMock, makeFakeEvent } from './helpers'
import { createRealGitFixture, type RealGitFixture } from './real-git-fixture'

const harness = setupHandlerHarness()
const pick = vi.hoisted(() => ({ open: null as string | null, save: null as string | null }))
const prompts = vi.hoisted(() => ({ answer: 1, count: 0 }))

vi.mock('electron', () => ({
  ...makeElectronMock(),
  dialog: {
    showOpenDialog: async () =>
      pick.open ? { canceled: false, filePaths: [pick.open] } : { canceled: true, filePaths: [] },
    showSaveDialog: async () =>
      pick.save ? { canceled: false, filePath: pick.save } : { canceled: true },
    showMessageBox: async () => {
      prompts.count++
      return { response: prompts.answer }
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf-8').reverse(),
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8'),
  },
}))

let db: Database.Database
const realDb = await vi.importActual<typeof import('../../../src/main/db/database')>(
  '../../../src/main/db/database',
)
vi.mock('../../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/db/database')>()),
  getDb: () => db,
}))

const storeState = vi.hoisted(() => ({
  git: {} as Record<string, unknown>,
  data: {} as Record<string, unknown>,
  onSet: null as null | ((key: string, value: unknown) => void),
}))
class FakeStore {
  get(key: string): unknown {
    return key === 'git' ? storeState.git : storeState.data[key]
  }
  set(key: string, value: unknown): void {
    storeState.onSet?.(key, value)
    storeState.data[key] = value
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const trust = await import('../../../src/main/lib/project-script-trust')
const { collectProjectScripts } = await import('../../../src/main/lib/project-scripts')
const { registerSaveHandlers, exportProjectData } =
  await import('../../../src/main/ipc/save.handler')
const { registerImportExportHandlers } = await import('../../../src/main/ipc/import-export.handler')
const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')
const { registerProjectTrustHandlers } = await import('../../../src/main/ipc/project-trust.handler')
const { registerProjectHandlers } = await import('../../../src/main/ipc/project.handler')
const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')

const FIX = join(__dirname, '../../fixtures')
const text = (rel: string): string => readFileSync(join(FIX, rel), 'utf-8')
const CANARY = "pm.environment.set('script_trust_canary', 'ran')"
const KEY = trust.PROJECT_SCRIPT_BLOCKS_STORE_KEY

interface Envelope<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
const call = <T = unknown>(channel: string, ...args: unknown[]) =>
  harness.handlers.get(channel)!(makeFakeEvent(), ...args) as Promise<Envelope<T>>

let tmp = ''
let workspaceId = ''
beforeAll(() => {
  // Not the OS temp dir: on macOS it is under /var, which save:importLocal refuses.
  tmp = mkdtempSync(join(process.cwd(), 'node_modules', '.project-script-trust-'))
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function newProject(): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 'http', 0, 1, 1)`,
  ).run(id, workspaceId, `p-${id}`)
  return id
}
/** A project with a row in it: "a collection imported into an existing project". */
function existingProject(): string {
  const id = newProject()
  db.prepare(
    `INSERT INTO endpoints (id, project_id, name, protocol, method, path, created_at, updated_at)
     VALUES (?, ?, 'Existing', 'http', 'GET', '/existing', 1, 1)`,
  ).run(randomUUID(), id)
  return id
}
function scriptedSource(): string {
  const id = newProject()
  db.prepare(
    `INSERT INTO endpoints (id, project_id, name, protocol, method, path, request_schema, created_at, updated_at)
     VALUES (?, ?, 'Scripted', 'http', 'GET', '/s', ?, 1, 1)`,
  ).run(randomUUID(), id, JSON.stringify({ preScript: CANARY }))
  return id
}
const scriptsIn = (projectId: string): number =>
  collectProjectScripts(exportProjectData(projectId)).length
const blocked = (projectId: string): Promise<boolean> => trust.isProjectScriptsBlocked(projectId)
const blockList = (): string[] => (storeState.data[KEY] as string[] | undefined) ?? []

const rowsOf = (projectId: string): number =>
  (['folders', 'endpoints', 'saved_requests', 'test_suites', 'mock_servers'] as const).reduce(
    (n, table) =>
      n +
      (
        db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE project_id = ?`).get(projectId) as {
          c: number
        }
      ).c,
    0,
  )
/** What was in the DB the moment each id reached the block list on disk. */
function recordRowsAtBlock(): Map<string, number> {
  const seen = new Map<string, number>()
  storeState.onSet = (key, value) => {
    if (key !== KEY) return
    for (const id of value as string[]) if (!seen.has(id)) seen.set(id, rowsOf(id))
  }
  return seen
}

function registerAll(): void {
  registerSaveHandlers()
  registerImportExportHandlers()
  registerMockHandlers()
  registerProjectTrustHandlers()
  registerProjectHandlers()
  registerGitHandlers()
}

beforeEach(() => {
  harness.reset()
  storeState.git = {}
  storeState.data = {}
  storeState.onSet = null
  prompts.answer = 1
  prompts.count = 0
  pick.open = null
  pick.save = null
  trust.setProjectScriptTrustStoreForTests(undefined)
  db = realDb.openAndMigrate(':memory:')
  workspaceId = randomUUID()
  db.prepare(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'W', 1, 1)`).run(
    workspaceId,
  )
  registerAll()
})

afterEach(() => {
  storeState.onSet = null
})

type Run = (projectId: string) => Promise<Envelope>
const withContent = (channel: string, rel: string, extra: object = {}): Run => {
  return (projectId) => call(channel, { projectId, content: text(rel), ...extra })
}

const SCRIPTED: Array<[string, Run]> = [
  ['Postman v2.1 file', withContent('import:postman', 'import-export/oracle-postman.json')],
  ['Postman v2.1 file (baseline)', withContent('import:postman', 'postman/baseline-v21.json')],
  ['Insomnia v5', withContent('import:insomnia', 'import-export/oracle-insomnia-v5.yaml')],
  [
    'Insomnia v5 (iterations)',
    withContent('import:insomnia', 'import-export/multi-iteration-insomnia.yaml'),
  ],
]

const SCRIPT_FREE: Array<[string, Run]> = [
  [
    'OpenAPI 3',
    withContent('import:openApi', 'import-export/openapi-3.0.json', { format: 'openapi' }),
  ],
  ['Postman v2.1 with no script', withContent('import:postman', 'import-export/postman-v2.1.json')],
  ['Insomnia v5 with no script', withContent('import:insomnia', 'import-export/insomnia-v5.yaml')],
  ['Insomnia v4 with no script', withContent('import:insomnia', 'import-export/insomnia-v4.json')],
  ['HAR', withContent('import:har', 'import-export/sample.har')],
  ['RAML', withContent('import:raml', 'import-export/sample.raml')],
  ['SoapUI', withContent('import:soapui', 'import-export/soapui-project.xml')],
  [
    'cURL',
    (projectId) =>
      call('import:curl', { projectId, curlCommand: "curl https://api.example.test/x -H 'A: b'" }),
  ],
  [
    '.proto',
    (projectId) =>
      call('import:proto', {
        projectId,
        protoPath: join(FIX, 'import-export/echo.proto'),
        serverAddress: 'h:1',
      }),
  ],
  [
    'WSDL',
    async (projectId) => {
      const parsed = await call('import:wsdl:parseFile', text('import-export/sample.wsdl'))
      expect(parsed.error).toBeUndefined()
      return call('import:wsdl', { projectId, parsedWsdl: parsed.data })
    },
  ],
]

/** Handlers nest a second success flag inside `data`. */
const expectImported = (r: Envelope): void => {
  expect(r.success, r.error).toBe(true)
  const inner = r.data as { success?: boolean; error?: string } | undefined
  if (inner && inner.success === false) throw new Error(`import failed: ${inner.error}`)
}

describe('a collection imported into an existing project', () => {
  it.each(SCRIPTED)('%s: scripted input marks it', async (_name, run) => {
    const p = existingProject()
    expectImported(await run(p))
    expect(scriptsIn(p)).toBeGreaterThan(0)
    expect(await blocked(p)).toBe(true)
  })

  it.each(SCRIPT_FREE)(
    '%s: script-free input never marks it, never prompts',
    async (_name, run) => {
      const p = existingProject()
      expectImported(await run(p))
      expect(scriptsIn(p)).toBe(0)
      expect(await blocked(p)).toBe(false)
      expect((await call<{ allowed: boolean }>('projectTrust:ensure', p)).data?.allowed).toBe(true)
      expect(prompts.count).toBe(0)
    },
  )

  it('a project that already had scripts and is allowed stays allowed on a script-free import', async () => {
    const p = scriptedSource()
    expectImported(
      await withContent('import:openApi', 'import-export/openapi-3.0.json', { format: 'openapi' })(
        p,
      ),
    )
    expect(scriptsIn(p)).toBe(1)
    expect(await blocked(p)).toBe(false)
  })

  it('a blocked project stays blocked through a script-free import', async () => {
    const p = existingProject()
    await trust.blockProjectScripts(p)
    expectImported(await withContent('import:har', 'import-export/sample.har')(p))
    expect(await blocked(p)).toBe(true)
  })

  it('it is on the block list before the first row lands, not after', async () => {
    const p = existingProject()
    const before = rowsOf(p)
    const seen = recordRowsAtBlock()
    expectImported(await withContent('import:postman', 'import-export/oracle-postman.json')(p))
    expect(seen.get(p)).toBe(before)
    expect(rowsOf(p)).toBeGreaterThan(before)
  })

  it('after Allow, a second import with new scripts asks again', async () => {
    const p = existingProject()
    expectImported(await withContent('import:postman', 'import-export/oracle-postman.json')(p))
    prompts.answer = 0
    await call('projectTrust:ensure', p)
    expect(await blocked(p)).toBe(false)
    expectImported(await withContent('import:insomnia', 'import-export/oracle-insomnia-v5.yaml')(p))
    expect(await blocked(p)).toBe(true)
  })
})

describe('Postman v3 folder and zip', () => {
  const pickFolder = async (folder: string): Promise<string> => {
    pick.open = folder
    const r = await call<{ handle: string }>('import:pickPostmanFolder')
    expect(r.success, r.error).toBe(true)
    return r.data!.handle
  }
  const openZip = async (buf: Buffer): Promise<string> => {
    const file = join(tmp, `${randomUUID()}.zip`)
    writeFileSync(file, buf)
    pick.open = file
    const r = await call<{ archive: { handle: string } }>('import:openFile', { format: 'postman' })
    expect(r.success, r.error).toBe(true)
    return r.data!.archive.handle
  }

  it('a v3 folder with scripts marks the project', async () => {
    const p = existingProject()
    const handle = await pickFolder(join(FIX, 'postman/v3/workspace'))
    expectImported(await call('import:postmanFolder', { projectId: p, handle, folderId: null }))
    expect(scriptsIn(p)).toBeGreaterThan(0)
    expect(await blocked(p)).toBe(true)
  })

  it('a v3 folder with no script does not', async () => {
    const p = existingProject()
    const handle = await pickFolder(join(FIX, 'postman/v3/collection-only'))
    expectImported(await call('import:postmanFolder', { projectId: p, handle, folderId: null }))
    expect(scriptsIn(p)).toBe(0)
    expect(await blocked(p)).toBe(false)
  })

  it('a zip with a scripted collection marks the project', async () => {
    const p = existingProject()
    const handle = await openZip(
      rawZip([
        { name: 'collection/c.json', data: Buffer.from(text('import-export/oracle-postman.json')) },
      ]),
    )
    expectImported(await call('import:postmanFolder', { projectId: p, handle, folderId: null }))
    expect(scriptsIn(p)).toBeGreaterThan(0)
    expect(await blocked(p)).toBe(true)
  })

  it('a zip with a script-free collection does not', async () => {
    const p = existingProject()
    const handle = await openZip(
      rawZip([
        { name: 'collection/c.json', data: Buffer.from(text('import-export/postman-v2.1.json')) },
      ]),
    )
    expectImported(await call('import:postmanFolder', { projectId: p, handle, folderId: null }))
    expect(scriptsIn(p)).toBe(0)
    expect(await blocked(p)).toBe(false)
  })
})

describe('a project file', () => {
  const fileOf = (projectId: string): string => JSON.stringify(exportProjectData(projectId))
  /** The file is from elsewhere: its source project is not on this machine. */
  const foreignFile = (): string => {
    const source = scriptedSource()
    const content = fileOf(source)
    db.prepare('DELETE FROM projects WHERE id = ?').run(source)
    return content
  }
  const newest = (): string =>
    (db.prepare('SELECT id FROM projects ORDER BY rowid DESC LIMIT 1').get() as { id: string }).id

  it('save:importProjectFromContent: blocked before its rows are written', async () => {
    const seen = recordRowsAtBlock()
    const r = await call('save:importProjectFromContent', { workspaceId, content: foreignFile() })
    expect(r.success, r.error).toBe(true)
    const p = newest()
    expect(scriptsIn(p)).toBe(1)
    expect(await blocked(p)).toBe(true)
    expect(seen.get(p)).toBe(0)
  })

  it('save:importProject (the file picker): blocked', async () => {
    const file = join(tmp, `${randomUUID()}.json`)
    writeFileSync(file, foreignFile())
    pick.open = file
    const r = await call('save:importProject', { workspaceId })
    expect(r.success, r.error).toBe(true)
    expect(await blocked(newest())).toBe(true)
  })

  it('save:importLocal into an existing project: blocked before its rows are written', async () => {
    const file = join(tmp, `${randomUUID()}.json`)
    writeFileSync(file, foreignFile())
    const p = newProject()
    const seen = recordRowsAtBlock()
    const r = await call('save:importLocal', { filePath: file, projectId: p })
    expect(r.success, r.error).toBe(true)
    expect(seen.get(p)).toBe(0)
    expect(await blocked(p)).toBe(true)
  })

  it('a script-free project file is marked but never asks', async () => {
    const source = newProject()
    db.prepare(
      `INSERT INTO endpoints (id, project_id, name, protocol, method, path, created_at, updated_at)
       VALUES (?, ?, 'Plain', 'http', 'GET', '/p', 1, 1)`,
    ).run(randomUUID(), source)
    const content = fileOf(source)
    db.prepare('DELETE FROM projects WHERE id = ?').run(source)
    await call('save:importProjectFromContent', { workspaceId, content })
    const r = await call<{ allowed: boolean }>('projectTrust:ensure', newest())
    expect(r.data?.allowed).toBe(true)
    expect(prompts.count).toBe(0)
  })
})

describe('a folder or test suite file', () => {
  /** The real export of one folder, through the real channel and a stubbed save picker. */
  async function exportedFolder(script: string | null): Promise<string> {
    const source = newProject()
    const folder = randomUUID()
    db.prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order, pre_script) VALUES (?, ?, NULL, 'F', 0, ?)`,
    ).run(folder, source, script)
    pick.save = join(tmp, `${randomUUID()}.json`)
    const r = await call('save:exportFolder', folder)
    expect(r.success, r.error).toBe(true)
    return readFileSync(pick.save, 'utf-8')
  }
  async function exportedSuite(script: string | null): Promise<string> {
    const source = newProject()
    const suite = randomUUID()
    db.prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, run_config, created_at, updated_at)
       VALUES (?, ?, 'S', 0, ?, 1, 1)`,
    ).run(suite, source, script ? JSON.stringify({ runPreScript: script }) : null)
    db.prepare(
      `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, pre_script, created_at)
       VALUES (?, ?, NULL, 'SF', 0, ?, 1)`,
    ).run(randomUUID(), suite, script)
    pick.save = join(tmp, `${randomUUID()}.json`)
    const r = await call('save:exportTestSuite', suite, 'testnizer')
    expect(r.success, r.error).toBe(true)
    return readFileSync(pick.save, 'utf-8')
  }

  it('a folder with a script marks; without, it does not', async () => {
    const withScript = existingProject()
    const scripted = await exportedFolder(CANARY)
    expectImported(await call('save:importFolder', { projectId: withScript, content: scripted }))
    expect(scriptsIn(withScript)).toBeGreaterThan(0)
    expect(await blocked(withScript)).toBe(true)

    const plain = existingProject()
    expectImported(
      await call('save:importFolder', { projectId: plain, content: await exportedFolder(null) }),
    )
    expect(await blocked(plain)).toBe(false)
  })

  it('a test suite with a script marks; without, it does not', async () => {
    const withScript = existingProject()
    const scripted = await exportedSuite(CANARY)
    expectImported(await call('save:importTestSuite', { projectId: withScript, content: scripted }))
    expect(scriptsIn(withScript)).toBeGreaterThan(0)
    expect(await blocked(withScript)).toBe(true)

    const plain = existingProject()
    expectImported(
      await call('save:importTestSuite', { projectId: plain, content: await exportedSuite(null) }),
    )
    expect(await blocked(plain)).toBe(false)
  })
})

describe('mock imports', () => {
  const server = (projectId: string): string => {
    const id = randomUUID()
    db.prepare(
      `INSERT INTO mock_servers (id, project_id, name, port, created_at, updated_at) VALUES (?, ?, 'M', 18765, 1, 1)`,
    ).run(id, projectId)
    return id
  }

  it.each([
    ['mock:import:openapi', 'import-export/openapi-3.0.json'],
    ['mock:import:postman', 'import-export/postman-v2.1.json'],
    // The mock importer takes a scripted collection's responses, not its scripts.
    ['mock:import:postman', 'import-export/oracle-postman.json'],
  ])('%s %s: rows with no script do not mark', async (channel, rel) => {
    const p = existingProject()
    const r = await call(channel, server(p), text(rel))
    expect(r.success, r.error).toBe(true)
    expect(scriptsIn(p)).toBe(0)
    expect(await blocked(p)).toBe(false)
  })
})

describe('a bad file leaves no trace', () => {
  const BAD: Array<[string, string]> = [
    ['broken', '{"info": '],
    ['empty', ''],
    ['the wrong format', '<html><body>not a collection</body></html>'],
  ]

  it.each(BAD)('%s: into an existing project', async (_name, content) => {
    for (const channel of [
      'import:postman',
      'import:insomnia',
      'import:har',
      'import:raml',
      'import:soapui',
    ]) {
      const p = existingProject()
      const r = await call<{ success?: boolean }>(channel, { projectId: p, content })
      expect(r.success === false || r.data?.success === false, channel).toBe(true)
      expect(await blocked(p), channel).toBe(false)
    }
  })

  it.each(BAD)('%s: as a new project, no id is left on the list', async (_name, content) => {
    const before = db.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }
    const r = await call('save:importProjectFromContent', { workspaceId, content })
    expect(r.success).toBe(false)
    expect(blockList()).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS c FROM projects').get()).toEqual(before)
  })

  it('a project file that fails while its rows go in drops the id it took', async () => {
    const source = scriptedSource()
    const data = exportProjectData(source) as { endpoints: Array<Record<string, unknown>> }
    db.prepare('DELETE FROM projects WHERE id = ?').run(source)
    data.endpoints[0].name = null // NOT NULL fails once the rows start going in
    const r = await call('save:importProjectFromContent', {
      workspaceId,
      content: JSON.stringify(data),
    })
    expect(r.success).toBe(false)
    expect(blockList()).toEqual([])
  })

  it('an oversized file is refused before it can mark anything', async () => {
    const p = existingProject()
    const huge = `{"info":{},"item":[],"pad":"${'x'.repeat(120 * 1024 * 1024)}"}`
    const r = await call<{ success?: boolean }>('import:postman', { projectId: p, content: huge })
    expect(r.success === false || r.data?.success === false).toBe(true)
    expect(await blocked(p)).toBe(false)
  })

  it('save:importLocal with a broken file does not mark the project', async () => {
    const file = join(tmp, `${randomUUID()}.json`)
    writeFileSync(file, '{"nope": ')
    const p = newProject()
    const r = await call('save:importLocal', { filePath: file, projectId: p })
    expect(r.success).toBe(false)
    expect(r.error).not.toMatch(/Invalid path/) // refused for the file, not the location
    expect(await blocked(p)).toBe(false)
  })
})

describe('the same import twice', () => {
  it('a re-import that changes nothing does not mark an allowed project again', async () => {
    const p = existingProject()
    expectImported(await withContent('import:soapui', 'import-export/soapui-project.xml')(p))
    expectImported(await withContent('import:soapui', 'import-export/soapui-project.xml')(p))
    expect(await blocked(p)).toBe(false)
  })
})

describe('Clone from Git (real git)', () => {
  let root = ''
  let fx: RealGitFixture
  const setDb = (next: Database.Database): void => {
    db = next
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'testnizer-trust-git-'))
    fx = createRealGitFixture({
      root,
      harness,
      setDb,
      gitStore: storeState.git,
      createDb: () => realDb.openAndMigrate(':memory:'),
    })
    fx.newRemote()
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const addScript = (m: { db: Database.Database }, endpointId: string): void => {
    m.db
      .prepare('UPDATE endpoints SET request_schema = ? WHERE id = ?')
      .run(JSON.stringify({ preScript: CANARY }), endpointId)
  }

  it("the wizard's first pull marks the new project before any row is written", async () => {
    const a = fx.on(fx.machine('a'))
    addScript(a, fx.addEndpoint(a, 'One'))
    await fx.push(a)

    const b = fx.on(fx.machine('b'))
    const seen = recordRowsAtBlock()
    await fx.pull(b)

    expect(fx.names(b)).toEqual(['One'])
    expect(seen.get(b.projectId)).toBe(0)
    expect(await blocked(b.projectId)).toBe(true)
    expect(
      (await call<{ allowed: boolean }>('projectTrust:ensure', b.projectId)).data?.allowed,
    ).toBe(false)
    expect(prompts.count).toBe(1)
  })

  it('a script-free clone is marked but never asks', async () => {
    const a = fx.on(fx.machine('a'))
    fx.addEndpoint(a, 'Plain')
    await fx.push(a)

    const b = fx.on(fx.machine('b'))
    await fx.pull(b)
    expect(await blocked(b.projectId)).toBe(true)
    expect(
      (await call<{ allowed: boolean }>('projectTrust:ensure', b.projectId)).data?.allowed,
    ).toBe(true)
    expect(prompts.count).toBe(0)
  })

  it('once allowed, a later pull, switch and merge do not change the state (the stated limit)', async () => {
    const a = fx.on(fx.machine('a'))
    addScript(a, fx.addEndpoint(a, 'One'))
    await fx.push(a)
    const b = fx.on(fx.machine('b'))
    await fx.pull(b)
    prompts.answer = 0
    await call('projectTrust:ensure', b.projectId)
    expect(await blocked(b.projectId)).toBe(false)

    // A new script arrives by pull.
    fx.on(a)
    addScript(a, fx.addEndpoint(a, 'Two'))
    await fx.push(a)
    fx.on(b)
    await fx.pull(b)
    expect(fx.names(b)).toEqual(['One', 'Two'])
    expect(await blocked(b.projectId)).toBe(false)

    // A branch with its own script arrives by switch, then merge.
    fx.on(a)
    await fx.createBranch(a, 'feature', 'main')
    await fx.switchTo(a, 'feature')
    addScript(a, fx.addEndpoint(a, 'Three'))
    await fx.push(a)
    fx.on(b)
    await fx.pull(b)
    await fx.switchTo(b, 'feature')
    await fx.switchTo(b, 'main')
    await fx.merge(b, 'feature')
    expect(fx.names(b)).toEqual(['One', 'Three', 'Two'])
    expect(await blocked(b.projectId)).toBe(false)
  })

  it('a blocked project stays blocked through later pulls', async () => {
    const a = fx.on(fx.machine('a'))
    addScript(a, fx.addEndpoint(a, 'One'))
    await fx.push(a)
    const b = fx.on(fx.machine('b'))
    await fx.pull(b)
    await fx.pull(b)
    expect(await blocked(b.projectId)).toBe(true)
  })

  it('a pull into a project that has its own rows does not mark it', async () => {
    const a = fx.on(fx.machine('a'))
    addScript(a, fx.addEndpoint(a, 'One'))
    await fx.push(a)
    const b = fx.on(fx.machine('b'))
    fx.addEndpoint(b, 'Local')
    await fx.pull(b)
    expect(await blocked(b.projectId)).toBe(false)
  })
})

describe('no import channel is left unclassified', () => {
  const WRAPPED = [
    'import:openApi',
    'import:postman',
    'import:postmanFolder',
    'import:har',
    'import:insomnia',
    'import:curl',
    'import:proto',
    'import:wsdl',
    'import:soapui',
    'import:raml',
    'save:importFolder',
    'save:importTestSuite',
    'mock:import:openapi',
    'mock:import:postman',
  ]
  const MARKS_ALWAYS = ['save:importProject', 'save:importProjectFromContent', 'save:importLocal']
  const WRITES_NO_SCRIPT: Record<string, string> = {
    'import:fetchUrl': 'reads a URL into text; writes no row',
    'import:openFile': 'reads a file; writes no row',
    'import:pickPostmanFolder': 'reads a folder; writes no row',
    'import:wsdl:parse': 'parses; writes no row',
    'import:wsdl:parseFile': 'parses; writes no row',
    'import:postmanEnvironment': 'variables only',
    'import:insomniaEnvironment': 'variables only',
  }

  it('a new import channel fails here until someone decides', () => {
    const channels = [...harness.handlers.keys()].filter((c) =>
      /^(import:|save:import|mock:import)/.test(c),
    )
    const known = new Set([...WRAPPED, ...MARKS_ALWAYS, ...Object.keys(WRITES_NO_SCRIPT)])
    expect(channels.filter((c) => !known.has(c))).toEqual([])
    expect([...known].filter((c) => !channels.includes(c))).toEqual([])
  })

  it('each of the wrapped channels calls the wrapper in its source', () => {
    const sources = ['save.handler.ts', 'import-export.handler.ts', 'mock.handler.ts'].map((f) =>
      readFileSync(join(__dirname, '../../../src/main/ipc', f), 'utf-8'),
    )
    for (const channel of WRAPPED) {
      const source = sources.find((s) => s.includes(`'${channel}'`))
      expect(source, channel).toBeDefined()
      const from = source!.indexOf(`'${channel}'`)
      const next = source!.indexOf('ipcMain.handle', from)
      const body = source!.slice(from, next === -1 ? undefined : next)
      expect(body, channel).toMatch(/with(Project|Mock)ImportCheck\(/)
    }
  })
})
