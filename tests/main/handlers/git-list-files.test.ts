/**
 * `save:gitListFiles` — the Clone-from-Git wizard's first leg (issue #130).
 * It used to treat ANY clone failure (wrong PAT, unreachable host) as
 * "completely empty repo" and let the wizard continue; only a remote with no
 * heads is empty now, and auth / network failures surface as errors.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))
vi.mock('electron-store', () => ({
  default: class {
    get(): unknown {
      return undefined
    }
    set(): void {}
  },
}))

const remote = vi.hoisted(() => ({
  heads: '' as string,
  listRemoteError: null as Error | null,
  cloneError: null as Error | null,
  calls: [] as string[],
}))
vi.mock('simple-git', () => {
  const makeInstance = () => {
    const instance = {
      env: () => instance,
      getConfig: async () => ({ key: 'user.name', value: 'u', values: [], scopes: new Map() }),
      addConfig: async () => {},
      listRemote: async (args: string[]) => {
        remote.calls.push(`ls-remote ${args.join(' ')}`)
        if (remote.listRemoteError) throw remote.listRemoteError
        return remote.heads
      },
      clone: async (url: string, _dir: string, opts?: string[]) => {
        remote.calls.push(`clone ${url}${opts?.length ? ' ' + opts.join(' ') : ''}`)
        if (remote.cloneError) throw remote.cloneError
      },
      init: async () => {
        remote.calls.push('init')
      },
      addRemote: async () => {},
    }
    return instance
  }
  return { simpleGit: () => makeInstance() }
})

const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')

const REPO = 'https://github.com/acme/apis.git'
const payload = { repoUrl: REPO, branch: 'main', username: 'u', token: 'ghp_secret' }
type Result = {
  success: boolean
  error?: string
  data?: { isEmpty: boolean; files: unknown[]; tmpDir: string }
}
const list = () => harness.invoke('save:gitListFiles', payload) as Promise<Result>

beforeEach(() => {
  harness.reset()
  remote.heads = ''
  remote.listRemoteError = null
  remote.cloneError = null
  remote.calls.length = 0
  testDb = createTestDb()
  registerSaveHandlers()
})

describe('save:gitListFiles decides from ls-remote', () => {
  it('no heads → isEmpty, nothing cloned, no phantom init', async () => {
    const res = await list()
    expect(res.success).toBe(true)
    expect(res.data?.isEmpty).toBe(true)
    expect(remote.calls.some((c) => c.startsWith('clone'))).toBe(false)
  })

  it('configured branch exists → shallow single-branch clone of it', async () => {
    remote.heads = 'abc\trefs/heads/main\ndef\trefs/heads/dev\n'
    const res = await list()
    expect(res.success).toBe(true)
    expect(res.data?.isEmpty).toBe(false)
    expect(remote.calls).toContain(`clone ${REPO} --branch main --single-branch --depth 1`)
  })

  it('remote only has `master` → clone its default branch instead', async () => {
    remote.heads = 'abc\trefs/heads/master\n'
    const res = await list()
    expect(res.success).toBe(true)
    expect(res.data?.isEmpty).toBe(false)
    expect(remote.calls).toContain(`clone ${REPO} --depth 1`)
  })

  it('401 on ls-remote → explicit auth error (token redacted), NOT "empty repo"', async () => {
    remote.listRemoteError = new Error(
      "fatal: Authentication failed for 'https://github.com/acme/apis.git/' ghp_secret",
    )
    const res = await list()
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/kimlik doğrulaması/i)
    expect(res.error).not.toContain('ghp_secret')
    expect(remote.calls.some((c) => c.startsWith('clone'))).toBe(false)
  })

  it('unreachable remote → explicit error, NOT "empty repo"', async () => {
    remote.listRemoteError = new Error(
      'fatal: unable to access: Could not resolve host: github.com',
    )
    const res = await list()
    expect(res.success).toBe(false)
    expect(res.error).toContain('Could not resolve host')
  })

  it('a clone that fails after ls-remote succeeded is an error, not an empty repo', async () => {
    remote.heads = 'abc\trefs/heads/main\n'
    remote.cloneError = new Error('fatal: early EOF')
    const res = await list()
    expect(res.success).toBe(false)
    expect(res.error).toContain('early EOF')
    expect(remote.calls).not.toContain('init')
  })
})
