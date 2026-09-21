import { ipcMain } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync as readDirSync } from 'fs'
import { join } from 'path'
import { getDb } from '../db/database'
import { exportProjectData, importProjectDataFromJson } from './save.handler'
import { asConflictAwareGit, runGitOpWithConflictHandling } from '../lib/git-conflict'
import type { SimpleGit, BranchSummaryBranch } from 'simple-git'
import { projectFileSlug, pickProjectFile } from '../lib/project-file'
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

  // Non-empty directory (project files already exist) — init in place.
  const localGit = await openRepo(config)
  await localGit.init()
  await pointHeadAt(localGit, defaultBranch)
  await localGit.addRemote('origin', auth.cleanUrl)
  if (heads.has(defaultBranch)) {
    await localGit.fetch('origin', defaultBranch)
    await localGit.checkout(['-b', defaultBranch, `origin/${defaultBranch}`])
  }
  return localGit
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
function reimportProjectFromDir(dir: string, projectId: string): boolean {
  const jsonFiles = readDirSync(dir).filter(
    (f: string) => f.endsWith('.json') && f !== 'package.json' && !f.startsWith('.'),
  )
  if (jsonFiles.length === 0) return false
  const file = pickProjectFile(jsonFiles, projectNameOf(projectId))
  const jsonContent = readFileSync(join(dir, file), 'utf-8')
  importProjectDataFromJson(jsonContent, projectId)
  return true
}

function projectNameOf(projectId: string): string | undefined {
  const row = getDb().prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as
    | { name: string }
    | undefined
  return row?.name
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

        // If baseBranch specified, checkout it first
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

        // Auto-commit any uncommitted changes before switching
        const status = await git.status()
        if (
          status.modified.length > 0 ||
          status.not_added.length > 0 ||
          status.created.length > 0
        ) {
          await git.add('.')
          await git.commit('Auto-save before branch switch')
        }

        // Try checkout — if it's a remote-only branch, create local tracking branch
        try {
          await git.checkout(payload.branchName)
        } catch {
          await git.checkout(['-b', payload.branchName, `origin/${payload.branchName}`])
        }

        // Best-effort: the branch switch itself succeeded, so a stale DB is
        // recoverable (Git Branches → Pull) and shouldn't fail the operation.
        try {
          reimportProjectFromDir(config.localPath, payload.projectId)
        } catch (e) {
          console.error('[git:switchBranch] reimport failed:', (e as Error).message)
        }

        return { success: true, data: { branch: payload.branchName } }
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

        // Auto-commit before merge
        const status = await git.status()
        if (
          status.modified.length > 0 ||
          status.not_added.length > 0 ||
          status.created.length > 0
        ) {
          await git.add('.')
          await git.commit('Auto-save before merge')
        }

        const currentBranch = await getCurrentBranch(git, config.branch)

        // Fetch latest
        try {
          await git.fetch(['--all'])
        } catch {
          /* offline OK */
        }

        const outcome = await runGitOpWithConflictHandling(asConflictAwareGit(git), () =>
          git.merge([payload.sourceBranch]),
        )
        if ('ok' in outcome) {
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
            reimportProjectFromDir(config.localPath, payload.projectId)
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

      // Export project data and write to repo before pushing
      const data = exportProjectData(projectId)
      const slug = projectFileSlug(data.project?.name as string | undefined)
      const displayName =
        ((data.project?.display_name || data.project?.name) as string) || 'project'
      const fileName = `${slug}.json`
      writeFileSync(join(config.localPath, fileName), JSON.stringify(data, null, 2), 'utf-8')

      // Retire the file an older name produced — but ONLY files git already
      // tracks. `local_path` may be a folder the user picked (Downloads…);
      // deleting every other .json there and `git add .` used to commit the
      // whole directory to GitHub.
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

      // Stage ONLY the project file and commit
      await git.add([fileName])
      const status = await git.status()
      if (status.staged.length > 0) {
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

      // Auto-commit edits to TRACKED files before pull (never sweep the
      // directory's untracked files into the repo — see push).
      const status = await git.status()
      if (status.modified.length > 0 || status.deleted.length > 0) {
        await git.raw(['add', '-u'])
        await git.commit('Auto-save before pull')
      }

      const outcome = await runGitOpWithConflictHandling(asConflictAwareGit(git), () =>
        git.pull('origin', currentBranch),
      )
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

      // Pull landed on disk; let any reimport failure surface explicitly so
      // the user doesn't see "pull succeeded" while the DB is silently stale.
      // `imported: false` means the checkout holds no project .json at all
      // (empty remote, or a repo that never had a push) — the caller decides
      // whether that is a warning (Clone from Git) or fine (fresh project).
      let imported = false
      try {
        imported = reimportProjectFromDir(config.localPath, projectId)
      } catch (e) {
        return {
          success: false,
          error: `Pull succeeded but importing the new state failed: ${(e as Error).message}`,
        }
      }
      return {
        success: true,
        data: { pulled: true, imported, state: 'clean', branch: currentBranch },
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
