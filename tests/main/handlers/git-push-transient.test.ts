/**
 * Transient remote failures on Push (tester report): GitHub now and then
 * answers a push with `remote: Internal Server Error` (a 5xx with a request
 * id); an immediate second click works. The app used to surface the raw
 * stderr and do nothing else.
 *
 * Real git, real simple-git, real export: the bare remote carries a
 * `pre-receive` hook that refuses the first K pushes with
 * "Internal Server Error" (a counter file in the bare repo), then accepts.
 *
 *   K=1 → the shared `pushWithRetry` retries, `git:push` succeeds on the
 *         FIRST call, `committed: true`, exactly one new commit on the remote.
 *   K=3 → retries are exhausted, the user gets the "temporary server error,
 *         try Push again" message; the second click succeeds with
 *         `committed: false` and the remote still holds exactly ONE commit —
 *         i.e. retrying from the UI never creates a duplicate commit.
 *   Non-transient refusal (branch-protection style hook) → no retry: the hook
 *         runs once.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import { createRealGitFixture, type RealGitFixture } from './real-git-fixture'

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

// `tmpdir()` as save.handler sees it: a per-test dir when `tmpState.dir` is
// set, so a test can list the temp clones a handler left behind (issue #301).
const tmpState = vi.hoisted(() => ({ dir: '' }))
vi.mock('os', async (importOriginal) => {
  const real = await importOriginal<typeof import('os')>()
  const tmpdir = (): string => tmpState.dir || real.tmpdir()
  return { ...real, default: { ...real, tmpdir }, tmpdir }
})

let currentDb: Database.Database
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => currentDb,
}))

const storeState = vi.hoisted(() => ({
  git: {} as Record<string, unknown>,
  /** Every `settings.set(key, …)` key, in order (save:git persists the remote). */
  sets: [] as string[],
}))
class FakeStore {
  get(key: string): unknown {
    return key === 'git' ? storeState.git : undefined
  }
  set(key: string): void {
    storeState.sets.push(key)
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')
const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')
const gitConfig = await import('../../../src/main/lib/git-config')

let root: string
let fx: RealGitFixture

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'testnizer-git-transient-'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  harness.reset()
  storeState.git = {}
  storeState.sets = []
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
  // Real child processes — no fake timers; just remove the backoff.
  gitConfig._setPushRetryDelays?.([0, 0])
})
afterEach(() => {
  gitConfig._setPushRetryDelays?.(null)
  tmpState.dir = ''
})

/**
 * `pre-receive` that refuses the first `failures` pushes with `message`, then
 * accepts. `runs` counts every invocation so a test can prove "no retry".
 */
function installFlakyHook(failures: number, message = 'Internal Server Error'): void {
  writeFileSync(join(fx.remote, 'fail-remaining'), String(failures), 'utf-8')
  writeFileSync(join(fx.remote, 'runs'), '0', 'utf-8')
  const hook = join(fx.remote, 'hooks', 'pre-receive')
  writeFileSync(
    hook,
    [
      '#!/bin/sh',
      'cat > /dev/null',
      'runs=$(cat runs)',
      'echo $((runs + 1)) > runs',
      'n=$(cat fail-remaining)',
      'if [ "$n" -gt 0 ]; then',
      '  echo $((n - 1)) > fail-remaining',
      `  echo "${message}" >&2`,
      '  exit 1',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    'utf-8',
  )
  chmodSync(hook, 0o755)
  // Immune to a developer's global `core.hooksPath` (the hook would never run).
  fx.git(root, '--git-dir', fx.remote, 'config', 'core.hooksPath', join(fx.remote, 'hooks'))
}

const hookRuns = (): number => Number(readFileSync(join(fx.remote, 'runs'), 'utf-8').trim())

/** Commits on the remote branch (0 when the branch does not exist yet). */
function remoteCommitCount(branch: string): number {
  try {
    return Number(fx.git(root, '--git-dir', fx.remote, 'rev-list', '--count', branch))
  } catch {
    return 0
  }
}

type PushData = { branch: string; pushed: boolean; committed: boolean }

describe('git:push — transient remote error (GitHub 500)', () => {
  it('one transient failure: retried inside the same call — success, committed, ONE commit on the remote', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    installFlakyHook(1)

    const res = await fx.call<PushData>('git:push', fx.on(a).projectId)
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    expect(res.data?.committed).toBe(true)
    expect(hookRuns()).toBe(2)
    expect(remoteCommitCount('main')).toBe(1)
    expect(fx.git(a.localPath, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(fx.remoteNames('main')).toEqual(['Health'])
  })

  it('retries exhausted: clear message, then the second click pushes WITHOUT a new commit', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    installFlakyHook(3)

    const first = await fx.call<PushData>('git:push', fx.on(a).projectId)
    expect(first.success).toBe(false)
    expect(first.error).toContain(gitConfig.GIT_PUSH_TRANSIENT_ERROR)
    expect(first.error).not.toBe(gitConfig.GIT_PUSH_REJECTED_ERROR)
    expect(hookRuns()).toBe(3) // 1 attempt + 2 retries
    expect(remoteCommitCount('main')).toBe(0)
    // The commit is safe locally.
    expect(fx.git(a.localPath, 'rev-list', '--count', 'HEAD')).toBe('1')

    const second = await fx.ok<PushData>('git:push', a.projectId)
    expect(second.committed).toBe(false)
    expect(remoteCommitCount('main')).toBe(1)
    expect(fx.git(a.localPath, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(fx.remoteNames('main')).toEqual(['Health'])
  })

  it('a non-transient refusal (protected branch) is NOT retried', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    installFlakyHook(5, 'GH006: Protected branch update failed for refs/heads/main.')

    const res = await fx.call<PushData>('git:push', fx.on(a).projectId)
    expect(res.success).toBe(false)
    expect(hookRuns()).toBe(1)
    expect(res.error ?? '').not.toContain(gitConfig.GIT_PUSH_TRANSIENT_ERROR ?? '\u0000')
  })
})

describe('git:createBranch — transient error on the upstream push is retried', () => {
  it('remotePushed stays true after one 500', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    await fx.push(a)
    installFlakyHook(1)
    const out = await fx.createBranch(a, 'feature', 'main')
    expect(out.remotePushed).toBe(true)
    expect(fx.remoteBranches()).toContain('feature')
  })
})

describe('save:gitPush / save:git (temp clone) — retried, one commit', () => {
  it('save:gitPush: one transient failure → success, exactly one commit', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    await fx.push(a)
    const before = remoteCommitCount('main')
    fx.addEndpoint(a, 'Users')
    installFlakyHook(1)
    const res = await fx.call<{ message?: string }>('save:gitPush', {
      projectId: fx.on(a).projectId,
      commitMessage: 'from save modal',
    })
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    expect(remoteCommitCount('main')).toBe(before + 1)
    expect(hookRuns()).toBe(2)
  })

  it('save:gitPush: retries exhausted → message says nothing is lost / try again', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    await fx.push(a)
    const before = remoteCommitCount('main')
    fx.addEndpoint(a, 'Users')
    installFlakyHook(3)
    const res = await fx.call('save:gitPush', { projectId: fx.on(a).projectId })
    expect(res.success).toBe(false)
    expect(res.error).toContain(gitConfig.GIT_PUSH_TRANSIENT_ERROR)
    expect(remoteCommitCount('main')).toBe(before)
    // Retry from the UI → exactly one new commit.
    await fx.ok('save:gitPush', { projectId: a.projectId })
    expect(remoteCommitCount('main')).toBe(before + 1)
  })

  it('save:git: one transient failure → success', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    installFlakyHook(1)
    const res = await fx.call('save:git', {
      projectId: fx.on(a).projectId,
      repoUrl: fx.remote,
      branch: 'main',
      username: 'u',
      token: 'x',
      commitMessage: 'manual',
    })
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    expect(remoteCommitCount('main')).toBe(1)
    expect(existsSync(join(fx.remote, 'runs'))).toBe(true)
  })
})

/*
 * Lost acknowledgment on the temp-clone paths (issue #301). The remote can
 * accept a push while the client sees a failure (ack lost, retries failed),
 * so the user clicks again. That click clones a fresh copy which ALREADY holds
 * the first commit; the export it writes differs only in its regenerated
 * `exportedAt`, and used to be committed as a second, content-free commit. A
 * post-receive hook cannot fake the lost ack (git ignores its exit code), so
 * these tests take the state right after it: the remote holds the project and
 * the same, unchanged project is saved again.
 */
describe('save:gitPush / save:git (temp clone) — an unchanged project makes no new commit (issue #301)', () => {
  it('save:gitPush: second click after the remote took the first push → noChanges, no commit', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    await fx.ok('save:gitPush', { projectId: fx.on(a).projectId })
    const before = remoteCommitCount('main')
    expect(before).toBe(1)

    const second = await fx.ok<{ noChanges?: boolean }>('save:gitPush', {
      projectId: a.projectId,
    })
    expect(second.noChanges).toBe(true)
    expect(remoteCommitCount('main')).toBe(before)
  })

  it('save:gitPush: a real change after that still commits', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    await fx.ok('save:gitPush', { projectId: fx.on(a).projectId })
    fx.addEndpoint(a, 'Users')
    await fx.ok('save:gitPush', { projectId: a.projectId })
    expect(remoteCommitCount('main')).toBe(2)
    expect(fx.remoteNames('main').sort()).toEqual(['Health', 'Users'])
  })

  it('save:git: second click → "No changes to push", no commit, the remote config is still saved', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    const payload = {
      projectId: fx.on(a).projectId,
      repoUrl: fx.remote,
      branch: 'main',
      username: 'u',
      token: 'x',
      commitMessage: 'manual',
    }
    await fx.ok('save:git', payload)
    expect(remoteCommitCount('main')).toBe(1)

    // The lost-ack click: on HEAD the first call threw before saving the remote
    // config, so the retry is the one that has to save it, or the toolbar
    // Push / Pull keep answering "Git yapılandırması bulunamadı".
    storeState.sets = []
    const second = await fx.ok<{ message?: string }>('save:git', payload)
    expect(second.message).toBe('No changes to push')
    expect(remoteCommitCount('main')).toBe(1)
    expect(storeState.sets).toContain('git')
  })
})

describe('save:git / save:gitPush / save:gitPull — the temp clone is removed on failure too', () => {
  /** Point the handlers' `tmpdir()` at an empty dir of this test's own. */
  function isolateTmp(): string {
    tmpState.dir = join(root, `tmp-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpState.dir)
    return tmpState.dir
  }
  const clonesIn = (dir: string): string[] =>
    readdirSync(dir).filter((f) => f.startsWith('testnizer-'))

  it('save:gitPush: a push that fails leaves no testnizer-push-* dir', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    installFlakyHook(3)
    const dir = isolateTmp()
    const res = await fx.call('save:gitPush', { projectId: fx.on(a).projectId })
    expect(res.success).toBe(false)
    expect(res.error).toContain(gitConfig.GIT_PUSH_TRANSIENT_ERROR)
    expect(clonesIn(dir)).toEqual([])
  })

  it('save:git: a push that fails leaves no testnizer-git-* dir', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    installFlakyHook(3)
    const dir = isolateTmp()
    const res = await fx.call('save:git', {
      projectId: fx.on(a).projectId,
      repoUrl: fx.remote,
      branch: 'main',
      username: 'u',
      token: 'x',
      commitMessage: 'manual',
    })
    expect(res.success).toBe(false)
    expect(clonesIn(dir)).toEqual([])
  })

  it('save:gitPull: an import that throws leaves no testnizer-pull-* dir', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    await fx.ok('save:gitPush', { projectId: fx.on(a).projectId })
    // A project file the importer cannot take: a non-array section throws.
    const work = join(root, `bad-${Math.random().toString(36).slice(2)}`)
    fx.git(root, 'clone', fx.remote, work)
    const file = readdirSync(work).find((f) => f.endsWith('.json'))!
    const doc = JSON.parse(readFileSync(join(work, file), 'utf-8')) as Record<string, unknown>
    doc.endpoints = 'not-an-array'
    writeFileSync(join(work, file), JSON.stringify(doc), 'utf-8')
    fx.git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-am', 'bad')
    fx.git(work, 'push', 'origin', 'HEAD:main')

    const dir = isolateTmp()
    const res = await fx.call('save:gitPull', { projectId: a.projectId })
    expect(res.success).toBe(false)
    expect(clonesIn(dir)).toEqual([])
  })

  it('the success path still removes its clone', async () => {
    const a = fx.machine('A')
    fx.addEndpoint(a, 'Health')
    const dir = isolateTmp()
    await fx.ok('save:gitPush', { projectId: fx.on(a).projectId })
    await fx.ok('save:gitPull', { projectId: a.projectId })
    expect(clonesIn(dir)).toEqual([])
  })
})
