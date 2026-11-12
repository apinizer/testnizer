/**
 * Tester finding 6: an English UI showed "Git yapılandırması bulunamadı."
 * because main returned hard-coded Turkish. Main now returns English text
 * plus a stable `errorCode` (`src/shared/git-errors.ts`); the renderer words
 * the code in the UI language (`lib/git-error-text.ts`).
 *
 * This file pins the main side: every git / branch handler that cannot find
 * the project's git config answers with the code, the branch handlers name
 * theirs, and the English text of every code is the renderer's EN text (the
 * dynamic `gitError.<CODE>` keys escape the literal-key coverage test).
 * The active-branch refusal needs a real checkout: see git-lifecycle.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

// No `git.<projectId>` entry: every handler takes its "no config" branch.
class FakeStore {
  get(_key: string): unknown {
    return undefined
  }
  set(_key: string, _value: unknown): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerGitHandlers } = await import('../../../src/main/ipc/git.handler')
const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')
const { registerBranchHandlers } = await import('../../../src/main/ipc/branch.handler')
const { GIT_ERROR_TEXT } = await import('../../../src/shared/git-errors')
const { valuesInAllLocales, setLocale, t } = await import('../../../src/renderer/lib/i18n')

type Envelope = { success: boolean; error?: string; errorCode?: string; errorDetail?: string }

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerGitHandlers()
  registerSaveHandlers()
  registerBranchHandlers()
})

describe('git handlers without a git config', () => {
  const byProjectId = [
    'git:listBranches',
    'git:currentBranch',
    'git:abortMerge',
    'git:push',
    'git:changes',
    'git:discard',
    'git:pull',
  ]
  for (const channel of byProjectId) {
    it(`${channel} answers GIT_CONFIG_MISSING in English`, async () => {
      const res = (await harness.invoke(channel, projectId)) as Envelope
      expect(res).toMatchObject({
        success: false,
        errorCode: 'GIT_CONFIG_MISSING',
        error: 'Git configuration not found.',
      })
    })
  }

  const byPayload: Array<[string, unknown[]]> = [
    ['git:createBranch', [{ projectId: '', branchName: 'x' }]],
    ['git:switchBranch', [{ projectId: '', branchName: 'x' }]],
    ['git:merge', [{ projectId: '', sourceBranch: 'x' }]],
    ['git:deleteBranch', [{ projectId: '', branchName: 'x' }]],
    ['git:listCommits', [{ projectId: '' }]],
    ['git:log', [{ projectId: '' }]],
  ]
  for (const [channel, args] of byPayload) {
    it(`${channel} answers GIT_CONFIG_MISSING`, async () => {
      const filled = args.map((a) =>
        typeof a === 'object' && a !== null ? { ...a, projectId } : a,
      )
      const res = (await harness.invoke(channel, ...filled)) as Envelope
      expect(res).toMatchObject({ success: false, errorCode: 'GIT_CONFIG_MISSING' })
    })
  }

  it('git:commit answers GIT_CONFIG_MISSING', async () => {
    const res = (await harness.invoke('git:commit', projectId, 'msg')) as Envelope
    expect(res).toMatchObject({ success: false, errorCode: 'GIT_CONFIG_MISSING' })
  })

  it('save:gitPush and save:gitPull answer GIT_CONFIG_MISSING_SETTINGS', async () => {
    for (const channel of ['save:gitPush', 'save:gitPull']) {
      const res = (await harness.invoke(channel, { projectId })) as Envelope
      expect(res, channel).toMatchObject({
        success: false,
        errorCode: 'GIT_CONFIG_MISSING_SETTINGS',
        error: GIT_ERROR_TEXT.GIT_CONFIG_MISSING_SETTINGS,
      })
    }
  })

  it('no handler returns hard-coded Turkish any more', async () => {
    const res = (await harness.invoke('git:pull', projectId)) as Envelope
    expect(res.error).not.toMatch(/yapılandırması|bulunamadı/)
  })
})

describe('git:resolveConflict input check', () => {
  it('an unknown side answers GIT_INVALID_CONFLICT_SIDE, worded in both locales', async () => {
    const res = (await harness.invoke('git:resolveConflict', {
      projectId,
      file: 'p.json',
      side: 'mine',
    })) as Envelope & { errorParams?: Record<string, string> }
    expect(res).toMatchObject({
      success: false,
      errorCode: 'GIT_INVALID_CONFLICT_SIDE',
      error: 'Invalid conflict side: mine',
      errorParams: { side: 'mine' },
    })
    const { gitErrorText } = await import('../../../src/renderer/lib/git-error-text')
    setLocale('tr')
    expect(gitErrorText(res)).toBe('Geçersiz çakışma tarafı: mine')
    setLocale('en')
    expect(gitErrorText(res)).toBe('Invalid conflict side: mine')
  })
})

describe('branch handlers', () => {
  it('branch:rename of a missing row answers BRANCH_NOT_FOUND', async () => {
    const res = (await harness.invoke('branch:rename', 'no-such-id', 'x')) as Envelope
    expect(res).toMatchObject({
      success: false,
      errorCode: 'BRANCH_NOT_FOUND',
      error: 'Branch not found',
    })
  })

  it('branch:delete of the default answers BRANCH_DEFAULT_UNDELETABLE', async () => {
    const def = (await harness.invoke('branch:ensureDefault', projectId)) as {
      data: { id: string }
    }
    const res = (await harness.invoke('branch:delete', def.data.id)) as Envelope
    expect(res).toMatchObject({
      success: false,
      errorCode: 'BRANCH_DEFAULT_UNDELETABLE',
      error: 'Cannot delete default branch',
    })
  })
})

describe('code registry ↔ renderer text', () => {
  for (const code of Object.keys(GIT_ERROR_TEXT) as Array<keyof typeof GIT_ERROR_TEXT>) {
    it(`${code}: EN text equals main's, TR is translated`, () => {
      const key = `gitError.${code}`
      const values = valuesInAllLocales(key)
      expect(values, key).toHaveLength(2)
      setLocale('en')
      expect(t(key)).toBe(GIT_ERROR_TEXT[code])
      setLocale('tr')
      expect(t(key)).not.toBe(GIT_ERROR_TEXT[code])
      expect(t(key).includes('{detail}')).toBe(GIT_ERROR_TEXT[code].includes('{detail}'))
      setLocale('en')
    })
  }
})
