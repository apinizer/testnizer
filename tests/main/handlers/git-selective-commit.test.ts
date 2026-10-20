/**
 * Issue #214 — choose which changes go into a commit (Insomnia Git Sync
 * parity). REAL git against a bare remote, real export/import, one in-memory
 * DB per machine (`real-git-fixture.ts`); no git mocks.
 *
 *   git:commit { only }      commits just those changes (+ what they need);
 *                            the rest stay in the DB and in git:changes
 *   git:push { only }        the same, then push
 *   git:push commitPending:false
 *                            pushes the existing commits only — uncommitted
 *                            changes are not swept in
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import {
  createRealGitFixture,
  PROJECT_FILE,
  type RealGitFixture,
  type Machine,
} from './real-git-fixture'
import type { GitChangesSummary, GitCommitOutcome } from '../../../src/shared/git-changes'

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
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => currentDb,
}))

const storeState = vi.hoisted(() => ({ git: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return key === 'git' ? storeState.git : undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')

let root: string
let fx: RealGitFixture

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'testnizer-git-selective-'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  harness.reset()
  storeState.git = {}
  fx = createRealGitFixture({
    root,
    harness,
    setDb: (db) => {
      currentDb = db
    },
    gitStore: storeState.git,
  })
  fx.newRemote()
  registerGitHandlers()
})

const commit = (m: Machine, message: string, only?: unknown): Promise<GitCommitOutcome> =>
  fx.ok('git:commit', fx.on(m).projectId, message, only === undefined ? undefined : { only })
const changes = (m: Machine): Promise<GitChangesSummary> => fx.ok('git:changes', fx.on(m).projectId)
const key = (kind: string, id: string): string => `${kind}:${id}`

type FileDoc = {
  endpoints?: { id: string; name: string; folder_id?: string | null }[]
  folders?: { id: string; name: string }[]
  project?: { name?: string; display_name?: string }
}
function headFile(m: Machine, file = PROJECT_FILE): FileDoc {
  return JSON.parse(fx.git(m.localPath, 'show', `HEAD:${file}`)) as FileDoc
}
const headNames = (m: Machine): string[] => (headFile(m).endpoints ?? []).map((e) => e.name).sort()

function addFolder(m: Machine, name: string): string {
  const id = randomUUID()
  m.db
    .prepare(
      'INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, NULL, ?, 0)',
    )
    .run(id, m.projectId, name)
  return id
}

function addEndpointIn(m: Machine, name: string, folderId: string): string {
  const id = fx.addEndpoint(m, name)
  m.db.prepare('UPDATE endpoints SET folder_id = ? WHERE id = ?').run(folderId, id)
  return id
}

describe('git:commit { only } (issue #214)', () => {
  it('commits 1 of 2 changes; the other is still listed and still in the DB', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Base')
    await fx.push(A)

    const pay = fx.addEndpoint(A, 'Payments')
    fx.addEndpoint(A, 'Refunds')
    expect((await changes(A)).items.map((i) => i.name)).toEqual(['Payments', 'Refunds'])

    const done = await commit(A, 'feat: payments only', [key('endpoint', pay)])
    expect(done).toMatchObject({ committed: true, partial: true, included: 1 })
    expect(headNames(A)).toEqual(['Base', 'Payments'])

    const left = await changes(A)
    expect(left.items).toMatchObject([{ kind: 'endpoint', name: 'Refunds', change: 'added' }])
    expect(left.ahead).toBe(1)
    expect(fx.names(A)).toEqual(['Base', 'Payments', 'Refunds'])

    // The rest commits normally afterwards.
    const rest = await commit(A, 'feat: refunds')
    expect(rest).toMatchObject({ committed: true, partial: false })
    expect(headNames(A)).toEqual(['Base', 'Payments', 'Refunds'])
    expect((await changes(A)).items).toEqual([])
  }, 30_000)

  it('an added request brings its added folder along; the summary says so', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Base')
    await fx.push(A)

    const folder = addFolder(A, 'Billing')
    const inv = addEndpointIn(A, 'Invoices', folder)
    fx.addEndpoint(A, 'Unrelated')

    const summary = await changes(A)
    const invItem = summary.items.find((i) => i.id === inv)
    expect(invItem?.requires).toEqual([key('folder', folder)])

    const done = await commit(A, 'feat: invoices', [key('endpoint', inv)])
    expect(done).toMatchObject({ committed: true, partial: true, included: 2 })
    const file = headFile(A)
    expect(file.folders?.map((f) => f.name)).toEqual(['Billing'])
    expect(file.endpoints?.find((e) => e.id === inv)?.folder_id).toBe(folder)
    expect(headNames(A)).toEqual(['Base', 'Invoices'])
  }, 30_000)

  it('deleting a folder takes the deletion of the request inside it along', async () => {
    const A = fx.machine('A')
    const folder = addFolder(A, 'Legacy')
    const old = addEndpointIn(A, 'Old call', folder)
    const keep = fx.addEndpoint(A, 'Keep')
    await fx.push(A)

    A.db.prepare('DELETE FROM endpoints WHERE id = ?').run(old)
    A.db.prepare('DELETE FROM folders WHERE id = ?').run(folder)
    A.db.prepare("UPDATE endpoints SET name = 'Keep v2' WHERE id = ?").run(keep)

    const done = await commit(A, 'chore: drop legacy', [key('folder', folder)])
    expect(done).toMatchObject({ committed: true, partial: true, included: 2 })
    const file = headFile(A)
    expect(file.folders ?? []).toEqual([])
    expect(headNames(A)).toEqual(['Keep']) // the rename was not selected
    expect((await changes(A)).items).toMatchObject([
      { kind: 'endpoint', name: 'Keep v2', change: 'modified' },
    ])
  }, 30_000)

  it('an unselected rename keeps the committed file name and header', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Base')
    await fx.push(A)

    A.db
      .prepare('UPDATE projects SET name = ?, display_name = ? WHERE id = ?')
      .run('Renamed APIs', 'Renamed APIs', A.projectId)
    const added = fx.addEndpoint(A, 'Added')

    await commit(A, 'feat: added', [key('endpoint', added)])
    expect(fx.git(A.localPath, 'ls-tree', '--name-only', 'HEAD')).toBe(PROJECT_FILE)
    expect(headFile(A).project?.name).toBe('Shared APIs')
    expect(headNames(A)).toEqual(['Added', 'Base'])
    expect((await changes(A)).items).toMatchObject([{ kind: 'project', change: 'modified' }])
  }, 30_000)

  it('an empty selection commits nothing; a non-array `only` is a full commit', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Base')
    await fx.push(A)
    const head = fx.git(A.localPath, 'rev-parse', 'HEAD')

    fx.addEndpoint(A, 'One')
    expect(await commit(A, 'nothing', [])).toMatchObject({ committed: false, sha: head })
    expect(await commit(A, 'nothing', ['endpoint:not-a-change'])).toMatchObject({
      committed: false,
    })
    expect(await commit(A, 'all', 'garbage')).toMatchObject({ committed: true, partial: false })
    expect((await changes(A)).items).toEqual([])
  }, 30_000)
})

describe('git:push after a selective commit (issue #214)', () => {
  it('commitPending:false pushes the commits only; the unselected change stays local', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Base')
    await fx.push(A)

    const pay = fx.addEndpoint(A, 'Payments')
    fx.addEndpoint(A, 'Draft')
    await commit(A, 'feat: payments', [key('endpoint', pay)])

    const pushed = await fx.ok<{ committed: boolean }>('git:push', fx.on(A).projectId, {
      commitPending: false,
    })
    expect(pushed.committed).toBe(false)
    expect(fx.remoteNames('main')).toEqual(['Base', 'Payments'])
    expect((await changes(A)).items.map((i) => i.name)).toEqual(['Draft'])
  }, 30_000)

  it('Commit and push with { only } commits the selection and pushes it', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Base')
    await fx.push(A)
    const pay = fx.addEndpoint(A, 'Payments')
    fx.addEndpoint(A, 'Draft')

    const pushed = await fx.ok<{ committed: boolean }>('git:push', fx.on(A).projectId, {
      commitMessage: 'feat: payments',
      only: [key('endpoint', pay)],
    })
    expect(pushed.committed).toBe(true)
    expect(fx.remoteNames('main')).toEqual(['Base', 'Payments'])
    expect((await changes(A)).items.map((i) => i.name)).toEqual(['Draft'])
  }, 30_000)

  it('default Push still commits everything pending (the #136 behaviour)', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Base')
    await fx.push(A)
    const pay = fx.addEndpoint(A, 'Payments')
    fx.addEndpoint(A, 'Draft')
    await commit(A, 'feat: payments', [key('endpoint', pay)])

    await fx.ok('git:push', fx.on(A).projectId, { commitMessage: 'everything' })
    expect(fx.remoteNames('main')).toEqual(['Base', 'Draft', 'Payments'])
    expect((await changes(A)).items).toEqual([])
  }, 30_000)

  it('machine B pulls exactly the selected rows: the request and its new folder, not the draft', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Base')
    await fx.push(A)
    const B = fx.machine('B')
    await fx.pull(B)

    const folder = addFolder(A, 'Billing')
    const inv = addEndpointIn(A, 'Invoices', folder)
    fx.addEndpoint(A, 'Draft')
    await commit(A, 'feat: invoices', [key('endpoint', inv)])
    await fx.ok('git:push', fx.on(A).projectId, { commitPending: false })

    const pulled = await fx.pull(B)
    expect(pulled).toMatchObject({ imported: true })
    expect(fx.names(B)).toEqual(['Base', 'Invoices'])
    const row = B.db.prepare('SELECT folder_id FROM endpoints WHERE id = ?').get(inv) as {
      folder_id: string
    }
    expect(row.folder_id).toBe(folder)
    expect(B.db.prepare('SELECT name FROM folders WHERE id = ?').get(folder)).toEqual({
      name: 'Billing',
    })
    expect((await changes(B)).items).toEqual([])
  }, 30_000)
})
