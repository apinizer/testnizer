/**
 * Shared scaffolding for the REAL-git handler suites: a bare remote in a temp
 * dir, one "machine" per (in-memory DB + checkout dir), and typed wrappers
 * over the `git:*` IPC handlers. The `vi.mock` calls stay in each test file
 * (vitest hoists them per file); the file hands this module the hooks it
 * needs (`setDb`, the settings-store state, the harness).
 */
import { expect } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { createTestDb, seedWorkspace } from './helpers'
import type { HandlerHarness } from './helpers'

export interface Machine {
  label: string
  db: Database.Database
  projectId: string
  localPath: string
}

export type Envelope<T> = { success: boolean; error?: string; data?: T }

export interface RealGitFixture {
  /** Bare remote path (a plain path is a valid local remote). */
  remote: string
  newRemote: () => string
  git: (cwd: string, ...args: string[]) => string
  machine: (
    label: string,
    opts?: { name?: string; displayName?: string; token?: string; branch?: string },
  ) => Machine
  on: (m: Machine) => Machine
  addEndpoint: (m: Machine, name: string) => string
  names: (m: Machine) => string[]
  remoteFile: (branch: string) => { endpoints: { id: string; name: string }[] } | null
  remoteNames: (branch: string) => string[]
  remoteBranches: () => string[]
  call: <T>(channel: string, ...args: unknown[]) => Promise<Envelope<T>>
  ok: <T>(channel: string, ...args: unknown[]) => Promise<T>
  push: (m: Machine) => Promise<{ branch: string }>
  pull: (m: Machine) => Promise<PullData>
  switchTo: (m: Machine, branch: string) => Promise<{ branch: string; fastForwarded: boolean }>
  merge: (m: Machine, source: string) => Promise<MergeData>
  createBranch: (
    m: Machine,
    name: string,
    base: string,
  ) => Promise<{ branch: string; remotePushed: boolean }>
  listBranches: (m: Machine) => Promise<{
    branches: { name: string; current: boolean; isRemote: boolean }[]
    current: string
  }>
}

export interface PullData {
  pulled: boolean
  imported: boolean
  state: string
  branch: string
  fastForwarded: string[]
  conflicts?: { file: string }[]
}

export interface MergeData {
  merged: boolean
  state: string
  currentBranch: string
  conflicts?: { file: string }[]
}

export const PROJECT_NAME = 'Shared APIs'
export const PROJECT_FILE = 'Shared-APIs.json'

export function createRealGitFixture(deps: {
  root: string
  harness: HandlerHarness
  setDb: (db: Database.Database) => void
  gitStore: Record<string, unknown>
}): RealGitFixture {
  const { root, harness, setDb, gitStore } = deps

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()

  const fx: RealGitFixture = {
    remote: '',
    newRemote: () => {
      fx.remote = join(root, `remote-${randomUUID().slice(0, 8)}.git`)
      git(root, 'init', '--bare', '--initial-branch=main', fx.remote)
      return fx.remote
    },
    git,
    machine: (label, opts = {}) => {
      const db = createTestDb()
      const workspaceId = seedWorkspace(db, `ws-${label}`)
      const projectId = randomUUID()
      const localPath = join(root, `checkout-${label}-${projectId.slice(0, 8)}`)
      mkdirSync(localPath, { recursive: true })
      const now = Date.now()
      db.prepare(
        `INSERT INTO projects (id, workspace_id, name, display_name, type, sort_order, save_mode, local_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'http', 0, 'both', ?, ?, ?)`,
      ).run(
        projectId,
        workspaceId,
        opts.name ?? PROJECT_NAME,
        opts.displayName ?? null,
        localPath,
        now,
        now,
      )
      gitStore[projectId] = {
        repoUrl: fx.remote,
        username: 'u',
        branch: opts.branch ?? 'main',
        token: opts.token ?? 'x',
      }
      return { label, db, projectId, localPath }
    },
    on: (m) => {
      setDb(m.db)
      return m
    },
    addEndpoint: (m, name) => {
      const id = randomUUID()
      const now = Date.now()
      m.db
        .prepare(
          `INSERT INTO endpoints (id, project_id, name, protocol, method, path, created_at, updated_at)
           VALUES (?, ?, ?, 'http', 'GET', ?, ?, ?)`,
        )
        .run(id, m.projectId, name, `/${name.toLowerCase()}`, now, now)
      return id
    },
    names: (m) =>
      (
        m.db
          .prepare('SELECT name FROM endpoints WHERE project_id = ? ORDER BY name')
          .all(m.projectId) as { name: string }[]
      ).map((r) => r.name),
    remoteFile: (branch) => {
      try {
        const listed = execFileSync(
          'git',
          ['--git-dir', fx.remote, 'ls-tree', '--name-only', branch],
          { encoding: 'utf-8' },
        )
          .split('\n')
          .filter((f) => f.endsWith('.json'))
        const file = listed.includes(PROJECT_FILE) ? PROJECT_FILE : listed[0]
        if (!file) return null
        const out = execFileSync('git', ['--git-dir', fx.remote, 'show', `${branch}:${file}`], {
          encoding: 'utf-8',
        })
        return JSON.parse(out) as { endpoints: { id: string; name: string }[] }
      } catch {
        return null
      }
    },
    remoteNames: (branch) => (fx.remoteFile(branch)?.endpoints ?? []).map((e) => e.name).sort(),
    remoteBranches: () =>
      execFileSync(
        'git',
        ['--git-dir', fx.remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'],
        {
          encoding: 'utf-8',
        },
      )
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .sort(),
    call: async (channel, ...args) => (await harness.invoke(channel, ...args)) as Envelope<never>,
    ok: async <T>(channel: string, ...args: unknown[]): Promise<T> => {
      const res = await fx.call<T>(channel, ...args)
      expect(res.error, `${channel} failed`).toBeUndefined()
      expect(res.success).toBe(true)
      return res.data as T
    },
    push: (m) => fx.ok('git:push', fx.on(m).projectId),
    pull: (m) => fx.ok('git:pull', fx.on(m).projectId),
    switchTo: (m, branch) =>
      fx.ok('git:switchBranch', { projectId: fx.on(m).projectId, branchName: branch }),
    merge: (m, source) =>
      fx.ok('git:merge', { projectId: fx.on(m).projectId, sourceBranch: source }),
    createBranch: (m, name, base) =>
      fx.ok('git:createBranch', {
        projectId: fx.on(m).projectId,
        branchName: name,
        baseBranch: base,
      }),
    listBranches: (m) => fx.ok('git:listBranches', fx.on(m).projectId),
  }
  return fx
}
