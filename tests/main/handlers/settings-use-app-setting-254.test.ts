/**
 * Issue #254 — "Use app setting": a project can go back to inheriting.
 *
 * CONTRACT (decided with the orchestrator; the renderer half is pinned in
 * tests/renderer/settings-scope-254.test.tsx):
 *
 *  - The project dialog's `requestTimeout`, `sslVerification` and
 *    `followRedirects` are SHARED project keys (`projects.shared_settings`).
 *    Projects saved before issue #287 / #254 carry the values the old first
 *    Save froze in (`sslVerification:true`, `followRedirects:true`,
 *    `requestTimeout:30000`), which shadow the app Settings for good.
 *  - OMITTING a key from a `settings:set` payload must keep meaning "leave it
 *    alone" — `writeSharedProjectSettings` merges, importers write partial
 *    objects, and settings-ssl-verification-persist-287.test.ts pins it.
 *  - So "Use app setting" is an EXPLICIT DELETE MARKER: `settings:set` with
 *    `<key>: null` for one of those three keys REMOVES the key from
 *    `projects.shared_settings` (and from what `settings:get` returns). The
 *    null itself is never stored. Keys not mentioned are untouched.
 *
 * RED / GREEN on the unfixed tree (stated honestly):
 *  - "null removes the key from the column / settings:get" ... RED (today the
 *    null is stored as a literal `null`, the key stays in the JSON).
 *  - "Run: reset project -> app defaultTimeout wins" ... the Run leg is GREEN
 *    today only because `nonNegative(null)` happens to fall through to the app
 *    value; it is here so the end-to-end chain (settings:set -> shared column ->
 *    loadProjectSettings -> resolveHttpTimeout) stays pinned once the null is
 *    no longer stored. The column assertion in the same test is the red part.
 *  - "legacy requestTimeout:30000 shadows the app default" and "a project that
 *    never wrote a timeout uses the app default" are PINS of existing
 *    behaviour (green before and after), not fail-first tests.
 *
 * One FakeStore is shared by the settings handler and the runner's own store
 * instance, so Run really sees what `settings:set` / `settings:setAll` wrote.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
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

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const storeState = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
class FakeStore {
  get store(): Record<string, unknown> {
    return storeState.values
  }
  get(key: string): unknown {
    return storeState.values[key]
  }
  set(key: string, value: unknown): void {
    storeState.values[key] = value
  }
  clear(): void {
    storeState.values = {}
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerSettingsHandlers } = await import('../../../src/main/ipc/settings.handler')
const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

let server: Server
let base = ''

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url?.startsWith('/slow')) {
          const t = setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            res.end('late')
          }, 1_500)
          req.on('close', () => clearTimeout(t))
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      })
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        resolve()
      })
    }),
)
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let workspaceId: string
let projectId: string
let key: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  key = `project.${projectId}.settings`
  storeState.values = {}
  registerSettingsHandlers()
  registerRunnerHandlers()
})
afterEach(() => testDb.close())

type Obj = Record<string, unknown>
const get = async (k: string): Promise<{ success: boolean; data?: Obj }> =>
  (await harness.invoke('settings:get', k)) as { success: boolean; data?: Obj }

function sharedColumn(): Obj | null {
  const row = testDb
    .prepare('SELECT shared_settings FROM projects WHERE id = ?')
    .get(projectId) as { shared_settings: string | null }
  return row.shared_settings ? (JSON.parse(row.shared_settings) as Obj) : null
}

/** What every pre-#287 first Save of the project dialog wrote. */
const LEGACY_FIRST_SAVE = {
  requestTimeout: 30000,
  sslVerification: true,
  followRedirects: true,
  workingDirectory: '/tmp/work',
  proxy: { mode: 'system' },
  tls: { minVersion: 'TLSv1.2', cipherPreset: 'intermediate' },
  auth: { type: 'bearer', bearerToken: '{{token}}' },
}

describe('issue #254 — settings:set with <key>: null removes the shared key', () => {
  it('a legacy first-save project can drop all three keys; the rest of the shared part survives', async () => {
    await harness.invoke('settings:set', key, LEGACY_FIRST_SAVE)
    expect(sharedColumn()).toMatchObject({
      requestTimeout: 30000,
      sslVerification: true,
      followRedirects: true,
    })

    const res = (await harness.invoke('settings:set', key, {
      requestTimeout: null,
      sslVerification: null,
      followRedirects: null,
      workingDirectory: '/tmp/work',
    })) as { success: boolean }
    expect(res.success).toBe(true)

    const column = sharedColumn()
    expect(column).not.toHaveProperty('requestTimeout')
    expect(column).not.toHaveProperty('sslVerification')
    expect(column).not.toHaveProperty('followRedirects')
    // Shared keys the save did not mention are untouched.
    expect(column).toMatchObject({
      tls: { cipherPreset: 'intermediate' },
      auth: { type: 'bearer', bearerToken: '{{token}}' },
    })

    const got = (await get(key)).data!
    expect(got).not.toHaveProperty('requestTimeout')
    expect(got).not.toHaveProperty('sslVerification')
    expect(got).not.toHaveProperty('followRedirects')
    expect(got.workingDirectory).toBe('/tmp/work')
    expect(got.tls).toMatchObject({ cipherPreset: 'intermediate' })
  })

  it('resetting ONE key leaves the other two (and omitted keys keep their value)', async () => {
    await harness.invoke('settings:set', key, LEGACY_FIRST_SAVE)
    await harness.invoke('settings:set', key, { sslVerification: null })

    const column = sharedColumn()
    expect(column).not.toHaveProperty('sslVerification')
    expect(column).toMatchObject({ requestTimeout: 30000, followRedirects: true })
    const got = (await get(key)).data!
    expect(got).toMatchObject({ requestTimeout: 30000, followRedirects: true })
    expect(got).not.toHaveProperty('sslVerification')
  })

  it('the delete marker is never stored: no literal null in the column or the local store', async () => {
    await harness.invoke('settings:set', key, LEGACY_FIRST_SAVE)
    await harness.invoke('settings:set', key, {
      requestTimeout: null,
      sslVerification: null,
      followRedirects: null,
    })
    expect(JSON.stringify(sharedColumn() ?? {})).not.toContain('null')
    expect(JSON.stringify(storeState.values[key] ?? {})).not.toContain('null')
  })

  it('a null on a project that never wrote the key is a harmless no-op (and a later real value still saves)', async () => {
    const res = (await harness.invoke('settings:set', key, {
      requestTimeout: null,
      workingDirectory: '/x',
    })) as { success: boolean }
    expect(res.success).toBe(true)
    expect(sharedColumn() ?? {}).not.toHaveProperty('requestTimeout')

    await harness.invoke('settings:set', key, { requestTimeout: 1234 })
    expect((await get(key)).data?.requestTimeout).toBe(1234)
  })

  it('PIN (green today): omitting the keys keeps them — only the explicit null removes', async () => {
    await harness.invoke('settings:set', key, LEGACY_FIRST_SAVE)
    await harness.invoke('settings:set', key, { workingDirectory: '/other' })
    expect(sharedColumn()).toMatchObject({
      requestTimeout: 30000,
      sslVerification: true,
      followRedirects: true,
    })
  })
})

describe('issue #254 — Run: the app defaultTimeout applies to a project with no timeout of its own', () => {
  interface Row {
    status: number | null
    error?: string
  }

  function seedSlowEndpoint(): string {
    const id = crypto.randomUUID()
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO endpoints
          (id, project_id, folder_id, name, protocol, method, path, status,
           request_schema, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'EP', 'http', 'GET', '/slow', 'developing', ?, 0, ?, ?)`,
      )
      .run(id, projectId, JSON.stringify({ method: 'GET', url: `${base}/slow` }), now, now)
    return id
  }

  async function run(): Promise<Row> {
    const res = (await harness.invoke('runner:execute', {
      projectId,
      workspaceId,
      endpointIds: [seedSlowEndpoint()],
    })) as { success: boolean; data?: { results: Row[] } }
    expect(res.success).toBe(true)
    return res.data!.results[0]
  }

  const timedOut = (row: Row): void => {
    expect(row.status).toBeNull()
    expect(row.error).toMatch(/timeout|timed out/i)
  }

  it('PIN (green today): a project that never wrote a timeout follows the app default', async () => {
    await harness.invoke('settings:setAll', { defaultTimeout: 200 })
    await harness.invoke('settings:set', key, { workingDirectory: '/w' })
    timedOut(await run())
  })

  it('PIN (green today): a legacy requestTimeout:30000 shadows the small app default (the reason a reset is needed)', async () => {
    await harness.invoke('settings:setAll', { defaultTimeout: 200 })
    await harness.invoke('settings:set', key, LEGACY_FIRST_SAVE)
    const row = await run()
    expect(row.status).toBe(200)
  })

  it('after "Use app setting" (requestTimeout: null) the app default wins again, and the key is gone', async () => {
    await harness.invoke('settings:setAll', { defaultTimeout: 200 })
    await harness.invoke('settings:set', key, LEGACY_FIRST_SAVE)
    await harness.invoke('settings:set', key, { requestTimeout: null })

    // RED today: the null is stored as a literal key in the column.
    expect(sharedColumn()).not.toHaveProperty('requestTimeout')
    timedOut(await run())
  })
})
