/**
 * Issue #207 — local Commit, Discard all changes and the changes summary,
 * driven through the branch menu against a local bare "remote".
 *
 *   1. A new endpoint → Commit… lists it as added → Commit with a message:
 *      the checkout's HEAD has the message, the remote ref does NOT move,
 *      the menu shows 0↓ 1↑.
 *   2. Rename the endpoint → Discard all changes → confirm: the DB and the
 *      tree are back at the committed name, no unrelated row is lost.
 *   3. Another change → Commit and push: the remote ref moves to HEAD and
 *      the menu shows 0↓ 0↑.
 *
 * Fixture model (as git-advanced): the git config is written over IPC and
 * the remote is a `git init --bare` folder under the OS temp dir. The remote
 * starts EMPTY and a baseline push seeds it with the project file, so the
 * commit panel only lists what this spec changes.
 *
 * The renderer learns about git only when a project activates
 * (`ensureDefault` → `checkGitConfig`), so the project is re-entered after
 * the config is written — and again after it is removed in `finally`, or the
 * branch store keeps `hasGit: true` and later specs' branch helpers take the
 * git path.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../../helpers/ui/bootstrap'
import { getActiveProjectId, listEndpointsByProject } from '../../helpers/ui/assert-ipc'
import { treeClearSearch, treeRename, treeSearch } from '../../helpers/ui/tree'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const ADDED_ROW = '[data-testid="git-change-item"][data-change="added"]'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

type IpcResult<T = unknown> = { success: boolean; data?: T; error?: string }
type Win = Window & {
  api?: {
    settings?: { set: (k: string, v: unknown) => Promise<IpcResult> }
    project?: {
      get: (id: string) => Promise<IpcResult<{ local_path?: string | null; save_mode?: string }>>
      update: (id: string, p: unknown) => Promise<IpcResult>
    }
    endpoint?: {
      create: (p: unknown) => Promise<IpcResult<{ id: string }>>
      get: (id: string) => Promise<IpcResult<{ id: string; name: string } | null>>
      delete: (id: string) => Promise<IpcResult>
    }
    git?: {
      push: (id: string, opts?: unknown) => Promise<IpcResult>
    }
  }
}

// ─── Git helpers (run outside the app, like git-advanced) ────────────────────

function git(args: string[]): string {
  return execFileSync('git', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
    .toString()
    .trim()
}

/** An EMPTY bare repository used as "origin". */
function createBareRepo(label: string): { repoPath: string; repoUrl: string } {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), `testnizer-bare-${label}-`))
  git(['init', '--bare', '-q', repoPath])
  return { repoPath, repoUrl: `file://${repoPath}` }
}

function remoteRef(barePath: string, branch = 'main'): string {
  try {
    return git(['--git-dir', barePath, 'rev-parse', `refs/heads/${branch}`])
  } catch {
    return ''
  }
}

function remoteSubjects(barePath: string, branch = 'main'): string[] {
  return git(['--git-dir', barePath, 'log', '--format=%s', `refs/heads/${branch}`])
    .split('\n')
    .filter(Boolean)
}

function localHead(checkout: string): string {
  return git(['-C', checkout, 'rev-parse', 'HEAD'])
}

function localSubject(checkout: string): string {
  return git(['-C', checkout, 'log', '-1', '--format=%s'])
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

/**
 * Leave the project and come back: the branch store re-reads the git config
 * (`hasGit` / `hasToken`) and the tree is rebuilt from the DB.
 */
async function reenterProject(window: Page): Promise<void> {
  await dismissOverlays(window)
  await window.getByTestId('header-home').click()
  await expect(window.getByTestId('project-home')).toBeVisible({ timeout: 15_000 })
  await ensureCanonicalProject(window)
  await navigateSidebar(window, 'apis')
}

/**
 * Open the branch menu fresh. The pill toggles and its click is what
 * re-fetches the changes summary, so an already-open menu is closed first.
 */
async function openBranchMenu(window: Page): Promise<void> {
  const pill = window.getByTestId('branch-pill')
  const commit = window.getByTestId('branch-commit')
  if (await commit.isVisible().catch(() => false)) {
    await pill.click()
    await expect(commit).toBeHidden()
  }
  await pill.click()
  await expect(commit).toBeVisible({ timeout: 10_000 })
}

async function closeBranchMenu(window: Page): Promise<void> {
  if (
    await window
      .getByTestId('branch-commit')
      .isVisible()
      .catch(() => false)
  ) {
    await window.getByTestId('branch-pill').click()
    await expect(window.getByTestId('branch-commit')).toBeHidden()
  }
}

/** Menu counts, read from a freshly opened menu (exact text: '1↑' ⊂ '11↑'). */
async function expectSyncCounts(window: Page, text: string): Promise<void> {
  await expect(async () => {
    await openBranchMenu(window)
    await expect(window.getByTestId('branch-sync-counts')).toHaveText(text, { timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
}

async function createEndpoint(window: Page, projectId: string, name: string): Promise<string> {
  return window.evaluate(
    async ({ pid, name }) => {
      const w = window as unknown as Win
      const r = await w.api!.endpoint!.create({
        project_id: pid,
        name,
        protocol: 'http',
        method: 'GET',
        path: '/git-commit-e2e',
        request_schema: JSON.stringify({
          method: 'GET',
          url: 'https://example.test/git-commit-e2e',
        }),
      })
      if (!r.success || !r.data) throw new Error(r.error ?? 'endpoint:create failed')
      return r.data.id
    },
    { pid: projectId, name },
  )
}

async function endpointName(window: Page, id: string): Promise<string | null> {
  return window.evaluate(async (eid) => {
    const r = await (window as unknown as Win).api!.endpoint!.get(eid)
    return r.success && r.data ? r.data.name : null
  }, id)
}

// ─── Test ────────────────────────────────────────────────────────────────────

uiTest.describe('Tur1 — Git commit / discard [issue #207]', () => {
  uiTest(
    'Commit keeps the remote, Discard restores the commit, Commit and push moves the remote',
    async ({ window }) => {
      uiTest.setTimeout(180_000)
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      await navigateSidebar(window, 'apis')

      const projectId = await getActiveProjectId(window)
      const label = uid()
      const prefix = `gitc-${label}`
      const original = `${prefix}-orig`
      const renamed = `${prefix}-renamed`
      const pushedName = `${prefix}-pushed`
      const createdIds: string[] = []

      const bare = createBareRepo(label)
      const localPath = fs.mkdtempSync(path.join(os.tmpdir(), `testnizer-gitcommit-${label}-`))
      const before = await window.evaluate(
        async (pid) => (await (window as unknown as Win).api!.project!.get(pid)).data ?? null,
        projectId,
      )

      try {
        // ── Setup: git config over IPC (dummy token: a file:// remote never
        // sends it, but Push / "Commit and push" require one), then a
        // baseline push so HEAD, origin/main and the upstream all exist.
        await window.evaluate(
          async ({ pid, repoUrl, lp }) => {
            const w = window as unknown as Win
            const r = await w.api!.settings!.set('git', {
              [pid]: { repoUrl, username: '', branch: 'main', token: 'e2e-local-token' },
            })
            if (!r.success) throw new Error(r.error)
            const u = await w.api!.project!.update(pid, { local_path: lp, save_mode: 'git' })
            if (!u.success) throw new Error(u.error)
          },
          { pid: projectId, repoUrl: bare.repoUrl, lp: localPath },
        )
        const baseline = await window.evaluate(
          (pid) =>
            (window as unknown as Win).api!.git!.push(pid, { commitMessage: 'e2e baseline' }),
          projectId,
        )
        expect(baseline.success, JSON.stringify(baseline)).toBe(true)
        const baselineRef = remoteRef(bare.repoPath)
        expect(baselineRef).not.toBe('')
        expect(localHead(localPath)).toBe(baselineRef)

        await reenterProject(window)
        // Fully synced right after the baseline: nothing to commit.
        await expectSyncCounts(window, '0↓ 0↑')
        await expect(window.getByTestId('branch-commit')).toBeDisabled()
        await closeBranchMenu(window)

        // ── 1. New endpoint → Commit… → listed as added → Commit
        await uiTest.step('commit locally: remote unchanged, menu shows 0↓ 1↑', async () => {
          createdIds.push(await createEndpoint(window, projectId, original))
          await reenterProject(window)

          await openBranchMenu(window)
          await expect(window.getByTestId('branch-commit')).toBeEnabled({ timeout: 10_000 })
          await window.getByTestId('branch-commit').click()

          const modal = window.getByTestId('git-commit-modal')
          await expect(modal).toBeVisible()
          const items = modal.getByTestId('git-change-item')
          await expect(modal.locator(ADDED_ROW).filter({ hasText: original })).toHaveCount(1, {
            timeout: 10_000,
          })
          // The baseline was exported from this DB a moment ago: the new
          // endpoint is the only pending change.
          await expect(items).toHaveCount(1)

          await modal.getByTestId('git-commit-message').fill('e2e local commit')
          await modal.getByTestId('git-commit-confirm').click()
          await expect(modal).toBeHidden({ timeout: 20_000 })

          await expect
            .poll(() => localSubject(localPath), { timeout: 15_000 })
            .toBe('e2e local commit')
          expect(remoteRef(bare.repoPath)).toBe(baselineRef)
          await expectSyncCounts(window, '0↓ 1↑')
          await closeBranchMenu(window)
        })

        // ── 2. Rename → Discard all changes → back to the committed state
        await uiTest.step('discard all changes restores the committed endpoint', async () => {
          const countBefore = (await listEndpointsByProject(window, projectId)).length
          const headBefore = localHead(localPath)

          await treeSearch(window, prefix)
          await expect(window.getByTestId('tree-node').filter({ hasText: original })).toHaveCount(
            1,
            { timeout: 10_000 },
          )
          await treeRename(window, original, renamed)
          await expect
            .poll(() => endpointName(window, createdIds[0]), { timeout: 10_000 })
            .toBe(renamed)
          await expect(window.getByTestId('tree-node').filter({ hasText: renamed })).toHaveCount(1)

          await openBranchMenu(window)
          await expect(window.getByTestId('branch-discard')).toBeEnabled({ timeout: 10_000 })
          await window.getByTestId('branch-discard').click()
          await expect(window.getByTestId('git-discard-dialog')).toBeVisible()
          await window.getByTestId('git-discard-confirm').click()
          await expect(window.getByTestId('git-discard-dialog')).toBeHidden({ timeout: 20_000 })

          // DB first, then the tree the re-sync rebuilt.
          await expect
            .poll(() => endpointName(window, createdIds[0]), { timeout: 15_000 })
            .toBe(original)
          await treeSearch(window, prefix)
          await expect(window.getByTestId('tree-node').filter({ hasText: original })).toHaveCount(
            1,
            { timeout: 15_000 },
          )
          await expect(window.getByTestId('tree-node').filter({ hasText: renamed })).toHaveCount(0)

          // A replace import from HEAD: no unrelated row may be dropped, and
          // the local commit is untouched (still one ahead, nothing pending).
          expect((await listEndpointsByProject(window, projectId)).length).toBe(countBefore)
          expect(localHead(localPath)).toBe(headBefore)
          expect(remoteRef(bare.repoPath)).toBe(baselineRef)
          await expectSyncCounts(window, '0↓ 1↑')
          await expect(window.getByTestId('branch-commit')).toBeDisabled()
          await closeBranchMenu(window)
        })

        // ── 3. Another change → Commit and push → remote moves, 0↓ 0↑
        await uiTest.step('commit and push moves the remote ref', async () => {
          createdIds.push(await createEndpoint(window, projectId, pushedName))
          await reenterProject(window)

          await openBranchMenu(window)
          await expect(window.getByTestId('branch-commit')).toBeEnabled({ timeout: 10_000 })
          await window.getByTestId('branch-commit').click()
          const modal = window.getByTestId('git-commit-modal')
          await expect(modal).toBeVisible()
          await expect(modal.locator(ADDED_ROW).filter({ hasText: pushedName })).toHaveCount(1, {
            timeout: 10_000,
          })

          await modal.getByTestId('git-commit-message').fill('e2e commit and push')
          await expect(modal.getByTestId('git-commit-and-push')).toBeEnabled()
          await modal.getByTestId('git-commit-and-push').click()
          await expect(modal).toBeHidden({ timeout: 30_000 })

          await expect
            .poll(() => remoteRef(bare.repoPath), { timeout: 20_000 })
            .not.toBe(baselineRef)
          expect(remoteRef(bare.repoPath)).toBe(localHead(localPath))
          const subjects = remoteSubjects(bare.repoPath)
          expect(subjects[0]).toBe('e2e commit and push')
          expect(subjects).toContain('e2e local commit')
          await expectSyncCounts(window, '0↓ 0↑')
          await closeBranchMenu(window)
        })
      } finally {
        // Same cleanup as git-advanced: drop the git config, put the project
        // back in local mode — then re-enter so the branch store forgets git.
        await closeBranchMenu(window).catch(() => {})
        await dismissOverlays(window).catch(() => {})
        await window
          .evaluate(
            async ({ ids }) => {
              const w = window as unknown as Win
              for (const id of ids) await w.api?.endpoint?.delete(id)
            },
            { ids: createdIds },
          )
          .catch(() => {})
        await window
          .evaluate(
            async ({ pid, lp, mode }) => {
              const w = window as unknown as Win
              await w.api?.settings?.set('git', {})
              await w.api?.project?.update(pid, { local_path: lp, save_mode: mode })
            },
            {
              pid: projectId,
              lp: before?.local_path ?? null,
              mode: before?.save_mode || 'local',
            },
          )
          .catch(() => {})
        await reenterProject(window).catch(() => {})
        await treeClearSearch(window).catch(() => {})
        fs.rmSync(localPath, { recursive: true, force: true })
        fs.rmSync(bare.repoPath, { recursive: true, force: true })
      }
    },
  )
})
