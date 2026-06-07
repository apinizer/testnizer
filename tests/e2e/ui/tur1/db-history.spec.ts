/**
 * MST-157, MST-258, MST-267, MST-268 — History persistence
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import {
  addHistoryIpc,
  clearHistoryIpc,
  getDefaultWorkspaceId,
  listHistoryIpc,
} from '../../helpers/ui/db-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB history [MST-157, MST-258, MST-267, MST-268]', () => {
  uiTest('MST-258 history entry stores protocol, status, snapshots', async ({ window }) => {
    await dismissOverlays(window)
    const wsId = await getDefaultWorkspaceId(window)
    const projectId = await getActiveProjectId(window)
    const marker = `hist-${uid()}`
    const id = await addHistoryIpc(window, {
      workspace_id: wsId,
      project_id: projectId,
      protocol: 'websocket',
      method: 'GET',
      url: `http://127.0.0.1/get?${marker}=1`,
      status_code: 200,
      duration_ms: 42,
      request_snapshot: JSON.stringify({ url: `http://127.0.0.1/get?${marker}=1` }),
      response_snapshot: JSON.stringify({ status: 200 }),
    })

    const row = await window.evaluate(async (hid) => {
      const w = window as unknown as Window & {
        api?: { history?: { get: (id: string) => Promise<{ success: boolean; data?: Record<string, unknown> }> } }
      }
      const res = await w.api?.history?.get(hid)
      return res?.data
    }, id)
    expect(row?.protocol).toBe('websocket')
    expect(row?.status_code).toBe(200)
    expect(String(row?.request_snapshot)).toContain(marker)
  })

  uiTest('MST-157 history records protocol type distinctly', async ({ window }) => {
    await dismissOverlays(window)
    const wsId = await getDefaultWorkspaceId(window)
    const projectId = await getActiveProjectId(window)
    await addHistoryIpc(window, {
      workspace_id: wsId,
      project_id: projectId,
      protocol: 'grpc',
      url: 'localhost:50051',
      request_snapshot: '{}',
    })
    const list = (await listHistoryIpc(window, { project_id: projectId, limit: 20 })) as Array<{
      protocol: string
    }>
    expect(list.some((h) => h.protocol === 'grpc')).toBe(true)
  })

  uiTest('MST-268 clear all removes project history', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const wsId = await getDefaultWorkspaceId(window)
    await addHistoryIpc(window, {
      workspace_id: wsId,
      project_id: projectId,
      protocol: 'http',
      url: 'http://127.0.0.1/get',
      request_snapshot: '{}',
    })
    await clearHistoryIpc(window, { project_id: projectId })
    const after = await listHistoryIpc(window, { project_id: projectId, limit: 50 })
    expect(after.length).toBe(0)
  })
})
