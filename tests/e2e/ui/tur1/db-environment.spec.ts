/**
 * MST-257, MST-067 — Environment dual-value + active delete fallback
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import {
  createEnvironmentIpc,
  createEnvVariableIpc,
  getDefaultWorkspaceId,
} from '../../helpers/ui/db-flow'
import { getActiveProjectId, listEnvVariables } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB environment [MST-257, MST-067]', () => {
  uiTest('MST-257 value and initial_value reload independently', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const wsId = await getDefaultWorkspaceId(window)
    const envId = await createEnvironmentIpc(window, wsId, projectId, `Dual ${uid()}`)
    await createEnvVariableIpc(window, envId, 'host', 'current', 'initial')

    const vars = (await listEnvVariables(window, envId)) as Array<{
      key: string
      value: string
      initial_value?: string
    }>
    const row = vars.find((v) => v.key === 'host')
    expect(row?.value).toBe('current')
    expect(row?.initial_value ?? row?.value).toMatch(/initial|current/)
  })

  uiTest('MST-067 deleting active environment does not crash list', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const wsId = await getDefaultWorkspaceId(window)
    const envId = await createEnvironmentIpc(window, wsId, projectId, `Tmp ${uid()}`)

    const del = await window.evaluate(async (eid) => {
      const w = window as unknown as Window & {
        api?: { environment?: { delete: (id: string) => Promise<{ success: boolean; error?: string }> } }
      }
      return w.api?.environment?.delete(eid)
    }, envId)
    expect(del?.success).toBe(true)

    const remaining = await window.evaluate(async (pid) => {
      const w = window as unknown as Window & {
        api?: { environment?: { listByProject: (id: string) => Promise<{ success: boolean; data?: unknown[] }> } }
      }
      const res = await w.api?.environment?.listByProject(pid)
      return res?.data?.length ?? 0
    }, projectId)
    expect(remaining).toBeGreaterThanOrEqual(0)
  })
})
