import { ipcMain } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync as readDirSync } from 'fs'
import { join } from 'path'
import { getDb } from '../db/database'
import { exportProjectData, importProjectDataFromJson } from './save.handler'
import type { SimpleGit, BranchSummaryBranch } from 'simple-git'

// ─── Helpers ─────────────────────────────────────────────────────

function getSettingsStore(): Promise<{
  get(key: string): unknown
  set(key: string, value: unknown): void
}> {
  return import('electron-store').then(({ default: Store }) => {
    return new Store({
      name: 'settings',
    }) as unknown as { get(key: string): unknown; set(key: string, value: unknown): void }
  })
}

async function getProjectGitConfig(projectId: string): Promise<{
  repoUrl: string
  username: string
  branch: string
  token: string
  localPath: string
} | null> {
  try {
    const db = getDb()
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
      | {
          local_path?: string
        }
      | undefined

    const settingsStore = await getSettingsStore()
    const gitConfig = settingsStore.get('git') as
      | Record<
          string,
          {
            repoUrl?: string
            username?: string
            branch?: string
            token?: string
          }
        >
      | undefined

    const config = gitConfig?.[projectId]
    if (!config?.repoUrl) return null

    return {
      repoUrl: config.repoUrl,
      username: config.username || '',
      branch: config.branch || 'main',
      token: config.token || '',
      localPath: project?.local_path || '',
    }
  } catch {
    return null
  }
}

function buildAuthUrl(repoUrl: string, username: string, token: string): string {
  const urlObj = new URL(repoUrl)
  urlObj.username = encodeURIComponent(username)
  urlObj.password = encodeURIComponent(token)
  return urlObj.toString()
}

async function ensureGitRepo(
  localPath: string,
  authUrl: string,
  defaultBranch: string,
): Promise<SimpleGit> {
  const { simpleGit } = await import('simple-git')

  if (!existsSync(localPath)) {
    mkdirSync(localPath, { recursive: true })
  }

  const gitDir = join(localPath, '.git')
  if (existsSync(gitDir)) {
    // Repo already exists — just return git instance
    const git = simpleGit(localPath)
    // Update remote URL in case credentials changed
    try {
      await git.remote(['set-url', 'origin', authUrl])
    } catch {
      // Remote doesn't exist, add it
      try {
        await git.addRemote('origin', authUrl)
      } catch {
        /* already exists */
      }
    }
    return git
  }

  // Directory exists but no .git — check if empty for clone, else init
  const dirContents = readDirSync(localPath)

  if (dirContents.length === 0) {
    // Empty directory — try to clone into it
    const git = simpleGit()
    try {
      await git.clone(authUrl, localPath, ['--branch', defaultBranch])
      return simpleGit(localPath)
    } catch {
      try {
        await git.clone(authUrl, localPath)
        return simpleGit(localPath)
      } catch {
        // Empty remote repo — init locally
        const localGit = simpleGit(localPath)
        await localGit.init()
        await localGit.addRemote('origin', authUrl)
        return localGit
      }
    }
  } else {
    // Non-empty directory (project files already exist) — init in place
    const localGit = simpleGit(localPath)
    await localGit.init()
    await localGit.addRemote('origin', authUrl)

    // Try to pull from remote if it has content
    try {
      await localGit.fetch('origin')
      // Check if remote has the default branch
      const remoteBranches = await localGit.branch(['-r'])
      if (Object.keys(remoteBranches.branches).some((b) => b.includes(defaultBranch))) {
        // Remote has content — set tracking and pull
        await localGit.checkout(['-b', defaultBranch, `origin/${defaultBranch}`])
      }
    } catch {
      // Remote is empty — that's fine, we'll push first
    }

    return localGit
  }
}

async function getCurrentBranch(
  git: Awaited<ReturnType<typeof ensureGitRepo>>,
  fallback: string,
): Promise<string> {
  try {
    return (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
  } catch {
    return fallback
  }
}

/**
 * Walk the working tree's conflicted files and pull each side's content via
 * `git show :2:<file>` (ours) and `:3:<file>` (theirs). Returns null when the
 * tree is clean — used after a merge / pull that reported a conflict.
 *
 * For project.json (the file the rest of the app cares about) we also extract
 * a compact stats summary so the resolution UI can show "12 endpoints vs 14"
 * without sending two megabytes back over IPC.
 */
async function collectConflictInfo(git: SimpleGit): Promise<Array<{
  file: string
  ours: string
  theirs: string
  stats: {
    ours: ConflictStats
    theirs: ConflictStats
  }
}> | null> {
  const status = await git.status()
  if (status.conflicted.length === 0) return null

  const conflicts: Array<{
    file: string
    ours: string
    theirs: string
    stats: { ours: ConflictStats; theirs: ConflictStats }
  }> = []

  for (const file of status.conflicted) {
    let ours = ''
    let theirs = ''
    try {
      ours = await git.show([`:2:${file}`])
    } catch {
      // File didn't exist on our side (added in theirs only).
    }
    try {
      theirs = await git.show([`:3:${file}`])
    } catch {
      // File didn't exist on their side.
    }
    conflicts.push({
      file,
      ours,
      theirs,
      stats: {
        ours: summarizeProjectJson(ours),
        theirs: summarizeProjectJson(theirs),
      },
    })
  }
  return conflicts
}

interface ConflictStats {
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

function summarizeProjectJson(content: string): ConflictStats {
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

// ─── Register handlers ──────────────────────────────────────────

export function registerGitHandlers(): void {
  // ─── List all branches (local + remote) ─────────────────────
  ipcMain.handle('git:listBranches', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      if (!config?.repoUrl || !config.localPath) {
        return { success: false, error: 'Git yapılandırması bulunamadı.' }
      }

      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)
      const git = await ensureGitRepo(config.localPath, authUrl, config.branch)

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

      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)
      const git = await ensureGitRepo(config.localPath, authUrl, config.branch)
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

        const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)
        const git = await ensureGitRepo(config.localPath, authUrl, config.branch)

        // If baseBranch specified, checkout it first
        if (payload.baseBranch) {
          await git.checkout(payload.baseBranch)
        }

        // Create and checkout new branch
        await git.checkoutLocalBranch(payload.branchName)

        // Push to remote
        try {
          await git.push('origin', payload.branchName, ['--set-upstream'])
        } catch {
          /* offline OK — will push later */
        }

        return { success: true, data: { branch: payload.branchName } }
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

        const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)
        const git = await ensureGitRepo(config.localPath, authUrl, config.branch)

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

        // Import data from the switched branch into DB
        const jsonFiles = readDirSync(config.localPath).filter(
          (f: string) => f.endsWith('.json') && f !== 'package.json',
        )
        if (jsonFiles.length > 0) {
          const jsonContent = readFileSync(join(config.localPath, jsonFiles[0]), 'utf-8')
          importProjectDataFromJson(jsonContent, payload.projectId)
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

        const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)
        const git = await ensureGitRepo(config.localPath, authUrl, config.branch)

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

        // Merge — wrap in try/catch so conflicts surface as structured data
        // rather than a thrown error. simple-git throws when CONFLICTS appear,
        // but the working tree IS in a half-merged state that we can resolve.
        try {
          const mergeResult = await git.merge([payload.sourceBranch])
          return {
            success: true,
            data: {
              merged: true,
              state: 'clean',
              currentBranch: currentBranch.trim(),
              sourceBranch: payload.sourceBranch,
              result: mergeResult.result,
            },
          }
        } catch (mergeErr) {
          const msg = (mergeErr as Error).message
          // Real conflict — collect both sides and surface to the renderer.
          const conflicts = await collectConflictInfo(git)
          if (conflicts && conflicts.length > 0) {
            return {
              success: true,
              data: {
                merged: false,
                state: 'conflicted',
                currentBranch: currentBranch.trim(),
                sourceBranch: payload.sourceBranch,
                conflicts,
              },
            }
          }
          // Some other failure — propagate.
          return { success: false, error: msg }
        }
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
      },
    ) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config?.localPath) {
          return { success: false, error: 'Git yapılandırması bulunamadı.' }
        }
        const { simpleGit } = await import('simple-git')
        const git = simpleGit(config.localPath)

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
            await git.commit(`Resolve merge conflict (${payload.side})`)
            committed = true
          } catch {
            // Commit may fail if there are no staged changes (e.g., merge
            // resulted in an identical state). Treat as already-clean.
            committed = true
          }

          // After committing, re-import the merged project.json so the DB
          // reflects whichever side the user picked.
          try {
            const jsonFiles = readDirSync(config.localPath).filter(
              (f: string) => f.endsWith('.json') && f !== 'package.json',
            )
            if (jsonFiles.length > 0) {
              const jsonContent = readFileSync(join(config.localPath, jsonFiles[0]), 'utf-8')
              importProjectDataFromJson(jsonContent, payload.projectId)
            }
          } catch {
            // Re-import is best-effort; the file is already committed.
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
      const { simpleGit } = await import('simple-git')
      const git = simpleGit(config.localPath)
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
    try {
      const config = await getProjectGitConfig(projectId)
      if (!config?.repoUrl || !config.localPath) {
        return { success: false, error: 'Git yapılandırması bulunamadı.' }
      }

      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)
      const git = await ensureGitRepo(config.localPath, authUrl, config.branch)

      // Determine current branch — may fail if no commits yet
      const currentBranch = await getCurrentBranch(git, config.branch)

      // Export project data and write to repo before pushing
      const data = exportProjectData(projectId)
      const slug = ((data.project?.name as string) || 'project').replace(/[^a-zA-Z0-9\-_]/g, '-')
      const displayName =
        ((data.project?.display_name || data.project?.name) as string) || 'project'
      const fileName = `${slug}.json`
      writeFileSync(join(config.localPath, fileName), JSON.stringify(data, null, 2), 'utf-8')

      // Clean up old .json files that don't match current slug
      try {
        const { unlinkSync } = await import('fs')
        for (const f of readDirSync(config.localPath)) {
          if (f.endsWith('.json') && f !== fileName && f !== 'package.json') {
            unlinkSync(join(config.localPath, f))
          }
        }
      } catch {
        /* ignore cleanup errors */
      }

      // Stage and commit
      await git.add('.')
      const status = await git.status()
      if (status.staged.length > 0) {
        await git.commit(`Update ${displayName} — ${new Date().toLocaleString()}`)
      }

      // Push current branch
      await git.push('origin', currentBranch, ['--set-upstream'])

      return { success: true, data: { branch: currentBranch, pushed: true } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Pull current branch ─────────────────────────────────
  ipcMain.handle('git:pull', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      if (!config?.repoUrl || !config.localPath) {
        return { success: false, error: 'Git yapılandırması bulunamadı.' }
      }

      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)
      const git = await ensureGitRepo(config.localPath, authUrl, config.branch)

      const currentBranch = await getCurrentBranch(git, config.branch)

      // Auto-commit before pull
      const status = await git.status()
      if (status.modified.length > 0 || status.not_added.length > 0 || status.created.length > 0) {
        await git.add('.')
        await git.commit('Auto-save before pull')
      }

      try {
        await git.pull('origin', currentBranch)
      } catch (pullErr) {
        // Pull failed — most commonly because the merge step it runs
        // internally hit a conflict. Surface conflict info so the renderer
        // can let the user resolve it.
        const conflicts = await collectConflictInfo(git)
        if (conflicts && conflicts.length > 0) {
          return {
            success: true,
            data: {
              pulled: false,
              state: 'conflicted',
              branch: currentBranch,
              conflicts,
            },
          }
        }
        return { success: false, error: (pullErr as Error).message }
      }

      // Import pulled data into DB — find the project .json file
      const jsonFiles = readDirSync(config.localPath).filter(
        (f: string) => f.endsWith('.json') && f !== 'package.json',
      )
      if (jsonFiles.length > 0) {
        const jsonContent = readFileSync(join(config.localPath, jsonFiles[0]), 'utf-8')
        importProjectDataFromJson(jsonContent, projectId)
      }

      return { success: true, data: { pulled: true, state: 'clean', branch: currentBranch } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Git status ───────────────────────────────────────────
  ipcMain.handle('git:status', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      if (!config?.repoUrl || !config.localPath) {
        return { success: false, error: 'Git yapılandırması bulunamadı.' }
      }

      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)
      const git = await ensureGitRepo(config.localPath, authUrl, config.branch)

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

        const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)
        const git = await ensureGitRepo(config.localPath, authUrl, config.branch)

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

        // Delete remote
        try {
          await git.push('origin', `:${payload.branchName}`)
        } catch {
          /* might not exist remotely */
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

        const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)
        const git = await ensureGitRepo(config.localPath, authUrl, config.branch)

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
      return { success: true, data: { hasGit: !!(config?.repoUrl && config.localPath) } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
