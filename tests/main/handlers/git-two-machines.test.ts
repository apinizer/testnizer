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
