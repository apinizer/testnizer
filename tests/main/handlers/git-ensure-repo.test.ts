/**
 * `ensureGitRepo` + `git:push` staging — the failure modes that only show up
 * once authentication WORKS (issue #127 follow-up, adversarial review):
 *
 *  - unreachable remote used to fall through to `git init`, poisoning the
 *    checkout with an unrelated history (every later Push non-fast-forward)
 *  - remote created with `master` while Storage says `main`: the two Push
 *    buttons landed the project on different branches
 *  - `local_path` pointing at somebody else's checkout had its origin hijacked
 *  - Push deleted every other `.json` in `local_path` and `git add .`-ed the
 *    whole folder (Downloads…) to GitHub
 *  - "remote is ahead" surfaced as raw git text
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'

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

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const storeState = vi.hoisted(() => ({ git: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return key === 'git' ? storeState.git : undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const importSpy = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/ipc/save.handler', () => ({
  exportProjectData: vi.fn(() => ({ project: { name: 'Acme APIs' }, folders: [], endpoints: [] })),
  importProjectDataFromJson: importSpy,
}))

/** Scripted remote + recorded git calls. */
const remote = vi.hoisted(() => ({
  heads: '' as string,
  listRemoteError: null as Error | null,
  originUrl: undefined as string | undefined,
  trackedJson: '' as string,
  pushError: null as Error | null,
  calls: [] as string[],
}))
vi.mock('simple-git', () => {
  const makeInstance = () => {
    const instance = {
      env: () => instance,
      raw: async (args: string[]) => {
        remote.calls.push(`raw ${args.join(' ')}`)
        if (args[0] === 'ls-files') return remote.trackedJson
        return ''
      },
      listRemote: async (args: string[]) => {
        remote.calls.push(`ls-remote ${args.join(' ')}`)
        if (remote.listRemoteError) throw remote.listRemoteError
        return remote.heads
      },
      getRemotes: async () =>
        remote.originUrl
          ? [{ name: 'origin', refs: { fetch: remote.originUrl, push: remote.originUrl } }]
          : [],
      getConfig: async () => ({ key: 'user.name', value: 'u', values: [], scopes: new Map() }),
      addConfig: async () => {},
      fetch: async (...a: string[]) => {
        remote.calls.push(`fetch ${a.join(' ')}`)
      },
      branch: async () => ({ branches: {}, current: 'main', all: [] }),
      revparse: async () => 'main',
      checkout: async (a: string[]) => {
        remote.calls.push(`checkout ${a.join(' ')}`)
      },
      checkoutLocalBranch: async (b: string) => {
        remote.calls.push(`checkoutLocalBranch ${b}`)
      },
      push: async () => {
        remote.calls.push('push')
        if (remote.pushError) throw remote.pushError
      },
      pull: async () => ({ summary: {} }),
      add: async (files: string | string[]) => {
        remote.calls.push(`add ${Array.isArray(files) ? files.join(' ') : files}`)
      },
      rm: async (files: string[]) => {
        remote.calls.push(`rm ${files.join(' ')}`)
      },
      commit: async () => ({}),
      status: async () => ({ files: [], modified: [], deleted: [], staged: ['x'] }),
      log: async () => ({ all: [] }),
      init: async () => {
        remote.calls.push('init')
      },
      addRemote: async (_n: string, url: string) => {
        remote.calls.push(`addRemote ${url}`)
      },
      remote: async (args: string[]) => {
        remote.calls.push(`remote ${args.join(' ')}`)
      },
      clone: async (url: string, _dir: string, opts?: string[]) => {
        remote.calls.push(`clone ${url}${opts?.length ? ' ' + opts.join(' ') : ''}`)
      },
    }
    return instance
  }
  return { simpleGit: () => makeInstance() }
})

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')
const { GIT_PUSH_REJECTED_ERROR } = await import('../../../src/main/lib/git-config')

const REPO = 'https://github.com/acme/apis.git'
let projectId: string
let localPath: string

beforeEach(() => {
  harness.reset()
  remote.heads = ''
  remote.listRemoteError = null
  remote.originUrl = undefined
  remote.trackedJson = ''
  remote.pushError = null
  remote.calls.length = 0
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  testDb.prepare('UPDATE projects SET name = ? WHERE id = ?').run('Acme APIs', projectId)
  localPath = mkdtempSync(join(tmpdir(), 'testnizer-ensure-'))
  testDb.prepare('UPDATE projects SET local_path = ? WHERE id = ?').run(localPath, projectId)
  storeState.git = {
    [projectId]: { repoUrl: REPO, username: 'u', branch: 'main', token: 'ghp_x' },
  }
  registerGitHandlers()
})

const push = () =>
  harness.invoke('git:push', projectId) as Promise<{ success: boolean; error?: string }>
const pull = () =>
  harness.invoke('git:pull', projectId) as Promise<{
    success: boolean
    error?: string
    data?: { pulled: boolean; imported: boolean; branch: string }
  }>

describe('git:pull reports whether a project file was actually imported', () => {
  beforeEach(() => {
    importSpy.mockClear()
    remote.heads = 'abc\trefs/heads/main\n'
  })

  it('clone landed but the checkout holds no project .json → success with imported:false', async () => {
    const res = await pull()
    expect(res.success).toBe(true)
    expect(res.data?.pulled).toBe(true)
    expect(res.data?.imported).toBe(false)
    expect(importSpy).not.toHaveBeenCalled()
  })

  it('project .json present → imported into THIS project id (machine B clone)', async () => {
    writeFileSync(join(localPath, 'acme-apis.json'), JSON.stringify({ version: '1', project: {} }))
    const res = await pull()
    expect(res.success).toBe(true)
    expect(res.data?.imported).toBe(true)
    expect(importSpy).toHaveBeenCalledTimes(1)
    expect(importSpy.mock.calls[0][1]).toBe(projectId)
  })
})

describe('ensureGitRepo decides from `ls-remote`, never from a failed clone', () => {
  it('empty remote → init locally, HEAD on the configured branch, no clone attempt', async () => {
    const res = await push()
    expect(res.success).toBe(true)
    expect(remote.calls).toContain('init')
    expect(remote.calls).toContain('raw symbolic-ref HEAD refs/heads/main')
    expect(remote.calls.some((c) => c.startsWith('clone'))).toBe(false)
  })

  it('remote has the configured branch → clone it directly', async () => {
    remote.heads = 'abc\trefs/heads/main\ndef\trefs/heads/dev\n'
    const res = await push()
    expect(res.success).toBe(true)
    expect(remote.calls).toContain(`clone ${REPO} --branch main`)
    expect(remote.calls).not.toContain('init')
  })

  it('remote has history on `master` only → clone it and START `main` on top (same as Save → Git)', async () => {
    remote.heads = 'abc\trefs/heads/master\n'
    const res = await push()
    expect(res.success).toBe(true)
    expect(remote.calls).toContain(`clone ${REPO}`)
    expect(remote.calls).toContain('checkoutLocalBranch main')
    expect(remote.calls).not.toContain('init')
  })

  it('unreachable remote → explicit error, NOTHING initialised on disk', async () => {
    remote.listRemoteError = new Error(
      "fatal: unable to access 'https://github.com/acme/apis.git/': Could not resolve host: github.com",
    )
    const res = await push()
    expect(res.success).toBe(false)
    expect(res.error).toContain('Uzak depoya erişilemedi')
    expect(res.error).toContain('Could not resolve host')
    expect(remote.calls).not.toContain('init')
    expect(remote.calls.some((c) => c.startsWith('clone'))).toBe(false)
    expect(existsSync(join(localPath, '.git'))).toBe(false)
  })

  it('401 on ls-remote → the auth message, token redacted', async () => {
    remote.listRemoteError = new Error(
      "fatal: Authentication failed for 'https://github.com/acme/apis.git/' (ghp_x)",
    )
    const res = await push()
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/kimlik doğrulaması/i)
    expect(res.error).not.toContain('ghp_x')
  })
})

describe('a NON-empty target folder (desktop.ini / .DS_Store) still lands the remote', () => {
  it('remote has the configured branch → init + fetch + checkout, no clone', async () => {
    writeFileSync(join(localPath, 'desktop.ini'), '[.ShellClassInfo]')
    remote.heads = 'abc\trefs/heads/main\n'
    const res = await pull()
    expect(res.success).toBe(true)
    expect(remote.calls).toContain('init')
    expect(remote.calls).toContain('fetch origin main')
    expect(remote.calls).toContain('checkout -b main origin/main')
    expect(remote.calls.some((c) => c.startsWith('clone'))).toBe(false)
  })

  it('remote has history on `master` only → fetch master, START `main` on top (mirrors the clone path)', async () => {
    writeFileSync(join(localPath, '.DS_Store'), '')
    remote.heads = 'abc\trefs/heads/master\n'
    const res = await pull()
    expect(res.success).toBe(true)
    expect(remote.calls).toContain('fetch origin master')
    expect(remote.calls).toContain('checkout -b master origin/master')
    expect(remote.calls).toContain('checkoutLocalBranch main')
  })

  it('genuinely empty remote → init only, nothing fetched', async () => {
    writeFileSync(join(localPath, 'desktop.ini'), '')
    remote.heads = ''
    const res = await pull()
    expect(res.success).toBe(true)
    expect(remote.calls).toContain('init')
    // No branch-specific fetch (there is no branch to fetch). The post-pull
    // `fetch --all --prune` that keeps the other local branches current is
    // fine — on an empty remote it is a no-op.
    expect(remote.calls.some((c) => /^fetch origin /.test(c))).toBe(false)
  })
})

describe('an existing checkout in local_path', () => {
  beforeEach(() => mkdirSync(join(localPath, '.git')))

  it('of ANOTHER remote is refused instead of having its origin hijacked', async () => {
    remote.originUrl = 'https://github.com/someone-else/dotfiles.git'
    const res = await push()
    expect(res.success).toBe(false)
    expect(res.error).toContain('başka bir uzak depoya')
    expect(res.error).toContain('someone-else/dotfiles')
    expect(remote.calls.some((c) => c.startsWith('remote set-url'))).toBe(false)
  })

  it('of the same repo with a legacy token-in-URL origin is accepted and scrubbed', async () => {
    remote.originUrl = 'https://u:ghp_old@github.com/acme/apis'
    const res = await push()
    expect(res.success).toBe(true)
    expect(remote.calls).toContain(`remote set-url origin ${REPO}`)
  })
})

describe('git:push stages only the project file', () => {
  it('never `add .`; retires only the tracked old-slug file; leaves foreign files alone', async () => {
    mkdirSync(join(localPath, '.git'))
    remote.originUrl = REPO
    writeFileSync(join(localPath, 'my-notes.json'), '{"untracked":true}')
    remote.trackedJson = 'Old-Name.json\nAcme-APIs.json\n'
    const res = await push()
    expect(res.success).toBe(true)
    expect(remote.calls).toContain('add Acme-APIs.json')
    expect(remote.calls).not.toContain('add .')
    expect(remote.calls).toContain('rm Old-Name.json')
    expect(remote.calls).not.toContain('rm my-notes.json')
    expect(remote.calls).not.toContain('rm Acme-APIs.json')
    expect(existsSync(join(localPath, 'my-notes.json'))).toBe(true)
    expect(existsSync(join(localPath, 'Acme-APIs.json'))).toBe(true)
  })

  it('a non-fast-forward rejection becomes a "pull first" message', async () => {
    remote.pushError = new Error(
      ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs',
    )
    const res = await push()
    expect(res.success).toBe(false)
    expect(res.error).toBe(GIT_PUSH_REJECTED_ERROR)
  })
})
