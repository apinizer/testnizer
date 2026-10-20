/**
 * "I push on my machine, my teammate pulls, everything works" — the git
 * fidelity guarantee, proven column by column.
 *
 * Machine A fills EVERY exported table with a non-default value in EVERY
 * column (checked from `PRAGMA table_info`, so a column added later fails
 * here until it is seeded — and then fails again if the importer drops it),
 * plus the project-level settings (auth, scripts, timeout…). A pushes;
 * machine B receives it two ways — a fresh project whose first Pull clones
 * the repo (the Clone-from-Git path) and an existing checkout that pulls a
 * second push — and every row must arrive identical, except the fields
 * documented as local by design (`LOCAL_BY_DESIGN` below).
 *
 * Both machines run the REAL production schema (`openAndMigrate(':memory:')`),
 * not the hand-kept `createTestDb` mirror, so a migration the mirror forgot
 * cannot hide a dropped column.
 *
 * A second assertion keeps the export list honest: every table with a
 * `project_id` (or reachable from one) is either exported or listed as
 * local by design.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import { createRealGitFixture, type RealGitFixture, type Machine } from './real-git-fixture'

const harness = setupHandlerHarness()

vi.mock('electron', () => {
  const base = makeElectronMock()
  return {
    ...base,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s, 'utf-8').reverse(),
      decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8'),
    },
  }
})

let currentDb: Database.Database
const realDb = await vi.importActual<typeof import('../../../src/main/db/database')>(
  '../../../src/main/db/database',
)
vi.mock('../../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/db/database')>()),
  getDb: () => currentDb,
}))

// One in-memory electron-store per test, shared by every `new Store()`
// (git config, project settings) — like the real single settings file.
const storeState = vi.hoisted(() => ({ data: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return storeState.data[key]
  }
  set(key: string | Record<string, unknown>, value?: unknown): void {
    if (typeof key === 'string') storeState.data[key] = value
    else Object.assign(storeState.data, key)
  }
  has(key: string): boolean {
    return key in storeState.data
  }
  delete(key: string): void {
    delete storeState.data[key]
  }
  get store(): Record<string, unknown> {
    return storeState.data
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')
const { registerSettingsHandlers } = await import('../../../src/main/ipc/settings.handler')
const { EXPORTED_TABLES, LOCAL_ONLY_TABLES } = await import('../../../src/main/lib/project-tables')
const projectSettings = await import('../../../src/main/lib/project-settings')

let root: string
let fx: RealGitFixture

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'testnizer-git-fidelity-'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  harness.reset()
  storeState.data = { git: {} }
  fx = createRealGitFixture({
    root,
    harness,
    setDb: (db) => {
      currentDb = db
    },
    gitStore: storeState.data.git as Record<string, unknown>,
    createDb: () => realDb.openAndMigrate(':memory:'),
  })
  fx.newRemote()
  registerGitHandlers()
  registerSettingsHandlers()
})

type Row = Record<string, unknown>
interface Column {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

const columnsOf = (db: Database.Database, table: string): Column[] =>
  db.prepare(`PRAGMA table_info(${table})`).all() as Column[]

/** SQLite's DEFAULT text → the JS value a row would hold. */
function defaultOf(c: Column): unknown {
  if (c.dflt_value === null) return null
  const d = c.dflt_value
  if (/^-?\d+(\.\d+)?$/.test(d)) return Number(d)
  return d.replace(/^'(.*)'$/s, '$1').replace(/''/g, "'")
}

/** A value that is valid for the column and differs from its default. */
function seedValue(table: string, c: Column): unknown {
  const def = defaultOf(c)
  if (/INT/i.test(c.type)) {
    if (/_at$/.test(c.name)) return 1_700_000_000_000 + c.name.length
    if (def === 0) return 1
    if (def === 1) return 0
    return 7
  }
  return JSON.stringify({ seed: `${table}.${c.name}` })
}

/**
 * Explicit values: references between the seeded rows, enum-like columns
 * whose value the importer branches on, and values that must stay valid.
 */
interface Ids {
  workspace: string
  project: string
  folderRoot: string
  folderChild: string
  endpoint: string
  savedRequest: string
  env: string
  suite: string
  suiteFolderRoot: string
  suiteFolderChild: string
  mockServer: string
  mockEndpoint: string
}

function overrides(ids: Ids, table: string): Row[] {
  const p = { project_id: ids.project }
  switch (table) {
    case 'folders':
      return [
        { ...p, id: ids.folderRoot, parent_id: null, name: 'Billing' },
        { ...p, id: ids.folderChild, parent_id: ids.folderRoot, name: 'Invoices' },
      ]
    case 'endpoints':
      return [
        { ...p, id: ids.endpoint, folder_id: ids.folderChild, protocol: 'graphql', method: 'POST' },
      ]
    case 'endpoint_cases':
      return [{ id: randomUUID(), endpoint_id: ids.endpoint }]
    case 'saved_requests':
      return [
        {
          ...p,
          id: ids.savedRequest,
          folder_id: ids.folderChild,
          endpoint_id: ids.endpoint,
          protocol: 'graphql',
          method: 'POST',
        },
      ]
    case 'saved_responses':
      return [
        {
          ...p,
          id: randomUUID(),
          owner_type: 'endpoint',
          owner_id: ids.endpoint,
          protocol: 'graphql',
          method: 'POST',
        },
      ]
    case 'environments':
      return [{ ...p, id: ids.env, workspace_id: ids.workspace, name: 'Staging' }]
    case 'environment_variables':
      // secret = 0 here: secret values are covered by the #177 suites.
      return [{ id: randomUUID(), environment_id: ids.env, key: 'host', secret: 0 }]
    case 'global_variables':
      return [{ ...p, id: randomUUID(), workspace_id: ids.workspace, key: 'tenant', secret: 0 }]
    case 'test_suites':
      return [{ ...p, id: ids.suite, name: 'Smoke' }]
    case 'test_suite_folders':
      return [
        { id: ids.suiteFolderRoot, suite_id: ids.suite, parent_id: null, name: 'Module A' },
        {
          id: ids.suiteFolderChild,
          suite_id: ids.suite,
          parent_id: ids.suiteFolderRoot,
          name: 'Setup',
        },
      ]
    case 'test_suite_items':
      return [
        {
          id: randomUUID(),
          suite_id: ids.suite,
          folder_id: ids.suiteFolderChild,
          source_endpoint_id: ids.endpoint,
          protocol: 'graphql',
          method: 'POST',
        },
      ]
    case 'mock_servers':
      return [
        // Auth / failure / rate limit hold valid JSON the server can load;
        // the auth carries no secret (secrets: issue #177 suites).
        {
          ...p,
          id: ids.mockServer,
          port: 18_731,
          auto_start: 1,
          auth_config: '{"type":"apiKey","header":"X-Env","value":""}',
          failure_config:
            '{"enabled":true,"probability":0.1,"mode":"status","status":503,"timeoutMs":1000}',
          rate_limit_config: '{"enabled":true,"requestsPerWindow":5,"windowMs":1000,"scope":"ip"}',
        },
      ]
    case 'mock_endpoints':
      return [
        {
          id: ids.mockEndpoint,
          server_id: ids.mockServer,
          method: 'POST',
          path: '/pay',
          auth_override: '',
        },
      ]
    case 'mock_responses':
      return [{ id: randomUUID(), endpoint_id: ids.mockEndpoint }]
    case 'mock_mcp_servers':
      return [
        {
          ...p,
          id: randomUUID(),
          port: 18_732,
          auth_mode: 'bearer',
          bearer_token: 'mcp-literal-token',
        },
      ]
    case 'certificates':
      // A cert whose files exist on no machine arrives disabled (issue #186).
      return [
        { ...p, id: randomUUID(), source: 'keystore', passphrase: '', keystore_key_password: '' },
      ]
    default:
      return [{ ...p, id: randomUUID() }]
  }
}

/**
 * Fields that do NOT travel, by design — each with its reason. Everything
 * else must arrive byte-identical.
 */
const LOCAL_BY_DESIGN: Record<string, Record<string, string>> = {
  '*': {
    project_id: 'rebound to the importing project (importProjectData)',
    workspace_id: 'rebound to the importing workspace',
    branch_id:
      "tags a row with a LOCAL `branches` row (issue #8); import clears it, or the row would be hidden on the teammate's machine",
  },
  certificates: {
    enabled: 'a cert whose files are missing here arrives disabled (issue #186)',
  },
  mock_mcp_servers: {
    bearer_token: 'a secret: blanked in every file, kept per machine (issue #177)',
  },
}

/**
 * Columns deliberately seeded at their default here because a non-default
 * value changes what travels; each is covered by its own suite.
 */
const SEEDED_AT_DEFAULT: Record<string, string> = {
  'environment_variables.secret': 'secret values: project-local-secrets.test.ts (issue #177)',
  'global_variables.secret': 'secret values: project-local-secrets.test.ts (issue #177)',
  'mock_endpoints.auth_override': 'mock auth secrets: project-local-secrets.test.ts (issue #177)',
}

function seedAll(m: Machine): Ids {
  const ws = (
    m.db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(m.projectId) as {
      workspace_id: string
    }
  ).workspace_id
  const ids: Ids = {
    workspace: ws,
    project: m.projectId,
    folderRoot: randomUUID(),
    folderChild: randomUUID(),
    endpoint: randomUUID(),
    savedRequest: randomUUID(),
    env: randomUUID(),
    suite: randomUUID(),
    suiteFolderRoot: randomUUID(),
    suiteFolderChild: randomUUID(),
    mockServer: randomUUID(),
    mockEndpoint: randomUUID(),
  }
  for (const table of EXPORTED_TABLES) {
    const cols = columnsOf(m.db, table)
    for (const over of overrides(ids, table)) {
      const row: Row = {}
      for (const c of cols) row[c.name] = c.name in over ? over[c.name] : seedValue(table, c)
      const names = Object.keys(row)
      m.db
        .prepare(
          `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        )
        .run(...names.map((n) => row[n]))
    }
  }
  return ids
}

/** Every column of every exported table holds a non-default value in some row. */
function expectFullySeeded(m: Machine): void {
  const missing: string[] = []
  for (const table of EXPORTED_TABLES) {
    const rows = rowsOf(m, table)
    for (const c of columnsOf(m.db, table)) {
      if (c.pk) continue
      const def = defaultOf(c)
      if (`${table}.${c.name}` in SEEDED_AT_DEFAULT) continue
      if (!rows.some((r) => r[c.name] !== null && r[c.name] !== def))
        missing.push(`${table}.${c.name}`)
    }
  }
  expect(missing, 'columns with no non-default seed value').toEqual([])
}

function rowsOf(m: Machine, table: string): Row[] {
  const cols = columnsOf(m.db, table).map((c) => c.name)
  const scope = cols.includes('project_id')
    ? 'WHERE project_id = ?'
    : table === 'environment_variables'
      ? 'WHERE environment_id IN (SELECT id FROM environments WHERE project_id = ?)'
      : table === 'endpoint_cases'
        ? 'WHERE endpoint_id IN (SELECT id FROM endpoints WHERE project_id = ?)'
        : table === 'test_suite_folders' || table === 'test_suite_items'
          ? 'WHERE suite_id IN (SELECT id FROM test_suites WHERE project_id = ?)'
          : table === 'mock_endpoints'
            ? 'WHERE server_id IN (SELECT id FROM mock_servers WHERE project_id = ?)'
            : table === 'mock_responses'
              ? 'WHERE endpoint_id IN (SELECT me.id FROM mock_endpoints me JOIN mock_servers ms ON ms.id = me.server_id WHERE ms.project_id = ?)'
              : null
  if (!scope) throw new Error(`no project scope for ${table}`)
  return m.db.prepare(`SELECT * FROM ${table} ${scope} ORDER BY id`).all(m.projectId) as Row[]
}

function comparable(table: string, row: Row): Row {
  const skip = { ...LOCAL_BY_DESIGN['*'], ...(LOCAL_BY_DESIGN[table] ?? {}) }
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) if (!(k in skip)) out[k] = v
  return out
}

function expectSameProject(a: Machine, b: Machine): void {
  for (const table of EXPORTED_TABLES) {
    expect(
      rowsOf(b, table).map((r) => comparable(table, r)),
      table,
    ).toEqual(rowsOf(a, table).map((r) => comparable(table, r)))
  }
  expect(rowsOf(b, 'certificates')[0].enabled).toBe(0)
  expect(rowsOf(b, 'mock_mcp_servers')[0].bearer_token).toBe('')
}

const SETTINGS = {
  auth: { type: 'bearer', bearerToken: '{{apiToken}}' },
  preScript: 'pm.environment.set("ts", Date.now())',
  testScript: 'pm.test("2xx", () => pm.response.to.be.success)',
  requestTimeout: 4321,
  sslVerification: false,
  followRedirects: false,
  tls: { minVersion: 'TLSv1.2', cipherPreset: 'legacy' },
}

const settingsOf = async (m: Machine): Promise<Record<string, unknown>> =>
  (await fx.ok('settings:get', `project.${fx.on(m).projectId}.settings`)) as Record<string, unknown>

describe('git push → teammate pull: everything arrives (fidelity guarantee)', () => {
  it('the export list covers every project-scoped table, or names it local by design', () => {
    const db = realDb.openAndMigrate(':memory:')
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name)
    const unclassified = tables.filter(
      (t) =>
        !EXPORTED_TABLES.includes(t) &&
        !LOCAL_ONLY_TABLES.includes(t) &&
        !['workspaces', 'projects'].includes(t),
    )
    expect(unclassified).toEqual([])
    db.close()
  })

  it('a fresh clone (Clone from Git) and a pull into an existing project get every row and setting', async () => {
    const A = fx.machine('A')
    seedAll(A)
    expectFullySeeded(A)
    await fx.ok('settings:set', `project.${fx.on(A).projectId}.settings`, {
      ...SETTINGS,
      // Machine-local: never travels.
      proxy: { mode: 'custom', host: 'proxy.a.local', port: 3128 },
      workingDirectory: '/Users/a/work',
    })
    await fx.push(A)

    // B: a brand-new local project whose first Pull clones the repo.
    const B = fx.machine('B')
    await fx.ok('settings:set', `project.${fx.on(B).projectId}.settings`, {
      proxy: { mode: 'none' },
      workingDirectory: '/home/b',
    })
    expect(await fx.pull(B)).toMatchObject({ imported: true })
    expectSameProject(A, B)
    const bSettings = await settingsOf(B)
    expect(bSettings).toMatchObject(SETTINGS)
    // B keeps its own machine-local settings.
    expect(bSettings).toMatchObject({ proxy: { mode: 'none' }, workingDirectory: '/home/b' })

    // A edits more; B (now an existing checkout) pulls again.
    A.db.prepare("UPDATE endpoints SET name = 'Invoices v2' WHERE project_id = ?").run(A.projectId)
    await fx.ok('settings:set', `project.${fx.on(A).projectId}.settings`, {
      ...SETTINGS,
      requestTimeout: 9999,
    })
    await fx.push(A)
    await fx.pull(B)
    expectSameProject(A, B)
    expect(await settingsOf(B)).toMatchObject({ requestTimeout: 9999 })
  }, 60_000)
})

describe('project settings: one owner, secrets stay local (git fidelity)', () => {
  it('a literal project credential is blanked in the file and kept on each machine; {{vars}} travel', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Base')
    await fx.ok('settings:set', `project.${fx.on(A).projectId}.settings`, {
      auth: { type: 'bearer', bearerToken: 'sk-live-literal' },
      preScript: 'pre()',
    })
    await fx.push(A)
    const file = JSON.parse(
      fx.git(root, '--git-dir', fx.remote, 'show', 'main:Shared-APIs.json'),
    ) as { project: { shared_settings: string } }
    expect(file.project.shared_settings).not.toContain('sk-live-literal')
    expect(JSON.parse(file.project.shared_settings)).toMatchObject({
      auth: { type: 'bearer', bearerToken: '' },
      preScript: 'pre()',
    })

    const B = fx.machine('B')
    // The pull says what is still empty here, instead of a silent 401 later.
    expect(await fx.pull(B)).toMatchObject({ imported: true, emptySecrets: 1 })
    expect(await settingsOf(B)).toMatchObject({ auth: { bearerToken: '' }, preScript: 'pre()' })
    // B types its own token; a later pull keeps it.
    await fx.ok('settings:set', `project.${fx.on(B).projectId}.settings`, {
      auth: { type: 'bearer', bearerToken: 'sk-b-own' },
    })
    await fx.ok('settings:set', `project.${fx.on(A).projectId}.settings`, { preScript: 'pre2()' })
    await fx.push(A)
    expect(await fx.pull(B)).toMatchObject({ emptySecrets: 0 })
    expect(await settingsOf(B)).toMatchObject({
      auth: { bearerToken: 'sk-b-own' },
      preScript: 'pre2()',
    })
    // A still has its own literal token (the file never held it).
    expect(await settingsOf(A)).toMatchObject({ auth: { bearerToken: 'sk-live-literal' } })
    // Nothing pending on B: its own token is not a change to commit.
    expect((await fx.ok<{ items: unknown[] }>('git:changes', fx.on(B).projectId)).items).toEqual([])
  }, 60_000)

  it('Send (settings:get) and Run (loadProjectSettings) read the same merged object', async () => {
    const A = fx.machine('A')
    fx.on(A)
    await fx.ok('settings:set', `project.${A.projectId}.settings`, {
      ...SETTINGS,
      proxy: { mode: 'custom', host: 'p', port: 1 },
    })
    const send = await settingsOf(A)
    const run = await projectSettings.loadProjectSettings(A.projectId)
    expect(run).toEqual(send)
    expect(send).toMatchObject({ ...SETTINGS, proxy: { mode: 'custom' } })
    // The shared part is in the project row, the rest in the store.
    const row = A.db
      .prepare('SELECT shared_settings FROM projects WHERE id = ?')
      .get(A.projectId) as { shared_settings: string }
    expect(Object.keys(JSON.parse(row.shared_settings)).sort()).toEqual(
      [...projectSettings.SHARED_PROJECT_SETTING_KEYS].sort(),
    )
    expect(storeState.data[`project.${A.projectId}.settings`]).toEqual({
      proxy: { mode: 'custom', host: 'p', port: 1 },
    })
  })

  it('startup migration moves settings saved before shared_settings into the project row, once', async () => {
    const A = fx.machine('A')
    fx.on(A)
    const key = `project.${A.projectId}.settings`
    storeState.data[key] = { ...SETTINGS, workingDirectory: '/w' }
    const store = new FakeStore()
    expect(projectSettings.migrateProjectSettingsToDb(store)).toBe(1)
    expect(projectSettings.migrateProjectSettingsToDb(store)).toBe(0)
    expect(storeState.data[key]).toEqual({ workingDirectory: '/w' })
    expect(projectSettings.readSharedProjectSettings(A.projectId)).toEqual(SETTINGS)
    expect(await settingsOf(A)).toMatchObject({ ...SETTINGS, workingDirectory: '/w' })
    // ...and the next push carries them.
    fx.addEndpoint(A, 'Base')
    await fx.push(A)
    const B = fx.machine('B')
    await fx.pull(B)
    expect(await settingsOf(B)).toMatchObject(SETTINGS)
  }, 60_000)

  it('a settings-only edit is a change: the Commit panel lists the project, Commit writes it', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Base')
    await fx.push(A)
    await fx.ok('settings:set', `project.${fx.on(A).projectId}.settings`, { testScript: 't()' })
    const changes = await fx.ok<{ items: { kind: string; change: string }[] }>(
      'git:changes',
      A.projectId,
    )
    expect(changes.items).toEqual([
      expect.objectContaining({ kind: 'project', change: 'modified' }),
    ])
    await fx.ok('git:commit', A.projectId, 'settings')
    expect((await fx.ok<{ items: unknown[] }>('git:changes', A.projectId)).items).toEqual([])
  }, 60_000)
})
