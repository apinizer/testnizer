/**
 * Issue #207 — local Commit, Discard and the pre-commit changes summary,
 * separate from Push. REAL git against a bare remote, real export/import,
 * one in-memory DB per machine (see `real-git-fixture.ts`); no git mocks.
 *
 *   git:commit   commits locally with the typed message; the remote is
 *                untouched until Push (Commit and push = git:push + message)
 *   git:changes  row-level A/M/D list of what a commit would write, plus
 *                ahead / behind from LOCAL refs (no fetch)
 *   git:discard  DB + checkout back to HEAD; secrets survive; refused
 *                mid-merge
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import { createRealGitFixture, type RealGitFixture, type Machine } from './real-git-fixture'
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
const { openSecret } = await import('../../../src/main/lib/secret-at-rest')
const { GIT_MERGE_IN_PROGRESS_ERROR, GIT_NOTHING_COMMITTED_ERROR } =
  await import('../../../src/shared/git-changes')

let root: string
let fx: RealGitFixture

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'testnizer-git-commit-'))
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

const commit = (m: Machine, message?: string): Promise<GitCommitOutcome> =>
  fx.ok('git:commit', fx.on(m).projectId, message)
const changes = (m: Machine): Promise<GitChangesSummary> => fx.ok('git:changes', fx.on(m).projectId)
const discard = (m: Machine): Promise<{ discarded: boolean; file: string }> =>
  fx.ok('git:discard', fx.on(m).projectId)
const remoteSha = (branch: string): string =>
  fx.git(root, '--git-dir', fx.remote, 'rev-parse', branch)
const lastMessage = (m: Machine): string => fx.git(m.localPath, 'log', '-1', '--format=%s')

function workspaceOf(m: Machine): string {
  return (
    m.db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(m.projectId) as {
      workspace_id: string
    }
  ).workspace_id
}

function addFolder(m: Machine, name: string): string {
  const id = randomUUID()
  m.db
    .prepare(
      'INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, NULL, ?, 0)',
    )
    .run(id, m.projectId, name)
  return id
}

function addVariable(m: Machine, envName: string, key: string, value: string, secret = 0): string {
  const now = Date.now()
  let env = m.db
    .prepare('SELECT id FROM environments WHERE project_id = ? AND name = ?')
    .get(m.projectId, envName) as { id: string } | undefined
  if (!env) {
    env = { id: randomUUID() }
    m.db
      .prepare(
        `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(env.id, workspaceOf(m), m.projectId, envName, now, now)
  }
  const id = randomUUID()
  m.db
    .prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(id, env.id, key, value, secret, value)
  return id
}

/** The plaintext the machine holds — values marked secret are sealed at rest (issue #239). */
function variable(m: Machine, id: string): { value: string; initial_value: string } | undefined {
  const row = m.db
    .prepare('SELECT value, initial_value FROM environment_variables WHERE id = ?')
    .get(id) as { value: string; initial_value: string } | undefined
  if (!row) return row
  return { value: openSecret(row.value).value, initial_value: openSecret(row.initial_value).value }
}

/** Commit a file straight into the bare remote through a throwaway clone. */
function commitToRemote(branch: string, file: string, content: string, message: string): void {
  const dir = join(root, `raw-${randomUUID().slice(0, 8)}`)
  fx.git(root, 'clone', '--branch', branch, fx.remote, dir)
  writeFileSync(join(dir, file), content, 'utf-8')
  fx.git(dir, 'add', file)
  fx.git(dir, '-c', 'user.name=raw', '-c', 'user.email=raw@x', 'commit', '-m', message)
  fx.git(dir, 'push', 'origin', branch)
}

describe('git:commit — local only (issue #207)', () => {
  it('commits with the typed message; the remote does not move until Push', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    const remoteBefore = remoteSha('main')

    fx.addEndpoint(A, 'A2')
    const done = await commit(A, '  feat: add A2 locally  ')
    expect(done.committed).toBe(true)
    expect(done.branch).toBe('main')
    expect(done.sha).toBe(fx.git(A.localPath, 'rev-parse', 'HEAD'))
    expect(lastMessage(A)).toBe('feat: add A2 locally')

    // Remote untouched: same ref, still only A1.
    expect(remoteSha('main')).toBe(remoteBefore)
    expect(fx.remoteNames('main')).toEqual(['A1'])
    const after = await changes(A)
    expect(after.items).toEqual([])
    expect(after).toMatchObject({ ahead: 1, behind: 0, hasUpstream: true, branch: 'main' })

    // Push ships the local commit as it is (no second commit).
    await fx.push(A)
    expect(remoteSha('main')).toBe(done.sha)
    expect(fx.remoteNames('main')).toEqual(['A1', 'A2'])
    expect((await changes(A)).ahead).toBe(0)
  }, 30_000)

  it('Commit and push (git:push with the message) commits AND moves the remote', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    const remoteBefore = remoteSha('main')

    fx.addEndpoint(A, 'A2')
    const pushed = await fx.ok<{ committed: boolean }>('git:push', fx.on(A).projectId, {
      commitMessage: 'feat: add A2 and push',
    })
    expect(pushed.committed).toBe(true)
    expect(remoteSha('main')).not.toBe(remoteBefore)
    expect(fx.git(root, '--git-dir', fx.remote, 'log', '-1', '--format=%s', 'main')).toBe(
      'feat: add A2 and push',
    )
    expect(fx.remoteNames('main')).toEqual(['A1', 'A2'])
  }, 30_000)

  it('nothing new → committed:false, not an error; blank message → the default; no token needed', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    const head = fx.git(A.localPath, 'rev-parse', 'HEAD')

    const none = await commit(A, 'nothing to say')
    expect(none).toMatchObject({ committed: false, sha: head })
    expect(fx.git(A.localPath, 'rev-parse', 'HEAD')).toBe(head)

    // Commit is local: it works without a token (Push would refuse).
    ;(storeState.git[A.projectId] as { token: string }).token = ''
    fx.addEndpoint(A, 'A2')
    const made = await commit(A, '   ')
    expect(made.committed).toBe(true)
    expect(lastMessage(A)).toMatch(/^Update Shared APIs — /)
  }, 30_000)

  it('the first commit of a fresh project lands on the configured branch', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    const done = await commit(A, 'first')
    expect(done).toMatchObject({ committed: true, branch: 'main' })
    expect(fx.git(A.localPath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(fx.remoteBranches()).toEqual([]) // nothing pushed
    expect(await changes(A)).toMatchObject({ items: [], ahead: 1, hasUpstream: false })
  }, 30_000)
})

describe('git:changes — the pre-commit summary (issue #207)', () => {
  it('lists an added endpoint, a modified variable and a deleted folder; empty right after Commit', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'Orders')
    const folderId = addFolder(A, 'Legacy')
    const varId = addVariable(A, 'Dev', 'baseUrl', 'https://v1.example')
    await fx.push(A)
    expect((await changes(A)).items).toEqual([])

    const added = fx.addEndpoint(A, 'Payments')
    A.db
      .prepare('UPDATE environment_variables SET value = ? WHERE id = ?')
      .run('https://v2.example', varId)
    A.db.prepare('DELETE FROM folders WHERE id = ?').run(folderId)

    const summary = await changes(A)
    expect(summary.items).toEqual([
      { kind: 'folder', id: folderId, name: 'Legacy', change: 'deleted' },
      { kind: 'endpoint', id: added, name: 'Payments', change: 'added' },
      { kind: 'variable', id: varId, name: 'Dev › baseUrl', change: 'modified' },
    ])
    // Read-only: computing the summary wrote nothing.
    expect(fx.git(A.localPath, 'status', '--porcelain')).toBe('')

    await commit(A, 'edit collection')
    expect((await changes(A)).items).toEqual([])
  }, 30_000)

  it('a per-machine header difference is not a change; a rename is one `project` item', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)

    // Per-machine header fields (save mode, timestamps, sort order) differ
    // from the committed header — not content.
    A.db
      .prepare('UPDATE projects SET save_mode = ?, updated_at = ?, sort_order = ? WHERE id = ?')
      .run('git', Date.now() + 5_000, 7, A.projectId)
    expect((await changes(A)).items).toEqual([])

    // Machine B pulled A's file: it carries A's project id and A's
    // project_id / workspace_id on every row. Still nothing to commit.
    const B = fx.machine('B')
    await fx.pull(B)
    expect(fx.names(B)).toEqual(['A1'])
    expect((await changes(B)).items).toEqual([])

    // The visible name DOES travel with the file, so a commit would write it.
    A.db
      .prepare('UPDATE projects SET display_name = ? WHERE id = ?')
      .run('Shared APIs v2', A.projectId)
    expect((await changes(A)).items).toEqual([
      { kind: 'project', id: A.projectId, name: 'Shared APIs v2', change: 'modified' },
    ])
  }, 30_000)

  it('ahead / behind come from local refs: a remote-only commit counts only after a fetch', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    expect(await changes(A)).toMatchObject({ ahead: 0, behind: 0, hasUpstream: true })

    fx.addEndpoint(A, 'A2')
    await commit(A, 'local work')
    expect(await changes(A)).toMatchObject({ ahead: 1, behind: 0 })

    // Someone else pushes to main.
    commitToRemote('main', 'notes.md', '# team notes\n', 'remote-only work')
    // No network in git:changes — the remote commit is unknown until a fetch.
    expect(await changes(A)).toMatchObject({ ahead: 1, behind: 0 })
    fx.git(A.localPath, 'fetch', 'origin')
    expect(await changes(A)).toMatchObject({ ahead: 1, behind: 1, hasUpstream: true })
  }, 30_000)
})

describe('git:discard — back to the last commit (issue #207)', () => {
  it('restores a deleted endpoint, reverts a modified one, drops an added one; a secret value survives', async () => {
    const A = fx.machine('A')
    const keep = fx.addEndpoint(A, 'Keep')
    const gone = fx.addEndpoint(A, 'Gone')
    const secretId = addVariable(A, 'Dev', 'token', 'S3cret-local', 1)
    await fx.push(A)
    // The committed file never holds the secret value.
    expect(JSON.stringify(fx.remoteFile('main'))).not.toContain('S3cret-local')

    A.db.prepare('DELETE FROM endpoints WHERE id = ?').run(gone)
    A.db.prepare('UPDATE endpoints SET name = ? WHERE id = ?').run('Keep (edited)', keep)
    fx.addEndpoint(A, 'Uncommitted')
    expect((await changes(A)).items.map((i) => `${i.change}:${i.name}`).sort()).toEqual([
      'added:Uncommitted',
      'deleted:Gone',
      'modified:Keep (edited)',
    ])

    const head = fx.git(A.localPath, 'rev-parse', 'HEAD')
    const res = await discard(A)
    expect(res).toEqual({ discarded: true, file: 'Shared-APIs.json' })
    expect(fx.names(A)).toEqual(['Gone', 'Keep'])
    expect(variable(A, secretId)).toEqual({ value: 'S3cret-local', initial_value: 'S3cret-local' })
    expect(fx.git(A.localPath, 'rev-parse', 'HEAD')).toBe(head)
    expect(fx.git(A.localPath, 'status', '--porcelain')).toBe('')
    expect((await changes(A)).items).toEqual([])
  }, 30_000)

  it('reverts an uncommitted project rename (the DB name points at a file HEAD lacks)', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    A.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run('Renamed APIs', A.projectId)
    fx.addEndpoint(A, 'A2')
    // A Push that failed after staging would leave the renamed file behind.
    writeFileSync(
      join(A.localPath, 'Renamed-APIs.json'),
      JSON.stringify({ project: { id: A.projectId } }),
    )
    fx.git(A.localPath, 'add', 'Renamed-APIs.json')

    await discard(A)
    expect(fx.names(A)).toEqual(['A1'])
    const name = (
      A.db.prepare('SELECT name FROM projects WHERE id = ?').get(A.projectId) as {
        name: string
      }
    ).name
    expect(name).toBe('Shared APIs')
    expect(fx.git(A.localPath, 'status', '--porcelain')).toBe('')
  }, 30_000)

  it('is refused while a merge is in progress (and so is Commit)', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    // The remote's copy is corrupted, so the row-level auto-merge declines.
    commitToRemote('main', 'Shared-APIs.json', '{ definitely not json', 'corrupt')
    fx.addEndpoint(A, 'A2')
    await commit(A, 'local A2')
    const pulled = await fx.pull(A)
    expect(pulled.state).toBe('conflicted')

    const refused = await fx.call('git:discard', fx.on(A).projectId)
    expect(refused).toEqual({ success: false, error: GIT_MERGE_IN_PROGRESS_ERROR })
    expect(fx.names(A)).toEqual(['A1', 'A2']) // DB untouched
    const commitRefused = await fx.call('git:commit', A.projectId, 'close it')
    expect(commitRefused).toEqual({ success: false, error: GIT_MERGE_IN_PROGRESS_ERROR })
  }, 30_000)

  it('is refused when nothing was ever committed (it would empty the project)', async () => {
    const A = fx.machine('A')
    fx.addEndpoint(A, 'A1')
    expect(await fx.call('git:discard', fx.on(A).projectId)).toEqual({
      success: false,
      error: GIT_NOTHING_COMMITTED_ERROR,
    })
    expect(fx.names(A)).toEqual(['A1'])
  }, 30_000)
})
