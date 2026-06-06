/**
 * MST-070 — Swagger 2.0 import
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId, listEndpointsByProject } from '../../helpers/ui/assert-ipc'
const FIXTURES = path.resolve(__dirname, '../../../fixtures/import-export')
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Import Swagger 2 [MST-070]', () => {
  uiTest('MST-070 Swagger 2.0 fixture imports user endpoints', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    const folder = `Swagger2 ${uid()}`
    const content = fs.readFileSync(path.join(FIXTURES, 'swagger-2.0.json'), 'utf8')
    const projectId = await getActiveProjectId(window)
    await window.evaluate(
      async ({ projectId, content, folderName }) => {
        const w = window as Window & {
          api?: {
            folder?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string } }> }
            importExport?: { importOpenApi: (p: unknown) => Promise<{ success: boolean; error?: string }> }
          }
        }
        const folderRes = await w.api?.folder?.create({ project_id: projectId, name: folderName })
        if (!folderRes?.success || !folderRes.data?.id) throw new Error('folder create failed')
        const res = await w.api?.importExport?.importOpenApi({
          projectId,
          content,
          format: 'swagger',
          folderId: folderRes.data.id,
        })
        if (!res?.success) throw new Error(res?.error ?? 'swagger import failed')
        const inner = res.data as { success?: boolean; error?: string } | undefined
        if (inner?.success === false) throw new Error(inner.error ?? 'swagger import failed')
      },
      { projectId, content, folderName: folder },
    )
    await expect
      .poll(async () => {
        const rows = (await listEndpointsByProject(window, projectId)) as Array<{ name: string }>
        return rows.some((r) => /list users/i.test(r.name))
      })
      .toBe(true)
    // IPC poll above is authoritative; tree UI can lag behind in long serial runs.
  })
})
