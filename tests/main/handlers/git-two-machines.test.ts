/**
 * Two machines, one remote — REAL git, real simple-git, real export/import.
 *
 * Tester report (two-device merge flow) reproduced step by step:
 *   A: create, Push · B: Pull · B: edit, Push · A: Pull · A: branch, edit,
 *   Push · B: Pull, switch to the branch, merge into main, Push · A: Pull.
 *
 * Two defects hid in that flow:
 *   1. Pull only merged the checked-out branch — A on `feature` never saw
 *      B's merge on `origin/main`; local `main` stayed stale.
 *   2. `git merge` updated the working tree but not the DB, and Push exported
 *      the (stale) DB over the merged file — the merge vanished from the
 *      remote even when done in the "right" order.
 *
 * Plus the Clone-from-Git guard: a fresh machine must import the remote's
 * file into its new project; the same machine (source project still open)
 * must be refused with the name the Hub shows, not the internal `name`.
 *
 * Each "machine" is its own in-memory DB + its own checkout dir; the remote
 * is a bare repository in a temp dir. No simple-git mock anywhere.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock, createTestDb, seedWorkspace } from './helpers'

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

// The "current machine" — swapped by `on(machine)`.
let currentDb: Database.Database
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => currentDb,
}))

// One settings store keyed by project id serves every machine (ids differ).
const storeState = vi.hoisted(() => ({ git: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return key === 'git' ? storeState.git : undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')
const { GIT_PUSH_REJECTED_ERROR } = await import('../../../src/main/lib/git-config')

const PROJECT_NAME = 'Shared APIs'
const FILE = 'Shared-APIs.json'

interface Machine {
  label: string
  db: Database.Database
  projectId: string
  localPath: string
}

let root: string
let remote: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

function remoteFile(branch: string): { endpoints: { id: string; name: string }[] } | null {
  try {
    const listed = execFileSync('git', ['--git-dir', remote, 'ls-tree', '--name-only', branch], {
      encoding: 'utf-8',
    })
      .split('\n')
      .filter((f) => f.endsWith('.json'))
    const file = listed.includes(FILE) ? FILE : listed[0]
    if (!file) return null
    const out = execFileSync('git', ['--git-dir', remote, 'show', `${branch}:${file}`], {
      encoding: 'utf-8',
    })
    return JSON.parse(out) as { endpoints: { id: string; name: string }[] }
  } catch {
    return null
  }
}

function remoteNames(branch: string): string[] {
  return (remoteFile(branch)?.endpoints ?? []).map((e) => e.name).sort()
}

function machine(label: string, opts: { name?: string; displayName?: string } = {}): Machine {
  const db = createTestDb()
  const workspaceId = seedWorkspace(db, `ws-${label}`)
  const projectId = randomUUID()
  const localPath = join(root, `checkout-${label}-${projectId.slice(0, 8)}`)
  mkdirSync(localPath, { recursive: true })
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, display_name, type, sort_order, save_mode, local_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'http', 0, 'both', ?, ?, ?)`,
  ).run(
    projectId,
    workspaceId,
    opts.name ?? PROJECT_NAME,
    opts.displayName ?? null,
    localPath,
    now,
    now,
  )
  storeState.git[projectId] = { repoUrl: remote, username: 'u', branch: 'main', token: 'x' }
  return { label, db, projectId, localPath }
}

function on(m: Machine): Machine {
  currentDb = m.db
  return m
}

function addEndpoint(m: Machine, name: string): string {
  const id = randomUUID()
  const now = Date.now()
  m.db
    .prepare(
      `INSERT INTO endpoints (id, project_id, name, protocol, method, path, created_at, updated_at)
       VALUES (?, ?, ?, 'http', 'GET', ?, ?, ?)`,
    )
    .run(id, m.projectId, name, `/${name.toLowerCase()}`, now, now)
  return id
}

function names(m: Machine): string[] {
  return (
    m.db
      .prepare('SELECT name FROM endpoints WHERE project_id = ? ORDER BY name')
      .all(m.projectId) as { name: string }[]
  ).map((r) => r.name)
}

type Envelope<T> = { success: boolean; error?: string; data?: T }

async function call<T>(channel: string, ...args: unknown[]): Promise<Envelope<T>> {
  return (await harness.invoke(channel, ...args)) as Envelope<T>
}

async function ok<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = await call<T>(channel, ...args)
  expect(res.error, `${channel} failed`).toBeUndefined()
  expect(res.success).toBe(true)
  return res.data as T
}

const push = (m: Machine) => ok<{ branch: string }>('git:push', on(m).projectId)
const pull = (m: Machine) =>
  ok<{
    pulled: boolean
    imported: boolean
    state: string
    branch: string
    fastForwarded: string[]
  }>('git:pull', on(m).projectId)
const switchTo = (m: Machine, branch: string) =>
  ok<{ branch: string; fastForwarded: boolean }>('git:switchBranch', {
    projectId: on(m).projectId,
    branchName: branch,
  })
const merge = (m: Machine, source: string) =>
  ok<{ merged: boolean; state: string }>('git:merge', {
    projectId: on(m).projectId,
    sourceBranch: source,
  })
const createBranch = (m: Machine, name: string, base: string) =>
  ok<{ branch: string; remotePushed: boolean }>('git:createBranch', {
    projectId: on(m).projectId,
    branchName: name,
    baseBranch: base,
  })
const listBranches = (m: Machine) =>
  ok<{ branches: { name: string; current: boolean; isRemote: boolean }[]; current: string }>(
    'git:listBranches',
    on(m).projectId,
  )

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'testnizer-two-machines-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  harness.reset()
  storeState.git = {}
  remote = join(root, `remote-${randomUUID().slice(0, 8)}.git`)
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  registerGitHandlers()
})

describe('two machines, one remote — the reported merge flow', () => {
  it('B merges A’s branch into main and pushes; A’s Pull on the feature branch fast-forwards main and switching to it shows the merge', async () => {
    const A = machine('A')
    const B = machine('B')

    // 1. A: create a collection, push main.
    addEndpoint(A, 'A1')
    await push(A)
    expect(remoteNames('main')).toEqual(['A1'])

    // 2. B: pull → A's rows land in B's (different) project id.
    expect((await pull(B)).imported).toBe(true)
    expect(names(B)).toEqual(['A1'])

    // 3. B: edit, push.
    addEndpoint(B, 'B1')
    await push(B)
    expect(remoteNames('main')).toEqual(['A1', 'B1'])

    // 4. A: pull.
    await pull(A)
    expect(names(A)).toEqual(['A1', 'B1'])

    // 5. A: new branch (the UI auto-switches to it), develop, push.
    await createBranch(A, 'feature', 'main')
    await switchTo(A, 'feature')
    addEndpoint(A, 'F1')
    expect((await push(A)).branch).toBe('feature')
    expect(remoteNames('feature')).toEqual(['A1', 'B1', 'F1'])
    expect(remoteNames('main')).toEqual(['A1', 'B1'])

    // 6. B: pull → the branch shows up (remote-only, "cloud icon").
    await pull(B)
    const listed = await listBranches(B)
    expect(listed.branches.find((b) => b.name === 'feature')).toMatchObject({ isRemote: true })

    // 7. B: switch to the branch (DB now = feature), back to main (DB =
    //    main, F1 gone — a branch IS its checkout), merge feature, push.
    await switchTo(B, 'feature')
    expect(names(B)).toEqual(['A1', 'B1', 'F1'])
    await switchTo(B, 'main')
    expect(names(B)).toEqual(['A1', 'B1'])
    expect((await merge(B, 'feature')).state).toBe('clean')
    // Defect 2: the DB must hold the MERGED state before Push exports it.
    expect(names(B)).toEqual(['A1', 'B1', 'F1'])
    await push(B)
    expect(remoteNames('main')).toEqual(['A1', 'B1', 'F1'])

    // 8. A: Pull while still on `feature`.
    const pulled = await pull(A)
    expect(pulled.branch).toBe('feature')
    // Defect 1: local main must have followed origin/main.
    expect(pulled.fastForwarded).toContain('main')
    expect(git(A.localPath, 'rev-parse', 'main')).toBe(git(A.localPath, 'rev-parse', 'origin/main'))

    // 9. A: switch to main → the merge is there, in git AND in the DB.
    await switchTo(A, 'main')
    expect(git(A.localPath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(names(A)).toEqual(['A1', 'B1', 'F1'])
  }, 30_000)

  it('the other order too: B on the feature branch merges main INTO it and pushes the branch — nothing is lost', async () => {
    const A = machine('A')
    const B = machine('B')
    addEndpoint(A, 'A1')
    await push(A)
    await pull(B)
    await createBranch(B, 'feature', 'main')
    await switchTo(B, 'feature')
    addEndpoint(B, 'F1')
    await push(B)

    // main moves on (A adds A2) while B sits on feature.
    addEndpoint(A, 'A2')
    await push(A)

    await pull(B) // on feature; fast-forwards local main behind the scenes
    expect((await merge(B, 'main')).state).toBe('clean')
    expect(names(B)).toEqual(['A1', 'A2', 'F1'])
    await push(B)
    expect(remoteNames('feature')).toEqual(['A1', 'A2', 'F1'])
  }, 30_000)

  it('switching to a branch a teammate advanced fast-forwards it even without a Pull first', async () => {
    const A = machine('A')
    const B = machine('B')
    addEndpoint(A, 'A1')
    await push(A)
    await pull(B)
    await createBranch(A, 'feature', 'main')
    await switchTo(A, 'feature')

    // B advances main while A is on feature and never pulls.
    addEndpoint(B, 'B1')
    await push(B)

    const sw = await switchTo(A, 'main')
    expect(sw.fastForwarded).toBe(true)
    expect(names(A)).toEqual(['A1', 'B1'])
  }, 30_000)
})

describe('row-level sync on Pull', () => {
  it('a request deleted on B and pushed disappears on A’s Pull and does not come back on A’s Push', async () => {
    const A = machine('A')
    const B = machine('B')
    addEndpoint(A, 'A1')
    const gone = addEndpoint(A, 'A2')
    await push(A)
    await pull(B)
    expect(names(B)).toEqual(['A1', 'A2'])

    B.db.prepare('DELETE FROM endpoints WHERE id = ?').run(gone)
    await push(B)
    expect(remoteNames('main')).toEqual(['A1'])

    await pull(A)
    expect(names(A)).toEqual(['A1'])
    await push(A)
    expect(remoteNames('main')).toEqual(['A1'])
  }, 30_000)

  it('unpushed local rows survive a Pull that brings new remote rows (no text-level conflict)', async () => {
    const A = machine('A')
    const B = machine('B')
    addEndpoint(A, 'A1')
    await push(A)
    await pull(B)

    addEndpoint(A, 'A-local') // not pushed
    addEndpoint(B, 'B-new')
    await push(B)

    const res = await pull(A)
    expect(res.state).toBe('clean')
    expect(names(A)).toEqual(['A-local', 'A1', 'B-new'])
    await push(A)
    expect(remoteNames('main')).toEqual(['A-local', 'A1', 'B-new'])
  }, 30_000)

  it('Push rejected (remote moved on) → Pull auto-merges by row → Push lands the union', async () => {
    const A = machine('A')
    const B = machine('B')
    addEndpoint(A, 'A1')
    await push(A)
    await pull(B)

    // Both edit the same collection; A wins the race to the remote.
    addEndpoint(A, 'A2')
    await push(A)
    addEndpoint(B, 'B2')
    const rejected = await call<unknown>('git:push', on(B).projectId)
    expect(rejected.success).toBe(false)
    expect(rejected.error).toBe(GIT_PUSH_REJECTED_ERROR)

    // B's rejected push left its commit on local main; the pull's merge
    // conflicts on the endpoints array and is auto-resolved by row.
    const pulled = await pull(B)
    expect(pulled.state).toBe('clean')
    expect(names(B)).toEqual(['A1', 'A2', 'B2'])
    await push(B)
    expect(remoteNames('main')).toEqual(['A1', 'A2', 'B2'])

    await pull(A)
    expect(names(A)).toEqual(['A1', 'A2', 'B2'])
  }, 30_000)

  it('a Pull with nothing new does not create a commit', async () => {
    const A = machine('A')
    addEndpoint(A, 'A1')
    await push(A)
    const before = git(A.localPath, 'rev-parse', 'HEAD')
    await pull(A)
    await switchTo(A, 'main')
    expect(git(A.localPath, 'rev-parse', 'HEAD')).toBe(before)
  }, 30_000)
})

describe('Clone from Git (New Project → Clone) — the first Pull of a fresh project', () => {
  it('a fresh machine imports the remote file into its NEW project (different id, renamed seed)', async () => {
    // Machine A's project is the renamed seed: internal name stays
    // "My Project", the Hub shows the display name.
    const A = machine('A', { name: 'My Project', displayName: 'Banking APIs' })
    addEndpoint(A, 'A1')
    await push(A)

    // Machine C: the wizard created an empty project with its own id/name.
    const C = machine('C', { name: 'banking-apis', displayName: 'Banking APIs' })
    const res = await pull(C)
    expect(res.imported).toBe(true)
    expect(names(C)).toEqual(['A1'])
    // Rows are bound to C's project, nothing parked under A's id.
    expect(
      (
        C.db
          .prepare('SELECT COUNT(*) AS n FROM endpoints WHERE project_id = ?')
          .get(A.projectId) as {
          n: number
        }
      ).n,
    ).toBe(0)
    // The empty new project must NOT have been exported over the clone.
    expect(remoteNames('main')).toEqual(['A1'])
    // C adopted the repository's project name, so its pushes go to the SAME
    // file A writes — no second `banking-apis.json` for A to ignore.
    addEndpoint(C, 'C1')
    await push(C)
    expect(git(root, '--git-dir', remote, 'ls-tree', '--name-only', 'main')).toBe('My-Project.json')
    await pull(A)
    expect(names(A)).toEqual(['A1', 'C1'])
  }, 30_000)

  it('the same machine (source project still open) is refused with the name the Hub shows', async () => {
    const A = machine('A', { name: 'My Project', displayName: 'Banking APIs' })
    addEndpoint(A, 'A1')
    await push(A)

    // A second project on the SAME machine (same DB) cloning the same remote.
    const projectId = randomUUID()
    const localPath = join(root, `checkout-A2-${projectId.slice(0, 8)}`)
    mkdirSync(localPath, { recursive: true })
    const now = Date.now()
    const ws = (A.db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
    A.db
      .prepare(
        `INSERT INTO projects (id, workspace_id, name, type, sort_order, save_mode, local_path, created_at, updated_at)
         VALUES (?, ?, 'banking-apis-copy', 'http', 1, 'both', ?, ?, ?)`,
      )
      .run(projectId, ws, localPath, now, now)
    storeState.git[projectId] = { repoUrl: remote, username: 'u', branch: 'main', token: 'x' }

    const res = await call<unknown>('git:pull', projectId)
    expect(res.success).toBe(false)
    expect(res.error).toContain('"Banking APIs"')
    expect(res.error).not.toContain('"My Project"')
    // A's rows were not moved.
    expect(names(A)).toEqual(['A1'])
  }, 30_000)
})

/**
 * Issue #135 — "After remote merge and push, teammate's pull does not show
 * merged collection content (Git OK, UI/DB stale)". The first describe above
 * covers B merging A's branch; here the roles are the reported ones and the
 * merge source is a branch A has NEVER checked out (only `origin/feature/b`
 * exists on A — the "cloud icon" path of `git:merge`).
 */
describe('issue #135 — teammate pulls a merge made on the other machine', () => {
  /** What the editor's Save does to an existing request: new name + path, newer stamp. */
  function editEndpoint(m: Machine, id: string, name: string): void {
    m.db
      .prepare('UPDATE endpoints SET name = ?, path = ?, updated_at = ? WHERE id = ?')
      .run(name, `/${name.toLowerCase()}`, Date.now() + 1000, id)
  }

  const rev = (m: Machine, ref: string): string => git(m.localPath, 'rev-parse', ref)
  const remoteRev = (branch: string): string => git(root, '--git-dir', remote, 'rev-parse', branch)

  /** B's checkout is on `main`, at exactly the remote's `main`, nothing uncommitted. */
  function expectBAtRemoteMain(B: Machine): void {
    expect(git(B.localPath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(rev(B, 'origin/main')).toBe(remoteRev('main'))
    expect(rev(B, 'HEAD')).toBe(remoteRev('main'))
    expect(git(B.localPath, 'status', '--porcelain')).toBe('')
  }

  /**
   * Steps 1–4 of the report: shared baseline on main, B pushes `feature/b`,
   * A pushes `feature/a`, B pulls on `feature/b`. Returns with A on
   * `feature/a` and B on `feature/b`.
   */
  async function branchesPushed(opts: { bEditsX1?: boolean } = {}) {
    const A = machine('A')
    const B = machine('B')

    // 1. Same baseline on both machines.
    const x1 = addEndpoint(A, 'X1')
    addEndpoint(A, 'X2')
    await push(A)
    await pull(A)
    expect((await pull(B)).imported).toBe(true)
    expect(names(B)).toEqual(['X1', 'X2'])

    // 2. B: feature/b (the UI switches to a new branch right away), edit, Push.
    await createBranch(B, 'feature/b', 'main')
    await switchTo(B, 'feature/b')
    addEndpoint(B, 'B1')
    if (opts.bEditsX1) editEndpoint(B, x1, 'X1-edited-on-B')
    expect((await push(B)).branch).toBe('feature/b')

    // 3. A: feature/a, different edits, Push.
    await createBranch(A, 'feature/a', 'main')
    await switchTo(A, 'feature/a')
    addEndpoint(A, 'A1')
    addEndpoint(A, 'A2')
    expect((await push(A)).branch).toBe('feature/a')

    // 4. B: Pull on feature/b — fine, nothing new for it.
    const pulledB = await pull(B)
    expect(pulledB.branch).toBe('feature/b')
    expect(pulledB.state).toBe('clean')
    expect(names(B)).toEqual(opts.bEditsX1 ? ['B1', 'X1-edited-on-B', 'X2'] : ['B1', 'X1', 'X2'])

    return { A, B }
  }

  /** Steps 5–7: A switches to main, merges (never-checked-out) branches, Pushes. */
  async function aMergesAndPushes(A: Machine, sources: string[]): Promise<void> {
    await switchTo(A, 'main')
    expect(names(A)).toEqual(['X1', 'X2'])
    const listed = await listBranches(A)
    expect(listed.branches.find((b) => b.name === 'feature/b')).toMatchObject({ isRemote: true })
    for (const source of sources) {
      expect((await merge(A, source)).state).toBe('clean')
    }
    expect((await push(A)).branch).toBe('main')
  }

  it('(a) B switches to main, then Pulls → B holds the merged main', async () => {
    const { A, B } = await branchesPushed()
    await aMergesAndPushes(A, ['feature/b'])
    const union = ['B1', 'X1', 'X2']
    expect(remoteNames('main')).toEqual(union)

    const sw = await switchTo(B, 'main')
    expect.soft(sw.fastForwarded, 'switch fast-forwards main to origin/main').toBe(true)
    expect.soft(names(B), 'DB right after the switch').toEqual(union)

    const pulled = await pull(B)
    expect(pulled.branch).toBe('main')
    expect(pulled.state).toBe('clean')
    expect(names(B)).toEqual(union)
    expect(names(B)).toEqual(remoteNames('main'))
    expectBAtRemoteMain(B)
  }, 30_000)

  it('(b) B Pulls on feature/b first (main fast-forwards behind the scenes), then switches → merged main', async () => {
    const { A, B } = await branchesPushed()
    await aMergesAndPushes(A, ['feature/b'])
    const union = ['B1', 'X1', 'X2']
    expect(remoteNames('main')).toEqual(union)

    const pulled = await pull(B)
    expect(pulled.branch).toBe('feature/b')
    expect
      .soft(pulled.fastForwarded, 'Pull on feature/b fast-forwards local main')
      .toContain('main')
    expect
      .soft(rev(B, 'main'), 'local main = origin/main before the switch')
      .toBe(rev(B, 'origin/main'))
    // Still on feature/b: its own content, untouched by the main update.
    expect(names(B)).toEqual(['B1', 'X1', 'X2'])

    await switchTo(B, 'main')
    expect(names(B)).toEqual(union)
    expect(names(B)).toEqual(remoteNames('main'))
    expectBAtRemoteMain(B)
  }, 30_000)

  it('(c) B modified an existing request on feature/b, A added rows on feature/a, A merges both → B sees the edit AND A’s rows (both orders)', async () => {
    const { A, B } = await branchesPushed({ bEditsX1: true })
    // feature/a fast-forwards main; feature/b then conflicts on the endpoints
    // array and is merged by row on the MERGE path.
    await aMergesAndPushes(A, ['feature/a', 'feature/b'])
    const union = ['A1', 'A2', 'B1', 'X1-edited-on-B', 'X2']
    expect(names(A)).toEqual(union)
    expect(remoteNames('main')).toEqual(union)

    // Order 2 first: B Pulls on feature/b, then switches to main.
    const pulled = await pull(B)
    expect(pulled.branch).toBe('feature/b')
    expect
      .soft(pulled.fastForwarded, 'Pull on feature/b fast-forwards local main')
      .toContain('main')
    await switchTo(B, 'main')
    expect(names(B)).toEqual(union)
    expect(names(B)).toEqual(remoteNames('main'))
    expectBAtRemoteMain(B)

    // Order 1 on the same state: back to feature/b and to main again, Pull —
    // nothing may revert to the one-sided view.
    await switchTo(B, 'feature/b')
    expect(names(B)).toEqual(['B1', 'X1-edited-on-B', 'X2'])
    await switchTo(B, 'main')
    const pulledMain = await pull(B)
    expect(pulledMain.state).toBe('clean')
    expect(names(B)).toEqual(union)
    expect(names(B)).toEqual(remoteNames('main'))
    // Navigating away and back must not mint an "Auto-save" commit on main:
    // a local-only commit there makes main diverge from origin/main, and the
    // NEXT teammate merge no longer fast-forwards on switch / Pull elsewhere.
    expectBAtRemoteMain(B)
  }, 30_000)

  it('(d) A’s local main was behind origin/main when A merged → Push is rejected, Pull merges by row, Push lands the union; B sees it', async () => {
    const { A, B } = await branchesPushed()

    // A is on main (up to date at this point)…
    await switchTo(A, 'main')
    expect(names(A)).toEqual(['X1', 'X2'])

    // …then B pushes a request straight to main and returns to feature/b.
    await switchTo(B, 'main')
    addEndpoint(B, 'M1')
    expect((await push(B)).branch).toBe('main')
    await switchTo(B, 'feature/b')
    expect(remoteNames('main')).toEqual(['M1', 'X1', 'X2'])

    // A never pulled: local main is behind origin/main. Merge feature/b.
    expect(rev(A, 'main')).not.toBe(remoteRev('main'))
    expect((await merge(A, 'feature/b')).state).toBe('clean')
    expect(names(A)).toEqual(['B1', 'X1', 'X2'])

    // Non-fast-forward: git refuses, the user is told to Pull. M1 must not be lost.
    const rejected = await call<unknown>('git:push', on(A).projectId)
    expect(rejected.success).toBe(false)
    expect(rejected.error).toBe(GIT_PUSH_REJECTED_ERROR)
    expect(remoteNames('main')).toEqual(['M1', 'X1', 'X2'])

    const pulledA = await pull(A)
    expect(pulledA.state).toBe('clean')
    expect(names(A)).toEqual(['B1', 'M1', 'X1', 'X2'])
    await push(A)
    const union = ['B1', 'M1', 'X1', 'X2']
    expect(remoteNames('main')).toEqual(union)

    // B: Pull on feature/b, then switch to main.
    const pulledB = await pull(B)
    expect(pulledB.branch).toBe('feature/b')
    expect
      .soft(pulledB.fastForwarded, 'Pull on feature/b fast-forwards local main')
      .toContain('main')
    await switchTo(B, 'main')
    expect(names(B)).toEqual(union)
    expect(names(B)).toEqual(remoteNames('main'))
    expectBAtRemoteMain(B)
  }, 30_000)

  it('(e) the NEXT round: B left main after seeing the merge; A pushes again; B Pulls on feature/b and switches → still current (no local-only commit blocks the fast-forward)', async () => {
    const { A, B } = await branchesPushed({ bEditsX1: true })
    await aMergesAndPushes(A, ['feature/a', 'feature/b'])
    const union = ['A1', 'A2', 'B1', 'X1-edited-on-B', 'X2']

    // Round 1 on B: Pull on feature/b, look at main, go back to work.
    await pull(B)
    await switchTo(B, 'main')
    expect(names(B)).toEqual(union)
    await switchTo(B, 'feature/b')
    // B changed nothing on main — leaving it must not commit there. The
    // merged file lists rows in merge order, B's DB in its own insertion
    // order; that difference is not an edit.
    expect.soft(rev(B, 'main'), 'local main untouched by leaving it').toBe(remoteRev('main'))

    // Round 2: A adds to main and pushes.
    addEndpoint(A, 'A3')
    expect((await push(A)).branch).toBe('main')
    const union2 = ['A1', 'A2', 'A3', 'B1', 'X1-edited-on-B', 'X2']
    expect(remoteNames('main')).toEqual(union2)

    // B: the #135 order 2 again.
    const pulled = await pull(B)
    expect(pulled.branch).toBe('feature/b')
    expect
      .soft(pulled.fastForwarded, 'Pull on feature/b fast-forwards local main')
      .toContain('main')
    await switchTo(B, 'main')
    expect(names(B)).toEqual(union2)
    expectBAtRemoteMain(B)
  }, 30_000)
})

// ─── Issue #177: values marked secret stay on each machine ───────

function addSecretVariable(m: Machine, key: string, value: string): string {
  const envId = randomUUID()
  const varId = randomUUID()
  const now = Date.now()
  const ws = (
    m.db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(m.projectId) as {
      workspace_id: string
    }
  ).workspace_id
  m.db
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'Dev', 1, ?, ?)`,
    )
    .run(envId, ws, m.projectId, now, now)
  m.db
    .prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
       VALUES (?, ?, ?, ?, 1, 1, ?)`,
    )
    .run(varId, envId, key, value, `${value}-init`)
  return varId
}

function addBearerMcpMock(m: Machine, token: string): string {
  const id = randomUUID()
  const now = Date.now()
  m.db
    .prepare(
      `INSERT INTO mock_mcp_servers (id, project_id, name, port, auth_mode, bearer_token, created_at, updated_at)
       VALUES (?, ?, 'MCP mock', 4777, 'bearer', ?, ?, ?)`,
    )
    .run(id, m.projectId, token, now, now)
  return id
}

function secretsOf(m: Machine, varId: string, mcpId: string): Record<string, unknown> {
  const v = m.db
    .prepare('SELECT value, initial_value FROM environment_variables WHERE id = ?')
    .get(varId) as { value: string; initial_value: string } | undefined
  const mcp = m.db.prepare('SELECT bearer_token FROM mock_mcp_servers WHERE id = ?').get(mcpId) as
    | { bearer_token: string }
    | undefined
  return { value: v?.value, initial_value: v?.initial_value, bearer: mcp?.bearer_token }
}

function remoteText(branch: string): string {
  const listed = execFileSync('git', ['--git-dir', remote, 'ls-tree', '--name-only', branch], {
    encoding: 'utf-8',
  })
    .split('\n')
    .filter((f) => f.endsWith('.json'))
  return execFileSync('git', ['--git-dir', remote, 'show', `${branch}:${listed[0]}`], {
    encoding: 'utf-8',
  })
}

describe('values marked secret stay on each machine (issue #177)', () => {
  it('Push blanks them on the remote; Pull and branch switches keep each machine’s own values without an Auto-save commit', async () => {
    const A = machine('A')
    const B = machine('B')
    const varId = addSecretVariable(A, 'token', 'A-secret')
    const mcpId = addBearerMcpMock(A, 'A-mcp-token')
    addEndpoint(A, 'A1')
    await push(A)

    // The remote file has the rows, the `secret` flag and '' — never A's values.
    const fileA = JSON.parse(remoteText('main')) as {
      environmentVariables: Record<string, unknown>[]
      mockMcpServers: Record<string, unknown>[]
    }
    expect(fileA.environmentVariables.find((r) => r.id === varId)).toMatchObject({
      key: 'token',
      secret: 1,
      value: '',
      initial_value: '',
    })
    expect(fileA.mockMcpServers.find((r) => r.id === mcpId)).toMatchObject({
      auth_mode: 'bearer',
      bearer_token: '',
    })
    expect(remoteText('main')).not.toMatch(/A-secret|A-mcp-token/)
    // A keeps its own values.
    expect(secretsOf(A, varId, mcpId)).toEqual({
      value: 'A-secret',
      initial_value: 'A-secret-init',
      bearer: 'A-mcp-token',
    })

    // B (fresh machine): the rows arrive blank; B types in its own values.
    await pull(B)
    expect(secretsOf(B, varId, mcpId)).toEqual({ value: '', initial_value: '', bearer: '' })
    B.db
      .prepare('UPDATE environment_variables SET value = ?, initial_value = ? WHERE id = ?')
      .run('B-secret', 'B-secret-init', varId)
    B.db.prepare('UPDATE mock_mcp_servers SET bearer_token = ? WHERE id = ?').run('B-mcp', mcpId)
    const bOwn = { value: 'B-secret', initial_value: 'B-secret-init', bearer: 'B-mcp' }

    // A pushes an unrelated change; B's Pull (merge + base) keeps B's values.
    addEndpoint(A, 'A2')
    await push(A)
    await pull(B)
    expect(names(B)).toEqual(['A1', 'A2'])
    expect(secretsOf(B, varId, mcpId)).toEqual(bOwn)

    // Switch away and back (replace re-imports): values kept, and leaving
    // `main` commits nothing — the stripped DB equals the stripped file.
    await createBranch(B, 'feature', 'main')
    const mainBefore = git(B.localPath, 'rev-parse', 'main')
    await switchTo(B, 'feature')
    expect(secretsOf(B, varId, mcpId)).toEqual(bOwn)
    expect(git(B.localPath, 'rev-parse', 'main'), 'no Auto-save commit on main').toBe(mainBefore)
    const featureBefore = git(B.localPath, 'rev-parse', 'feature')
    await switchTo(B, 'main')
    expect(secretsOf(B, varId, mcpId)).toEqual(bOwn)
    expect(git(B.localPath, 'rev-parse', 'feature'), 'no Auto-save commit on feature').toBe(
      featureBefore,
    )

    // B pushes real work: B's values do not leak either, and A keeps its own.
    addEndpoint(B, 'B1')
    await push(B)
    expect(remoteText('main')).not.toMatch(/B-secret|B-mcp|A-secret|A-mcp-token/)
    await pull(A)
    expect(names(A)).toEqual(['A1', 'A2', 'B1'])
    expect(secretsOf(A, varId, mcpId)).toEqual({
      value: 'A-secret',
      initial_value: 'A-secret-init',
      bearer: 'A-mcp-token',
    })
  }, 30_000)
})
