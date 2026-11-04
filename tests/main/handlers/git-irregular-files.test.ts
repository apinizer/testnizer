/**
 * A repository can hold anything: `project.json` can be a link to a file outside
 * the checkout, or to /dev/zero. Reading it would import someone else's file or
 * hang main, and writing through it would change whatever it points at.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import {
  createRealGitFixture,
  PROJECT_FILE,
  type RealGitFixture,
  type Machine,
} from './real-git-fixture'

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

let dir: string
let fx: RealGitFixture
let A: Machine
let B: Machine

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'testnizer-git-irregular-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

beforeEach(async () => {
  harness.reset()
  storeState.git = {}
  fx = createRealGitFixture({
    root: dir,
    harness,
    setDb: (db) => {
      currentDb = db
    },
    gitStore: storeState.git,
  })
  fx.newRemote()
  registerGitHandlers()
  registerSaveHandlers()
  A = fx.machine('A')
  fx.addEndpoint(A, 'From A')
  await fx.push(A)
  B = fx.machine('B')
})

/** A commits `name` as a link to `target`, in place of whatever was there. */
function commitLink(name: string, target: string): void {
  const m = fx.on(A)
  rmSync(join(m.localPath, name), { force: true })
  symlinkSync(target, join(m.localPath, name))
  fx.git(m.localPath, 'add', name)
  fx.git(m.localPath, '-c', 'user.name=raw', '-c', 'user.email=raw@x', 'commit', '-m', 'link')
  fx.git(m.localPath, 'push', 'origin', 'HEAD')
}

describe('a project file that is a link', () => {
  it('git:pull does not import the file it points at, and says why', async () => {
    const outside = join(dir, `outside-${randomUUID()}.json`)
    writeFileSync(
      outside,
      JSON.stringify({
        version: '1',
        kind: 'project',
        project: { name: 'Stolen' },
        folders: [],
        endpoints: [{ id: 'stolen', name: 'Read through the link', status: 'developing' }],
        savedRequests: [],
      }),
    )
    commitLink(PROJECT_FILE, outside)

    const res = await fx.call('git:pull', fx.on(B).projectId)
    expect(fx.names(fx.on(B))).not.toContain('Read through the link')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/link or a special file/)
  })

  it('save:gitPull refuses it too', async () => {
    const outside = join(dir, `outside-${randomUUID()}.json`)
    writeFileSync(outside, JSON.stringify({ version: '1', project: {}, endpoints: [] }))
    commitLink(PROJECT_FILE, outside)
    const res = await fx.call('save:gitPull', { projectId: fx.on(B).projectId })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/link or a special file/)
  })

  it('git:push replaces the link instead of writing through it', async () => {
    const outside = join(dir, `victim-${randomUUID()}.json`)
    writeFileSync(outside, 'keep me')
    const m = fx.on(A)
    rmSync(join(m.localPath, PROJECT_FILE), { force: true })
    symlinkSync(outside, join(m.localPath, PROJECT_FILE))
    fx.addEndpoint(m, 'After the link')

    await fx.push(m)
    expect(readFileSync(outside, 'utf-8')).toBe('keep me')
    expect(lstatSync(join(m.localPath, PROJECT_FILE)).isFile()).toBe(true)
    expect(fx.remoteNames('main')).toContain('After the link')
  })

  // Not run against old code: reading /dev/zero never ends.
  it('a link to /dev/zero is reported, not read', async () => {
    commitLink(PROJECT_FILE, '/dev/zero')
    const started = Date.now()
    const res = await fx.call('git:pull', fx.on(B).projectId)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/link or a special file/)
    expect(Date.now() - started).toBeLessThan(15_000)
  })
})

describe('save:gitDiff', () => {
  it('compares with this project’s file, not the first one listed', async () => {
    const m = fx.on(A)
    await fx.push(m)
    // Sorts ahead of the project's own file.
    const other = join(m.localPath, 'AAA-other.json')
    writeFileSync(
      other,
      JSON.stringify({
        version: '1',
        kind: 'project',
        project: { name: 'Other' },
        folders: [],
        endpoints: [{ id: 'other', name: 'From another project' }],
        savedRequests: [],
      }),
    )
    fx.git(m.localPath, 'add', 'AAA-other.json')
    fx.git(m.localPath, '-c', 'user.name=raw', '-c', 'user.email=raw@x', 'commit', '-m', 'other')
    fx.git(m.localPath, 'push', 'origin', 'HEAD')

    const res = await fx.call<{ endpoints?: { added?: unknown[]; removed?: unknown[] } }>(
      'save:gitDiff',
      { projectId: m.projectId },
    )
    expect(res.success, res.error).toBe(true)
    expect(JSON.stringify(res.data)).not.toContain('From another project')
  })
})
