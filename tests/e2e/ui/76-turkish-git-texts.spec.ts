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
 * Cleanup (shared Electron, `finally`, each step on its own): the canonical
 * project opened first, then back to English, the git settings of
 * the spec's project cleared, the project and its duplicate deleted, the
 * temp repos removed — and, when the body passed, the result asserted.
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
import { createProject, goToProjectHome } from '../helpers/ui/workspace-flow'
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

      const cleanupErrors: string[] = []
      let copies: string[] = []
      let owned: string[] = []
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

        await switchToTurkish(window)
        await dismissOverlays(window)

        // ── Project Home: Duplicate toast.
        // The IPC write above did not reach the renderer's project list
        // (opening a project reads that list, it does not re-fetch it). The
        // Duplicate action re-fetches the list after it succeeds, so the
        // header below sees `save_mode: 'git'` — a user action, no store poke.
        before = await allProjectIds(window)
        await goToProjectHome(window)
        // Exact name: the copy's card ("… (copy)") contains the name too.
        const card = window
          .getByTestId('project-card')
          .filter({ has: window.getByText(name, { exact: true }) })
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
        // The copy is in the list now, so the list was re-fetched.
        await expect
          .poll(async () => (await allProjectIds(window)).length, { timeout: 10_000 })
          .toBeGreaterThan(before.length)

        // Re-open the project: the header reads the refreshed save mode.
        await card.click()
        await expect(window.getByTestId('nav-apis')).toBeVisible({ timeout: 15_000 })

        // ── Header: Pull / Push and their tooltips (the git term in parentheses).
        const pull = window.getByTestId('header-pull')
        const push = window.getByTestId('header-push')
        await expect(pull).toBeVisible({ timeout: 10_000 })
        await expect(push).toBeVisible()
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
      } finally {
        // Each step on its own: one failing must not skip the others. The
        // failures are asserted after the `finally` — so a failed test body
        // keeps its own error instead of a cleanup one.
        const step = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
          try {
            await fn()
          } catch (e) {
            cleanupErrors.push(`${label}: ${(e as Error).message}`)
          }
        }
        await step('dismiss overlays', () => dismissOverlays(window))
        // A project must be open first: `restoreEnglishLocale` ends on the
        // APIs page and the header tabs exist only inside a project (Project
        // Home has neither). The canonical one — this spec's project is
        // deleted below.
        await step('open canonical project', () => ensureCanonicalProject(window))
        await step('restore English', () => restoreEnglishLocale(window))
        if (projectId) {
          const pid = projectId
          await step('clear git settings', () =>
            window.evaluate(
              (id) => (window as unknown as Win).api?.settings?.set(`git.${id}`, { repoUrl: '' }),
              pid,
            ),
          )
        }
        await step('find the copy', async () => {
          if (before.length) {
            copies = (await allProjectIds(window)).filter((id) => !before.includes(id))
          }
        })
        owned = [...copies, ...(projectId ? [projectId] : [])]
        // Close their header tabs (an open tab of a deleted project would linger).
        for (const id of owned) {
          await step(`close tab ${id}`, async () => {
            const close = window.getByTestId(`header-project-tab-close-${id}`)
            if ((await close.count()) > 0) {
              await close.click({ force: true })
              await expect(close).toHaveCount(0, { timeout: 5_000 })
            }
          })
        }
        for (const id of owned) {
          await step(`delete project ${id}`, () => deleteProject(window, id))
        }
        await step('remove temp dir', async () => {
          fs.rmSync(tmp, { recursive: true, force: true })
        })
      }

      // Reached only when the body passed: the cleanup left the shared window clean.
      expect(cleanupErrors).toEqual([])
      expect(copies.length).toBeGreaterThan(0)
      expect(await persistedLocale(window)).toBe('en')
      const remaining = await allProjectIds(window)
      for (const id of owned) expect(remaining).not.toContain(id)
    },
  )
})
