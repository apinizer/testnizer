/**
 * Tester finding 6 — with the UI in Turkish the git surfaces stayed English:
 * the header's Pull / Push (and their tooltips), the branch menu's Merge /
 * New Branch, and the project Duplicate toast. This spec switches the shared
 * window to TR and reads those texts on the real screen.
 *
 * Labels and `title`s only — Pull / Push are never clicked (the remote is a
 * throwaway local bare repo, so nothing leaves the machine anyway).
 *
 * Screenshots: set `TESTNIZER_SHOT_DIR` to a folder and every step saves one
 * there (`76-<step>.png`).
 *
 * Cleanup (shared Electron, `finally`): back to English, the git settings of
 * the spec's project cleared, the project and its duplicate deleted, the
 * canonical project active again, the temp repos removed.
 */
import { expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  openCommandPalette,
} from '../helpers/ui/bootstrap'
import { getActiveProjectId } from '../helpers/ui/assert-ipc'
import { createProject, goToProjectHome, openProject } from '../helpers/ui/workspace-flow'
import { deleteProject } from '../helpers/ui/db-flow'
import { persistedLocale, restoreEnglishLocale } from '../helpers/ui/locale'

type Win = Window & {
  api?: {
    settings?: { set: (k: string, v: unknown) => Promise<{ success: boolean; error?: string }> }
    project?: {
      update: (id: string, p: unknown) => Promise<{ success: boolean; error?: string }>
      list: (wsId: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }>
    }
    workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> }
  }
}

const SHOT_DIR = process.env.TESTNIZER_SHOT_DIR

async function shot(page: Page, step: string): Promise<void> {
  if (!SHOT_DIR) return
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SHOT_DIR, `76-${step}.png`) })
}

/** Every project id in every workspace — to find the Duplicate's copy afterwards. */
async function allProjectIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const w = window as unknown as Win
    const ids: string[] = []
    for (const ws of (await w.api?.workspace?.list())?.data ?? []) {
      for (const p of (await w.api?.project?.list(ws.id))?.data ?? []) ids.push(p.id)
    }
    return ids
  })
}

async function switchToTurkish(page: Page): Promise<void> {
  await openCommandPalette(page)
  await page
    .getByRole('option', { name: /Türkçe|Turkish/i })
    .first()
    .click()
  await expect.poll(() => persistedLocale(page), { timeout: 5_000 }).toBe('tr')
}

uiTest.describe('Turkish UI — git and duplicate texts [tester finding 6]', () => {
  uiTest(
    'header Pull / Push, branch menu and the Duplicate toast read Turkish',
    async ({ window }) => {
      uiTest.setTimeout(120_000)
      await dismissOverlays(window)
      await ensureCanonicalProject(window)

      const label = `${Date.now()}`.slice(-7)
      const name = `TR Git ${label}`
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `testnizer-76-${label}-`))
      const bare = path.join(tmp, 'remote.git')
      const checkout = path.join(tmp, 'checkout')
      execFileSync('git', ['init', '-q', '--bare', bare])

      let projectId: string | null = null
      let before: string[] = []
      try {
        // Set-up in English (the helpers select by English labels).
        await goToProjectHome(window)
        await createProject(window, name)
        projectId = await getActiveProjectId(window, name)
        await window.evaluate(
          async ({ pid, repoUrl, lp }) => {
            const w = window as unknown as Win
            const r = await w.api!.settings!.set(`git.${pid}`, {
              repoUrl,
              username: 'e2e',
              branch: 'main',
              token: '',
            })
            if (!r.success) throw new Error(r.error)
            const u = await w.api!.project!.update(pid, { local_path: lp, save_mode: 'git' })
            if (!u.success) throw new Error(u.error)
          },
          { pid: projectId, repoUrl: bare, lp: checkout },
        )
        // Re-open so the header reads the new save mode.
        await openProject(window, name)

        await switchToTurkish(window)
        await dismissOverlays(window)

        // ── Header: Pull / Push and their tooltips (the git term in parentheses).
        const pull = window.getByTestId('header-pull')
        const push = window.getByTestId('header-push')
        await expect(pull).toHaveText('Çek')
        await expect(push).toHaveText('Gönder')
        await expect(pull).toHaveAttribute('title', 'Uzak depodan çek (pull)')
        await expect(push).toHaveAttribute('title', 'Uzak depoya gönder (push)')
        await shot(window, 'header-pull-push')

        // ── Branch menu: Pull / Push / Merge / New Branch, the merge picker, the new-branch input.
        await window.getByTestId('branch-pill').click()
        await expect(window.getByTestId('branch-merge')).toHaveText('Birleştir', {
          timeout: 15_000,
        })
        await expect(window.getByTestId('branch-pull')).toHaveText('Çek')
        await expect(window.getByTestId('branch-push')).toHaveText('Gönder')
        await expect(window.getByTestId('branch-new')).toHaveText('Yeni Dal')
        await shot(window, 'branch-menu')
        await window.getByTestId('branch-merge').click()
        await expect(window.getByText(/birleştirilecek dal/)).toBeVisible()
        await expect(window.getByText(/Merge into/)).toHaveCount(0)
        await shot(window, 'branch-merge-picker')
        await window.getByTestId('branch-new').click()
        await expect(window.getByPlaceholder(/dalından yeni dal/)).toBeVisible()
        await shot(window, 'branch-new-input')
        await dismissOverlays(window)

        // ── Project Home: Duplicate toast.
        before = await allProjectIds(window)
        await goToProjectHome(window)
        const card = window.getByTestId('project-card').filter({ hasText: name }).first()
        await card.hover()
        // The card's "…" button (revealed on hover) is its only button.
        await card.locator('button').first().click()
        await card.getByRole('button', { name: 'Çoğalt' }).click()
        await expect(
          window.locator('[data-sonner-toast]').filter({ hasText: `"${name}" çoğaltıldı` }),
        ).toBeVisible({ timeout: 15_000 })
        await expect(
          window.locator('[data-sonner-toast]').filter({ hasText: /Duplicated/ }),
        ).toHaveCount(0)
        await shot(window, 'duplicate-toast')
      } finally {
        await restoreEnglishLocale(window).catch(() => {})
        await dismissOverlays(window).catch(() => {})
        if (projectId) {
          await window
            .evaluate(
              (pid) => (window as unknown as Win).api?.settings?.set(`git.${pid}`, { repoUrl: '' }),
              projectId,
            )
            .catch(() => {})
        }
        const copies = before.length
          ? (await allProjectIds(window).catch(() => [] as string[])).filter(
              (id) => !before.includes(id),
            )
          : []
        // Close the header tabs first (an open tab of a deleted project would linger).
        for (const id of [...copies, ...(projectId ? [projectId] : [])]) {
          const close = window.getByTestId(`header-project-tab-close-${id}`)
          if ((await close.count()) > 0) await close.click({ force: true }).catch(() => {})
        }
        await ensureCanonicalProject(window).catch(() => {})
        for (const id of [...copies, ...(projectId ? [projectId] : [])]) {
          await deleteProject(window, id).catch(() => {})
        }
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    },
  )
})
