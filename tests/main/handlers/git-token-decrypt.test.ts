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
import { setupHandlerHarness, makeElectronMock, createTestDb, seedProject, seedWorkspace } from './helpers'

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

// Record every URL that reaches simple-git so we can assert on the password part.
const recorded = vi.hoisted(() => ({ urls: [] as string[] }))
vi.mock('simple-git', () => {
  const instance = {
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
      throw new Error('empty remote')
    },
  }
  return { simpleGit: () => instance }
})

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')

let projectId: string

beforeEach(() => {
  harness.reset()
  recorded.urls.length = 0
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

describe('issue #127 — git token decryption', () => {
  it('git:push embeds the DECRYPTED token in the remote URL', async () => {
    const res = (await harness.invoke('git:push', projectId)) as { success: boolean; error?: string }
    expect(res.success).toBe(true)
    expect(recorded.urls.length).toBeGreaterThan(0)
    for (const url of recorded.urls) {
      const parsed = new URL(url)
      expect(decodeURIComponent(parsed.password)).toBe(PLAIN_TOKEN)
      expect(decodeURIComponent(parsed.username)).toBe('acme-user')
      expect(url).not.toContain('enc%3Av1')
      expect(url).not.toContain('enc:v1')
    }
  })

  it('git:pull embeds the DECRYPTED token in the remote URL', async () => {
    const res = (await harness.invoke('git:pull', projectId)) as { success: boolean }
    expect(res.success).toBe(true)
    expect(recorded.urls.length).toBeGreaterThan(0)
    for (const url of recorded.urls) {
      expect(decodeURIComponent(new URL(url).password)).toBe(PLAIN_TOKEN)
    }
  })

  it('legacy plaintext tokens still pass through unchanged', async () => {
    ;(storeState.git[projectId] as { token: string }).token = PLAIN_TOKEN
    const res = (await harness.invoke('git:push', projectId)) as { success: boolean }
    expect(res.success).toBe(true)
    expect(decodeURIComponent(new URL(recorded.urls[0]).password)).toBe(PLAIN_TOKEN)
  })

  it('surfaces an explicit error when the token cannot be decrypted (locked keychain)', async () => {
    encryptionAvailable.value = false
    const res = (await harness.invoke('git:push', projectId)) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/token/i)
    // Must never reach the remote with a bogus password.
    expect(recorded.urls).toEqual([])
  })

  it('surfaces an explicit error when no token was ever saved', async () => {
    ;(storeState.git[projectId] as { token?: string }).token = undefined
    const res = (await harness.invoke('git:pull', projectId)) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/token/i)
    expect(recorded.urls).toEqual([])
  })
})
