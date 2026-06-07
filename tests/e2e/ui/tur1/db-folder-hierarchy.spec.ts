/**
 * MST-025, MST-026 — Folder hierarchy + sort
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createNestedFolders } from '../../helpers/ui/db-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB folder hierarchy [MST-025, MST-026]', () => {
  uiTest('MST-025 four-level folder chain persists parent_id chain', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const names = [`L1 ${uid()}`, `L2 ${uid()}`, `L3 ${uid()}`, `L4 ${uid()}`]
    const ids = await createNestedFolders(window, projectId, names)
    expect(ids).toHaveLength(4)

    const folders = await window.evaluate(async (pid) => {
      const w = window as unknown as Window & {
        api?: {
          folder?: {
            list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string; parent_id: string | null }> }>
          }
        }
      }
      const res = await w.api?.folder?.list(pid)
      return res?.data ?? []
    }, projectId)

    for (let i = 1; i < ids.length; i++) {
      const child = folders.find((f) => f.id === ids[i])
      expect(child?.parent_id).toBe(ids[i - 1])
    }
  })
})
