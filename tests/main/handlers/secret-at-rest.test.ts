/**
 * Issue #239 — values marked secret are encrypted at rest.
 *
 * `secret`-flagged environment / global variables (`value`, `initial_value`),
 * HTTP mock auth credentials (only the secret FIELDS of `auth_config` /
 * `auth_override`) and the Mock MCP `bearer_token` are stored as
 * `enc:v1:` safeStorage ciphertext. Every reader opens them (renderer IPC,
 * Run / Mock variable loader, mask inventory, mock engine), every writer seals
 * them, and no file ever carries ciphertext.
 *
 * Fail-before: every raw `SELECT` below returned the plaintext; the description
 * scrub of a stripped export also searched for (then) plaintext needles — once
 * the column is sealed those needles must be decrypted or the "Auth required"
 * preset's token leaks into the project file.
 *
 * Real production schema (`openAndMigrate(':memory:')`), real repos and
 * handlers; the OS keychain is a reversible stand-in whose key can be swapped
 * (a keychain reset / a profile restored elsewhere) or switched off.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock, seedWorkspace, seedProject } from './helpers'

const harness = setupHandlerHarness()

/** The stand-in OS keychain: `key` is the machine's secret, `available` its presence. */
const keychain = vi.hoisted(() => ({ available: true, key: 'machine-key-1' }))

vi.mock('electron', () => ({
  ...makeElectronMock(),
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    encryptString: (s: string) => Buffer.from(`${keychain.key}|${s}`, 'utf-8').reverse(),
    decryptString: (b: Buffer) => {
      const text = Buffer.from(b).reverse().toString('utf-8')
      const bar = text.indexOf('|')
      if (text.slice(0, bar) !== keychain.key) throw new Error('keychain changed')
      return text.slice(bar + 1)
    },
  },
}))

let testDb: Database.Database
const realDb = await vi.importActual<typeof import('../../../src/main/db/database')>(
  '../../../src/main/db/database',
)
vi.mock('../../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/db/database')>()),
  getDb: () => testDb,
}))

vi.mock('../../../src/main/ipc/test-suite.handler', () => ({
  snapshotEndpointForSuite: vi.fn(() => ({})),
  ensureUniqueSuiteName: (_db: unknown, _pid: string, name: string) => name,
}))

const { registerEnvironmentHandlers } = await import('../../../src/main/ipc/environment.handler')
const { registerMockHandlers, buildServerDef } = await import('../../../src/main/ipc/mock.handler')
const { registerSaveHandlers, exportProjectData, importProjectDataFromJson } =
  await import('../../../src/main/ipc/save.handler')
const { sameExport } = await import('../../../src/main/ipc/git.handler')
const { importPostmanEnvironment, exportAsPostman } =
  await import('../../../src/main/ipc/import-export.handler')
const envRepo = await import('../../../src/main/db/environment.repo')
const { addHistory } = await import('../../../src/main/db/history.repo')
const { createMockMcpServer, getMockMcpServer, updateMockMcpServer } =
  await import('../../../src/main/db/mock-mcp.repo')
const { loadEnvVars } = await import('../../../src/main/lib/env-vars')
const { stripLocalSecrets } = await import('../../../src/main/lib/local-secrets')
const { checkAuth, resolveAuthConfig } = await import('../../../src/main/mock/auth')
const { invalidateSecretInventory } = await import('../../../src/main/lib/secret-inventory-cache')
const { runSecretAtRestMigration, SECRET_AT_REST_MIGRATION_KEY } =
  await import('../../../src/main/db/secret-at-rest-migration')
const { HISTORY_MASK } = await import('../../../src/shared/credential-headers')

type Row = Record<string, unknown>
type Envelope<T> = { success: boolean; error?: string; data?: T }
const invoke = <T>(channel: string, ...args: unknown[]): Promise<Envelope<T>> =>
  harness.invoke(channel, ...args) as Promise<Envelope<T>>

const ENC = /^enc:v1:/

const SECRET = 'S3cret-token-239-abcdef'
const SECRET_INIT = 'S3cret-initial-239-xyz'
const GLOBAL_SECRET = 'G1obal-secret-239-qwerty'

beforeEach(() => {
  keychain.available = true
  keychain.key = 'machine-key-1'
  harness.reset()
  testDb = realDb.openAndMigrate(':memory:')
  invalidateSecretInventory()
  registerEnvironmentHandlers()
  registerMockHandlers()
  registerSaveHandlers()
})

interface Fixture {
  workspaceId: string
  projectId: string
  envId: string
}

function fixture(): Fixture {
  const workspaceId = seedWorkspace(testDb)
  const projectId = seedProject(testDb, workspaceId, 'Vault')
  const envId = randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'Dev', 1, ?, ?)`,
    )
    .run(envId, workspaceId, projectId, now, now)
  return { workspaceId, projectId, envId }
}

const rawVar = (table: string, id: string): Row =>
  testDb.prepare(`SELECT value, initial_value, secret FROM ${table} WHERE id = ?`).get(id) as Row

async function createSecretVar(f: Fixture, key = 'token'): Promise<Row> {
  const res = await invoke<Row>('envVariable:create', {
    environment_id: f.envId,
    key,
    value: SECRET,
    initial_value: SECRET_INIT,
    secret: true,
  })
  expect(res.error).toBeUndefined()
  return res.data!
}

// ─── Variables ───────────────────────────────────────────────────

describe('variables marked secret: sealed on disk, plaintext everywhere they are used', () => {
  it('raw row holds enc:v1:, the IPC create/list returns plaintext, a plain variable stays plain', async () => {
    const f = fixture()
    const created = await createSecretVar(f)
    // The renderer swaps its optimistic row for this one — it must be plaintext.
    expect(created).toMatchObject({ value: SECRET, initial_value: SECRET_INIT, secret: 1 })
    const raw = rawVar('environment_variables', created.id as string)
    expect(raw.value).toMatch(ENC)
    expect(raw.initial_value).toMatch(ENC)
    expect(JSON.stringify(raw)).not.toContain(SECRET)

    const plain = await invoke<Row>('envVariable:create', {
      environment_id: f.envId,
      key: 'baseUrl',
      value: 'https://api.example.com',
      initial_value: 'https://api.example.com',
    })
    expect(rawVar('environment_variables', plain.data!.id as string)).toMatchObject({
      value: 'https://api.example.com',
      initial_value: 'https://api.example.com',
    })

    const list = await invoke<Row[]>('envVariable:list', f.envId)
    const byKey = new Map(list.data!.map((r) => [r.key, r]))
    expect(byKey.get('token')).toMatchObject({ value: SECRET, initial_value: SECRET_INIT })
    expect(byKey.get('token')!.decryptFailed).toBeUndefined()
    expect(byKey.get('baseUrl')).toMatchObject({ value: 'https://api.example.com' })
  })

  it('global variables marked secret: same rule (create, listByProject)', async () => {
    const f = fixture()
    const res = await invoke<Row>('globalVariable:create', {
      workspace_id: f.workspaceId,
      project_id: f.projectId,
      key: 'gkey',
      value: GLOBAL_SECRET,
      initial_value: GLOBAL_SECRET,
      secret: true,
    })
    expect(res.data).toMatchObject({ value: GLOBAL_SECRET })
    expect(rawVar('global_variables', res.data!.id as string).value).toMatch(ENC)
    const list = await invoke<Row[]>('globalVariable:listByProject', f.projectId)
    expect(list.data![0]).toMatchObject({ key: 'gkey', value: GLOBAL_SECRET })
  })

  it('Run / Mock (loadEnvVars) resolve the plaintext — Send ≡ Run', async () => {
    const f = fixture()
    await createSecretVar(f)
    await invoke('globalVariable:create', {
      workspace_id: f.workspaceId,
      project_id: f.projectId,
      key: 'gkey',
      value: '',
      initial_value: GLOBAL_SECRET, // current empty → initial value (issue #4 fallback)
      secret: true,
    })
    const vars = loadEnvVars({ workspaceId: f.workspaceId, projectId: f.projectId })
    expect(vars.token).toBe(SECRET)
    expect(vars.gkey).toBe(GLOBAL_SECRET)
  })

  it('toggling the flag: secret → plain stores plaintext, plain → secret seals', async () => {
    const f = fixture()
    const v = await createSecretVar(f)
    const id = v.id as string
    await invoke('envVariable:update', id, { secret: false })
    expect(rawVar('environment_variables', id)).toEqual({
      value: SECRET,
      initial_value: SECRET_INIT,
      secret: 0,
    })
    await invoke('envVariable:update', id, { secret: true })
    const raw = rawVar('environment_variables', id)
    expect(raw.value).toMatch(ENC)
    expect(raw.initial_value).toMatch(ENC)
    expect((await invoke<Row[]>('envVariable:list', f.envId)).data![0]).toMatchObject({
      value: SECRET,
      initial_value: SECRET_INIT,
    })
  })

  it('the Runner persisting pm.environment.set into a secret variable seals the new value', async () => {
    const f = fixture()
    const v = await createSecretVar(f)
    // runner.handler: `envRepo.updateVariable(row.id, { value: envUpdates[key] })`
    envRepo.updateVariable(v.id as string, { value: 'from-script-239-value' })
    const raw = rawVar('environment_variables', v.id as string)
    expect(raw.value).toMatch(ENC)
    expect(loadEnvVars({ projectId: f.projectId }).token).toBe('from-script-239-value')
  })

  it('a value the keychain cannot decrypt: flagged, never ciphertext, never overwritten by an unrelated edit', async () => {
    const f = fixture()
    const v = await createSecretVar(f)
    const id = v.id as string
    const sealed = rawVar('environment_variables', id)

    keychain.key = 'machine-key-RESET' // keychain reset / profile restored elsewhere
    const list = await invoke<Row[]>('envVariable:list', f.envId)
    expect(list.data![0]).toMatchObject({ value: '', initial_value: '', decryptFailed: true })
    expect(JSON.stringify(list.data)).not.toMatch(/enc:v1:/)
    expect(loadEnvVars({ projectId: f.projectId }).token).toBe('')

    // What the env editor sends when the user edits only the description.
    await invoke('envVariable:update', id, {
      key: 'token',
      value: '',
      initial_value: '',
      enabled: true,
      secret: true,
      description: 'edited',
    })
    expect(rawVar('environment_variables', id)).toEqual(sealed)

    // Re-entering a value replaces it.
    await invoke('envVariable:update', id, { value: 'new-value-239-entered' })
    const list2 = await invoke<Row[]>('envVariable:list', f.envId)
    expect(list2.data![0]).toMatchObject({ value: 'new-value-239-entered' })

    // Back on the original keychain the untouched initial value still opens.
    keychain.key = 'machine-key-1'
    expect((await invoke<Row[]>('envVariable:list', f.envId)).data![0]).toMatchObject({
      initial_value: SECRET_INIT,
    })
  })

  it('keychain unavailable: plaintext fallback keeps working, and the status says so', async () => {
    keychain.available = false
    const f = fixture()
    const v = await createSecretVar(f)
    expect(rawVar('environment_variables', v.id as string).value).toBe(SECRET)
    expect(loadEnvVars({ projectId: f.projectId }).token).toBe(SECRET)
    const status = await invoke<{ encrypted: boolean }>('secureStorage:status')
    expect(status.data!.encrypted).toBe(false)
    keychain.available = true
    expect((await invoke<{ encrypted: boolean }>('secureStorage:status')).data!.encrypted).toBe(
      true,
    )
  })
})

// ─── History masking (#195 / #238 regression guard) ─────────────

describe('History still masks a secret value that is sealed at rest', () => {
  it('a secret used in the URL and a header is masked in the stored row', async () => {
    const f = fixture()
    await createSecretVar(f)
    const row = addHistory({
      workspace_id: f.workspaceId,
      project_id: f.projectId,
      protocol: 'http',
      method: 'GET',
      url: `https://api.example.com/items?sig=${SECRET}`,
      status_code: 200,
      request_snapshot: JSON.stringify({ headers: [{ key: 'X-Trace', value: SECRET }] }),
    })
    const stored = testDb
      .prepare('SELECT url, request_snapshot FROM history WHERE id = ?')
      .get(row.id) as Row
    const text = JSON.stringify(stored)
    expect(text).not.toContain(SECRET)
    expect(text).not.toMatch(/enc:v1:/)
  })
})

// ─── HTTP mock + Mock MCP ────────────────────────────────────────

async function createMock(f: Fixture, name: string, port: number): Promise<string> {
  const res = await invoke<Row>('mock:server:create', { projectId: f.projectId, name, port })
  expect(res.error).toBeUndefined()
  return res.data!.id as string
}

const rawAuth = (id: string): string =>
  (testDb.prepare('SELECT auth_config FROM mock_servers WHERE id = ?').get(id) as Row)
    .auth_config as string

describe('mock auth credentials: only the secret fields are sealed, the mock still accepts them', () => {
  interface AuthCase {
    name: string
    auth: Row
    ok: Record<string, string>
    bad: Record<string, string>
    secret: string
  }
  const cases: AuthCase[] = [
    {
      name: 'bearer',
      auth: { type: 'bearer', tokens: ['mock-bearer-239-aaaa'] },
      ok: { authorization: 'Bearer mock-bearer-239-aaaa' },
      bad: { authorization: 'Bearer wrong' },
      secret: 'mock-bearer-239-aaaa',
    },
    {
      name: 'basic',
      auth: { type: 'basic', users: [{ username: 'qa', password: 'mock-basic-239-pw' }] },
      ok: { authorization: `Basic ${Buffer.from('qa:mock-basic-239-pw').toString('base64')}` },
      bad: { authorization: `Basic ${Buffer.from('qa:nope').toString('base64')}` },
      secret: 'mock-basic-239-pw',
    },
    {
      name: 'apiKey',
      auth: { type: 'apiKey', in: 'header', name: 'X-Key', keys: ['mock-key-239-zzzz'] },
      ok: { 'x-key': 'mock-key-239-zzzz' },
      bad: { 'x-key': 'other' },
      secret: 'mock-key-239-zzzz',
    },
  ]
  for (const c of cases) {
    it(`${c.name}: raw JSON stays JSON with enc:v1: fields; view + engine see plaintext`, async () => {
      const f = fixture()
      const id = await createMock(f, `Mock ${c.name}`, 4700)
      const upd = await invoke<Row>('mock:server:update', id, { authConfig: c.auth })
      expect(upd.data!.authConfig).toEqual(c.auth)

      const raw = rawAuth(id)
      expect(raw).not.toContain(c.secret)
      const parsed = JSON.parse(raw) as Row
      expect(parsed.type).toBe(c.auth.type as string)
      expect(raw).toMatch(/"enc:v1:/)

      const view = await invoke<Row>('mock:server:get', id)
      expect(view.data!.authConfig).toEqual(c.auth)

      const def = buildServerDef(id)!
      expect(checkAuth({ config: def.auth, headers: c.ok, query: {} }).ok).toBe(true)
      expect(checkAuth({ config: def.auth, headers: c.bad, query: {} }).ok).toBe(false)
    })
  }

  it('endpoint auth override is sealed and resolved by the engine', async () => {
    const f = fixture()
    const serverId = await createMock(f, 'Override', 4701)
    const override = { type: 'basic', users: [{ username: 'alice', password: 'ep-pw-239-x' }] }
    const ep = await invoke<Row>('mock:endpoint:create', {
      serverId,
      method: 'GET',
      path: '/private',
      authOverride: override,
    })
    const raw = (
      testDb
        .prepare('SELECT auth_override FROM mock_endpoints WHERE id = ?')
        .get(ep.data!.id) as Row
    ).auth_override as string
    expect(raw).not.toContain('ep-pw-239-x')
    expect(raw).toMatch(/"enc:v1:/)
    const def = buildServerDef(serverId)!
    const effective = resolveAuthConfig(def.auth, def.endpoints[0].authOverride)
    const header = `Basic ${Buffer.from('alice:ep-pw-239-x').toString('base64')}`
    expect(checkAuth({ config: effective, headers: { authorization: header }, query: {} }).ok).toBe(
      true,
    )
  })

  it('an undecryptable credential reads as "" (fail-closed) and survives an unrelated edit', async () => {
    const f = fixture()
    const id = await createMock(f, 'Locked', 4702)
    await invoke('mock:server:update', id, { authConfig: cases[0].auth })
    const sealed = rawAuth(id)

    keychain.key = 'machine-key-RESET'
    const view = await invoke<Row>('mock:server:get', id)
    expect(view.data!.authConfig).toEqual({ type: 'bearer', tokens: [''] })
    expect(view.data!.authDecryptFailed).toBe(true)
    const def = buildServerDef(id)!
    expect(
      checkAuth({ config: def.auth, headers: { authorization: 'Bearer ' }, query: {} }).ok,
    ).toBe(false)
    // The editor sends back what it shows, with another field changed.
    await invoke('mock:server:update', id, {
      name: 'Locked (renamed)',
      authConfig: view.data!.authConfig,
    })
    expect(rawAuth(id)).toBe(sealed)

    keychain.key = 'machine-key-1'
    expect((await invoke<Row>('mock:server:get', id)).data!.authConfig).toEqual(cases[0].auth)
  })

  it('Mock MCP bearer token: sealed in the row, plaintext in the config the server starts from', () => {
    const f = fixture()
    const cfg = createMockMcpServer({
      projectId: f.projectId,
      name: 'MCP',
      port: 4800,
      authMode: 'bearer',
      bearerToken: 'mcp-bearer-239-token',
    })
    expect(cfg.bearerToken).toBe('mcp-bearer-239-token')
    const raw = (
      testDb.prepare('SELECT bearer_token FROM mock_mcp_servers WHERE id = ?').get(cfg.id) as Row
    ).bearer_token as string
    expect(raw).toMatch(ENC)
    expect(getMockMcpServer(cfg.id)!.bearerToken).toBe('mcp-bearer-239-token')

    // Locked token + an unrelated edit keeps the stored ciphertext.
    keychain.key = 'machine-key-RESET'
    const locked = getMockMcpServer(cfg.id)!
    expect(locked).toMatchObject({ bearerToken: '', bearerTokenDecryptFailed: true })
    updateMockMcpServer(cfg.id, { name: 'MCP renamed' })
    expect(
      (testDb.prepare('SELECT bearer_token FROM mock_mcp_servers WHERE id = ?').get(cfg.id) as Row)
        .bearer_token,
    ).toBe(raw)
    keychain.key = 'machine-key-1'
    expect(getMockMcpServer(cfg.id)!.bearerToken).toBe('mcp-bearer-239-token')
  })
})

// ─── Files, import, duplicate ────────────────────────────────────

async function seedSecretsProject(): Promise<
  Fixture & { varId: string; mockId: string; mcpId: string }
> {
  const f = fixture()
  const v = await createSecretVar(f)
  await invoke('globalVariable:create', {
    workspace_id: f.workspaceId,
    project_id: f.projectId,
    key: 'gkey',
    value: GLOBAL_SECRET,
    secret: true,
  })
  const mockId = await createMock(f, 'Auth API', 4900)
  await invoke('mock:server:update', mockId, {
    authConfig: { type: 'bearer', tokens: ['mock-bearer-239-aaaa'] },
    // The old "Auth required" preset wrote the token into the description.
    description: 'Requests need "Authorization: Bearer mock-bearer-239-aaaa".',
  })
  const mcp = createMockMcpServer({
    projectId: f.projectId,
    name: 'MCP',
    port: 4901,
    authMode: 'bearer',
    bearerToken: 'mcp-bearer-239-token',
  })
  return { ...f, varId: v.id as string, mockId, mcpId: mcp.id }
}

const CANARIES = [
  SECRET,
  SECRET_INIT,
  GLOBAL_SECRET,
  'mock-bearer-239-aaaa',
  'mcp-bearer-239-token',
]

describe('no ciphertext and no secret reaches a file; import / duplicate keep the local values', () => {
  it('the file form (stripLocalSecrets ∘ exportProjectData) holds neither enc:v1: nor a secret', async () => {
    const s = await seedSecretsProject()
    // The DB dump itself is faithful (Duplicate relies on it) — ciphertext.
    expect(JSON.stringify(exportProjectData(s.projectId))).toMatch(/enc:v1:/)
    const text = JSON.stringify(stripLocalSecrets(exportProjectData(s.projectId)))
    expect(text).not.toMatch(/enc:v1:/)
    for (const c of CANARIES) expect(text, c).not.toContain(c)
    // The description scrub decrypts its needles: the token is masked there.
    const doc = JSON.parse(text) as { mockServers: Row[] }
    expect(doc.mockServers[0].description).toContain(HISTORY_MASK)
    // sameExport compares the stripped form: no spurious Auto-save commit.
    expect(sameExport(text, exportProjectData(s.projectId) as unknown as Row)).toBe(true)
  })

  it('Save to folder (save:local): the file on disk holds neither enc:v1: nor a secret', async () => {
    const s = await seedSecretsProject()
    const dir = mkdtempSync(join(tmpdir(), 'tnz-239-'))
    try {
      const res = await invoke<{ path: string }>('save:local', {
        projectId: s.projectId,
        directoryPath: dir,
      })
      expect(res.error).toBeUndefined()
      const text = readFileSync(res.data!.path, 'utf-8')
      expect(text).not.toMatch(/enc:v1:/)
      for (const c of CANARIES) expect(text, c).not.toContain(c)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Postman collection export: a locked value on a row no longer marked secret exports ""', async () => {
    const s = await seedSecretsProject()
    keychain.key = 'machine-key-RESET'
    await invoke('envVariable:update', s.varId, { secret: false })
    const json = exportAsPostman(s.projectId)
    expect(json).not.toMatch(/enc:v1:/)
    keychain.key = 'machine-key-1'
    expect(exportAsPostman(s.projectId)).not.toContain(SECRET)
  })

  it('a variable whose secret flag was cleared while undecryptable exports "" — never ciphertext', async () => {
    const s = await seedSecretsProject()
    keychain.key = 'machine-key-RESET'
    await invoke('envVariable:update', s.varId, { secret: false })
    expect(rawVar('environment_variables', s.varId)).toMatchObject({ secret: 0 })
    expect(String(rawVar('environment_variables', s.varId).value)).toMatch(ENC)
    const text = JSON.stringify(stripLocalSecrets(exportProjectData(s.projectId)))
    expect(text).not.toMatch(/enc:v1:/)
  })

  for (const mode of ['merge', 'replace'] as const) {
    it(`${mode}: a stripped file keeps this machine's sealed values (keepLocal)`, async () => {
      const s = await seedSecretsProject()
      const text = JSON.stringify(stripLocalSecrets(exportProjectData(s.projectId)))
      await importProjectDataFromJson(text, s.projectId, { mode })
      const raw = rawVar('environment_variables', s.varId)
      expect(raw.value).toMatch(ENC)
      expect(loadEnvVars({ projectId: s.projectId }).token).toBe(SECRET)
      expect(getMockMcpServer(s.mcpId)!.bearerToken).toBe('mcp-bearer-239-token')
      const def = buildServerDef(s.mockId)!
      expect(
        checkAuth({
          config: def.auth,
          headers: { authorization: 'Bearer mock-bearer-239-aaaa' },
          query: {},
        }).ok,
      ).toBe(true)
    })
  }

  it('an old file carrying a plaintext secret is sealed on import', async () => {
    const s = await seedSecretsProject()
    const legacy = JSON.parse(JSON.stringify(exportProjectData(s.projectId))) as {
      environmentVariables: Row[]
      mockMcpServers: Row[]
    }
    legacy.environmentVariables.find((r) => r.id === s.varId)!.value = 'legacy-plain-239-value'
    legacy.mockMcpServers[0].bearer_token = 'legacy-mcp-239-token'
    await importProjectDataFromJson(JSON.stringify(legacy), s.projectId)
    expect(String(rawVar('environment_variables', s.varId).value)).toMatch(ENC)
    expect(loadEnvVars({ projectId: s.projectId }).token).toBe('legacy-plain-239-value')
    const raw = (
      testDb.prepare('SELECT bearer_token FROM mock_mcp_servers WHERE id = ?').get(s.mcpId) as Row
    ).bearer_token
    expect(String(raw)).toMatch(ENC)
    expect(getMockMcpServer(s.mcpId)!.bearerToken).toBe('legacy-mcp-239-token')
  })

  it('project:duplicate copies the ciphertext and the copy decrypts', async () => {
    const s = await seedSecretsProject()
    const dup = await invoke<{ projectId: string }>('project:duplicate', {
      projectId: s.projectId,
      workspaceId: s.workspaceId,
    })
    expect(dup.error).toBeUndefined()
    const copy = dup.data!.projectId
    const envId = (
      testDb.prepare('SELECT id FROM environments WHERE project_id = ?').get(copy) as Row
    ).id as string
    const raw = testDb
      .prepare('SELECT value FROM environment_variables WHERE environment_id = ?')
      .get(envId) as Row
    expect(String(raw.value)).toMatch(ENC)
    const list = await invoke<Row[]>('envVariable:list', envId)
    expect(list.data![0]).toMatchObject({ value: SECRET, initial_value: SECRET_INIT })
    const g = await invoke<Row[]>('globalVariable:listByProject', copy)
    expect(g.data![0]).toMatchObject({ value: GLOBAL_SECRET })
  })

  it('Postman environment import: a `secret` value is sealed', async () => {
    const f = fixture()
    const res = await importPostmanEnvironment(f.projectId, {
      name: 'Postman Env',
      values: [
        { key: 'apiKey', value: 'postman-secret-239-v', type: 'secret', enabled: true },
        { key: 'host', value: 'https://h.example', type: 'default', enabled: true },
      ],
    } as Parameters<typeof importPostmanEnvironment>[1])
    expect(res.success).toBe(true)
    const rows = testDb
      .prepare('SELECT key, value FROM environment_variables WHERE environment_id = ?')
      .all(res.environmentId) as Row[]
    const byKey = new Map(rows.map((r) => [r.key, r.value]))
    expect(String(byKey.get('apiKey'))).toMatch(ENC)
    expect(byKey.get('host')).toBe('https://h.example')
  })
})

// ─── One-time migration ──────────────────────────────────────────

function seedLegacyPlaintext(f: Fixture): {
  secretVar: string
  plainVar: string
  mockId: string
  mcpId: string
} {
  const now = Date.now()
  const secretVar = randomUUID()
  const plainVar = randomUUID()
  const ins = testDb.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  )
  ins.run(secretVar, f.envId, 'token', SECRET, 1, SECRET_INIT)
  ins.run(plainVar, f.envId, 'host', 'https://plain.example', 0, 'https://plain.example')
  testDb
    .prepare(
      `INSERT INTO global_variables (id, workspace_id, project_id, key, value, enabled, secret, initial_value)
       VALUES (?, ?, ?, 'gkey', ?, 1, 1, '')`,
    )
    .run(randomUUID(), f.workspaceId, f.projectId, GLOBAL_SECRET)
  const mockId = randomUUID()
  testDb
    .prepare(
      `INSERT INTO mock_servers (id, project_id, name, port, auth_config, created_at, updated_at)
       VALUES (?, ?, 'Legacy', 4950, ?, ?, ?)`,
    )
    .run(
      mockId,
      f.projectId,
      JSON.stringify({ type: 'bearer', tokens: ['mock-bearer-239-aaaa'] }),
      now,
      now,
    )
  const mcpId = randomUUID()
  testDb
    .prepare(
      `INSERT INTO mock_mcp_servers (id, project_id, name, port, auth_mode, bearer_token, created_at, updated_at)
       VALUES (?, ?, 'Legacy MCP', 4951, 'bearer', 'mcp-bearer-239-token', ?, ?)`,
    )
    .run(mcpId, f.projectId, now, now)
  return { secretVar, plainVar, mockId, mcpId }
}

const noWait = { startAfter: async () => {}, yieldBetweenBatches: async () => {}, log: () => {} }

function rawSecretsSnapshot(): string {
  return JSON.stringify([
    testDb.prepare('SELECT value, initial_value FROM environment_variables ORDER BY id').all(),
    testDb.prepare('SELECT value, initial_value FROM global_variables ORDER BY id').all(),
    testDb.prepare('SELECT auth_config FROM mock_servers ORDER BY id').all(),
    testDb.prepare('SELECT bearer_token FROM mock_mcp_servers ORDER BY id').all(),
  ])
}

const marker = (): unknown =>
  testDb.prepare('SELECT value FROM settings WHERE key = ?').get(SECRET_AT_REST_MIGRATION_KEY)

describe('migration: legacy plaintext rows are sealed once, idempotently', () => {
  it('seals secret values, keeps plain ones, VACUUMs once and writes the marker', async () => {
    const f = fixture()
    const ids = seedLegacyPlaintext(f)
    const res = await runSecretAtRestMigration(testDb, { ...noWait, batchSize: 1 })
    expect(res).toMatchObject({ ran: true, vacuumed: true, skipped: 0 })
    expect(res.sealed).toBe(4)
    expect(marker()).toBeDefined()

    const snap = rawSecretsSnapshot()
    for (const c of CANARIES) expect(snap, c).not.toContain(c)
    expect(rawVar('environment_variables', ids.plainVar).value).toBe('https://plain.example')
    expect(loadEnvVars({ workspaceId: f.workspaceId, projectId: f.projectId })).toMatchObject({
      token: SECRET,
      gkey: GLOBAL_SECRET,
      host: 'https://plain.example',
    })
    expect(getMockMcpServer(ids.mcpId)!.bearerToken).toBe('mcp-bearer-239-token')
    expect(
      checkAuth({
        config: buildServerDef(ids.mockId)!.auth,
        headers: { authorization: 'Bearer mock-bearer-239-aaaa' },
        query: {},
      }).ok,
    ).toBe(true)

    // History masking keeps matching after the migration (#238 class).
    invalidateSecretInventory()
    const h = addHistory({
      protocol: 'http',
      url: `https://x.example/?k=${SECRET}`,
      request_snapshot: '{}',
    })
    expect(
      String((testDb.prepare('SELECT url FROM history WHERE id = ?').get(h.id) as Row).url),
    ).not.toContain(SECRET)

    // Idempotent: a second run changes nothing and does not VACUUM again.
    const again = await runSecretAtRestMigration(testDb, noWait)
    expect(again).toMatchObject({ ran: true, vacuumed: false, sealed: 0 })
    expect(rawSecretsSnapshot()).toBe(snap)
  })

  it('keychain unavailable: nothing is touched and the marker is NOT written; it runs later', async () => {
    const f = fixture()
    seedLegacyPlaintext(f)
    keychain.available = false
    const before = rawSecretsSnapshot()
    const res = await runSecretAtRestMigration(testDb, noWait)
    expect(res.ran).toBe(false)
    expect(rawSecretsSnapshot()).toBe(before)
    expect(marker()).toBeUndefined()

    keychain.available = true
    const later = await runSecretAtRestMigration(testDb, noWait)
    expect(later).toMatchObject({ ran: true, vacuumed: true })
    expect(rawSecretsSnapshot()).not.toContain(SECRET)
    expect(marker()).toBeDefined()
  })

  it('a value written in plaintext while the keychain was off is sealed by the next launch', async () => {
    const f = fixture()
    await runSecretAtRestMigration(testDb, noWait) // marker written on an empty DB
    keychain.available = false
    const v = await createSecretVar(f)
    expect(rawVar('environment_variables', v.id as string).value).toBe(SECRET)
    keychain.available = true
    const res = await runSecretAtRestMigration(testDb, noWait)
    expect(res.sealed).toBe(1)
    expect(String(rawVar('environment_variables', v.id as string).value)).toMatch(ENC)
  })
})
