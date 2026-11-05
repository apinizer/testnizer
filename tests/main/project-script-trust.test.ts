/**
 * The script trust state and its prompt (`lib/project-script-trust.ts`,
 * `ipc/project-trust.handler.ts`), and the walker that finds a project's scripts
 * (`lib/project-scripts.ts`). Real handlers on the real migrated schema; only the
 * native dialog is stubbed, which is the one thing no test can click.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock, makeFakeEvent } from './handlers/helpers'

const harness = setupHandlerHarness()
const dialogMock = vi.hoisted(() => ({
  answer: 1,
  calls: [] as Array<{
    title: string
    message: string
    detail: string
    buttons: string[]
    defaultId: number
    cancelId: number
  }>,
  hold: null as Promise<void> | null,
  fail: false,
}))

vi.mock('electron', () => ({
  ...makeElectronMock(),
  dialog: {
    showMessageBox: async (...args: unknown[]) => {
      dialogMock.calls.push(args[args.length - 1] as (typeof dialogMock.calls)[number])
      if (dialogMock.fail) throw new Error('no display')
      if (dialogMock.hold) await dialogMock.hold
      return { response: dialogMock.answer }
    },
  },
}))

let db: Database.Database
const realDb = await vi.importActual<typeof import('../../src/main/db/database')>(
  '../../src/main/db/database',
)
vi.mock('../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../src/main/db/database')>()),
  getDb: () => db,
}))

const storeState = vi.hoisted(() => ({ data: {} as Record<string, unknown>, writes: 0 }))
class FakeStore {
  get(key: string): unknown {
    return storeState.data[key]
  }
  set(key: string, value: unknown): void {
    storeState.writes++
    storeState.data[key] = value
  }
  clear(): void {
    storeState.data = {}
  }
  get store(): Record<string, unknown> {
    return storeState.data
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const trust = await import('../../src/main/lib/project-script-trust')
const { collectProjectScripts, scriptFingerprints, SCRIPT_TEXT_COLUMNS, SCRIPT_JSON_COLUMNS } =
  await import('../../src/main/lib/project-scripts')
const { EXPORTED_TABLES } = await import('../../src/main/lib/project-tables')
const { scriptTrustPrompt, registerProjectTrustHandlers } =
  await import('../../src/main/ipc/project-trust.handler')
const { registerSettingsHandlers } = await import('../../src/main/ipc/settings.handler')
const { registerProjectHandlers } = await import('../../src/main/ipc/project.handler')
const { registerSaveHandlers, exportProjectData } = await import('../../src/main/ipc/save.handler')

const KEY = trust.PROJECT_SCRIPT_BLOCKS_STORE_KEY
const CANARY = "console.log('script-trust-canary')"

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}
interface EnsureData {
  allowed: boolean
  blocked: boolean
  scriptCount: number
}
const ensure = (id: string, ...rest: unknown[]) =>
  harness.handlers.get('projectTrust:ensure')!(makeFakeEvent(), id, ...rest) as Promise<
    Envelope<EnsureData>
  >

let workspaceId = ''
function newProject(
  extra: { name?: string; display?: string; sharedSettings?: string } = {},
): string {
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, display_name, type, sort_order, created_at, updated_at, shared_settings)
     VALUES (?, ?, ?, ?, 'http', 0, ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    extra.name ?? `p-${id}`,
    extra.display ?? null,
    now,
    now,
    extra.sharedSettings ?? null,
  )
  return id
}
function addFolderWithScript(projectId: string, script = CANARY): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order, pre_script) VALUES (?, ?, NULL, 'F', 0, ?)`,
  ).run(id, projectId, script)
  return id
}

beforeEach(() => {
  harness.reset()
  storeState.data = {}
  storeState.writes = 0
  dialogMock.answer = 1
  dialogMock.calls = []
  dialogMock.hold = null
  dialogMock.fail = false
  trust.setProjectScriptTrustStoreForTests(undefined)
  db = realDb.openAndMigrate(':memory:')
  workspaceId = randomUUID()
  db.prepare(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'W', 1, 1)`).run(
    workspaceId,
  )
  registerProjectTrustHandlers()
  registerSettingsHandlers()
  registerProjectHandlers()
  registerSaveHandlers()
})
afterEach(() => db.close())

describe('state', () => {
  it('absence means allowed, so a project nobody marked needs nothing', async () => {
    expect(await trust.isProjectScriptsBlocked('never-seen')).toBe(false)
    expect(storeState.writes).toBe(0)
  })

  it('a block survives a restart; Allow does too', async () => {
    await trust.blockProjectScripts('a')
    await trust.blockProjectScripts('b')
    expect(storeState.data[KEY]).toEqual(['a', 'b'])

    trust.setProjectScriptTrustStoreForTests(undefined) // a new process reads the file
    expect(await trust.isProjectScriptsBlocked('a')).toBe(true)

    await trust.allowProjectScripts('a')
    trust.setProjectScriptTrustStoreForTests(undefined)
    expect(await trust.isProjectScriptsBlocked('a')).toBe(false)
    expect(await trust.isProjectScriptsBlocked('b')).toBe(true)
  })

  it('the block is in memory before the call yields (imports write rows in the same tick)', async () => {
    await trust.ensureLoaded()
    void trust.blockProjectScripts('sync')
    expect(storeState.data[KEY]).toEqual(['sync'])
  })

  it('a store that will not load: memory holds the session, and nothing is written over the file', async () => {
    const set = vi.fn()
    trust.setProjectScriptTrustStoreForTests({
      get: () => {
        throw new Error('corrupt')
      },
      set,
    })
    await trust.blockProjectScripts('p')
    expect(await trust.isProjectScriptsBlocked('p')).toBe(true)
    expect(set).not.toHaveBeenCalled()

    trust.setProjectScriptTrustStoreForTests(null) // no store at all
    await trust.blockProjectScripts('q')
    expect(await trust.isProjectScriptsBlocked('q')).toBe(true)
  })

  it('a failed store write: the session still sees the new state, both ways', async () => {
    const data: string[] = ['listed']
    let writable = true
    trust.setProjectScriptTrustStoreForTests({
      get: () => data,
      set: () => {
        if (!writable) throw new Error('disk full')
      },
    })
    expect(await trust.isProjectScriptsBlocked('listed')).toBe(true)
    writable = false
    await trust.allowProjectScripts('listed')
    expect(await trust.isProjectScriptsBlocked('listed')).toBe(false)
    await trust.blockProjectScripts('new')
    expect(await trust.isProjectScriptsBlocked('new')).toBe(true)
  })

  it('a project that is reread many times reads the store once (the mock check is per request)', async () => {
    let reads = 0
    trust.setProjectScriptTrustStoreForTests({
      get: () => {
        reads++
        return []
      },
      set: () => {},
    })
    for (let i = 0; i < 5; i++) await trust.isProjectScriptsBlocked('p')
    expect(reads).toBe(1)
  })
})

describe('the renderer cannot write the state', () => {
  it('settings:set refuses the key and a dotted path into it', async () => {
    await trust.blockProjectScripts('p')
    const invoke = harness.invoke as (c: string, ...a: unknown[]) => Promise<Envelope<unknown>>
    expect((await invoke('settings:set', KEY, [])).success).toBe(false)
    expect((await invoke('settings:set', `${KEY}.0`, 'x')).success).toBe(false)
    expect(storeState.data[KEY]).toEqual(['p'])
    // A sibling whose name only starts the same way is a normal setting.
    expect((await invoke('settings:set', `${KEY}Extra`, 1)).success).toBe(true)
  })

  it('settings:setAll refuses it too', async () => {
    await trust.blockProjectScripts('p')
    const r = (await harness.invoke('settings:setAll', { [KEY]: [] })) as Envelope<unknown>
    expect(r.success).toBe(false)
    expect(storeState.data[KEY]).toEqual(['p'])
  })

  it('settings:reset keeps the list', async () => {
    await trust.blockProjectScripts('p')
    storeState.data.other = 1
    await harness.invoke('settings:reset')
    expect(storeState.data.other).toBeUndefined()
    expect(storeState.data[KEY]).toEqual(['p'])
  })

  it('projectTrust:block is the safe direction', async () => {
    const p = newProject()
    const r = (await harness.invoke('projectTrust:block', p)) as Envelope<boolean>
    expect(r.success).toBe(true)
    expect(await trust.isProjectScriptsBlocked(p)).toBe(true)
  })

  it('no argument of ensure can answer for the user', async () => {
    const p = newProject()
    addFolderWithScript(p)
    await trust.blockProjectScripts(p)
    const r = await ensure(p, { hasScript: true, allowed: true, response: 0, answer: 'allow' })
    expect(r.data?.allowed).toBe(false)
    expect(dialogMock.calls).toHaveLength(1)
    expect(await trust.isProjectScriptsBlocked(p)).toBe(true)
  })
})

describe('projectTrust:ensure', () => {
  it('not blocked: allowed, no dialog', async () => {
    const p = newProject()
    addFolderWithScript(p)
    expect((await ensure(p)).data).toMatchObject({ allowed: true, blocked: false })
    expect(dialogMock.calls).toHaveLength(0)
  })

  it('blocked without a script: allowed, no dialog, still blocked', async () => {
    const p = newProject()
    await trust.blockProjectScripts(p)
    expect((await ensure(p)).data).toEqual({ allowed: true, blocked: true, scriptCount: 0 })
    expect(dialogMock.calls).toHaveLength(0)
    expect(await trust.isProjectScriptsBlocked(p)).toBe(true)
  })

  it('whitespace-only scripts are no scripts', async () => {
    const p = newProject()
    addFolderWithScript(p, '  \n\t ')
    await trust.blockProjectScripts(p)
    expect((await ensure(p)).data?.allowed).toBe(true)
    expect(dialogMock.calls).toHaveLength(0)
  })

  it('blocked with a script: "Not now" keeps it blocked and says not allowed', async () => {
    const p = newProject()
    addFolderWithScript(p)
    await trust.blockProjectScripts(p)
    const r = await ensure(p)
    expect(r.data).toEqual({ allowed: false, blocked: true, scriptCount: 1 })
    expect(await trust.isProjectScriptsBlocked(p)).toBe(true)
  })

  it('the click on Allow clears it, and the next call does not ask', async () => {
    const p = newProject()
    addFolderWithScript(p)
    await trust.blockProjectScripts(p)
    dialogMock.answer = 0
    expect((await ensure(p)).data).toEqual({ allowed: true, blocked: false, scriptCount: 1 })
    expect(await trust.isProjectScriptsBlocked(p)).toBe(false)
    await ensure(p)
    expect(dialogMock.calls).toHaveLength(1)
  })

  it('hasScript asks even with no saved script (a run hook typed but not saved)', async () => {
    const p = newProject()
    await trust.blockProjectScripts(p)
    expect((await ensure(p, { hasScript: true })).data?.allowed).toBe(false)
    expect(dialogMock.calls).toHaveLength(1)
    expect(dialogMock.calls[0].detail).toContain('no saved script')
    // hasScript cannot allow anything: the block is still there.
    expect(await trust.isProjectScriptsBlocked(p)).toBe(true)
  })

  it('concurrent calls for one project share one dialog', async () => {
    const p = newProject()
    addFolderWithScript(p)
    await trust.blockProjectScripts(p)
    let release = (): void => {}
    dialogMock.hold = new Promise<void>((r) => (release = r))
    dialogMock.answer = 0
    const calls = [ensure(p), ensure(p), ensure(p, { hasScript: true })]
    await vi.waitFor(() => expect(dialogMock.calls.length).toBeGreaterThan(0))
    release()
    const results = await Promise.all(calls)
    expect(dialogMock.calls).toHaveLength(1)
    expect(results.every((r) => r.data?.allowed)).toBe(true)
    // The next question gets its own dialog.
    await trust.blockProjectScripts(p)
    dialogMock.answer = 1
    await ensure(p)
    expect(dialogMock.calls).toHaveLength(2)
  })

  it('two projects get a dialog each', async () => {
    const [a, b] = [newProject(), newProject()]
    addFolderWithScript(a)
    addFolderWithScript(b)
    await trust.blockProjectScripts(a)
    await trust.blockProjectScripts(b)
    await Promise.all([ensure(a), ensure(b)])
    expect(dialogMock.calls).toHaveLength(2)
  })

  it('a dialog that fails is not an Allow', async () => {
    const p = newProject()
    addFolderWithScript(p)
    await trust.blockProjectScripts(p)
    dialogMock.fail = true
    const r = await ensure(p)
    expect(r.success).toBe(false)
    expect(await trust.isProjectScriptsBlocked(p)).toBe(true)
  })

  it('the dialog names the project and the count; Not now is default and cancel', async () => {
    const p = newProject({ name: 'internal', display: 'Shop API' })
    addFolderWithScript(p)
    addFolderWithScript(p)
    await trust.blockProjectScripts(p)
    await ensure(p)
    const shown = dialogMock.calls[0]
    expect(shown.message).toContain('Shop API')
    expect(shown.detail).toContain('2 scripts')
    expect(shown.buttons).toEqual(['Allow scripts on this computer', 'Not now'])
    expect(shown.defaultId).toBe(1)
    expect(shown.cancelId).toBe(1)
  })

  it('follows ui.locale', async () => {
    const p = newProject({ name: 'Mağaza' })
    addFolderWithScript(p)
    await trust.blockProjectScripts(p)
    storeState.data['ui.locale'] = 'tr'
    await ensure(p)
    expect(dialogMock.calls[0].buttons).toEqual([
      "Bu bilgisayarda script'lere izin ver",
      'Şimdi değil',
    ])
    expect(dialogMock.calls[0].message).toContain('Mağaza')
    expect(scriptTrustPrompt('en', 'P', 1).detail).toContain('1 script.')
  })
})

describe('project:duplicate and project:delete', () => {
  it('a copy of a blocked project is blocked', async () => {
    const p = newProject()
    addFolderWithScript(p)
    await trust.blockProjectScripts(p)
    const r = (await harness.invoke('project:duplicate', {
      projectId: p,
      workspaceId,
      name: 'Copy',
    })) as Envelope<{ projectId: string }>
    expect(r.success).toBe(true)
    expect(await trust.isProjectScriptsBlocked(r.data!.projectId)).toBe(true)
  })

  it('a copy of an allowed project is allowed', async () => {
    const p = newProject()
    addFolderWithScript(p)
    const r = (await harness.invoke('project:duplicate', {
      projectId: p,
      workspaceId,
      name: 'Copy',
    })) as Envelope<{ projectId: string }>
    expect(await trust.isProjectScriptsBlocked(r.data!.projectId)).toBe(false)
  })

  it('delete drops the entry', async () => {
    const p = newProject()
    await trust.blockProjectScripts(p)
    await harness.invoke('project:delete', p)
    expect(await trust.isProjectScriptsBlocked(p)).toBe(false)
    expect(storeState.data[KEY]).toEqual([])
  })

  it('never in the database or the exported file', async () => {
    const p = newProject()
    addFolderWithScript(p)
    await trust.blockProjectScripts(p)
    expect(JSON.stringify(exportProjectData(p))).not.toContain(KEY)
    const tables = db
      .prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL`)
      .all() as Array<{ sql: string }>
    expect(tables.some((t) => /blocked|script_trust/i.test(t.sql))).toBe(false)
  })
})

describe('withImportScriptCheck', () => {
  const run = (fp: { now: string[] }, next: string[]) => () => {
    fp.now = next
    return 'done'
  }

  it('no new script: the block comes off again', async () => {
    const fp = { now: ['x|1'] }
    await trust.withImportScriptCheck('p', () => fp.now, run(fp, ['x|1']))
    expect(await trust.isProjectScriptsBlocked('p')).toBe(false)
  })

  it('removing a script is not a new one', async () => {
    const fp = { now: ['x|1', 'y|2'] }
    await trust.withImportScriptCheck('p', () => fp.now, run(fp, ['x|1']))
    expect(await trust.isProjectScriptsBlocked('p')).toBe(false)
  })

  it('an added or a changed script keeps it', async () => {
    const fp = { now: ['x|1'] }
    await trust.withImportScriptCheck('added', () => fp.now, run(fp, ['x|1', 'y|2']))
    expect(await trust.isProjectScriptsBlocked('added')).toBe(true)
    const changed = { now: ['x|1'] }
    await trust.withImportScriptCheck('changed', () => changed.now, run(changed, ['x|2']))
    expect(await trust.isProjectScriptsBlocked('changed')).toBe(true)
  })

  it('it is blocked while the import runs', async () => {
    const fp = { now: [] as string[] }
    let during = false
    await trust.withImportScriptCheck(
      'p',
      () => fp.now,
      async () => {
        during = await trust.isProjectScriptsBlocked('p')
      },
    )
    expect(during).toBe(true)
    expect(await trust.isProjectScriptsBlocked('p')).toBe(false)
  })

  it('a project that was already blocked stays blocked', async () => {
    await trust.blockProjectScripts('p')
    await trust.withImportScriptCheck(
      'p',
      () => [],
      () => 1,
    )
    expect(await trust.isProjectScriptsBlocked('p')).toBe(true)
  })

  it('an import that throws leaves the state as it found it, and rethrows', async () => {
    await expect(
      trust.withImportScriptCheck(
        'p',
        () => [],
        () => {
          throw new Error('bad file')
        },
      ),
    ).rejects.toThrow('bad file')
    expect(await trust.isProjectScriptsBlocked('p')).toBe(false)
  })

  it('a digest that cannot be read stays blocked (the safe side)', async () => {
    let n = 0
    await trust.withImportScriptCheck(
      'p',
      () => {
        if (n++ > 0) throw new Error('db gone')
        return []
      },
      () => 1,
    )
    expect(await trust.isProjectScriptsBlocked('p')).toBe(true)
  })
})

describe('the walker reads every place a script lives', () => {
  const S = 'pm.environment.set("a", 1)'
  const schema = JSON.stringify({ preScript: S, postScript: S })
  const cases: Array<[string, Parameters<typeof collectProjectScripts>[0], number]> = [
    [
      'project shared settings',
      { project: { id: 'p', shared_settings: JSON.stringify({ preScript: S, testScript: S }) } },
      2,
    ],
    ['folders', { folders: [{ id: 'f', pre_script: S, post_script: S }] }, 2],
    ['suite folders', { testSuiteFolders: [{ id: 'f', pre_script: S, post_script: S }] }, 2],
    ['endpoint request_schema', { endpoints: [{ id: 'e', request_schema: schema }] }, 2],
    ['suite item request_schema', { testSuiteItems: [{ id: 'i', request_schema: schema }] }, 2],
    ['saved request columns', { savedRequests: [{ id: 's', pre_script: S, post_script: S }] }, 2],
    [
      'saved request metadata',
      { savedRequests: [{ id: 's', metadata: JSON.stringify({ mcp: { preScript: S } }) }] },
      1,
    ],
    [
      'MCP metadata inside a request_schema',
      { endpoints: [{ id: 'e', request_schema: JSON.stringify({ metadata: { postScript: S } }) }] },
      1,
    ],
    [
      'suite run hooks',
      {
        testSuites: [
          {
            id: 't',
            run_config: JSON.stringify({ runPreScript: S, runPostScript: S, runFailScript: S }),
          },
        ],
      },
      3,
    ],
    ['mock responses', { mockResponses: [{ id: 'm', script: S }] }, 1],
  ]
  it.each(cases)('%s', (_label, source, count) => {
    expect(collectProjectScripts(source)).toHaveLength(count)
  })

  it('whitespace-only, missing and unparsable values are no scripts', () => {
    expect(
      collectProjectScripts({
        project: { id: 'p', shared_settings: '{broken' },
        folders: [{ id: 'f', pre_script: '  \n', post_script: null }],
        endpoints: [{ id: 'e', request_schema: JSON.stringify({ preScript: ' ', postScript: 7 }) }],
        mockResponses: [{ id: 'm', script: '' }],
      }),
    ).toEqual([])
  })

  it('a fingerprint changes with the text and the place, and holds no script text', () => {
    const one = scriptFingerprints([{ location: 'a', source: S }])[0]
    expect(one).not.toContain(S)
    expect(scriptFingerprints([{ location: 'a', source: `${S} ` }])[0]).not.toBe(one)
    expect(scriptFingerprints([{ location: 'b', source: S }])[0]).not.toBe(one)
  })

  it('finds them in a real export, from the real schema', () => {
    const p = newProject({ sharedSettings: JSON.stringify({ preScript: S }) })
    addFolderWithScript(p, S)
    db.prepare(
      `INSERT INTO endpoints (id, project_id, name, protocol, method, path, request_schema, created_at, updated_at)
       VALUES ('e1', ?, 'E', 'http', 'GET', '/x', ?, 1, 1)`,
    ).run(p, schema)
    db.prepare(
      `INSERT INTO saved_requests (id, project_id, name, protocol, method, url, pre_script, created_at, updated_at)
       VALUES ('s1', ?, 'S', 'http', 'GET', '/x', ?, 1, 1)`,
    ).run(p, S)
    expect(collectProjectScripts(exportProjectData(p))).toHaveLength(5)
  })

  /**
   * The guard: a new column that can hold a script must be classified. A script
   * column the walker misses would let `ensure` say "no scripts" while a runtime
   * evaluates one. Every exported column is read from the real schema, so adding
   * one fails here until it is walked or listed below with its reason.
   */
  const WALKED = new Map<string, Set<string>>()
  for (const [t, cols] of [
    ...Object.entries(SCRIPT_TEXT_COLUMNS),
    ...Object.entries(SCRIPT_JSON_COLUMNS),
  ]) {
    const set = WALKED.get(t) ?? new Set<string>()
    cols.forEach((c) => set.add(c))
    WALKED.set(t, set)
  }
  const SCRIPT_FREE: Record<string, string> = {
    'endpoints.response_schemas': 'response documentation, never run',
    'endpoint_cases.assertions': 'rows read by the assertion evaluators; nothing compiles them',
    'saved_requests.assertions': 'rows read by the assertion evaluators; nothing compiles them',
    'test_suite_items.assertions': 'rows read by the assertion evaluators; nothing compiles them',
    'mock_responses.stream_config': 'response data',
    'mock_mcp_servers.tools_json': 'names, schemas and fixed results; mock-mcp has no script',
    'mock_mcp_servers.resources_json': 'data; mock-mcp has no script',
    'mock_mcp_servers.prompts_json': 'data; mock-mcp has no script',
    'mock_mcp_servers.options_json': 'server options',
    'saved_responses.response_json': 'a recorded response, never run',
    'saved_responses.request_json': 'a recorded request, never run',
    'mock_servers.failure_config': 'response data',
    'mock_servers.rate_limit_config': 'numbers',
    'mock_servers.auth_config': 'credentials',
    'mock_endpoints.schema_validation': 'a JSON schema; ajv compiles it, no user code runs',
    'mock_responses.condition': 'matched by mock/condition.ts, not run as a script',
  }
  // "description" contains "script", so the name has to start a word.
  const SCRIPT_NAME = /(^|_)script/i
  const SUSPICIOUS = /(^|_)script|schema|metadata|config|_json$|assertion|condition|settings/i
  const columnsOf = (table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
  const EVERY_TABLE = ['projects', ...EXPORTED_TABLES]

  it('every exported column that could hold a script is walked or stated script-free', () => {
    const unknown: string[] = []
    for (const table of EVERY_TABLE) {
      for (const name of columnsOf(table)) {
        if (!SUSPICIOUS.test(name)) continue
        if (WALKED.get(table)?.has(name)) continue
        if (`${table}.${name}` in SCRIPT_FREE) continue
        unknown.push(`${table}.${name}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('a column named like a script is always walked, never just stated', () => {
    for (const table of EVERY_TABLE) {
      for (const name of columnsOf(table).filter((c) => SCRIPT_NAME.test(c))) {
        expect(WALKED.get(table)?.has(name), `${table}.${name}`).toBe(true)
      }
    }
  })

  it('both lists name real columns, so neither can go stale unnoticed', () => {
    for (const [table, cols] of WALKED) {
      for (const c of cols) expect(columnsOf(table), `${table}.${c}`).toContain(c)
    }
    for (const entry of Object.keys(SCRIPT_FREE)) {
      const [table, col] = entry.split('.')
      expect(columnsOf(table), entry).toContain(col)
    }
  })
})
