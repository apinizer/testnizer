/**
 * The rest of the git lifecycle against a REAL bare remote — everything
 * `git-two-machines.test.ts` (the tester's merge flow) does not cover:
 *
 *   first push to an empty remote · remote that only has `master` · status /
 *   log / commit list · branch create (pushed) / delete (local + remote) /
 *   switch to a remote-only branch · merging a remote-only branch · a
 *   conflict the row-level auto-merge declines → user picks a side / aborts ·
 *   both sides editing the same request · project rename retiring the old
 *   file · missing token · Pull on a remote nobody pushed to yet · the
 *   wizard's inspection step (`save:gitListFiles` / `gitReadFile`) · the
 *   SaveModal's temp-clone push / pull sharing a remote with the checkout.
 *
 * Real git, real simple-git, real export/import; one in-memory DB per machine.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import { createRealGitFixture, type RealGitFixture, type Machine } from './real-git-fixture'

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
const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')
const { GIT_TOKEN_MISSING_ERROR } = await import('../../../src/main/lib/git-config')

let root: string
let fx: RealGitFixture

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'testnizer-git-lifecycle-'))
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
  registerSaveHandlers()
})

/** Commit a file straight into the bare remote through a throwaway clone. */
function commitToRemote(branch: string, file: string, content: string, message: string): void {
  const dir = join(root, `raw-${randomUUID().slice(0, 8)}`)
  fx.git(root, 'clone', fx.remote, dir)
  const hasBranch = fx.remoteBranches().includes(branch)
  if (hasBranch) fx.git(dir, 'checkout', branch)
  else fx.git(dir, 'checkout', '-b', branch)
  writeFileSync(join(dir, file), content, 'utf-8')
  fx.git(dir, 'add', file)
  fx.git(dir, '-c', 'user.name=raw', '-c', 'user.email=raw@x', 'commit', '-m', message)
  fx.git(dir, 'push', 'origin', branch)
}

describe('first contact with the remote', () => {
  it('empty remote: the first Push seeds `main`; status/log/commit-list/currentBranch/hasConfig agree', async () => {
    const A = fx.machine('A')
    expect(
      await fx.ok<{ hasGit: boolean; hasToken: boolean }>('git:hasConfig', fx.on(A).projectId),
    ).toEqual({
      hasGit: true,
      hasToken: true,
    })
    fx.addEndpoint(A, 'A1')
    expect((await fx.push(A)).branch).toBe('main')
    expect(fx.remoteBranches()).toEqual(['main'])
    expect(fx.remoteNames('main')).toEqual(['A1'])

    expect(await fx.ok<string>('git:currentBranch', fx.on(A).projectId)).toBe('main')
    const status = await fx.ok<{
      branch: string
      isClean: boolean
      commits: { message: string }[]
    }>('git:status', A.projectId)
    expect(status.branch).toBe('main')
    expect(status.isClean).toBe(true)
    expect(status.commits[0].message).toMatch(/^Update Shared APIs/)
    const log = await fx.ok<{ message: string }[]>('git:log', { projectId: A.projectId, count: 5 })
    expect(log).toHaveLength(1)
    const listed = await fx.ok<{ commits: { message: string }[]; total: number }>(
      'git:listCommits',
      {
        projectId: A.projectId,
      },
    )
    expect(listed.total).toBe(1)
  }, 20_000)

  it('Pull on a remote nobody pushed to yet is a clear no-op, not a raw git error', async () => {
    const A = fx.machine('A')
    const res = await fx.call<{ pulled: boolean; imported: boolean }>(
      'git:pull',
      fx.on(A).projectId,
    )
    expect(res.success).toBe(true)
    expect(res.data).toMatchObject({ pulled: false, imported: false })
    // …and the project can still be pushed afterwards.
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    expect(fx.remoteNames('main')).toEqual(['A1'])
  }, 20_000)

  it('remote that only has `master` (created elsewhere): `main` starts on top of it, Pull imports, Push lands on main', async () => {
    const seed = JSON.stringify({
      version: 'testnizer-project/2.0',
      exportedAt: 1,
      kind: 'project',
      project: { id: randomUUID(), name: 'Shared APIs' },
      folders: [],
      endpoints: [
        {
          id: randomUUID(),
          project_id: 'x',
          folder_id: null,
          name: 'M1',
          protocol: 'http',
          method: 'GET',
          path: '/m1',
          status: 'developing',
          sort_order: 0,
          created_at: 1,
          updated_at: 1,
        },
      ],
      endpointCases: [],
      savedRequests: [],
      environments: [],
      environmentVariables: [],
      globalVariables: [],
    })
    commitToRemote('master', 'Shared-APIs.json', seed, 'seed on master')

    const A = fx.machine('A')
    const pulled = await fx.pull(A)
    expect(pulled.imported).toBe(true)
    expect(fx.names(A)).toEqual(['M1'])
    expect(fx.git(A.localPath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    expect(fx.remoteBranches()).toEqual(['main', 'master'])
    expect(fx.remoteNames('main')).toEqual(['A1', 'M1'])
  }, 20_000)

  it('a non-empty target folder (desktop.ini) still receives the remote', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    const B = fx.machine('B')
    writeFileSync(join(B.localPath, 'desktop.ini'), '')
    expect((await fx.pull(B)).imported).toBe(true)
    expect(fx.names(B)).toEqual(['A1'])
  }, 20_000)

  it('no token → Push and Pull refuse up front with the token message', async () => {
    const A = fx.machine('A', { token: '' })
    const push = await fx.call('git:push', fx.on(A).projectId)
    const pull = await fx.call('git:pull', fx.on(A).projectId)
    expect(push).toEqual({ success: false, error: GIT_TOKEN_MISSING_ERROR })
    expect(pull).toEqual({ success: false, error: GIT_TOKEN_MISSING_ERROR })
  })
})

describe('branches', () => {
  let A: Machine
  let B: Machine
  beforeEach(async () => {
    A = fx.machine('A')
    B = fx.machine('B')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    await fx.pull(B)
  })

  it('create pushes the branch; the other machine sees it remote-only, switches to it (tracking), pushes to it', async () => {
    expect(await fx.createBranch(A, 'feature', 'main')).toEqual({
      branch: 'feature',
      remotePushed: true,
    })
    expect(fx.remoteBranches()).toEqual(['feature', 'main'])

    await fx.pull(B)
    const list = await fx.listBranches(B)
    expect(list.branches).toContainEqual({ name: 'feature', current: false, isRemote: true })

    await fx.switchTo(B, 'feature')
    expect(fx.git(B.localPath, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/feature')
    fx.addEndpoint(B, 'F1')
    expect((await fx.push(B)).branch).toBe('feature')
    expect(fx.remoteNames('feature')).toEqual(['A1', 'F1'])
    expect(fx.remoteNames('main')).toEqual(['A1'])
  }, 30_000)

  it('merging a remote-only branch (never checked out here) works and lands in the DB', async () => {
    await fx.createBranch(A, 'feature', 'main')
    await fx.switchTo(A, 'feature')
    fx.addEndpoint(A, 'F1')
    await fx.push(A)

    await fx.pull(B) // still on main; feature is remote-only for B
    expect((await fx.merge(B, 'feature')).state).toBe('clean')
    expect(fx.names(B)).toEqual(['A1', 'F1'])
    await fx.push(B)
    expect(fx.remoteNames('main')).toEqual(['A1', 'F1'])
  }, 30_000)

  it('merge with nothing new is clean and changes nothing', async () => {
    await fx.createBranch(A, 'feature', 'main')
    await fx.switchTo(A, 'main')
    const before = fx.git(A.localPath, 'rev-parse', 'HEAD')
    expect((await fx.merge(A, 'feature')).state).toBe('clean')
    expect(fx.git(A.localPath, 'rev-parse', 'HEAD')).toBe(before)
    expect(fx.names(A)).toEqual(['A1'])
  }, 30_000)

  it('delete removes the branch locally AND on the remote; the active branch cannot be deleted', async () => {
    await fx.createBranch(A, 'feature', 'main')
    await fx.switchTo(A, 'feature')
    const refused = await fx.call('git:deleteBranch', {
      projectId: A.projectId,
      branchName: 'feature',
    })
    expect(refused.success).toBe(false)

    await fx.switchTo(A, 'main')
    expect(
      await fx.ok<{ deleted: string }>('git:deleteBranch', {
        projectId: A.projectId,
        branchName: 'feature',
      }),
    ).toEqual({ deleted: 'feature' })
    expect(fx.remoteBranches()).toEqual(['main'])
    expect((await fx.listBranches(A)).branches.map((b) => b.name)).toEqual(['main'])

    // The other machine's stale `origin/feature` is pruned by its next Pull.
    await fx.pull(B)
    expect((await fx.listBranches(B)).branches.map((b) => b.name)).toEqual(['main'])
  }, 30_000)

  it('on the OTHER machine (file carries A’s project id) switching back and forth creates no header-only commits', async () => {
    await fx.createBranch(B, 'feature', 'main')
    await fx.switchTo(B, 'feature')
    const head = fx.git(B.localPath, 'rev-parse', 'HEAD')
    await fx.switchTo(B, 'main')
    await fx.switchTo(B, 'feature')
    expect((await fx.merge(B, 'main')).state).toBe('clean')
    expect(fx.git(B.localPath, 'rev-parse', 'HEAD')).toBe(head)
    expect(fx.git(B.localPath, 'status', '--porcelain')).toBe('')
  }, 30_000)

  it('switching branches carries unpushed edits with the branch they were made on', async () => {
    await fx.createBranch(A, 'feature', 'main')
    await fx.switchTo(A, 'feature')
    fx.addEndpoint(A, 'F1') // not pushed
    await fx.switchTo(A, 'main')
    expect(fx.names(A)).toEqual(['A1']) // main has no F1
    await fx.switchTo(A, 'feature')
    expect(fx.names(A)).toEqual(['A1', 'F1']) // committed on feature by the switch
    await fx.push(A)
    expect(fx.remoteNames('feature')).toEqual(['A1', 'F1'])
  }, 30_000)
})

describe('conflicts', () => {
  it('both sides edit the SAME request: the newer edit wins on Pull, nothing is lost', async () => {
    const A = fx.machine('A')
    const B = fx.machine('B')
    const id = fx.addEndpoint(A, 'A1')
    await fx.push(A)
    await fx.pull(B)

    B.db
      .prepare('UPDATE endpoints SET name = ?, updated_at = ? WHERE id = ?')
      .run('A1 (B)', 2000, id)
    await fx.push(B)
    A.db
      .prepare('UPDATE endpoints SET name = ?, updated_at = ? WHERE id = ?')
      .run('A1 (A)', 3000, id)
    expect((await fx.call('git:push', fx.on(A).projectId)).success).toBe(false) // rejected

    expect((await fx.pull(A)).state).toBe('clean')
    expect(fx.names(A)).toEqual(['A1 (A)'])
    await fx.push(A)
    expect(fx.remoteNames('main')).toEqual(['A1 (A)'])
    await fx.pull(B)
    expect(fx.names(B)).toEqual(['A1 (A)'])
  }, 30_000)

  it('a conflict the auto-merge declines (unparsable remote file) reaches the user; picking OURS commits, re-imports and lets Push through', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)

    // The remote's copy gets corrupted by something else…
    commitToRemote('main', 'Shared-APIs.json', '{ definitely not json', 'corrupt')
    // …while A keeps working and gets rejected.
    fx.addEndpoint(A, 'A2')
    expect((await fx.call('git:push', fx.on(A).projectId)).success).toBe(false)

    const pulled = await fx.pull(A)
    expect(pulled.state).toBe('conflicted')
    expect(pulled.conflicts?.map((c) => c.file)).toEqual(['Shared-APIs.json'])
    expect(fx.names(A)).toEqual(['A1', 'A2']) // DB untouched while conflicted

    const resolved = await fx.ok<{ committed: boolean; stillConflicted: boolean }>(
      'git:resolveConflict',
      { projectId: A.projectId, file: 'Shared-APIs.json', side: 'ours' },
    )
    expect(resolved).toMatchObject({ committed: true, stillConflicted: false })
    expect(fx.names(A)).toEqual(['A1', 'A2'])
    await fx.push(A)
    expect(fx.remoteNames('main')).toEqual(['A1', 'A2'])
  }, 30_000)

  it('a conflict on a NON-project file goes to the user; picking THEIRS for the project file replaces the DB with their side', async () => {
    const A = fx.machine('A')
    const B = fx.machine('B')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    await fx.pull(B)

    // Both sides commit a different `notes.json` (not a project file) AND
    // change the collection: B pushes first, A is rejected.
    writeFileSync(join(B.localPath, 'notes.json'), '{"who":"B"}')
    fx.git(B.localPath, 'add', 'notes.json')
    fx.git(B.localPath, '-c', 'user.name=b', '-c', 'user.email=b@x', 'commit', '-m', 'notes B')
    fx.addEndpoint(B, 'B1')
    await fx.push(B)

    writeFileSync(join(A.localPath, 'notes.json'), '{"who":"A"}')
    fx.git(A.localPath, 'add', 'notes.json')
    fx.git(A.localPath, '-c', 'user.name=a', '-c', 'user.email=a@x', 'commit', '-m', 'notes A')
    fx.addEndpoint(A, 'A2')
    expect((await fx.call('git:push', fx.on(A).projectId)).success).toBe(false)

    const pulled = await fx.pull(A)
    expect(pulled.state).toBe('conflicted')
    expect(pulled.conflicts?.map((c) => c.file).sort()).toEqual(['Shared-APIs.json', 'notes.json'])

    const first = await fx.ok<{ stillConflicted: boolean; remainingConflicts: string[] }>(
      'git:resolveConflict',
      { projectId: A.projectId, file: 'notes.json', side: 'theirs' },
    )
    expect(first.stillConflicted).toBe(true)
    expect(first.remainingConflicts).toEqual(['Shared-APIs.json'])

    const second = await fx.ok<{ stillConflicted: boolean; committed: boolean }>(
      'git:resolveConflict',
      { projectId: A.projectId, file: 'Shared-APIs.json', side: 'theirs' },
    )
    expect(second).toMatchObject({ stillConflicted: false, committed: true })
    // Their project file (A1, B1) replaced ours (A1, A2) — A2 is gone.
    expect(fx.names(A)).toEqual(['A1', 'B1'])
    expect(readFileSync(join(A.localPath, 'notes.json'), 'utf-8')).toBe('{"who":"B"}')
    expect(fx.git(A.localPath, 'status', '--porcelain')).toBe('')
    await fx.push(A)
    expect(fx.remoteNames('main')).toEqual(['A1', 'B1'])
  }, 30_000)

  it('abortMerge returns to the pre-pull state: clean tree, DB untouched, HEAD unchanged', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    commitToRemote('main', 'Shared-APIs.json', '{ nope', 'corrupt')
    fx.addEndpoint(A, 'A2')
    expect((await fx.call('git:push', fx.on(A).projectId)).success).toBe(false)
    const head = fx.git(A.localPath, 'rev-parse', 'HEAD')
    expect((await fx.pull(A)).state).toBe('conflicted')

    expect(await fx.ok<{ aborted: boolean }>('git:abortMerge', A.projectId)).toEqual({
      aborted: true,
    })
    expect(fx.git(A.localPath, 'status', '--porcelain')).toBe('')
    expect(fx.git(A.localPath, 'rev-parse', 'HEAD')).toBe(head)
    expect(fx.names(A)).toEqual(['A1', 'A2'])
  }, 30_000)
})

describe('project file naming', () => {
  it('renaming the project retires the old tracked file; the other machine (old name) still imports the lone file', async () => {
    const A = fx.machine('A')
    const B = fx.machine('B')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    await fx.pull(B)

    A.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run('Renamed APIs', A.projectId)
    fx.addEndpoint(A, 'A2')
    await fx.push(A)
    expect(fx.git(A.localPath, 'ls-files')).toBe('Renamed-APIs.json')
    expect(existsSync(join(A.localPath, 'Renamed-APIs.json'))).toBe(true)
    expect(fx.remoteNames('main')).toEqual(['A1', 'A2'])

    expect((await fx.pull(B)).imported).toBe(true)
    expect(fx.names(B)).toEqual(['A1', 'A2'])

    // The rename PROPAGATES: B's project now carries the new name, so B's
    // next Push writes the same file instead of resurrecting the old one.
    expect(
      (B.db.prepare('SELECT name FROM projects WHERE id = ?').get(B.projectId) as { name: string })
        .name,
    ).toBe('Renamed APIs')
    fx.addEndpoint(B, 'B1')
    await fx.push(B)
    expect(fx.git(root, '--git-dir', fx.remote, 'ls-tree', '--name-only', 'main')).toBe(
      'Renamed-APIs.json',
    )
    expect(fx.remoteNames('main')).toEqual(['A1', 'A2', 'B1'])
    await fx.pull(A)
    expect(fx.names(A)).toEqual(['A1', 'A2', 'B1'])
  }, 30_000)

  it('display name and description travel with the file too; identity fields stay local', async () => {
    const A = fx.machine('A', { name: 'My Project', displayName: 'Banking APIs' })
    A.db
      .prepare('UPDATE projects SET description = ? WHERE id = ?')
      .run('Core banking', A.projectId)
    fx.addEndpoint(A, 'A1')
    await fx.push(A)

    const B = fx.machine('B', { name: 'my-project', displayName: 'whatever I typed' })
    await fx.pull(B)
    const row = B.db
      .prepare('SELECT name, display_name, description, local_path FROM projects WHERE id = ?')
      .get(B.projectId) as {
      name: string
      display_name: string
      description: string
      local_path: string
    }
    expect(row).toMatchObject({
      name: 'My Project',
      display_name: 'Banking APIs',
      description: 'Core banking',
    })
    expect(row.local_path).toBe(B.localPath)
  }, 30_000)
})

describe('the other two git surfaces share the remote with the checkout', () => {
  it('wizard step 1: gitListFiles + gitReadFile see the pushed project (id, name, display_name); an empty remote reports isEmpty', async () => {
    const creds = { repoUrl: fx.remote, branch: 'main', username: 'u', token: 'x' }
    const empty = await fx.ok<{ tmpDir: string; files: unknown[]; isEmpty: boolean }>(
      'save:gitListFiles',
      creds,
    )
    expect(empty.isEmpty).toBe(true)
    expect(empty.files).toEqual([])
    await fx.ok('save:gitCleanup', empty.tmpDir)

    const A = fx.machine('A', { name: 'My Project', displayName: 'Banking APIs' })
    fx.addEndpoint(A, 'A1')
    await fx.push(A)

    const listed = await fx.ok<{
      tmpDir: string
      files: { name: string; path: string }[]
      isEmpty: boolean
    }>('save:gitListFiles', creds)
    expect(listed.isEmpty).toBe(false)
    expect(listed.files.map((f) => f.name)).toEqual(['My-Project.json'])
    const file = await fx.ok<{ project: { id: string; name: string; display_name: string } }>(
      'save:gitReadFile',
      listed.files[0].path,
    )
    expect(file.project).toMatchObject({
      id: A.projectId,
      name: 'My Project',
      display_name: 'Banking APIs',
    })
    await fx.ok('save:gitCleanup', listed.tmpDir)
    expect(existsSync(listed.tmpDir)).toBe(false)
  }, 30_000)

  it('SaveModal push (temp clone) then toolbar Pull on the same machine: the checkout catches up without a conflict', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)

    fx.addEndpoint(A, 'A2')
    const pushed = await fx.call<{ commit?: string }>('save:gitPush', {
      projectId: A.projectId,
      commitMessage: 'from save modal',
    })
    expect(pushed.success).toBe(true)
    expect(fx.remoteNames('main')).toEqual(['A1', 'A2'])

    // The local checkout is now one commit behind its own remote.
    const pulled = await fx.pull(A)
    expect(pulled.state).toBe('clean')
    expect(fx.names(A)).toEqual(['A1', 'A2'])
    expect(readFileSync(join(A.localPath, 'Shared-APIs.json'), 'utf-8')).toContain('"A2"')
    await fx.push(A) // nothing new to commit; must not fail
  }, 30_000)

  it('SaveModal pull (temp clone) imports the remote into the other machine', async () => {
    const A = fx.machine('A')
    const B = fx.machine('B')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    const res = await fx.call<{ imported: { endpoints: number } }>('save:gitPull', {
      projectId: fx.on(B).projectId,
    })
    expect(res.success).toBe(true)
    expect(res.data?.imported.endpoints).toBe(1)
    expect(fx.names(B)).toEqual(['A1'])
  }, 30_000)
})
