/**
 * MST-157, MST-258, MST-267, MST-268 — History persistence
 * Issues #195 / #196 — History masking, Console "Show secrets" toggle
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

  uiTest('issue #195 history rows never store a credential (masked in main)', async ({ window }) => {
    await dismissOverlays(window)
    const wsId = await getDefaultWorkspaceId(window)
    const projectId = await getActiveProjectId(window)
    const literal = `literal-key-${uid()}`
    const id = await addHistoryIpc(window, {
      workspace_id: wsId,
      project_id: projectId,
      protocol: 'http',
      method: 'GET',
      url: `http://127.0.0.1/get?api_key=${literal}`,
      request_snapshot: JSON.stringify({
        headers: [{ key: 'X-API-Key', value: literal, enabled: true }],
        configured: { headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }] },
      }),
      response_snapshot: JSON.stringify({ status: 200, body: `{"echo":"${literal}"}` }),
    })
    const row = await window.evaluate(async (hid) => {
      const w = window as unknown as Window & {
        api?: { history?: { get: (id: string) => Promise<{ success: boolean; data?: Record<string, unknown> }> } }
      }
      const res = await w.api?.history?.get(hid)
      return res?.data
    }, id)
    const text = JSON.stringify(row)
    expect(text).not.toContain(literal)
    // The {{var}} template is kept for re-send.
    expect(String(row?.request_snapshot)).toContain('Bearer {{token}}')
  })

  uiTest('issue #196 Console "Show secrets" is off by default and session-only', async ({ window }) => {
    await dismissOverlays(window)
    const read = (): Promise<unknown> =>
      window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { console?: { getShowSecrets: () => Promise<{ data?: boolean }> } }
        }
        return (await w.api?.console?.getShowSecrets())?.data
      })
    expect(await read()).toBe(false)
    await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api?: { console?: { setShowSecrets: (on: boolean) => Promise<unknown> } }
      }
      await w.api?.console?.setShowSecrets(true)
    })
    expect(await read()).toBe(true)
    // Reset so later specs in the shared Electron instance see the default.
    await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api?: { console?: { setShowSecrets: (on: boolean) => Promise<unknown> } }
      }
      await w.api?.console?.setShowSecrets(false)
    })
    expect(await read()).toBe(false)
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
