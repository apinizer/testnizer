/**
 * MST-264 — Branch switch endpoint isolation
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createBranchScopedRequest, getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { createBranchIpc } from '../../helpers/ui/db-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB branch isolation [MST-264]', () => {
  uiTest('MST-264 two branches keep separate saved request sets', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const branchA = `a-${uid()}`
    const branchB = `b-${uid()}`
    await createBranchIpc(window, projectId, branchA)
    await createBranchIpc(window, projectId, branchB)

    const reqA = `OnlyA ${uid()}`
    const reqB = `OnlyB ${uid()}`
    await createBranchScopedRequest(window, { projectId, branchId: branchA, name: reqA, url: 'http://127.0.0.1/a' })
    await createBranchScopedRequest(window, { projectId, branchId: branchB, name: reqB, url: 'http://127.0.0.1/b' })

    const countOn = async (scope: string, label: string) =>
      window.evaluate(
        async ({ pid, br, n }) => {
          const w = window as Window & {
            api?: { savedRequest?: { list: (id: string, b?: string | null) => Promise<{ success: boolean; data?: Array<{ name: string }> }> } }
          }
          const res = await w.api?.savedRequest?.list(pid, br)
          return (res?.data ?? []).filter((r) => r.name === n).length
        },
        { pid: projectId, br: scope, n: label },
      )

    expect(await countOn(branchA, reqA)).toBe(1)
    expect(await countOn(branchA, reqB)).toBe(0)
    expect(await countOn(branchB, reqB)).toBe(1)
    expect(await countOn(branchB, reqA)).toBe(0)
  })
})
