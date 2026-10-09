/**
 * Issue #154 git follow-ups, against a REAL bare remote (no simple-git mocks):
 *
 *   B. `sameExport` canonicalises both sides through the same JSON round
 *      trip — an `undefined` field or a `Date` in the live export object must
 *      not read as a change (it would produce a needless "Auto-save" commit).
 *   C. `git:push` with the project file present in the checkout but never
 *      committed (untracked, or staged by an earlier push whose commit never
 *      happened) adds + commits it and reports `committed: true`. Before the
 *      fix the "same content as the DB" early return skipped `git add`, so
 *      Push reported success with `committed: false` and the remote never
 *      received the file.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import { createRealGitFixture, PROJECT_FILE, type RealGitFixture } from './real-git-fixture'

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

const { registerGitHandlers, sameExport } = await import('../../../src/main/ipc/git.handler')
const { registerSaveHandlers, exportProjectData } =
  await import('../../../src/main/ipc/save.handler')

let root: string
let fx: RealGitFixture

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'testnizer-git-154-'))
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

/** Write the project's export exactly as Push would, without committing it. */
function writeExportUncommitted(m: { projectId: string; localPath: string }): void {
  const data = exportProjectData(m.projectId)
  writeFileSync(join(m.localPath, PROJECT_FILE), JSON.stringify(data, null, 2), 'utf-8')
}

describe('sameExport canonicalisation (issue #154 B)', () => {
  it('an export object with undefined fields and a Date equals its written-and-parsed file form', () => {
    const live: Record<string, unknown> = {
      version: '1.0',
      exportedAt: new Date(0),
      project: { id: 'p1', name: 'Shared APIs', display_name: undefined, description: null },
      someFutureField: undefined,
      generatedAt: new Date('2026-01-02T03:04:05.000Z'),
      endpoints: [
        {
          id: 'e1',
          project_id: 'p1',
          name: 'A1',
          description: undefined,
          touched: new Date('2026-01-02T03:04:05.000Z'),
        },
      ],
      folders: [],
    }
    // Production writes the file with JSON.stringify(data, null, 2).
    const onDisk = JSON.stringify(live, null, 2)
    expect(sameExport(onDisk, live)).toBe(true)
  })

  it('a real content change still compares unequal', () => {
    const live = { version: '1.0', project: { name: 'P' }, endpoints: [{ id: 'e1', name: 'A1' }] }
    const onDisk = JSON.stringify({ ...live, endpoints: [{ id: 'e1', name: 'A2' }] }, null, 2)
    expect(sameExport(onDisk, live)).toBe(false)
  })
})

describe('git:push with an uncommitted project file (issue #154 C)', () => {
  it('an UNTRACKED project file identical to the DB is added, committed and pushed (committed:true)', async () => {
    commitToRemote('main', 'notes.json', '{"note":"team notes"}\n', 'seed notes')
    const A = fx.on(fx.machine('A'))
    fx.addEndpoint(A, 'A1')
    // The checkout already holds the project file (e.g. exported there before
    // git was configured) — same content as the DB, never committed.
    writeExportUncommitted(A)

    const res = await fx.ok<{ branch: string; pushed: boolean; committed: boolean }>(
      'git:push',
      A.projectId,
    )
    expect(res).toMatchObject({ branch: 'main', pushed: true, committed: true })
    expect(fx.git(A.localPath, 'ls-files', '--', PROJECT_FILE)).toBe(PROJECT_FILE)
    expect(fx.git(A.localPath, 'status', '--porcelain')).toBe('')
    expect(fx.remoteNames('main')).toEqual(['A1'])
  }, 30_000)

  it('a STAGED-but-uncommitted project file is committed on the next Push', async () => {
    const A = fx.on(fx.machine('A'))
    fx.addEndpoint(A, 'A1')
    await fx.push(A) // seeds the remote with the file
    fx.addEndpoint(A, 'A2')
    // An earlier push wrote + staged the new state but its commit never happened.
    writeExportUncommitted(A)
    fx.git(A.localPath, 'add', PROJECT_FILE)

    const res = await fx.ok<{ committed: boolean }>('git:push', A.projectId)
    expect(res.committed).toBe(true)
    expect(fx.remoteNames('main')).toEqual(['A1', 'A2'])
  }, 30_000)

  it('nothing new (file tracked and identical) still reports committed:false and makes no commit', async () => {
    const A = fx.on(fx.machine('A'))
    fx.addEndpoint(A, 'A1')
    await fx.push(A)
    const head = fx.git(A.localPath, 'rev-parse', 'HEAD')
    const res = await fx.ok<{ committed: boolean }>('git:push', A.projectId)
    expect(res.committed).toBe(false)
    expect(fx.git(A.localPath, 'rev-parse', 'HEAD')).toBe(head)
  }, 30_000)
})
