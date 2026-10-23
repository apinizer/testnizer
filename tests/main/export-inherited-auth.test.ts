/**
 * Issue #276 — exports of an `inherit` request carry its EFFECTIVE auth, and
 * `:name` path variables travel.
 *
 * Postman imports now store `{type:'inherit'}` and put the collection auth on
 * the import folder or the project. Before this change:
 *  - `export:curl` printed no auth for such a request (it only knew the
 *    request's own auth);
 *  - the OpenAPI export emitted no `security` for it;
 *  - the Insomnia export dropped the project auth (Insomnia has no workspace
 *    auth) and turned an explicit `none` under an authed folder into
 *    "inherit" (a missing `authentication` block).
 * Path variables: cURL substitutes them, Postman writes `url.variable[]`,
 * OpenAPI turns `:id` into `{id}`.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-pm276-exp-'))
type Handler = (event: unknown, ...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { getPath: (): string => tmpDir },
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      ipcHandlers.set(channel, fn)
    },
  },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (s: string): Buffer => Buffer.from(`k1|${s}`, 'utf-8').reverse(),
    decryptString: (b: Buffer): string => {
      const text = Buffer.from(b).reverse().toString('utf-8')
      return text.slice(text.indexOf('|') + 1)
    },
  },
}))
vi.mock('../../src/main/protocols/grpc.engine', () => ({ loadProto: () => Promise.resolve({}) }))
class FakeStore {
  get(): unknown {
    return undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

import { initDatabase, getDb } from '../../src/main/db/database'
import { registerImportExportHandlers } from '../../src/main/ipc/import-export.handler'
import { writeSharedProjectSettings } from '../../src/main/lib/project-settings'

let workspaceId = ''
let seq = 0

function newProject(auth?: Record<string, unknown>): string {
  const id = `exp276-${++seq}`
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'http', 0, ?, ?)`,
    )
    .run(id, workspaceId, id, now, now)
  if (auth) writeSharedProjectSettings(id, { auth })
  return id
}

function folder(projectId: string, auth: unknown, parent: string | null = null): string {
  const id = `f-${++seq}`
  getDb()
    .prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth) VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .run(id, projectId, parent, id, auth ? JSON.stringify(auth) : null)
  return id
}

function endpoint(
  projectId: string,
  folderId: string | null,
  name: string,
  schema: Record<string, unknown>,
): string {
  const id = `ep-${++seq}`
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'http', 'GET', ?, 'developing', ?, ?, ?, ?)`,
    )
    .run(id, projectId, folderId, name, String(schema.url), JSON.stringify(schema), seq, now, now)
  return id
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcHandlers.get(channel)!({}, ...args)) as {
    success: boolean
    data?: T
    error?: string
  }
  expect(res.error).toBeUndefined()
  expect(res.success).toBe(true)
  return res.data as T
}

const FOLDER_BEARER = { type: 'bearer', bearer: { token: '{{folderTok}}', prefix: 'Bearer' } }

beforeAll(() => {
  initDatabase()
  registerImportExportHandlers()
  workspaceId = (getDb().prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
})

describe('issue #276 — export:curl', () => {
  it('inherit resolves to the folder auth, then the project auth; none stays none', async () => {
    const pid = newProject({ type: 'api-key', apiKeyKey: 'X-Api-Key', apiKeyValue: 'PROJ' })
    const f = folder(pid, FOLDER_BEARER)
    const underFolder = endpoint(pid, f, 'a', { url: 'https://h.test/a', auth: { type: 'inherit' } })
    const atRoot = endpoint(pid, null, 'b', { url: 'https://h.test/b', auth: { type: 'inherit' } })
    const none = endpoint(pid, f, 'c', { url: 'https://h.test/c', auth: { type: 'none' } })

    const a = await invoke<string>('export:curl', {
      method: 'GET',
      url: 'https://h.test/a',
      auth: { type: 'inherit' },
      endpointId: underFolder,
    })
    expect(a).toContain('Authorization: Bearer {{folderTok}}')

    const b = await invoke<string>('export:curl', {
      method: 'GET',
      url: 'https://h.test/b',
      auth: { type: 'inherit' },
      endpointId: atRoot,
    })
    expect(b).toContain('X-Api-Key: PROJ')

    const c = await invoke<string>('export:curl', {
      method: 'GET',
      url: 'https://h.test/c',
      auth: { type: 'none' },
      endpointId: none,
    })
    expect(c).not.toMatch(/Authorization|X-Api-Key/)
  })

  it('substitutes :name path variables; without a stored-request id nothing changes', async () => {
    const out = await invoke<string>('export:curl', {
      method: 'GET',
      url: 'https://h.test/users/:id/:other',
      pathVariables: [{ key: 'id', value: '42' }],
    })
    expect(out).toContain('https://h.test/users/42/:other')
  })
})

describe('issue #276 — OpenAPI / Insomnia / Postman exports', () => {
  it('OpenAPI: inherit carries the folder / project security; :id becomes {id}', async () => {
    const pid = newProject({ type: 'basic', basicUser: 'u', basicPass: 'secret' })
    const f = folder(pid, FOLDER_BEARER)
    endpoint(pid, f, 'inFolder', { url: 'https://h.test/users/:id', auth: { type: 'inherit' } })
    endpoint(pid, null, 'atRoot', { url: 'https://h.test/orgs', auth: { type: 'inherit' } })
    endpoint(pid, f, 'open', { url: 'https://h.test/open', auth: { type: 'none' } })
    const doc = JSON.parse(await invoke<string>('export:openApi', pid)) as {
      paths: Record<string, Record<string, { security?: unknown; parameters?: unknown[] }>>
    }
    expect(doc.paths['/users/{id}'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/users/{id}'].get.parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path' }),
    )
    expect(doc.paths['/orgs'].get.security).toEqual([{ basicAuth: [] }])
    expect(doc.paths['/open'].get.security).toBeUndefined()
    expect(JSON.stringify(doc)).not.toContain('secret')
  })

  it('Insomnia: project auth on a root inherit request (literal blanked), explicit none kept', async () => {
    const pid = newProject({ type: 'bearer', bearerToken: 'LITERAL' })
    const f = folder(pid, FOLDER_BEARER)
    endpoint(pid, null, 'root', { url: 'https://h.test/r', auth: { type: 'inherit' } })
    endpoint(pid, f, 'inFolder', { url: 'https://h.test/f', auth: { type: 'inherit' } })
    endpoint(pid, f, 'none', { url: 'https://h.test/n', auth: { type: 'none' } })
    const out = await invoke<string>('export:insomnia', pid)
    const resources = (JSON.parse(out) as { resources: Array<Record<string, unknown>> }).resources
    const req = (name: string) => resources.find((r) => r._type === 'request' && r.name === name)!
    expect(req('root').authentication).toEqual({ type: 'bearer', token: '', prefix: 'Bearer' })
    expect(req('inFolder').authentication).toBeUndefined()
    expect(req('none').authentication).toEqual({ type: 'none' })
    expect(out).not.toContain('LITERAL')
  })

  it('Postman: url.variable[] carries the path variables', async () => {
    const pid = newProject()
    endpoint(pid, null, 'pv', {
      url: '{{base}}/users/:id',
      pathVariables: [{ id: 'r1', key: 'id', value: '{{uid}}', description: 'who' }],
    })
    const coll = JSON.parse(await invoke<string>('export:postman', pid)) as {
      item: Array<{ request: { url: { raw: string; variable?: unknown[] } } }>
    }
    expect(coll.item[0].request.url.raw).toBe('{{base}}/users/:id')
    expect(coll.item[0].request.url.variable).toEqual([
      { key: 'id', value: '{{uid}}', description: 'who' },
    ])
  })
})
