/**
 * MST-262, MST-271 — Mock server persistence
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createMockServerIpc, deleteMockServerIpc, getMockServerIpc } from '../../helpers/ui/db-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { randomMockPort } from '../../helpers/ui/mock-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB mock [MST-262, MST-271]', () => {
  uiTest('MST-262 mock server config reloads with same port', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const port = randomMockPort()
    const name = `Persist ${uid()}`
    const id = await createMockServerIpc(window, projectId, name, port)
    const row = (await getMockServerIpc(window, id)) as { name: string; port: number }
    expect(row.name).toBe(name)
    expect(row.port).toBe(port)
  })

  uiTest('MST-271 mock server delete removes config', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const id = await createMockServerIpc(window, projectId, `Del ${uid()}`, randomMockPort())
    await deleteMockServerIpc(window, id)
    const list = await window.evaluate(async (pid) => {
      const w = window as unknown as Window & {
        api?: { mock?: { server?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }> } } }
      }
      const res = await w.api?.mock?.server?.list(pid)
      return res?.data ?? []
    }, projectId)
    expect(list.some((s: { id: string }) => s.id === id)).toBe(false)
  })
})
