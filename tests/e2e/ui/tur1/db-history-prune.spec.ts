/**
 * MST-259 — History pruning limit
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { addHistoryIpc, getDefaultWorkspaceId } from '../../helpers/ui/db-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'

uiTest.describe('Tur1 — DB history prune [MST-259]', () => {
  uiTest('MST-259 history:prune enforces limit', async ({ window }) => {
    await dismissOverlays(window)
    const wsId = await getDefaultWorkspaceId(window)
    const projectId = await getActiveProjectId(window)
    for (let i = 0; i < 5; i++) {
      await addHistoryIpc(window, {
        workspace_id: wsId,
        project_id: projectId,
        protocol: 'http',
        url: `http://127.0.0.1/get?prune=${i}`,
        request_snapshot: '{}',
      })
    }
    const pruned = await window.evaluate(async (wid) => {
      const w = window as Window & {
        api?: { history?: { prune: (limit: number, wsId?: string) => Promise<{ success: boolean; data?: number }> } }
      }
      return w.api?.history?.prune(2, wid)
    }, wsId)
    expect(pruned?.success).toBe(true)
    const list = await window.evaluate(async (wid) => {
      const w = window as Window & {
        api?: { history?: { list: (o: unknown) => Promise<{ success: boolean; data?: unknown[] }> } }
      }
      const res = await w.api?.history?.list({ workspace_id: wid, limit: 50 })
      return res?.data?.length ?? 0
    }, wsId)
    expect(list).toBeLessThanOrEqual(2)
  })
})
