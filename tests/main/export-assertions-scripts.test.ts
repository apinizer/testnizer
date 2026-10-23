/**
 * Issue #270 — what runs on Send/Run must run after a Postman / Insomnia export.
 *
 * (a) Tests-tab rows of an endpoint, a Ctrl+S-saved request and a suite item
 *     reach the exported test script as generated pm.test / insomnia.test code
 *     (Postman/Newman ignore x-apinizer), ahead of the user's own script.
 * (b) Project folders export their auth + pre/post scripts (suite folders did).
 * (c) Project pre/test scripts become collection-level `event`; a Postman
 *     import fills an empty project script from it and never overwrites one.
 * Round trip: re-importing our Postman file restores the x-apinizer kinds as
 * rows and keeps only the other generated tests as script — nothing runs twice.
 *
 * Real schema (`initDatabase`) in a temp userData dir; the IPC handlers the
 * renderer calls are exercised.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-export-270-'))

type Handler = (event: unknown, ...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => tmpDir },
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      ipcHandlers.set(channel, fn)
    },
  },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

vi.mock('../../src/main/protocols/grpc.engine', () => ({
  loadProto: () => Promise.resolve({}),
}))

import { initDatabase, getDb } from '../../src/main/db/database'
import { createSavedRequest } from '../../src/main/db/endpoint.repo'
import {
  registerImportExportHandlers,
  buildPostmanSuiteExport,
  buildInsomniaSuiteExport,
} from '../../src/main/ipc/import-export.handler'
import {
  readSharedProjectSettings,
  writeSharedProjectSettings,
} from '../../src/main/lib/project-settings'
import { ASSERTION_BLOCK_BEGIN } from '../../src/shared/assertions-to-script'

interface PmEvent {
  listen: string
  script: { exec: string[] }
}
interface PmItem {
  name: string
  item?: PmItem[]
  event?: PmEvent[]
  auth?: { type: string }
}
interface PmCollection {
  item: PmItem[]
  event?: PmEvent[]
}
interface InsoResource {
  _type: string
  name?: string
  afterResponseScript?: string
  preRequestScript?: string
  authentication?: { type: string }
}

const ROWS = [
  { id: 'r1', name: 'Status is 200', type: 'status_equals', enabled: true, expected: 200 },
  { id: 'r2', name: 'Has trace', type: 'header_exists', enabled: true, headerName: 'X-Trace' },
  {
    id: 'r3',
    name: 'Name is Ada',
    type: 'body_jsonpath',
    enabled: true,
    jsonPath: '$.name',
    expected: 'Ada',
  },
  // Disabled: not in the generated script. (A header kind on purpose —
  // x-apinizer carries disabled mappable rows as active ones; out of scope here.)
  {
    id: 'r4',
    name: 'Off row',
    type: 'header_contains',
    enabled: false,
    headerName: 'X',
    expected: 'z',
  },
]
const USER_POST = "pm.test('user script', () => pm.expect(1).to.equal(1))"

let workspaceId: string
let projectId: string
let folderId: string

beforeAll(() => {
  initDatabase()
  registerImportExportHandlers()
})

function newProject(name: string): string {
  const now = Date.now()
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'http', 0, ?, ?)`,
    )
    .run(id, workspaceId, name, now, now)
  return id
}

function testScript(events: PmEvent[] | undefined): string {
  return (events ?? []).find((e) => e.listen === 'test')?.script.exec.join('\n') ?? ''
}

async function ipc<T>(channel: string, arg: unknown): Promise<T> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  const res = (await handler({}, arg)) as { success: boolean; data?: T; error?: string }
  expect(res.error).toBeUndefined()
  expect(res.success).toBe(true)
  return res.data as T
}

beforeEach(() => {
  const db = getDb()
  const now = Date.now()
  workspaceId = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  projectId = newProject('Export 270')
  folderId = randomUUID()
  db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth, pre_script, post_script)
     VALUES (?, ?, NULL, 'Users', 0, ?, ?, ?)`,
  ).run(
    folderId,
    projectId,
    JSON.stringify({ type: 'bearer', bearer: { token: '{{token}}' } }),
    "pm.variables.set('folderPre', '1')",
    "pm.test('folder post', () => {})",
  )
  db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 'Get user', NULL, 'http', 'GET', '/users/1', 'developing', ?, NULL, 0, ?, ?)`,
  ).run(
    randomUUID(),
    projectId,
    folderId,
    JSON.stringify({
      url: 'https://api.example.com/users/1',
      method: 'GET',
      postScript: USER_POST,
      assertions: ROWS,
    }),
    now,
    now,
  )
  createSavedRequest({
    project_id: projectId,
    folder_id: folderId,
    name: 'Saved user',
    protocol: 'http',
    method: 'GET',
    url: 'https://api.example.com/users/2',
    assertions: JSON.stringify([ROWS[1]]),
  })
  writeSharedProjectSettings(projectId, {
    preScript: "pm.variables.set('projectPre', '1')",
    testScript: "pm.test('project test', () => {})",
  })
})

describe('issue #270 — Postman project export', () => {
  it('writes Tests-tab rows as pm.test code before the user script (endpoint + saved request)', async () => {
    const col = JSON.parse(await ipc<string>('export:postman', projectId)) as PmCollection
    const folder = col.item.find((i) => i.name === 'Users')!
    const ep = folder.item!.find((i) => i.name === 'Get user')!
    const script = testScript(ep.event)
    expect(script.startsWith(ASSERTION_BLOCK_BEGIN)).toBe(true)
    expect(script).toContain('pm.test("Status is 200"')
    expect(script).toContain('pm.test("Has trace"')
    expect(script).toContain('pm.test("Name is Ada"')
    expect(script).not.toContain('Off row')
    expect(script.indexOf('pm.test("Name is Ada"')).toBeLessThan(script.indexOf(USER_POST))

    const saved = folder.item!.find((i) => i.name === 'Saved user')!
    expect(testScript(saved.event)).toContain('pm.test("Has trace"')
  })

  it('carries folder auth + pre/post scripts and project scripts as collection event', async () => {
    const col = JSON.parse(await ipc<string>('export:postman', projectId)) as PmCollection
    const folder = col.item.find((i) => i.name === 'Users')!
    expect(folder.auth?.type).toBe('bearer')
    expect(folder.event?.find((e) => e.listen === 'prerequest')?.script.exec.join('\n')).toBe(
      "pm.variables.set('folderPre', '1')",
    )
    expect(testScript(folder.event)).toBe("pm.test('folder post', () => {})")
    expect(col.event?.find((e) => e.listen === 'prerequest')?.script.exec.join('\n')).toBe(
      "pm.variables.set('projectPre', '1')",
    )
    expect(testScript(col.event)).toBe("pm.test('project test', () => {})")
  })

  it('re-import: x-apinizer kinds return as rows, the rest stay script — nothing twice', async () => {
    const content = await ipc<string>('export:postman', projectId)
    const target = newProject('Reimport 270')
    await ipc('import:postman', { projectId: target, content })
    const row = getDb()
      .prepare(`SELECT request_schema FROM endpoints WHERE project_id = ? AND name = 'Get user'`)
      .get(target) as { request_schema: string }
    const schema = JSON.parse(row.request_schema) as {
      postScript?: string
      assertions?: Array<{ type: string }>
    }
    expect((schema.assertions ?? []).map((a) => a.type).sort()).toEqual([
      'body_jsonpath',
      'status_equals',
    ])
    const post = schema.postScript ?? ''
    expect(post).not.toContain('pm.test("Status is 200"')
    expect(post).not.toContain('pm.test("Name is Ada"')
    expect(post).toContain('pm.test("Has trace"')
    expect(post).toContain(USER_POST)

    // No x-apinizer on the saved request (header row only) → block kept as script.
    const saved = getDb()
      .prepare(`SELECT request_schema FROM endpoints WHERE project_id = ? AND name = 'Saved user'`)
      .get(target) as { request_schema: string }
    const savedSchema = JSON.parse(saved.request_schema) as {
      postScript?: string
      assertions?: unknown[]
    }
    expect(savedSchema.assertions ?? []).toEqual([])
    expect(savedSchema.postScript).toContain('pm.test("Has trace"')

    // Collection event → the new project's own scripts.
    expect(readSharedProjectSettings(target)).toMatchObject({
      preScript: "pm.variables.set('projectPre', '1')",
      testScript: "pm.test('project test', () => {})",
    })
  })

  it('import never overwrites a project script that is already set', async () => {
    const content = await ipc<string>('export:postman', projectId)
    const target = newProject('Has scripts')
    writeSharedProjectSettings(target, { testScript: 'mine()' })
    const res = await ipc<{ warnings?: string[] }>('import:postman', { projectId: target, content })
    expect(readSharedProjectSettings(target)).toMatchObject({
      testScript: 'mine()',
      preScript: "pm.variables.set('projectPre', '1')",
    })
    expect(res.warnings?.some((w) => /collection-level test script was not imported/.test(w))).toBe(
      true,
    )
  })
})

describe('issue #270 — Insomnia project export', () => {
  it('writes rows as insomnia.test code and exports folder auth + scripts', async () => {
    const doc = JSON.parse(await ipc<string>('export:insomnia', projectId)) as {
      resources: InsoResource[]
    }
    const req = doc.resources.find((r) => r._type === 'request' && r.name === 'Get user')!
    expect(req.afterResponseScript?.startsWith(ASSERTION_BLOCK_BEGIN)).toBe(true)
    expect(req.afterResponseScript).toContain('insomnia.test("Status is 200"')
    expect(req.afterResponseScript).toContain(USER_POST)
    const group = doc.resources.find((r) => r._type === 'request_group' && r.name === 'Users')!
    expect(group.authentication?.type).toBe('bearer')
    expect(group.preRequestScript).toBe("pm.variables.set('folderPre', '1')")
    expect(group.afterResponseScript).toBe("pm.test('folder post', () => {})")
  })
})

describe('issue #270 — suite exports', () => {
  it('suite items carry their assertion column as test code (Postman + Insomnia)', () => {
    const db = getDb()
    const now = Date.now()
    const suiteId = randomUUID()
    db.prepare(
      `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Smoke', NULL, 0, ?, ?)`,
    ).run(suiteId, projectId, now, now)
    db.prepare(
      `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url, request_schema, assertions, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'http', 'Suite call', 'GET', 'https://api.example.com/x', ?, ?, 0, ?, ?)`,
    ).run(
      randomUUID(),
      suiteId,
      JSON.stringify({ url: 'https://api.example.com/x', method: 'GET' }),
      JSON.stringify([ROWS[0]]),
      now,
      now,
    )
    const col = JSON.parse(buildPostmanSuiteExport(suiteId).content) as PmCollection
    const item = col.item.find((i) => i.name === 'Suite call')!
    expect(testScript(item.event)).toContain('pm.test("Status is 200"')
    expect(testScript(col.event)).toBe("pm.test('project test', () => {})")

    const doc = JSON.parse(buildInsomniaSuiteExport(suiteId).content) as {
      resources: InsoResource[]
    }
    const req = doc.resources.find((r) => r._type === 'request' && r.name === 'Suite call')!
    expect(req.afterResponseScript).toContain('insomnia.test("Status is 200"')
  })
})
