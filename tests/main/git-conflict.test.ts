import { describe, it, expect, vi } from 'vitest'
import {
  summarizeProjectJson,
  runGitOpWithConflictHandling,
  collectConflictInfo,
  type ConflictAwareGit,
} from '../../src/main/lib/git-conflict'

// ─── summarizeProjectJson ────────────────────────────────────────

describe('summarizeProjectJson', () => {
  it('returns empty + parsable:false for empty input', () => {
    const r = summarizeProjectJson('')
    expect(r.parsable).toBe(false)
    expect(r.endpoints).toBe(0)
    expect(r.mockServers).toBe(0)
  })

  it('returns empty + parsable:false for invalid JSON', () => {
    const r = summarizeProjectJson('{ this is not json')
    expect(r.parsable).toBe(false)
    expect(r.endpoints).toBe(0)
  })

  it('counts each array-valued field independently', () => {
    const r = summarizeProjectJson(
      JSON.stringify({
        endpoints: [1, 2, 3],
        savedRequests: ['a'],
        folders: [],
        testSuites: [{}, {}],
        mockServers: [{}],
        mockEndpoints: [{}, {}, {}, {}],
        environments: [{}, {}],
        certificates: [],
      }),
    )
    expect(r).toEqual({
      endpoints: 3,
      savedRequests: 1,
      folders: 0,
      testSuites: 2,
      mockServers: 1,
      mockEndpoints: 4,
      environments: 2,
      certificates: 0,
      parsable: true,
    })
  })

  it('treats non-array values as zero rather than throwing', () => {
    const r = summarizeProjectJson(
      JSON.stringify({
        endpoints: null,
        savedRequests: 'not an array',
        folders: { not: 'array' },
      }),
    )
    expect(r.parsable).toBe(true)
    expect(r.endpoints).toBe(0)
    expect(r.savedRequests).toBe(0)
    expect(r.folders).toBe(0)
  })

  it('ignores unknown top-level keys', () => {
    const r = summarizeProjectJson(
      JSON.stringify({ unknownField: [1, 2, 3], endpoints: [1] }),
    )
    expect(r.endpoints).toBe(1)
    expect(r.parsable).toBe(true)
  })

  it('parses an empty object', () => {
    const r = summarizeProjectJson('{}')
    expect(r.parsable).toBe(true)
    expect(r.endpoints).toBe(0)
  })
})

// ─── runGitOpWithConflictHandling ────────────────────────────────

function makeGit(opts: {
  conflicted?: string[]
  showResults?: Record<string, string | Error>
}): ConflictAwareGit {
  return {
    status: vi.fn(async () => ({ conflicted: opts.conflicted ?? [] })),
    show: vi.fn(async (args: string[]) => {
      const key = args[0] ?? ''
      const v = opts.showResults?.[key]
      if (v instanceof Error) throw v
      return v ?? ''
    }),
  }
}

describe('runGitOpWithConflictHandling', () => {
  it('returns { ok: true } when the op succeeds', async () => {
    const git = makeGit({})
    const r = await runGitOpWithConflictHandling(git, async () => 'done')
    expect(r).toEqual({ ok: true })
  })

  it('surfaces conflicts when op throws AND tree has conflicts', async () => {
    const git = makeGit({
      conflicted: ['project.json'],
      showResults: {
        ':2:project.json': JSON.stringify({ endpoints: [1, 2] }),
        ':3:project.json': JSON.stringify({ endpoints: [1, 2, 3, 4] }),
      },
    })
    const r = await runGitOpWithConflictHandling(git, async () => {
      throw new Error('CONFLICTS')
    })
    expect('conflicts' in r).toBe(true)
    if ('conflicts' in r) {
      expect(r.conflicts).toHaveLength(1)
      expect(r.conflicts[0].file).toBe('project.json')
      expect(r.conflicts[0].stats.ours.endpoints).toBe(2)
      expect(r.conflicts[0].stats.theirs.endpoints).toBe(4)
    }
  })

  it('returns { error } when op throws and tree has no conflicts', async () => {
    const git = makeGit({ conflicted: [] })
    const r = await runGitOpWithConflictHandling(git, async () => {
      throw new Error('Authentication failed')
    })
    expect(r).toEqual({ error: 'Authentication failed' })
  })

  it('returns { error } even when collectConflictInfo itself fails', async () => {
    const git: ConflictAwareGit = {
      status: vi.fn(async () => {
        throw new Error('status broken')
      }),
      show: vi.fn(async () => ''),
    }
    const r = await runGitOpWithConflictHandling(git, async () => {
      throw new Error('original failure')
    })
    // We surface the ORIGINAL operation's error, not the secondary
    // status-failure — losing the primary error would mislead the user.
    expect(r).toEqual({ error: 'original failure' })
  })
})

// ─── collectConflictInfo ─────────────────────────────────────────

describe('collectConflictInfo', () => {
  it('returns null when there are no conflicts', async () => {
    const git = makeGit({ conflicted: [] })
    expect(await collectConflictInfo(git)).toBeNull()
  })

  it('fetches ours+theirs in parallel for each file', async () => {
    const git = makeGit({
      conflicted: ['a.json', 'b.json'],
      showResults: {
        ':2:a.json': '{}',
        ':3:a.json': '{}',
        ':2:b.json': '{}',
        ':3:b.json': '{}',
      },
    })
    const r = await collectConflictInfo(git)
    expect(r).toHaveLength(2)
    // 4 git.show calls (2 files × 2 sides)
    expect((git.show as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4)
  })

  it('tolerates missing side via per-file catch (e.g. added-by-only-one)', async () => {
    const git = makeGit({
      conflicted: ['added-by-theirs.json'],
      showResults: {
        ':2:added-by-theirs.json': new Error('no such object'),
        ':3:added-by-theirs.json': JSON.stringify({ endpoints: [1] }),
      },
    })
    const r = await collectConflictInfo(git)
    expect(r).not.toBeNull()
    expect(r![0].stats.ours.parsable).toBe(false)
    expect(r![0].stats.theirs.parsable).toBe(true)
    expect(r![0].stats.theirs.endpoints).toBe(1)
  })
})
