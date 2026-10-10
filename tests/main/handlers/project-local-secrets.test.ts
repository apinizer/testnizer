/**
 * Issue #177 — "values marked secret stay on this machine".
 * Issue #186 — project import dropped folder auth/scripts, suite-folder auth/
 * scripts and the keystore columns of certificates.
 *
 * Real save handlers, real export / import, in-memory DBs (one per "machine").
 * The only file-system boundary exercised directly is `save:local` /
 * `save:exportProject`; the git boundaries (push / pull / switch) are covered
 * with a real bare remote in `git-two-machines.test.ts`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
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

let testDb: Database.Database
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

vi.mock('../../../src/main/lib/secure-storage', () => ({
  encryptSecret: (s: string | null | undefined) => (s ? `enc:${s}` : null),
  decryptSecret: (s: string | null | undefined) => (s ? s.replace(/^enc:/, '') : null),
}))

vi.mock('../../../src/main/ipc/import-export.handler', () => ({
  importPostman: vi.fn(),
  importInsomnia: vi.fn(),
}))

vi.mock('../../../src/main/ipc/test-suite.handler', () => ({
  snapshotEndpointForSuite: vi.fn(() => ({})),
  ensureUniqueSuiteName: (_db: unknown, _pid: string, name: string) => name,
}))

const electron = await import('electron')
const dialogMock = (electron as unknown as { dialog: { showSaveDialog: ReturnType<typeof vi.fn> } })
  .dialog

const { registerSaveHandlers, exportProjectData, importProjectDataFromJson, importProjectAsNew } =
  await import('../../../src/main/ipc/save.handler')
const { sameExport } = await import('../../../src/main/ipc/git.handler')
const { checkAuth } = await import('../../../src/main/mock/auth')
type AuthConfig = Parameters<typeof checkAuth>[0]['config']

type Envelope<T> = { success: boolean; error?: string; data?: T }
type Row = Record<string, unknown>

let outDir: string
beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'testnizer-secrets-'))
})
afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

beforeEach(() => {
  harness.reset()
  dialogMock.showSaveDialog.mockReset()
  registerSaveHandlers()
})

// ─── Fixture ─────────────────────────────────────────────────────

interface Seeded {
  workspaceId: string
  projectId: string
  envId: string
  secretVarId: string
  plainVarId: string
  globalSecretId: string
  bearerMockId: string
  apiKeyMockId: string
  mockEndpointId: string
  mcpId: string
  folderId: string
  suiteFolderId: string
  certId: string
}

const BEARER_AUTH = { type: 'bearer', tokens: ['tok-1', 'tok-2'] }
const API_KEY_AUTH = { type: 'apiKey', in: 'header', name: 'X-Key', keys: ['key-1'] }
const BASIC_OVERRIDE = {
  type: 'basic',
  users: [
    { username: 'alice', password: 'alice-pw' },
    { username: 'bob', password: 'bob-pw' },
  ],
}
const FOLDER_AUTH = JSON.stringify({ type: 'bearer', bearer: { token: '{{t}}' } })

function seed(db: Database.Database): Seeded {
  const workspaceId = seedWorkspace(db)
  const projectId = seedProject(db, workspaceId, 'Secret Project')
  const now = Date.now()
  const s: Seeded = {
    workspaceId,
    projectId,
    envId: randomUUID(),
    secretVarId: randomUUID(),
    plainVarId: randomUUID(),
    globalSecretId: randomUUID(),
    bearerMockId: randomUUID(),
    apiKeyMockId: randomUUID(),
    mockEndpointId: randomUUID(),
    mcpId: randomUUID(),
    folderId: randomUUID(),
    suiteFolderId: randomUUID(),
    certId: randomUUID(),
  }
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Dev', 1, ?, ?)`,
  ).run(s.envId, workspaceId, projectId, now, now)
  const insVar = db.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  )
  insVar.run(s.secretVarId, s.envId, 'token', 'cur-secret', 1, 'init-secret')
  insVar.run(s.plainVarId, s.envId, 'base', 'https://cur.example', 0, 'https://init.example')
  db.prepare(
    `INSERT INTO global_variables (id, workspace_id, project_id, key, value, enabled, secret, initial_value)
     VALUES (?, ?, ?, 'gkey', 'g-cur', 1, 1, 'g-init')`,
  ).run(s.globalSecretId, workspaceId, projectId)

  const insMock = db.prepare(
    `INSERT INTO mock_servers (id, project_id, name, port, auth_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  insMock.run(s.bearerMockId, projectId, 'Bearer mock', 4501, JSON.stringify(BEARER_AUTH), now, now)
  insMock.run(s.apiKeyMockId, projectId, 'Key mock', 4502, JSON.stringify(API_KEY_AUTH), now, now)
  db.prepare(
    `INSERT INTO mock_endpoints (id, server_id, method, path, auth_override, created_at, updated_at)
     VALUES (?, ?, 'GET', '/private', ?, ?, ?)`,
  ).run(s.mockEndpointId, s.bearerMockId, JSON.stringify(BASIC_OVERRIDE), now, now)
  db.prepare(
    `INSERT INTO mock_mcp_servers (id, project_id, name, port, auth_mode, bearer_token, created_at, updated_at)
     VALUES (?, ?, 'MCP mock', 4600, 'bearer', 'mcp-tok', ?, ?)`,
  ).run(s.mcpId, projectId, now, now)

  // Issue #186 columns.
  db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth, pre_script, post_script)
     VALUES (?, ?, NULL, 'Secured', 0, ?, 'pm.variables.set("a", 1)', 'pm.test("ok", () => {})')`,
  ).run(s.folderId, projectId, FOLDER_AUTH)
  const suiteId = randomUUID()
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Suite', 0, ?, ?)`,
  ).run(suiteId, projectId, now, now)
  db.prepare(
    `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, auth, pre_script, post_script, created_at)
     VALUES (?, ?, NULL, 'Suite folder', 0, ?, 'suitePre()', 'suitePost()', ?)`,
  ).run(s.suiteFolderId, suiteId, FOLDER_AUTH, now)
  // The keystore the cert row links to exists on this machine (issue #186
  // rule 4: a row whose key material is missing locally is imported disabled).
  db.prepare(
    `INSERT OR IGNORE INTO keystores (id, name, type, blob, created_at, updated_at)
     VALUES ('ks-1', 'Client KS', 'pkcs12', 'enc:blob', ?, ?)`,
  ).run(now, now)
  db.prepare(
    `INSERT INTO certificates (id, project_id, kind, host, passphrase, enabled, created_at, source, keystore_id, keystore_alias, keystore_key_password)
     VALUES (?, ?, 'client', 'api.example.com', 'enc:cert-pp', 1, ?, 'keystore', 'ks-1', 'client-alias', 'entry-pw')`,
  ).run(s.certId, projectId, now)
  return s
}

/** `save:local` → the JSON that actually lands on disk. */
async function saveLocalFile(projectId: string): Promise<{ text: string; doc: Row }> {
  const res = (await harness.invoke('save:local', {
    projectId,
    directoryPath: outDir,
  })) as Envelope<{ path: string }>
  expect(res.error).toBeUndefined()
  const text = readFileSync(res.data!.path, 'utf-8')
  return { text, doc: JSON.parse(text) as Row }
}

const rowsOf = (doc: Row, section: string): Row[] => (doc[section] as Row[] | undefined) ?? []
const byId = (rows: Row[], id: string): Row => rows.find((r) => r.id === id) as Row

/** The #177 file form, written by hand (independent of the code under test). */
function blankSecrets(doc: Row, s: Seeded): Row {
  Object.assign(byId(rowsOf(doc, 'environmentVariables'), s.secretVarId), {
    value: '',
    initial_value: '',
  })
  Object.assign(byId(rowsOf(doc, 'globalVariables'), s.globalSecretId), {
    value: '',
    initial_value: '',
  })
  byId(rowsOf(doc, 'mockServers'), s.bearerMockId).auth_config = JSON.stringify({
    type: 'bearer',
    tokens: ['', ''],
  })
  byId(rowsOf(doc, 'mockServers'), s.apiKeyMockId).auth_config = JSON.stringify({
    ...API_KEY_AUTH,
    keys: [''],
  })
  byId(rowsOf(doc, 'mockEndpoints'), s.mockEndpointId).auth_override = JSON.stringify({
    type: 'basic',
    users: [
      { username: 'alice', password: '' },
      { username: 'bob', password: '' },
    ],
  })
  byId(rowsOf(doc, 'mockMcpServers'), s.mcpId).bearer_token = ''
  Object.assign(byId(rowsOf(doc, 'certificates'), s.certId), {
    passphrase: '',
    keystore_key_password: '',
  })
  return doc
}

function readVar(db: Database.Database, table: string, id: string): Row {
  return db.prepare(`SELECT value, initial_value, secret FROM ${table} WHERE id = ?`).get(id) as Row
}

// ─── Export boundary ─────────────────────────────────────────────

describe('project file never carries values marked secret (issue #177)', () => {
  it('save:local blanks secret env/global values, mock auth secrets and the MCP bearer — and nothing else', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const { doc } = await saveLocalFile(s.projectId)

    const vars = rowsOf(doc, 'environmentVariables')
    expect(byId(vars, s.secretVarId)).toMatchObject({
      key: 'token',
      secret: 1,
      value: '',
      initial_value: '',
    })
    // Non-secret variables are untouched.
    expect(byId(vars, s.plainVarId)).toMatchObject({
      value: 'https://cur.example',
      initial_value: 'https://init.example',
    })
    expect(byId(rowsOf(doc, 'globalVariables'), s.globalSecretId)).toMatchObject({
      key: 'gkey',
      value: '',
      initial_value: '',
    })

    const mocks = rowsOf(doc, 'mockServers')
    expect(JSON.parse(byId(mocks, s.bearerMockId).auth_config as string)).toEqual({
      type: 'bearer',
      tokens: ['', ''],
    })
    expect(JSON.parse(byId(mocks, s.apiKeyMockId).auth_config as string)).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-Key',
      keys: [''],
    })
    expect(
      JSON.parse(byId(rowsOf(doc, 'mockEndpoints'), s.mockEndpointId).auth_override as string),
    ).toEqual({
      type: 'basic',
      users: [
        { username: 'alice', password: '' },
        { username: 'bob', password: '' },
      ],
    })
    expect(byId(rowsOf(doc, 'mockMcpServers'), s.mcpId)).toMatchObject({
      auth_mode: 'bearer',
      bearer_token: '',
    })

    // The DB itself is untouched by an export.
    expect(readVar(testDb, 'environment_variables', s.secretVarId).value).toBe('cur-secret')
  })

  it('save:exportProject (save dialog) writes the stripped form too', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const target = join(outDir, `export-${randomUUID()}.json`)
    dialogMock.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    const res = (await harness.invoke('save:exportProject', s.projectId)) as Envelope<unknown>
    expect(res.error).toBeUndefined()
    const text = readFileSync(target, 'utf-8')
    expect(text).not.toContain('cur-secret')
    expect(text).not.toContain('init-secret')
    expect(text).not.toContain('g-cur')
    expect(text).not.toContain('tok-1')
    expect(text).not.toContain('key-1')
    expect(text).not.toContain('alice-pw')
    expect(text).not.toContain('mcp-tok')
    // Request-level / folder-level auth is NOT a "value marked secret".
    expect(text).toContain('{{t}}')
  })

  it('project:duplicate keeps secrets — the copy never leaves this machine', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const res = (await harness.invoke('project:duplicate', {
      projectId: s.projectId,
      workspaceId: s.workspaceId,
    })) as Envelope<{ projectId: string }>
    expect(res.error).toBeUndefined()
    const copy = res.data!.projectId
    const v = testDb
      .prepare(
        `SELECT ev.value, ev.initial_value FROM environment_variables ev
         JOIN environments e ON e.id = ev.environment_id
         WHERE e.project_id = ? AND ev.key = 'token'`,
      )
      .get(copy) as Row
    expect(v).toEqual({ value: 'cur-secret', initial_value: 'init-secret' })
    const g = testDb
      .prepare(`SELECT value, initial_value FROM global_variables WHERE project_id = ?`)
      .get(copy) as Row
    expect(g).toEqual({ value: 'g-cur', initial_value: 'g-init' })
    const m = testDb
      .prepare(`SELECT bearer_token FROM mock_mcp_servers WHERE project_id = ?`)
      .get(copy) as Row
    expect(m.bearer_token).toBe('mcp-tok')
  })
})

// ─── Import boundary ─────────────────────────────────────────────

describe('importing a stripped file keeps this machine’s secret values (issue #177)', () => {
  for (const mode of ['merge', 'replace'] as const) {
    it(`${mode} mode: local value / initial_value, mock auth secrets and MCP bearer survive`, async () => {
      testDb = createTestDb()
      const s = seed(testDb)
      const { text } = await saveLocalFile(s.projectId)

      // The file as #177 writes it — blanked explicitly here too, so this
      // case pins the IMPORT side on its own (a stripped file arriving from a
      // teammate) regardless of what this machine's export produces.
      const doc = blankSecrets(JSON.parse(text) as Row, s)
      byId(rowsOf(doc, 'mockEndpoints'), s.mockEndpointId).auth_override = JSON.stringify({
        type: 'basic',
        users: [
          { username: 'bob', password: '' }, // order changed — users match by name
          { username: 'alice', password: '' },
        ],
      })
      // The teammate changed a non-secret thing in the same rows meanwhile.
      byId(rowsOf(doc, 'environmentVariables'), s.secretVarId).description = 'from remote'
      byId(rowsOf(doc, 'mockMcpServers'), s.mcpId).name = 'MCP mock (renamed)'

      await importProjectDataFromJson(JSON.stringify(doc), s.projectId, { mode })

      expect(readVar(testDb, 'environment_variables', s.secretVarId)).toEqual({
        value: 'cur-secret',
        initial_value: 'init-secret',
        secret: 1,
      })
      expect(
        testDb
          .prepare('SELECT description FROM environment_variables WHERE id = ?')
          .get(s.secretVarId),
      ).toEqual({ description: 'from remote' })
      expect(readVar(testDb, 'global_variables', s.globalSecretId)).toMatchObject({
        value: 'g-cur',
        initial_value: 'g-init',
      })
      const mock = (id: string): unknown =>
        JSON.parse(
          (
            testDb.prepare('SELECT auth_config FROM mock_servers WHERE id = ?').get(id) as {
              auth_config: string
            }
          ).auth_config,
        )
      expect(mock(s.bearerMockId)).toEqual(BEARER_AUTH)
      expect(mock(s.apiKeyMockId)).toEqual(API_KEY_AUTH)
      const override = testDb
        .prepare('SELECT auth_override FROM mock_endpoints WHERE id = ?')
        .get(s.mockEndpointId) as { auth_override: string }
      expect(JSON.parse(override.auth_override)).toEqual({
        type: 'basic',
        users: [
          { username: 'bob', password: 'bob-pw' },
          { username: 'alice', password: 'alice-pw' },
        ],
      })
      expect(
        testDb.prepare('SELECT name, bearer_token FROM mock_mcp_servers WHERE id = ?').get(s.mcpId),
      ).toEqual({ name: 'MCP mock (renamed)', bearer_token: 'mcp-tok' })
    })
  }

  it('a file written before #177 (secret value present) still overwrites — legacy files keep working', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const legacy = exportProjectData(s.projectId) as unknown as Row
    byId(rowsOf(legacy, 'environmentVariables'), s.secretVarId).value = 'from-legacy-file'
    await importProjectDataFromJson(JSON.stringify(legacy), s.projectId)
    expect(readVar(testDb, 'environment_variables', s.secretVarId).value).toBe('from-legacy-file')
  })

  it('a fresh machine gets "" (never NULL) and a blank-secret mock stays closed', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const { text } = await saveLocalFile(s.projectId)

    // Machine B: its own DB, its own project id, none of A's rows.
    testDb = createTestDb()
    const ws = seedWorkspace(testDb, 'B')
    const pid = seedProject(testDb, ws, 'Secret Project')
    await importProjectDataFromJson(text, pid)

    expect(readVar(testDb, 'environment_variables', s.secretVarId)).toEqual({
      value: '',
      initial_value: '',
      secret: 1,
    })
    expect(readVar(testDb, 'environment_variables', s.plainVarId).value).toBe('https://cur.example')
    expect(readVar(testDb, 'global_variables', s.globalSecretId)).toMatchObject({
      value: '',
      initial_value: '',
    })
    expect(
      testDb.prepare('SELECT bearer_token FROM mock_mcp_servers WHERE id = ?').get(s.mcpId),
    ).toEqual({ bearer_token: '' })

    // Runtime gate on what B now holds: nothing gets in with a blank secret.
    const cfg = JSON.parse(
      (
        testDb.prepare('SELECT auth_config FROM mock_servers WHERE id = ?').get(s.bearerMockId) as {
          auth_config: string
        }
      ).auth_config,
    ) as AuthConfig
    expect(checkAuth({ config: cfg, headers: { authorization: 'Bearer ' }, query: {} }).ok).toBe(
      false,
    )
    const override = JSON.parse(
      (
        testDb
          .prepare('SELECT auth_override FROM mock_endpoints WHERE id = ?')
          .get(s.mockEndpointId) as { auth_override: string }
      ).auth_override,
    ) as AuthConfig
    const blankAlice = `Basic ${Buffer.from('alice:').toString('base64')}`
    expect(
      checkAuth({ config: override, headers: { authorization: blankAlice }, query: {} }).ok,
    ).toBe(false)
  })
})

// ─── sameExport (git switch / pull no-op detection) ──────────────

describe('sameExport compares the stripped form (issue #177)', () => {
  it('the stripped file on disk equals the live DB export — no Auto-save commit', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const live = exportProjectData(s.projectId) as unknown as Row
    const fileText = JSON.stringify(blankSecrets(JSON.parse(JSON.stringify(live)) as Row, s))
    expect(sameExport(fileText, live)).toBe(true)
    // …and what save:local actually writes is that same form.
    const { text } = await saveLocalFile(s.projectId)
    expect(sameExport(text, exportProjectData(s.projectId) as unknown as Row)).toBe(true)
  })

  it('a pre-#177 file that still holds a secret differs once, so it gets rewritten', () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const legacyText = JSON.stringify(exportProjectData(s.projectId))
    expect(sameExport(legacyText, exportProjectData(s.projectId) as unknown as Row)).toBe(false)
  })
})

// ─── Issue #186: columns the importer used to drop ───────────────

describe('project import writes folder auth/scripts, suite folder auth/scripts, keystore cert fields (issue #186)', () => {
  function assertCarried(
    db: Database.Database,
    ids: { folder: string; suiteFolder: string; cert: string },
    // The entry password is machine-bound (issue #177): a project FILE carries ''.
    keystoreKeyPassword: string,
  ): void {
    expect(
      db.prepare('SELECT auth, pre_script, post_script FROM folders WHERE id = ?').get(ids.folder),
    ).toEqual({
      auth: FOLDER_AUTH,
      pre_script: 'pm.variables.set("a", 1)',
      post_script: 'pm.test("ok", () => {})',
    })
    expect(
      db
        .prepare('SELECT auth, pre_script, post_script FROM test_suite_folders WHERE id = ?')
        .get(ids.suiteFolder),
    ).toEqual({ auth: FOLDER_AUTH, pre_script: 'suitePre()', post_script: 'suitePost()' })
    expect(
      db
        .prepare(
          'SELECT source, keystore_id, keystore_alias, keystore_key_password, host FROM certificates WHERE id = ?',
        )
        .get(ids.cert),
    ).toEqual({
      source: 'keystore',
      keystore_id: 'ks-1',
      keystore_alias: 'client-alias',
      keystore_key_password: keystoreKeyPassword,
      host: 'api.example.com',
    })
  }

  it('importProjectData (git pull / Clone on machine B) into a fresh DB', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const { text } = await saveLocalFile(s.projectId)

    testDb = createTestDb()
    const pid = seedProject(testDb, seedWorkspace(testDb, 'B'), 'Secret Project')
    await importProjectDataFromJson(text, pid)
    assertCarried(testDb, { folder: s.folderId, suiteFolder: s.suiteFolderId, cert: s.certId }, '')
  })

  it('importProjectAsNew (Import Project / Duplicate) with fresh ids', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const { doc } = await saveLocalFile(s.projectId)

    testDb = createTestDb()
    const ws = seedWorkspace(testDb, 'B')
    const { projectId } = importProjectAsNew(
      doc as unknown as Parameters<typeof importProjectAsNew>[0],
      ws,
    )
    const folder = testDb
      .prepare('SELECT id FROM folders WHERE project_id = ? AND name = ?')
      .get(projectId, 'Secured') as { id: string }
    const suiteFolder = testDb
      .prepare(
        `SELECT f.id FROM test_suite_folders f JOIN test_suites t ON t.id = f.suite_id
         WHERE t.project_id = ?`,
      )
      .get(projectId) as { id: string }
    const cert = testDb
      .prepare('SELECT id FROM certificates WHERE project_id = ?')
      .get(projectId) as { id: string } | undefined
    expect(cert, 'certificate copied into the new project').toBeDefined()
    assertCarried(testDb, { folder: folder.id, suiteFolder: suiteFolder.id, cert: cert!.id }, '')
  })
})

// ─── Issue #186: a file written by an OLDER build ────────────────

describe('a project file without the #186 columns keeps local values (issue #186)', () => {
  /** What a pre-#186 build wrote: the same export, minus the new keys. */
  function oldFile(projectId: string): Row {
    const doc = JSON.parse(JSON.stringify(exportProjectData(projectId))) as Row
    for (const r of rowsOf(doc, 'certificates')) {
      delete r.source
      delete r.keystore_id
      delete r.keystore_alias
      delete r.keystore_key_password
    }
    for (const section of ['folders', 'testSuiteFolders']) {
      for (const r of rowsOf(doc, section)) {
        delete r.auth
        delete r.pre_script
        delete r.post_script
      }
    }
    return doc
  }

  for (const mode of ['merge', 'replace'] as const) {
    it(`${mode} mode into the same project: local folder auth/scripts + cert keystore link survive`, async () => {
      testDb = createTestDb()
      const s = seed(testDb)
      const doc = oldFile(s.projectId)
      byId(rowsOf(doc, 'mockMcpServers'), s.mcpId).name = 'MCP from old file'

      await importProjectDataFromJson(JSON.stringify(doc), s.projectId, { mode })

      expect(
        testDb
          .prepare('SELECT auth, pre_script, post_script FROM folders WHERE id = ?')
          .get(s.folderId),
      ).toEqual({
        auth: FOLDER_AUTH,
        pre_script: 'pm.variables.set("a", 1)',
        post_script: 'pm.test("ok", () => {})',
      })
      expect(
        testDb
          .prepare('SELECT auth, pre_script, post_script FROM test_suite_folders WHERE id = ?')
          .get(s.suiteFolderId),
      ).toEqual({ auth: FOLDER_AUTH, pre_script: 'suitePre()', post_script: 'suitePost()' })
      expect(
        testDb
          .prepare(
            'SELECT source, keystore_id, keystore_alias, keystore_key_password FROM certificates WHERE id = ?',
          )
          .get(s.certId),
      ).toEqual({
        source: 'keystore',
        keystore_id: 'ks-1',
        keystore_alias: 'client-alias',
        keystore_key_password: 'entry-pw',
      })
      // The import ran to the end — the section after certificates landed.
      expect(testDb.prepare('SELECT name FROM mock_mcp_servers WHERE id = ?').get(s.mcpId)).toEqual(
        { name: 'MCP from old file' },
      )
    })
  }

  it('into a fresh DB: new rows take the column defaults (source = file), no NOT NULL abort', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const doc = oldFile(s.projectId)

    testDb = createTestDb()
    const pid = seedProject(testDb, seedWorkspace(testDb, 'B'), 'Secret Project')
    await importProjectDataFromJson(JSON.stringify(doc), pid)

    expect(
      testDb
        .prepare(
          'SELECT source, keystore_id, keystore_alias, keystore_key_password FROM certificates WHERE id = ?',
        )
        .get(s.certId),
    ).toEqual({
      source: 'file',
      keystore_id: null,
      keystore_alias: null,
      keystore_key_password: null,
    })
    expect(
      testDb.prepare('SELECT auth, pre_script FROM folders WHERE id = ?').get(s.folderId),
    ).toEqual({ auth: null, pre_script: null })
    expect(testDb.prepare('SELECT 1 AS x FROM mock_mcp_servers WHERE id = ?').get(s.mcpId)).toEqual(
      { x: 1 },
    )
  })
})

// ─── Issue #177: certificate passphrases are machine-bound ───────

describe('certificate passphrase + keystore entry password stay on this machine (issue #177)', () => {
  const certSecrets = (db: Database.Database, id: string): Row =>
    db
      .prepare('SELECT passphrase, keystore_key_password FROM certificates WHERE id = ?')
      .get(id) as Row

  it('save:local writes "" for both', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const { doc, text } = await saveLocalFile(s.projectId)
    expect(byId(rowsOf(doc, 'certificates'), s.certId)).toMatchObject({
      passphrase: '',
      keystore_key_password: '',
      keystore_alias: 'client-alias',
    })
    expect(text).not.toContain('cert-pp')
    expect(text).not.toContain('entry-pw')
    // sameExport compares the stripped form — no endless Auto-save commit.
    expect(sameExport(text, exportProjectData(s.projectId) as unknown as Row)).toBe(true)
  })

  for (const mode of ['merge', 'replace'] as const) {
    it(`${mode} pull keeps the local values`, async () => {
      testDb = createTestDb()
      const s = seed(testDb)
      const { text } = await saveLocalFile(s.projectId)
      await importProjectDataFromJson(text, s.projectId, { mode })
      expect(certSecrets(testDb, s.certId)).toEqual({
        passphrase: 'enc:cert-pp',
        keystore_key_password: 'entry-pw',
      })
    })
  }

  it("an older file carrying the other machine's ciphertext does not overwrite the local value", async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const doc = JSON.parse(JSON.stringify(exportProjectData(s.projectId))) as Row
    Object.assign(byId(rowsOf(doc, 'certificates'), s.certId), {
      passphrase: 'enc:other-machine',
      keystore_key_password: 'enc:other-entry',
    })
    await importProjectDataFromJson(JSON.stringify(doc), s.projectId)
    expect(certSecrets(testDb, s.certId)).toEqual({
      passphrase: 'enc:cert-pp',
      keystore_key_password: 'entry-pw',
    })
  })

  it('a fresh machine gets ""', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const { text } = await saveLocalFile(s.projectId)
    testDb = createTestDb()
    const pid = seedProject(testDb, seedWorkspace(testDb, 'B'), 'Secret Project')
    await importProjectDataFromJson(text, pid)
    expect(certSecrets(testDb, s.certId)).toEqual({ passphrase: '', keystore_key_password: '' })
  })

  it('project:duplicate keeps both', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const res = (await harness.invoke('project:duplicate', {
      projectId: s.projectId,
      workspaceId: s.workspaceId,
    })) as Envelope<{ projectId: string }>
    expect(res.error).toBeUndefined()
    const copy = testDb
      .prepare(
        'SELECT passphrase, keystore_key_password, enabled FROM certificates WHERE project_id = ?',
      )
      .get(res.data!.projectId) as Row
    expect(copy).toEqual({
      passphrase: 'enc:cert-pp',
      keystore_key_password: 'entry-pw',
      enabled: 1,
    })
  })
})

// ─── Issue #186: a cert whose material is not on this machine ────

describe('imported certificates whose key material is missing here are disabled (issue #186)', () => {
  const MISSING = '/nonexistent/testnizer-186/client.crt'

  function addFileCert(
    db: Database.Database,
    projectId: string,
    paths: { crt?: string; key?: string; pfx?: string },
    enabled = 1,
  ): string {
    const id = randomUUID()
    db.prepare(
      `INSERT INTO certificates (id, project_id, kind, host, crt_path, key_path, pfx_path, enabled, created_at)
       VALUES (?, ?, 'client', '127.0.0.1', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      paths.crt ?? null,
      paths.key ?? null,
      paths.pfx ?? null,
      enabled,
      Date.now(),
    )
    return id
  }
  const enabledOf = (db: Database.Database, where: string, arg: string): number[] =>
    (
      db.prepare(`SELECT enabled FROM certificates WHERE ${where} ORDER BY crt_path`).all(arg) as {
        enabled: number
      }[]
    ).map((r) => r.enabled)

  function realFiles(): { crt: string; key: string } {
    const crt = join(outDir, `c-${randomUUID()}.crt`)
    const key = join(outDir, `k-${randomUUID()}.key`)
    writeFileSync(crt, 'CRT')
    writeFileSync(key, 'KEY')
    return { crt, key }
  }

  it('importProjectAsNew: missing path → enabled 0; existing files keep their enabled value', async () => {
    testDb = createTestDb()
    const ws = seedWorkspace(testDb)
    const pid = seedProject(testDb, ws, 'Cert Project')
    const files = realFiles()
    const missingId = addFileCert(testDb, pid, { crt: MISSING, key: files.key })
    const presentId = addFileCert(testDb, pid, files)
    const presentOffId = addFileCert(testDb, pid, { pfx: files.crt }, 0)
    const doc = exportProjectData(pid)

    const { projectId } = importProjectAsNew(doc, ws, { name: 'Imported' })
    const rows = testDb
      .prepare(
        'SELECT crt_path, key_path, pfx_path, enabled FROM certificates WHERE project_id = ?',
      )
      .all(projectId) as Row[]
    const find = (p: { crt_path?: string | null; pfx_path?: string | null }): Row =>
      rows.find((r) =>
        p.pfx_path ? r.pfx_path === p.pfx_path : r.crt_path === p.crt_path && !r.pfx_path,
      ) as Row
    expect(find({ crt_path: MISSING }).enabled).toBe(0)
    expect(find({ crt_path: files.crt }).enabled).toBe(1)
    expect(find({ pfx_path: files.crt }).enabled).toBe(0)
    // Ids unused below — the source rows are untouched.
    expect(enabledOf(testDb, 'id = ?', missingId)).toEqual([1])
    expect(enabledOf(testDb, 'id = ?', presentId)).toEqual([1])
    expect(enabledOf(testDb, 'id = ?', presentOffId)).toEqual([0])
  })

  it('a passphrase stripped from the file ("") counts as missing material — even with the files present', async () => {
    testDb = createTestDb()
    const ws = seedWorkspace(testDb)
    const pid = seedProject(testDb, ws, 'Cert Project')
    const files = realFiles()
    const pfxId = addFileCert(testDb, pid, { pfx: files.crt })
    testDb.prepare(`UPDATE certificates SET passphrase = 'enc:pp' WHERE id = ?`).run(pfxId)
    const { doc, text } = await saveLocalFile(pid)

    // Import Project from that file on the same machine: the PFX is here, its
    // passphrase is not — enabled would break every Send to the host.
    const { projectId } = importProjectAsNew(
      doc as unknown as Parameters<typeof importProjectAsNew>[0],
      ws,
      { name: 'From file' },
    )
    expect(enabledOf(testDb, 'project_id = ?', projectId)).toEqual([0])

    // Pull into machine B (the same paths happen to exist): a NEW row, disabled.
    testDb = createTestDb()
    const pidB = seedProject(testDb, seedWorkspace(testDb, 'B'), 'Cert Project')
    await importProjectDataFromJson(text, pidB)
    expect(enabledOf(testDb, 'id = ?', pfxId)).toEqual([0])
  })

  it('project:duplicate keeps a passphrase-protected cert enabled (the copy carries the passphrase)', async () => {
    testDb = createTestDb()
    const ws = seedWorkspace(testDb)
    const pid = seedProject(testDb, ws, 'Cert Project')
    const pfxId = addFileCert(testDb, pid, { pfx: realFiles().crt })
    testDb.prepare(`UPDATE certificates SET passphrase = 'enc:pp' WHERE id = ?`).run(pfxId)
    const res = (await harness.invoke('project:duplicate', {
      projectId: pid,
      workspaceId: ws,
    })) as Envelope<{ projectId: string }>
    expect(res.error).toBeUndefined()
    expect(enabledOf(testDb, 'project_id = ?', res.data!.projectId)).toEqual([1])
  })

  it('project:duplicate on the same machine leaves enabled unchanged', async () => {
    testDb = createTestDb()
    const ws = seedWorkspace(testDb)
    const pid = seedProject(testDb, ws, 'Cert Project')
    addFileCert(testDb, pid, realFiles())
    const res = (await harness.invoke('project:duplicate', {
      projectId: pid,
      workspaceId: ws,
    })) as Envelope<{ projectId: string }>
    expect(res.error).toBeUndefined()
    expect(enabledOf(testDb, 'project_id = ?', res.data!.projectId)).toEqual([1])
  })

  it('keystore-backed row: the keystore missing here counts as missing material', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const doc = exportProjectData(s.projectId)
    testDb = createTestDb()
    const ws = seedWorkspace(testDb, 'B')
    const { projectId } = importProjectAsNew(doc, ws)
    expect(enabledOf(testDb, 'project_id = ?', projectId)).toEqual([0])
  })

  it('importProjectData (pull): NEW rows with missing files are disabled and stay so on the next pull', async () => {
    testDb = createTestDb()
    const wsA = seedWorkspace(testDb)
    const pidA = seedProject(testDb, wsA, 'Cert Project')
    const files = realFiles()
    const missingId = addFileCert(testDb, pidA, { crt: MISSING })
    const presentId = addFileCert(testDb, pidA, files)
    const { text } = await saveLocalFile(pidA)

    testDb = createTestDb()
    const pidB = seedProject(testDb, seedWorkspace(testDb, 'B'), 'Cert Project')
    await importProjectDataFromJson(text, pidB)
    expect(enabledOf(testDb, 'id = ?', missingId)).toEqual([0])
    expect(enabledOf(testDb, 'id = ?', presentId)).toEqual([1])

    // Second pull of the same file (enabled = 1 in it): the local value wins.
    await importProjectDataFromJson(text, pidB, { mode: 'replace' })
    expect(enabledOf(testDb, 'id = ?', missingId)).toEqual([0])
  })

  it('importProjectData (pull): an EXISTING local row keeps its local enabled value', async () => {
    testDb = createTestDb()
    const ws = seedWorkspace(testDb)
    const pid = seedProject(testDb, ws, 'Cert Project')
    const files = realFiles()
    const offId = addFileCert(testDb, pid, files, 0)
    const missingOnId = addFileCert(testDb, pid, { crt: MISSING }, 1)
    const doc = JSON.parse(JSON.stringify(exportProjectData(pid))) as Row
    byId(rowsOf(doc, 'certificates'), offId).enabled = 1
    await importProjectDataFromJson(JSON.stringify(doc), pid)
    expect(enabledOf(testDb, 'id = ?', offId)).toEqual([0])
    // The user's own row is never switched off behind their back.
    expect(enabledOf(testDb, 'id = ?', missingOnId)).toEqual([1])
  })
})
