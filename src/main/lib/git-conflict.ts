/**
 * Pure helpers behind the merge/pull conflict resolution flow. Lives in a
 * standalone module (not in git.handler.ts) so it can be unit-tested without
 * having to spin up the full IPC layer or a real git repo.
 */
import type { SimpleGit } from 'simple-git'

export interface ConflictStats {
  endpoints: number
  savedRequests: number
  folders: number
  testSuites: number
  mockServers: number
  mockEndpoints: number
  environments: number
  certificates: number
  parsable: boolean
}

export interface ConflictEntry {
  file: string
  stats: { ours: ConflictStats; theirs: ConflictStats }
}

/**
 * Counts the array-valued top-level keys we care about in an exported
 * project.json. Used to give the conflict resolution UI a side-by-side
 * "12 endpoints vs 14" view without shipping multi-megabyte JSON over IPC.
 *
 * Tolerant: empty string → `parsable: false` with zero counts; invalid JSON
 * does the same; missing arrays count as zero rather than throwing.
 */
export function summarizeProjectJson(content: string): ConflictStats {
  const empty: ConflictStats = {
    endpoints: 0,
    savedRequests: 0,
    folders: 0,
    testSuites: 0,
    mockServers: 0,
    mockEndpoints: 0,
    environments: 0,
    certificates: 0,
    parsable: false,
  }
  if (!content) return empty
  try {
    const data = JSON.parse(content) as Record<string, unknown[]>
    return {
      endpoints: Array.isArray(data.endpoints) ? data.endpoints.length : 0,
      savedRequests: Array.isArray(data.savedRequests) ? data.savedRequests.length : 0,
      folders: Array.isArray(data.folders) ? data.folders.length : 0,
      testSuites: Array.isArray(data.testSuites) ? data.testSuites.length : 0,
      mockServers: Array.isArray(data.mockServers) ? data.mockServers.length : 0,
      mockEndpoints: Array.isArray(data.mockEndpoints) ? data.mockEndpoints.length : 0,
      environments: Array.isArray(data.environments) ? data.environments.length : 0,
      certificates: Array.isArray(data.certificates) ? data.certificates.length : 0,
      parsable: true,
    }
  } catch {
    return empty
  }
}

// Subset of SimpleGit we actually use — kept narrow so tests can mock just
// what's needed instead of stubbing the entire library surface.
export interface ConflictAwareGit {
  status: () => Promise<{ conflicted: string[] }>
  show: (args: string[]) => Promise<string>
}

/**
 * Reads each conflicted file's ours/theirs from git's index (`:2:` / `:3:`)
 * in parallel — both per-file and across files — and returns only compact
 * stats. Returns null when the tree is clean. Full content strings are
 * intentionally NOT returned: the renderer modal renders only counts, and
 * shipping raw JSON over IPC for large project files was the main cost
 * driver before commit 845a302.
 */
export async function collectConflictInfo(git: ConflictAwareGit): Promise<ConflictEntry[] | null> {
  const status = await git.status()
  if (status.conflicted.length === 0) return null

  return Promise.all(
    status.conflicted.map(async (file) => {
      const [ours, theirs] = await Promise.all([
        git.show([`:2:${file}`]).catch(() => ''),
        git.show([`:3:${file}`]).catch(() => ''),
      ])
      return {
        file,
        stats: {
          ours: summarizeProjectJson(ours),
          theirs: summarizeProjectJson(theirs),
        },
      }
    }),
  )
}

/**
 * Wraps a git operation that can fail with a CONFLICTS error from simple-git.
 * On conflict, the working tree is left half-merged and we surface the
 * structured conflict info so the renderer can prompt for resolution.
 * Returns a discriminated union so callers can `'ok' in r` / `'conflicts' in
 * r` / `'error' in r` without optional chaining gymnastics.
 */
export async function runGitOpWithConflictHandling(
  git: ConflictAwareGit,
  op: () => Promise<unknown>,
): Promise<{ ok: true } | { conflicts: ConflictEntry[] } | { error: string }> {
  try {
    await op()
    return { ok: true }
  } catch (err) {
    const conflicts = await collectConflictInfo(git).catch(() => null)
    if (conflicts && conflicts.length > 0) return { conflicts }
    return { error: (err as Error).message }
  }
}

/**
 * Cast helper for the production SimpleGit instance — it has the same shape
 * as ConflictAwareGit (plus a lot more). Keeps the call sites in
 * git.handler.ts tidy.
 */
export function asConflictAwareGit(git: SimpleGit): ConflictAwareGit {
  return git as unknown as ConflictAwareGit
}
