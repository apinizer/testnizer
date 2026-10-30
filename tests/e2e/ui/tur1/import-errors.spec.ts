/**
 * MST-085 — Wrong file type actionable error
 * MST-086 — Duplicate import conflict
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId, listEndpointsByProject } from '../../helpers/ui/assert-ipc'
import { openImportDropdown } from '../../helpers/ui/import-flow'

const FIXTURES = path.resolve(__dirname, '../../../fixtures/import-export')
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Import errors [MST-085]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  // Issue #276: the Postman card takes every Postman artifact. An environment
  // file is no longer rejected — it is announced as an environment import
  // (no destination folder) instead of being forced through the folder step.
  // The file is picked through the real `import:openFile` IPC (main-process
  // dialog patched): the renderer `window.api` stub cannot replace a
  // contextBridge function in the production build, so the old version of
  // this test only ever matched the static "Postman" heading.
  uiTest('MST-085 Postman environment file is routed to an environment import', async ({ app, window }) => {
    const file = path.join(FIXTURES, 'postman-env-wrong-type.json')
    await app.evaluate(({ dialog }, p) => {
      const d = dialog as unknown as Record<string, unknown>
      if (!d.__orig085) d.__orig085 = d.showOpenDialog
      d.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
    }, file)
    try {
      await openImportDropdown(window, /Postman/i)
      const modal = window.getByTestId('import-modal')
      await modal.getByRole('button', { name: /Click to select a/i }).click()
      await expect(modal.getByTestId('import-env-note')).toBeVisible({ timeout: 15_000 })
      await expect(modal.getByPlaceholder('Folder name')).toBeHidden()
      await window.keyboard.press('Escape')
      await expect(modal).toBeHidden({ timeout: 10_000 })
    } finally {
      await app.evaluate(({ dialog }) => {
        const d = dialog as unknown as Record<string, unknown>
        if (d.__orig085) {
          d.showOpenDialog = d.__orig085
          delete d.__orig085
        }
      })
    }
  })
})

// ─── MST-086: Duplicate import conflict ────────────────────────────────────

uiTest.describe('Tur1 — Duplicate import conflict [MST-086]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-086 importing the same Postman collection twice creates two separate folders', async ({
    window,
  }) => {
    const content = fs.readFileSync(path.join(FIXTURES, 'postman-v2.1.json'), 'utf8')
    const projectId = await getActiveProjectId(window)

    const importOnce = async (folderName: string) => {
      await window.evaluate(
        async ({ projectId, content, folderName }) => {
          const w = window as unknown as Window & {
            api?: {
              folder?: {
                create: (p: unknown) => Promise<{ success: boolean; data?: { id: string } }>
              }
              importExport?: {
                importPostman: (p: unknown) => Promise<{ success: boolean; data?: unknown }>
              }
            }
          }
          const folderRes = await w.api?.folder?.create({
            project_id: projectId,
            name: folderName,
          })
          if (!folderRes?.success || !folderRes.data?.id) {
            throw new Error('folder create failed')
          }
          const res = await w.api?.importExport?.importPostman({
            projectId,
            content,
            folderId: folderRes.data.id,
          })
          if (!res?.success) throw new Error('import failed')
        },
        { projectId, content, folderName },
      )
    }

    const folder1 = `Dup1 ${uid()}`
    const folder2 = `Dup2 ${uid()}`

    const rowsBefore = ((await listEndpointsByProject(window, projectId)) as unknown[]).length
    await importOnce(folder1)
    const rowsAfterFirst = ((await listEndpointsByProject(window, projectId)) as unknown[]).length
    await importOnce(folder2)
    const rowsAfterSecond = ((await listEndpointsByProject(window, projectId)) as unknown[]).length

    const firstImportCount = rowsAfterFirst - rowsBefore
    const secondImportCount = rowsAfterSecond - rowsAfterFirst

    // Both imports should add endpoints
    expect(firstImportCount).toBeGreaterThan(0)
    expect(secondImportCount).toBeGreaterThan(0)
    // Total rows doubled (no silent deduplication without user prompt)
    expect(rowsAfterSecond - rowsBefore).toBeGreaterThanOrEqual(firstImportCount * 2)
  })

  uiTest('MST-086 importing Insomnia collection twice does not corrupt existing endpoints', async ({
    window,
  }) => {
    const content = fs.readFileSync(path.join(FIXTURES, 'insomnia-v4.json'), 'utf8')
    const projectId = await getActiveProjectId(window)

    const importInsomnia = async (folderName: string) => {
      await window.evaluate(
        async ({ projectId, content, folderName }) => {
          const w = window as unknown as Window & {
            api?: {
              folder?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string } }> }
              importExport?: { importInsomnia: (p: unknown) => Promise<{ success: boolean }> }
            }
          }
          const fr = await w.api?.folder?.create({ project_id: projectId, name: folderName })
          await w.api?.importExport?.importInsomnia({
            projectId,
            content,
            folderId: fr?.data?.id ?? null,
          })
        },
        { projectId, content, folderName },
      )
    }

    const rowsBefore = ((await listEndpointsByProject(window, projectId)) as unknown[]).length
    await importInsomnia(`Dup-Ins-1 ${uid()}`)
    const countAfterFirst = ((await listEndpointsByProject(window, projectId)) as unknown[]).length - rowsBefore
    await importInsomnia(`Dup-Ins-2 ${uid()}`)
    const countAfterSecond =
      ((await listEndpointsByProject(window, projectId)) as unknown[]).length - rowsBefore - countAfterFirst

    // Both imports should succeed and add endpoints
    expect(countAfterFirst).toBeGreaterThan(0)
    expect(countAfterSecond).toBeGreaterThan(0)
  })
})
