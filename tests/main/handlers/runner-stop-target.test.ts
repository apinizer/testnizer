/**
 * Stop stops the run it was pressed on.
 *
 * Since issue #317 a run outlives its tab, so a user can leave one run and start
 * another. `runner:stop` looped over every active run: Stop on the second aborted
 * the first with no marker on its tab, and aborted a scheduled run too.
 *
 * Real local server, real `executeCollection`, nothing mocked but the DB handle.
 * Every run is held on the wire while Stop is pressed, so what is proved is what
 * happens to a run that is still going.
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

const { registerRunnerHandlers, executeCollectionForScheduler } =
  await import('../../../src/main/ipc/runner.handler')

interface Report {
  results: Array<{ url: string; status: number | null; statusText?: string }>
  stopReason?: string
}
interface RunResult {
  success: boolean
  data: Report
}

let server: Server
let base = ''
/** Requests parked on the wire, by path. */
let parked = new Map<string, () => void>()
let arrived: string[] = []
let waiters: Array<() => void> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume()
    const path = req.url ?? '/'
    arrived.push(path)
    const answer = (): void => {
      if (res.destroyed) return
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    }
    if (path.includes('/hold')) parked.set(path, answer)
    else answer()
    waiters.splice(0).forEach((w) => w())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function untilArrived(path: string): Promise<void> {
  while (!arrived.includes(path)) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve)
    })
  }
}

let workspaceId = ''
let projectId = ''
let otherProjectId = ''

function seed(project: string, path: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'http', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(
      id,
      project,
      path,
      `${base}${path}`,
      JSON.stringify({ method: 'GET', url: `${base}${path}` }),
      now,
      now,
    )
  return id
}

/** A run held on `/hold-<name>`, then a second step only a live run reaches. */
function startRun(name: string, tab: string | undefined, project = projectId): Promise<RunResult> {
  return harness.invoke('runner:execute', {
    projectId: project,
    workspaceId,
    runTabId: tab,
    endpointIds: [seed(project, `/hold-${name}`), seed(project, `/after-${name}`)],
  }) as Promise<RunResult>
}

const release = (): void => parked.forEach((answer) => answer())
const paths = (report: Report): string[] => report.results.map((r) => r.url.replace(base, ''))

beforeEach(() => {
  harness.reset()
  parked = new Map()
  arrived = []
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  otherProjectId = seedProject(testDb, workspaceId, 'Other')
  registerRunnerHandlers()
})
afterEach(() => {
  testDb.close()
})

describe('runner:stop addresses one run', () => {
  it('direct Stop on tab B aborts B; tab A, left running, finishes every step', async () => {
    const runA = startRun('a', 'tab-a')
    await untilArrived('/hold-a')
    const runB = startRun('b', 'tab-b')
    await untilArrived('/hold-b')

    const stop = (await harness.invoke('runner:stop', {
      mode: 'direct',
      runTabId: 'tab-b',
      projectId,
    })) as { success: boolean; data: boolean }
    expect(stop).toEqual({ success: true, data: true })

    const b = (await runB).data
    expect(arrived).not.toContain('/after-b')
    expect(b.stopReason).toBeTruthy()

    release()
    const a = (await runA).data
    expect(paths(a)).toEqual(['/hold-a', '/after-a'])
    expect(a.results.map((r) => r.status)).toEqual([200, 200])
    expect(a.stopReason).toBeFalsy()
  })

  it('graceful Stop on tab B leaves tab A running too', async () => {
    const runA = startRun('a', 'tab-a')
    await untilArrived('/hold-a')
    const runB = startRun('b', 'tab-b')
    await untilArrived('/hold-b')

    await harness.invoke('runner:stop', { mode: 'graceful', runTabId: 'tab-b', projectId })
    release()

    const [a, b] = [(await runA).data, (await runB).data]
    expect(paths(a)).toEqual(['/hold-a', '/after-a'])
    expect(paths(b)[0]).toBe('/hold-b')
    expect(arrived).not.toContain('/after-b')
  })

  it('the same tab id in another project is another run (`runner-main` exists in every project)', async () => {
    const runA = startRun('a', 'runner-main', projectId)
    await untilArrived('/hold-a')
    const runOther = startRun('other', 'runner-main', otherProjectId)
    await untilArrived('/hold-other')

    await harness.invoke('runner:stop', {
      mode: 'direct',
      runTabId: 'runner-main',
      projectId: otherProjectId,
    })
    expect((await runOther).data.stopReason).toBeTruthy()

    release()
    expect(paths((await runA).data)).toEqual(['/hold-a', '/after-a'])
  })

  it('a scheduled run in the same project survives a tab Stop, even from a tabless runner', async () => {
    const scheduled = executeCollectionForScheduler({
      projectId,
      endpointIds: [seed(projectId, '/hold-s'), seed(projectId, '/after-s')],
    }) as unknown as Promise<Report>
    await untilArrived('/hold-s')
    const runB = startRun('b', undefined)
    await untilArrived('/hold-b')

    await harness.invoke('runner:stop', { mode: 'direct', projectId })
    expect((await runB).data.stopReason).toBeTruthy()

    release()
    expect(paths(await scheduled)).toEqual(['/hold-s', '/after-s'])
  })

  it('reports false, stopping nothing, when the addressed run has ended', async () => {
    const runA = startRun('a', 'tab-a')
    await untilArrived('/hold-a')
    const stop = (await harness.invoke('runner:stop', {
      mode: 'direct',
      runTabId: 'tab-gone',
      projectId,
    })) as { data: boolean }
    expect(stop.data).toBe(false)
    release()
    expect(paths((await runA).data)).toEqual(['/hold-a', '/after-a'])
  })
})
