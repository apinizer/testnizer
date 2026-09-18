/**
 * Regression for issue #127 — "Git Push fails with Invalid username or token
 * although PAT is saved in project Storage settings".
 *
 * `settings:set` encrypts every field named `token` into a safeStorage
 * `enc:v1:` envelope. `git.handler.ts` read that value raw from
 * electron-store and embedded the *ciphertext* as the HTTPS password, so
 * GitHub rejected every push/pull. The handler must decrypt the token before
 * building the authenticated remote URL, and must surface an explicit error
 * when the token cannot be decrypted (locked keychain) instead of letting
 * GitHub answer with an opaque 401.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'fs'
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

// Reversible safeStorage double: "encrypt" = reverse the bytes.
vi.mock('electron', () => {
  const base = makeElectronMock()
  return {
    ...base,
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable.value,
      encryptString: (s: string) => Buffer.from(s, 'utf-8').reverse(),
      decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8'),
    },
  }
})
const encryptionAvailable = vi.hoisted(() => ({ value: true }))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const PLAIN_TOKEN = 'ghp_realSecretToken123'
const ENCRYPTED_TOKEN = 'enc:v1:' + Buffer.from(PLAIN_TOKEN, 'utf-8').reverse().toString('base64')

const storeState = vi.hoisted(() => ({ git: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return key === 'git' ? storeState.git : undefined
  }
  set(_key: string, _value: unknown): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

vi.mock('../../../src/main/ipc/save.handler', () => ({
  exportProjectData: vi.fn(() => ({ project: { name: 'p' }, folders: [], endpoints: [] })),
  importProjectDataFromJson: vi.fn(),
}))

// Record every simple-git construction (its `-c` config carries the
// credential as `http.extraHeader`) and every remote URL that reaches git —
// the URL must be CLEAN (no userinfo) since v1.5.4.
const recorded = vi.hoisted(() => ({
  urls: [] as string[],
  configs: [] as string[][],
}))
vi.mock('simple-git', () => {
  const makeInstance = (cfg: string[]) => {
    const instance = {
      env: () => instance,
      getConfig: async () => ({
        key: 'user.name',
        value: 'Existing User',
        values: [],
        scopes: new Map(),
      }),
      addConfig: async () => {},
      fetch: async () => {},
      branch: async () => ({ branches: {}, current: 'main', all: [] }),
      revparse: async () => 'main',
      checkout: async () => {},
      checkoutLocalBranch: async () => {},
      push: async () => {},
      pull: async () => ({ summary: {} }),
      add: async () => {},
      commit: async () => ({}),
      status: async () => ({ files: [], modified: [], not_added: [], created: [], staged: [] }),
      log: async () => ({ all: [] }),
      init: async () => {},
      addRemote: async (_name: string, url: string) => {
        recorded.urls.push(url)
      },
      remote: async (args: string[]) => {
        if (args[0] === 'set-url') recorded.urls.push(args[2])
      },
      clone: async (url: string) => {
        recorded.urls.push(url)
        throw new Error('fatal: could not read from remote repository (empty)')
      },
    }
    recorded.configs.push(cfg)
    return instance
  }
  return {
    simpleGit: (optsOrDir?: unknown) => {
      const cfg =
        optsOrDir && typeof optsOrDir === 'object'
          ? ((optsOrDir as { config?: string[] }).config ?? [])
          : []
      return makeInstance(cfg)
    },
  }
})

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')

let projectId: string

beforeEach(() => {
  harness.reset()
  recorded.urls.length = 0
  recorded.configs.length = 0
  encryptionAvailable.value = true
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  const localPath = mkdtempSync(join(tmpdir(), 'testnizer-git-'))
  testDb.prepare('UPDATE projects SET local_path = ? WHERE id = ?').run(localPath, projectId)
  storeState.git = {
    [projectId]: {
      repoUrl: 'https://github.com/acme/apis.git',
      username: 'acme-user',
      branch: 'main',
      token: ENCRYPTED_TOKEN,
    },
  }
  registerGitHandlers()
})

const basicFor = (user: string, token: string) =>
  `http.extraHeader=Authorization: Basic ${Buffer.from(`${user}:${token}`, 'utf8').toString('base64')}`

/** Every http.extraHeader entry simple-git was constructed with. */
function sentAuthHeaders(): string[] {
  return recorded.configs.flat().filter((c) => c.startsWith('http.extraHeader='))
}

describe('issue #127 — git token decryption', () => {
  it('git:push authenticates with the DECRYPTED token and keeps the remote URL clean', async () => {
    const res = (await harness.invoke('git:push', projectId)) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(true)
    const headers = sentAuthHeaders()
    expect(headers.length).toBeGreaterThan(0)
    for (const h of headers) expect(h).toBe(basicFor('acme-user', PLAIN_TOKEN))
    // Ciphertext must never reach git, and the token must never sit in a URL
    // (that is what older builds persisted into .git/config).
    expect(recorded.urls.length).toBeGreaterThan(0)
    for (const url of recorded.urls) {
      expect(url).toBe('https://github.com/acme/apis.git')
      expect(url).not.toContain('enc:v1')
      expect(url).not.toContain(PLAIN_TOKEN)
    }
    expect(JSON.stringify(recorded.configs)).not.toContain('enc:v1')
  })

  it('git:pull authenticates with the DECRYPTED token', async () => {
    const res = (await harness.invoke('git:pull', projectId)) as { success: boolean }
    expect(res.success).toBe(true)
    const headers = sentAuthHeaders()
    expect(headers.length).toBeGreaterThan(0)
    for (const h of headers) expect(h).toBe(basicFor('acme-user', PLAIN_TOKEN))
  })

  it('legacy plaintext tokens still pass through unchanged', async () => {
    ;(storeState.git[projectId] as { token: string }).token = PLAIN_TOKEN
    const res = (await harness.invoke('git:push', projectId)) as { success: boolean }
    expect(res.success).toBe(true)
    expect(sentAuthHeaders()[0]).toBe(basicFor('acme-user', PLAIN_TOKEN))
  })

  it('surfaces an explicit error when the token cannot be decrypted (locked keychain)', async () => {
    encryptionAvailable.value = false
    const res = (await harness.invoke('git:push', projectId)) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/token/i)
    // Must never reach the remote with a bogus credential.
    expect(recorded.urls).toEqual([])
  })

  it('surfaces an explicit error when no token was ever saved', async () => {
    ;(storeState.git[projectId] as { token?: string }).token = undefined
    const res = (await harness.invoke('git:pull', projectId)) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/token/i)
    expect(recorded.urls).toEqual([])
  })

  it('git:hasConfig reports hasToken so the UI can warn before hitting the network', async () => {
    let res = (await harness.invoke('git:hasConfig', projectId)) as {
      data: { hasGit: boolean; hasToken: boolean }
    }
    expect(res.data).toEqual({ hasGit: true, hasToken: true })
    ;(storeState.git[projectId] as { token?: string }).token = undefined
    res = (await harness.invoke('git:hasConfig', projectId)) as {
      data: { hasGit: boolean; hasToken: boolean }
    }
    expect(res.data).toEqual({ hasGit: true, hasToken: false })
  })

  it('a Git-only project without local_path gets a default checkout dir instead of "no config"', async () => {
    testDb.prepare('UPDATE projects SET local_path = NULL WHERE id = ?').run(projectId)
    const res = (await harness.invoke('git:push', projectId)) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(true)
    const row = testDb.prepare('SELECT local_path FROM projects WHERE id = ?').get(projectId) as {
      local_path: string
    }
    expect(row.local_path).toContain(projectId)
  })
})
