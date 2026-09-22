import { ipcMain } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync as readDirSync } from 'fs'
import { join } from 'path'
import { getDb } from '../db/database'
import { exportProjectData, importProjectDataFromJson, type ProjectExport } from './save.handler'
import { asConflictAwareGit, runGitOpWithConflictHandling } from '../lib/git-conflict'
import type { SimpleGit, BranchSummaryBranch } from 'simple-git'
import { projectFileSlug, pickProjectFile } from '../lib/project-file'
import { mergeProjectFiles } from '../lib/project-merge'
import {
  getProjectGitConfig,
  gitAuth,
  gitClientOptions,
  gitProcessEnv,
  isGitAuthError,
  redactToken,
  describeGitError,
  sameRemote,
  foreignRepoError,
  unreachableRemoteError,
  GIT_TOKEN_MISSING_ERROR,
  type ProjectGitConfig,
  type GitAuth,
} from '../lib/git-config'

// ─── Helpers ─────────────────────────────────────────────────────

/** simple-git bound to `localPath` with per-process auth + identity config. */
async function openRepo(
  config: ProjectGitConfig,
  localPath = config.localPath,
): Promise<SimpleGit> {
  const { simpleGit } = await import('simple-git')
  const auth = gitAuth(config.repoUrl, config.username, config.token)
  return simpleGit(await gitClientOptions(auth, localPath)).env(gitProcessEnv(auth))
}

/**
 * A fresh `git init` puts HEAD on the machine's init.defaultBranch (still
 * `master` on many installs), but every later step commits to and pushes
 * `config.branch` — so the first push to an EMPTY remote failed with
 * "src refspec main does not match any". Point HEAD at the configured branch
 * before the first commit (works with no commits yet, unlike checkout -b).
 */
async function pointHeadAt(git: SimpleGit, branch: string): Promise<void> {
  try {
    await git.raw(['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
  } catch {
    /* non-fatal — push will report the real branch state */
  }
}

function authFailure(e: unknown, token: string): Error {
  return new Error(describeGitError(e, token))
}

/**
 * `git ls-remote --heads` — the branches the remote has RIGHT NOW. Decides,
 * before anything touches disk, whether the remote is empty (init locally),
 * has the configured branch (clone it) or has history on another branch
 * (clone that, create ours on top). Any failure is RETHROWN: an unreachable
 * remote used to fall through to `git init`, leaving an unrelated local
 * history that made every later Push non-fast-forward and every Pull
 * "refusing to merge unrelated histories".
 */
async function remoteHeads(bare: SimpleGit, auth: GitAuth, token: string): Promise<Set<string>> {
  let out: string
  try {
    out = await bare.listRemote(['--heads', auth.cleanUrl])
  } catch (e) {
    if (isGitAuthError((e as Error).message)) throw authFailure(e, token)
    throw new Error(unreachableRemoteError(redactToken((e as Error).message, token)))
  }
  const heads = new Set<string>()
  for (const line of out.split('\n')) {
    const ref = line.split('\t')[1]?.trim()
    if (ref?.startsWith('refs/heads/')) heads.add(ref.slice('refs/heads/'.length))
  }
  return heads
}

/** The fetch URL of `origin`, or undefined when the repo has no origin. */
async function originUrl(git: SimpleGit): Promise<string | undefined> {
  try {
    const remotes = await git.getRemotes(true)
    return remotes.find((r) => r.name === 'origin')?.refs.fetch
  } catch {
    return undefined
  }
}

/**
 * Make `config.localPath` a working checkout of `config.repoUrl` and return a
 * git bound to it. The remote URL written to `.git/config` is always the
 * CLEAN one — credentials travel per process (see `gitAuth`), which also
 * scrubs the `https://user:PAT@…` URLs older builds persisted.
 *
 * A 401/403 from the remote is RETHROWN, never swallowed: the old code fell
 * back to `init` + `addRemote` on any clone/fetch error, so a wrong PAT left
 * the user with an unrelated local repo and "phantom success" everywhere but
 * Push/Pull.
 */
async function ensureGitRepo(config: ProjectGitConfig): Promise<SimpleGit> {
  const { simpleGit } = await import('simple-git')
  const { localPath, branch: defaultBranch } = config
  const auth = gitAuth(config.repoUrl, config.username, config.token)

  if (!existsSync(localPath)) {
    mkdirSync(localPath, { recursive: true })
  }

  const gitDir = join(localPath, '.git')
  if (existsSync(gitDir)) {
    const git = await openRepo(config)
    const existing = await originUrl(git)
    if (existing && !sameRemote(existing, auth.cleanUrl)) {
      // Not ours: a checkout of some other repository lives here. Re-pointing
      // its origin would hijack it (and Push would commit its files).
      throw new Error(foreignRepoError(localPath, redactToken(existing, config.token)))
    }
    // Keep origin pointing at the clean URL (also replaces token-bearing
    // URLs written by older builds).
    try {
      await git.remote(['set-url', 'origin', auth.cleanUrl])
    } catch {
      try {
        await git.addRemote('origin', auth.cleanUrl)
      } catch {
        /* already exists */
      }
    }
    return git
  }

  const dirContents = readDirSync(localPath)
  const bare = simpleGit(await gitClientOptions(auth)).env(gitProcessEnv(auth))
  const heads = await remoteHeads(bare, auth, config.token)

  if (dirContents.length === 0) {
    if (heads.size === 0) {
      // Genuinely empty remote — init locally; the first push seeds it.
      const localGit = await openRepo(config)
      await localGit.init()
      await pointHeadAt(localGit, defaultBranch)
      await localGit.addRemote('origin', auth.cleanUrl)
      return localGit
    }
    if (heads.has(defaultBranch)) {
      await bare.clone(auth.cleanUrl, localPath, ['--branch', defaultBranch])
      return openRepo(config)
    }
    // The remote has history but not OUR branch (e.g. it was created with
    // `master`, Storage says `main`). Clone its default branch and start the
    // configured branch from there — the same thing Save → Git does, so both
    // Push buttons land the project on the same branch.
    await bare.clone(auth.cleanUrl, localPath)
    const git = await openRepo(config)
    await git.checkoutLocalBranch(defaultBranch)
    return git
  }

  // Non-empty directory — `git clone` refuses it, so init in place and fetch.
  // "Non-empty" includes a folder holding only `desktop.ini` / `.DS_Store`:
  // the user picked an "empty" clone target and expects the remote to land
  // here, so this branch must reach the same end state as the clone above.
  // It used to fetch ONLY when the configured branch existed; a remote on
  // `master` left an empty init behind and every later Pull said "pulled".
  const localGit = await openRepo(config)
  await localGit.init()
  await pointHeadAt(localGit, defaultBranch)
  await localGit.addRemote('origin', auth.cleanUrl)
  if (heads.has(defaultBranch)) {
    await localGit.fetch('origin', defaultBranch)
    await localGit.checkout(['-b', defaultBranch, `origin/${defaultBranch}`])
  } else if (heads.size > 0) {
    const remoteDefault = pickRemoteDefaultBranch(heads)
    await localGit.fetch('origin', remoteDefault)
    await localGit.checkout(['-b', remoteDefault, `origin/${remoteDefault}`])
    await localGit.checkoutLocalBranch(defaultBranch)
  }
  return localGit
}

/** The branch a clone would land on: `main`, else `master`, else the first head. */
function pickRemoteDefaultBranch(heads: Set<string>): string {
  if (heads.has('main')) return 'main'
  if (heads.has('master')) return 'master'
  return [...heads][0]
}

async function getCurrentBranch(
  git: Awaited<ReturnType<typeof ensureGitRepo>>,
  fallback: string,
): Promise<string> {
  try {
    const name = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
    if (name && name !== 'HEAD') return name
  } catch {
    /* unborn HEAD (fresh init, or clone of an EMPTY remote) — handled below */
  }
  // No commits yet: HEAD is an unborn ref named after init.defaultBranch
  // (often `master`). Every later step commits to and pushes `fallback`, so
  // point HEAD there now or the first push fails with "src refspec … does
  // not match any" — the empty-remote first-push bug.
  await pointHeadAt(git, fallback)
  return fallback
}

// Finds the project's exported .json in `dir` and imports it into SQLite.
// On a parse/import error this THROWS so callers can surface a meaningful
// message — most paths (branch-switch, resolve) wrap this in their own
// try/catch when failure isn't fatal; pull lets the error propagate so the
// user knows the pull succeeded on disk but the DB sync didn't.
// Returns false (not throwing) only when no .json file is found.
//
// Two flavours, chosen by the caller:
//  - `replace` (switch / merge / conflict resolution): the checkout IS the
//    branch, so rows the file no longer lists are dropped from the DB.
//  - `base` (pull): rows the PREVIOUS file had and the pulled one lacks were
//    deleted on the remote and are dropped; rows the file never knew about
//    (unpushed local work) stay. Additive upserts used to bring a request
//    deleted on machine B back on A's next Pull, and A's next Push then
//    resurrected it on the remote.
function reimportProjectFromDir(
  dir: string,
  projectId: string,
  how: { mode: 'replace' } | { mode: 'merge'; base: ProjectExport | null },
): boolean {
  const found = readProjectFileFromDir(dir, projectId)
  if (!found) return false
  importProjectDataFromJson(found.content, projectId, how)
  return true
}

/** The checkout's project file for THIS project, or null when it has none. */
function readProjectFileFromDir(
  dir: string,
  projectId: string,
): { file: string; content: string } | null {
  const jsonFiles = readDirSync(dir).filter(
    (f: string) => f.endsWith('.json') && f !== 'package.json' && !f.startsWith('.'),
  )
  if (jsonFiles.length === 0) return null
  const file = pickProjectFile(jsonFiles, projectNameOf(projectId))
  return { file, content: readFileSync(join(dir, file), 'utf-8') }
}

/** Parsed project file, or null when absent / unparsable (no base to diff). */
function snapshotProjectFile(dir: string, projectId: string): ProjectExport | null {
  try {
    const found = readProjectFileFromDir(dir, projectId)
    return found ? (JSON.parse(found.content) as ProjectExport) : null
  } catch {
    return null
  }
}

function projectNameOf(projectId: string): string | undefined {
  const row = getDb().prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as
    | { name: string }
    | undefined
  return row?.name
}

/** Section keys whose emptiness means "this project holds nothing yet". */
const EXPORT_SECTIONS = [
  'folders',
  'endpoints',
  'savedRequests',
  'environments',
  'globalVariables',
  'testSuites',
  'mockServers',
  'certificates',
  'savedResponses',
] as const

function isEmptyExport(data: Record<string, unknown>): boolean {
  return EXPORT_SECTIONS.every((k) => {
    const v = data[k]
    return !Array.isArray(v) || v.length === 0
  })
}

/** Same project content, ignoring the export timestamp. */
function sameExport(a: string, b: Record<string, unknown>): boolean {
  try {
    const parsed = JSON.parse(a) as Record<string, unknown>
    return JSON.stringify({ ...parsed, exportedAt: 0 }) === JSON.stringify({ ...b, exportedAt: 0 })
  } catch {
    return false
  }
}

/**
 * Write the project's DB state into the checkout as `<slug>.json` and stage
 * it (plus the removal of any tracked file an older name produced). This is
 * the ONE place the working tree learns what the database holds.
 *
 * Push always did this; switch / merge / pull did not. Their "Auto-save
 * before …" commits therefore recorded nothing (the tree only changes on
 * Push), and — worse — after `git merge` the DB still held the pre-merge
 * state, so the very next Push exported that stale state OVER the merged
 * file and shipped it to the remote: the merge "disappeared" (tester report,
 * two-machine flow). Every git operation now syncs DB → tree first, so what
 * git merges is what the user sees.
 *
 * `skipIfEmpty`: a project with no content yet must not overwrite the file
 * it is about to receive (Clone from Git: the fresh project's first Pull
 * clones the repo, and exporting the empty project on top of that clone
 * would commit an empty file, pull "already up to date" and import nothing).
 *
 * Only tracked `*.json` files are retired: `local_path` may be a folder the
 * user picked (Downloads…), and `git add .` once committed the whole thing.
 */
async function syncWorkingTreeFromDb(
  git: SimpleGit,
  config: ProjectGitConfig,
  projectId: string,
  opts: { skipIfEmpty: boolean },
): Promise<{ fileName: string; displayName: string; changed: boolean }> {
  const data = exportProjectData(projectId) as unknown as Record<string, unknown>
  const project = (data.project ?? {}) as Record<string, unknown>
  const slug = projectFileSlug(project.name as string | undefined)
  const displayName = ((project.display_name || project.name) as string) || 'project'
  const fileName = `${slug}.json`
  const target = join(config.localPath, fileName)

  if (opts.skipIfEmpty && isEmptyExport(data)) {
    return { fileName, displayName, changed: false }
  }
  if (existsSync(target) && sameExport(readFileSync(target, 'utf-8'), data)) {
    // Byte-identical apart from `exportedAt` — rewriting would only churn
    // the timestamp into a commit on every switch / pull.
    return { fileName, displayName, changed: false }
  }
  writeFileSync(target, JSON.stringify(data, null, 2), 'utf-8')

  const tracked = (await git.raw(['ls-files', '--', '*.json']))
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f && f !== fileName && f !== 'package.json' && !f.includes('/'))
  for (const f of tracked) {
    try {
      await git.rm([f])
    } catch {
      /* already gone */
    }
  }
  await git.add([fileName])
  const status = await git.status()
  return { fileName, displayName, changed: status.staged.length > 0 }
}

/**
 * Commit whatever is staged plus edits to TRACKED files. `add -u` never
 * sweeps the folder's other files in (see `syncWorkingTreeFromDb`).
 */
async function commitTracked(git: SimpleGit, message: string): Promise<boolean> {
  await git.raw(['add', '-u'])
  const status = await git.status()
  if (status.staged.length === 0) return false
  await git.commit(message)
  return true
}

/**
 * Switch / merge: the DB holds this branch's edits, so record them on it
 * before git replaces the tree. (Pull deliberately does NOT do this — see
 * `git:pull` — so two machines appending to the same collection never turn
 * into a text-level conflict over lines the user never wrote.)
 */
async function autoCommit(
  git: SimpleGit,
  config: ProjectGitConfig,
  projectId: string,
  message: string,
): Promise<void> {
  await syncWorkingTreeFromDb(git, config, projectId, { skipIfEmpty: true })
  await commitTracked(git, message)
}

/**
 * Bring every OTHER local branch up to its `origin/<name>` when that is a
 * pure fast-forward. Pull only merged the checked-out branch, so machine A
 * sitting on `feature` pulled `feature` while B's merge landed on
 * `origin/main`; A's local `main` stayed where it was and switching to it
 * showed the old tree. Non-fast-forward branches are left alone (they need
 * a real merge, which the user does by switching and pulling).
 */
async function fastForwardOtherBranches(git: SimpleGit, currentBranch: string): Promise<string[]> {
  const updated: string[] = []
  let refs = ''
  try {
    refs = await git.raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  } catch {
    return updated
  }
  for (const line of refs.split('\n')) {
    const name = line.trim()
    if (!name || name === currentBranch) continue
    const remoteRef = `origin/${name}`
    try {
      await git.raw(['rev-parse', '--verify', '--quiet', `refs/remotes/${remoteRef}`])
    } catch {
      continue // no remote counterpart
    }
    try {
      // Exit code 0 ⇔ local is an ancestor of the remote ⇔ fast-forwardable.
      await git.raw(['merge-base', '--is-ancestor', name, remoteRef])
    } catch {
      continue // diverged — needs a merge
    }
    const before = (await git.raw(['rev-parse', name])).trim()
    const after = (await git.raw(['rev-parse', remoteRef])).trim()
    if (before === after) continue
    try {
      await git.raw(['branch', '-f', name, remoteRef])
      updated.push(name)
    } catch {
      /* non-fatal */
    }
  }
  return updated
}

/**
 * A merge / pull stopped on conflicts. When every conflicted path is a
 * top-level project `.json`, merge the three index stages BY ROW (see
 * `project-merge.ts`), stage the result and complete the merge. Two
 * branches that each added a request used to conflict on the same lines,
 * and "keep mine / keep theirs" threw one side's rows away. Anything else
 * (a non-project file, an unparsable side, a file deleted on one side) is
 * left for the user's conflict dialog — returns false, index untouched.
 */
async function autoResolveProjectConflicts(
  git: SimpleGit,
  dir: string,
  message: string,
): Promise<boolean> {
  const status = await git.status()
  if (status.conflicted.length === 0) return false
  const merged: { file: string; content: string }[] = []
  for (const file of status.conflicted) {
    if (!file.endsWith('.json') || file.includes('/')) return false
    const stage = async (n: 1 | 2 | 3): Promise<string> => {
      try {
        return await git.show([`:${n}:${file}`])
      } catch {
        return ''
      }
    }
    const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)])
    const content = mergeProjectFiles(base, ours, theirs)
    if (content === null) return false
    merged.push({ file, content })
  }
  for (const m of merged) {
    writeFileSync(join(dir, m.file), m.content, 'utf-8')
    await git.add([m.file])
  }
  await git.commit(message)
  return true
}

/** True when `refs/heads/<name>` exists in this checkout. */
async function hasLocalBranch(git: SimpleGit, name: string): Promise<boolean> {
  try {
    await git.raw(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])
    return true
  } catch {
    return false
  }
}

// ─── Register handlers ──────────────────────────────────────────

export function registerGitHandlers(): void {
  // ─── List all branches (local + remote) ─────────────────────
  ipcMain.handle('git:listBranches', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      if (!config?.repoUrl || !config.localPath) {
        return { success: false, error: 'Git yapılandırması bulunamadı.' }
      }

      const git = await ensureGitRepo(config)

      // Fetch latest from remote
      try {
        await git.fetch(['--all', '--prune'])
      } catch {
        /* offline OK */
      }

      let branchSummary: Awaited<ReturnType<typeof git.branch>>
      try {
        branchSummary = await git.branch(['-a'])
      } catch {
        // No commits yet — return default branch name
        return {
          success: true,
          data: {
            branches: [{ name: config.branch, current: true, isRemote: false }],
            current: config.branch,
          },
        }
      }

      const branches: { name: string; current: boolean; isRemote: boolean }[] = []
      const seen = new Set<string>()

      // Local branches
      for (const [name, info] of Object.entries(branchSummary.branches) as [
        string,
        BranchSummaryBranch,
      ][]) {
        if (name.startsWith('remotes/')) continue
        branches.push({ name, current: info.current, isRemote: false })
        seen.add(name)
      }

      // Remote branches (only show ones not already local)
      for (const name of Object.keys(branchSummary.branches)) {
        if (!name.startsWith('remotes/origin/')) continue
        const shortName = name.replace('remotes/origin/', '')
        if (shortName === 'HEAD') continue
        if (!seen.has(shortName)) {
          branches.push({ name: shortName, current: false, isRemote: true })
        }
      }

      // If no branches found (empty repo), show default
      if (branches.length === 0) {
        branches.push({ name: config.branch, current: true, isRemote: false })
      }

      return { success: true, data: { branches, current: branchSummary.current || config.branch } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Current branch ────────────────────────────────────────
  ipcMain.handle('git:currentBranch', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      if (!config?.repoUrl || !config.localPath) {
        return { success: false, error: 'Git yapılandırması bulunamadı.' }
      }

      const git = await ensureGitRepo(config)
      const current = await getCurrentBranch(git, config.branch)

      return { success: true, data: current }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Create branch ─────────────────────────────────────────
  ipcMain.handle(
    'git:createBranch',
    async (
      _event,
      payload: {
        projectId: string
        branchName: string
        baseBranch?: string
      },
    ) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config?.repoUrl || !config.localPath) {
          return { success: false, error: 'Git yapılandırması bulunamadı.' }
        }

        const git = await ensureGitRepo(config)

        // If baseBranch specified, checkout it first. The UI always passes
        // the CURRENT branch; a different base is reachable only over IPC,
        // and the DB (current branch's content) is then committed onto the
        // new branch by the auto-switch that follows.
        if (payload.baseBranch) {
          await git.checkout(payload.baseBranch)
        }

        // Create and checkout new branch
        await git.checkoutLocalBranch(payload.branchName)

        // Push to remote — only when we actually hold a credential; with none
        // the push can only 401 and the old code swallowed that as "offline".
        let remotePushed = false
        if (config.token) {
          try {
            await git.push('origin', payload.branchName, ['--set-upstream'])
            remotePushed = true
          } catch {
            /* offline OK — will push later */
          }
        }

        return { success: true, data: { branch: payload.branchName, remotePushed } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Switch branch (checkout) ──────────────────────────────
  ipcMain.handle(
    'git:switchBranch',
    async (
      _event,
      payload: {
        projectId: string
        branchName: string
      },
    ) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config?.repoUrl || !config.localPath) {
          return { success: false, error: 'Git yapılandırması bulunamadı.' }
        }

        const git = await ensureGitRepo(config)

        // The DB holds the edits made on the branch we are leaving; record
        // them on THAT branch before the checkout replaces the tree.
        await autoCommit(git, config, payload.projectId, 'Auto-save before branch switch')

        // Try checkout — if it's a remote-only branch, create local tracking branch
        try {
          await git.checkout(payload.branchName)
        } catch {
          await git.checkout(['-b', payload.branchName, `origin/${payload.branchName}`])
        }

        // Best-effort: land the remote's newer commits when they are a pure
        // fast-forward. A user who switches to `main` right after a teammate
        // merged into it expects to see that merge, not the local `main`
        // from their last pull. Diverged branches stay put (Pull merges).
        let fastForwarded = false
        if (config.token) {
          try {
            await git.fetch('origin', payload.branchName)
            const before = (await git.revparse(['HEAD'])).trim()
            await git.raw(['merge', '--ff-only', `origin/${payload.branchName}`])
            fastForwarded = (await git.revparse(['HEAD'])).trim() !== before
          } catch {
            /* offline, no remote counterpart, or diverged — all fine here */
          }
        }

        // Best-effort: the branch switch itself succeeded, so a stale DB is
        // recoverable (Git Branches → Pull) and shouldn't fail the operation.
        try {
          reimportProjectFromDir(config.localPath, payload.projectId, { mode: 'replace' })
        } catch (e) {
          console.error('[git:switchBranch] reimport failed:', (e as Error).message)
        }

        return { success: true, data: { branch: payload.branchName, fastForwarded } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Merge branch ─────────────────────────────────────────
  ipcMain.handle(
    'git:merge',
    async (
      _event,
      payload: {
        projectId: string
        sourceBranch: string
      },
    ) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config?.repoUrl || !config.localPath) {
          return { success: false, error: 'Git yapılandırması bulunamadı.' }
        }

        const git = await ensureGitRepo(config)

        // What git merges must be what the user sees: sync DB → tree first.
        await autoCommit(git, config, payload.projectId, 'Auto-save before merge')

        const currentBranch = await getCurrentBranch(git, config.branch)

        // Fetch latest
        try {
          await git.fetch(['--all', '--prune'])
        } catch {
          /* offline OK */
        }

        // A branch that exists only on the remote (cloud icon in the list)
        // has no `refs/heads/<name>` — merge its tracking ref instead of
        // failing with "not something we can merge".
        const mergeRef = (await hasLocalBranch(git, payload.sourceBranch))
          ? payload.sourceBranch
          : `origin/${payload.sourceBranch}`

        let outcome = await runGitOpWithConflictHandling(asConflictAwareGit(git), () =>
          git.merge([mergeRef]),
        )
        if (
          'conflicts' in outcome &&
          (await autoResolveProjectConflicts(
            git,
            config.localPath,
            `Merge ${payload.sourceBranch} into ${currentBranch.trim()}`,
          ))
        ) {
          outcome = { ok: true }
        }
        if ('ok' in outcome) {
          // The tree now holds the merged file; the DB still holds the
          // pre-merge state. Without this import the next Push exported the
          // stale DB over the merge result. A failure here is surfaced (not
          // logged): the user is about to Push, and a silently stale DB is
          // exactly the bug being fixed.
          try {
            reimportProjectFromDir(config.localPath, payload.projectId, { mode: 'replace' })
          } catch (e) {
            return {
              success: false,
              error: `Merge succeeded but importing the merged state failed: ${(e as Error).message}`,
            }
          }
          return {
            success: true,
            data: {
              merged: true,
              state: 'clean',
              currentBranch: currentBranch.trim(),
              sourceBranch: payload.sourceBranch,
            },
          }
        }
        if ('conflicts' in outcome) {
          return {
            success: true,
            data: {
              merged: false,
              state: 'conflicted',
              currentBranch: currentBranch.trim(),
              sourceBranch: payload.sourceBranch,
              conflicts: outcome.conflicts,
            },
          }
        }
        return { success: false, error: outcome.error }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Resolve a merge/pull conflict by picking a side ────────
  // The renderer lets the user pick "use mine" / "use theirs" per file.
  // We checkout the chosen side, stage it, and — once every conflict is
  // resolved — commit the merge and re-import project.json into the DB.
  ipcMain.handle(
    'git:resolveConflict',
    async (
      _event,
      payload: {
        projectId: string
        file: string
        side: 'ours' | 'theirs'
        // Renderer passes a locale-aware commit message — main has no i18n.
        commitMessage?: string
      },
    ) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config?.localPath) {
          return { success: false, error: 'Git yapılandırması bulunamadı.' }
        }
        // Defence-in-depth: the side string is built into a CLI flag via
        // template literal; reject anything that's not the expected literal.
        if (payload.side !== 'ours' && payload.side !== 'theirs') {
          return { success: false, error: `Invalid side: ${payload.side}` }
        }
        const git = await openRepo(config)

        await git.checkout([`--${payload.side}`, payload.file])
        await git.add(payload.file)

        // If every conflict is resolved, complete the merge. We do NOT use
        // `git merge --continue` (which requires an interactive editor); a
        // straight `commit` with a generated message is friendlier.
        const status = await git.status()
        const stillConflicted = status.conflicted.length > 0
        let committed = false
        if (!stillConflicted) {
          try {
            await git.commit(payload.commitMessage || `Resolve merge conflict (${payload.side})`)
            committed = true
          } catch {
            // Commit may fail if there are no staged changes (e.g., merge
            // resulted in an identical state). Treat as already-clean.
            committed = true
          }

          // After committing, re-import the merged project.json so the DB
          // reflects whichever side the user picked. Best-effort — the commit
          // itself is already in git, so the worst case is a stale DB.
          try {
            reimportProjectFromDir(config.localPath, payload.projectId, { mode: 'replace' })
          } catch (e) {
            console.error('[git:resolveConflict] reimport failed:', (e as Error).message)
          }
        }

        return {
          success: true,
          data: {
            file: payload.file,
            side: payload.side,
            stillConflicted,
            committed,
            remainingConflicts: status.conflicted,
          },
        }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Abort an in-progress merge ─────────────────────────────
  ipcMain.handle('git:abortMerge', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      if (!config?.localPath) {
        return { success: false, error: 'Git yapılandırması bulunamadı.' }
      }
      const git = await openRepo(config)
      try {
        await git.merge(['--abort'])
      } catch {
        // No merge in progress (or rebase context) — fall back to reset.
        try {
          await git.reset(['--merge'])
        } catch {
          /* nothing to abort */
        }
      }
      return { success: true, data: { aborted: true } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Push current branch ──────────────────────────────────
  ipcMain.handle('git:push', async (_event, projectId: string) => {
    let config: Awaited<ReturnType<typeof getProjectGitConfig>> = null
    try {
      config = await getProjectGitConfig(projectId)
      if (!config?.repoUrl || !config.localPath) {
        return { success: false, error: 'Git yapılandırması bulunamadı.' }
      }
      if (!config.token) {
        return { success: false, error: GIT_TOKEN_MISSING_ERROR }
      }

      const git = await ensureGitRepo(config)

      // Determine current branch — may fail if no commits yet
      const currentBranch = await getCurrentBranch(git, config.branch)

      // Export project data into the checkout and commit it. Push is the one
      // path that writes even an EMPTY project: seeding a new remote with
      // the fresh project's file is exactly its job.
      const { displayName, changed } = await syncWorkingTreeFromDb(git, config, projectId, {
        skipIfEmpty: false,
      })
      if (changed) {
        await git.commit(`Update ${displayName} — ${new Date().toLocaleString()}`)
      }

      // Push current branch
      await git.push('origin', currentBranch, ['--set-upstream'])

      return { success: true, data: { branch: currentBranch, pushed: true } }
    } catch (e) {
      return { success: false, error: describeGitError(e, config?.token) }
    }
  })

  // ─── Pull current branch ─────────────────────────────────
  ipcMain.handle('git:pull', async (_event, projectId: string) => {
    let config: Awaited<ReturnType<typeof getProjectGitConfig>> = null
    try {
      config = await getProjectGitConfig(projectId)
      if (!config?.repoUrl || !config.localPath) {
        return { success: false, error: 'Git yapılandırması bulunamadı.' }
      }
      if (!config.token) {
        return { success: false, error: GIT_TOKEN_MISSING_ERROR }
      }

      const git = await ensureGitRepo(config)

      const currentBranch = await getCurrentBranch(git, config.branch)

      // Pull does NOT export the DB first. Unpushed local rows are merged at
      // ROW level by the import below (they simply survive the upsert); an
      // export + commit here would turn two machines appending to the same
      // collection into a text-level conflict the user has to "resolve" by
      // throwing one side away. Only edits to already-tracked files (rare:
      // something else touched the checkout) are committed so the pull can
      // proceed.
      await commitTracked(git, 'Auto-save before pull')

      // What the checkout held BEFORE the pull — the base for spotting rows
      // the remote deleted. Missing file → nothing to diff against.
      const base = snapshotProjectFile(config.localPath, projectId)

      let outcome = await runGitOpWithConflictHandling(asConflictAwareGit(git), () =>
        git.pull('origin', currentBranch),
      )
      if (
        'conflicts' in outcome &&
        (await autoResolveProjectConflicts(
          git,
          config.localPath,
          `Merge origin/${currentBranch} into ${currentBranch}`,
        ))
      ) {
        outcome = { ok: true }
      }
      if ('conflicts' in outcome) {
        return {
          success: true,
          data: {
            pulled: false,
            state: 'conflicted',
            branch: currentBranch,
            conflicts: outcome.conflicts,
          },
        }
      }
      if ('error' in outcome) {
        return { success: false, error: outcome.error }
      }

      // Pull is "sync this project", not "sync this branch": fetch everything
      // and fast-forward the other local branches too, so `main` reflects a
      // merge a teammate pushed while we sat on a feature branch.
      let fastForwarded: string[] = []
      try {
        await git.fetch(['--all', '--prune'])
        fastForwarded = await fastForwardOtherBranches(git, currentBranch)
      } catch {
        /* the branch we are on is already up to date — that is the pull */
      }

      // Pull landed on disk; let any reimport failure surface explicitly so
      // the user doesn't see "pull succeeded" while the DB is silently stale.
      // `imported: false` means the checkout holds no project .json at all
      // (empty remote, or a repo that never had a push) — the caller decides
      // whether that is a warning (Clone from Git) or fine (fresh project).
      let imported = false
      try {
        imported = reimportProjectFromDir(config.localPath, projectId, { mode: 'merge', base })
      } catch (e) {
        return {
          success: false,
          error: `Pull succeeded but importing the new state failed: ${(e as Error).message}`,
        }
      }
      return {
        success: true,
        data: { pulled: true, imported, state: 'clean', branch: currentBranch, fastForwarded },
      }
    } catch (e) {
      return { success: false, error: describeGitError(e, config?.token) }
    }
  })

  // ─── Git status ───────────────────────────────────────────
  ipcMain.handle('git:status', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      if (!config?.repoUrl || !config.localPath) {
        return { success: false, error: 'Git yapılandırması bulunamadı.' }
      }

      const git = await ensureGitRepo(config)

      const status = await git.status()
      const currentBranch = await getCurrentBranch(git, config.branch)

      // Get log (last 10 commits)
      let commits: { hash: string; message: string; date: string; author: string }[] = []
      try {
        const log = await git.log({ maxCount: 10 })
        commits = log.all.map((c) => ({
          hash: c.hash.slice(0, 7),
          message: c.message,
          date: c.date,
          author: c.author_name,
        }))
      } catch {
        /* no commits yet */
      }

      return {
        success: true,
        data: {
          branch: currentBranch,
          modified: status.modified.length,
          staged: status.staged.length,
          untracked: status.not_added.length,
          isClean: status.isClean(),
          commits,
        },
      }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Commit history (dedicated panel) ────────────────────
  // v1.3.1 B8/B10: endpoint Save commits weren't reflected anywhere in the
  // UI — there was no commit log surface for users to inspect what they'd
  // saved. listCommits returns a paginated slice that the renderer's
  // CommitHistoryPanel can virtualise. We deliberately reuse simple-git's
  // `log` here (same dependency the status handler uses) instead of pulling
  // in a heavier git library.
  ipcMain.handle(
    'git:listCommits',
    async (
      _event,
      payload: { projectId: string; branch?: string; limit?: number; skip?: number },
    ) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config?.repoUrl || !config.localPath) {
          return { success: false, error: 'Git yapılandırması bulunamadı.' }
        }
        const git = await ensureGitRepo(config)
        const limit = Math.max(1, Math.min(500, payload.limit ?? 100))
        const logArgs: Record<string, unknown> = { maxCount: limit }
        if (payload.branch) {
          logArgs.from = payload.branch
        }
        if (payload.skip != null && payload.skip > 0) {
          // simple-git `log` doesn't expose a typed skip — fall through to the
          // raw `--skip` flag for cursor-based pagination.
          ;(logArgs as { '--skip': string })['--skip'] = String(payload.skip)
        }
        try {
          const log = await git.log(logArgs)
          const commits = log.all.map((c) => ({
            hash: c.hash,
            shortHash: c.hash.slice(0, 7),
            message: c.message,
            date: c.date,
            author: c.author_name,
            email: c.author_email,
            refs: c.refs,
          }))
          return { success: true, data: { commits, total: log.total } }
        } catch {
          return { success: true, data: { commits: [], total: 0 } }
        }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Delete branch ────────────────────────────────────────
  ipcMain.handle(
    'git:deleteBranch',
    async (
      _event,
      payload: {
        projectId: string
        branchName: string
      },
    ) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config?.repoUrl || !config.localPath) {
          return { success: false, error: 'Git yapılandırması bulunamadı.' }
        }

        const git = await ensureGitRepo(config)

        const currentBranch = await getCurrentBranch(git, config.branch)
        if (currentBranch === payload.branchName) {
          return { success: false, error: "Aktif branch silinemez. Önce başka bir branch'e geçin." }
        }

        // Delete local
        try {
          await git.deleteLocalBranch(payload.branchName, true)
        } catch {
          /* might not exist locally */
        }

        // Delete remote (skip without a credential — see createBranch)
        if (config.token) {
          try {
            await git.push('origin', `:${payload.branchName}`)
          } catch {
            /* might not exist remotely */
          }
        }

        return { success: true, data: { deleted: payload.branchName } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Git log for branch ───────────────────────────────────
  ipcMain.handle(
    'git:log',
    async (
      _event,
      payload: {
        projectId: string
        count?: number
      },
    ) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config?.repoUrl || !config.localPath) {
          return { success: false, error: 'Git yapılandırması bulunamadı.' }
        }

        const git = await ensureGitRepo(config)

        const log = await git.log({ maxCount: payload.count || 20 })
        const commits = log.all.map((c) => ({
          hash: c.hash.slice(0, 7),
          fullHash: c.hash,
          message: c.message,
          date: c.date,
          author: c.author_name,
        }))

        return { success: true, data: commits }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Check if project has git configured ──────────────────
  ipcMain.handle('git:hasConfig', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      return {
        success: true,
        data: {
          hasGit: !!(config?.repoUrl && config.localPath),
          // A remote without a usable token can only fail at the server; let
          // the UI say so up front instead of firing network calls.
          hasToken: !!config?.token,
        },
      }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
