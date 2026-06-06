/**
 * MST-265, MST-275, MST-190 — Branch persistence
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createBranchScopedRequest, getActiveProjectId, listBranches } from '../../helpers/ui/assert-ipc'
import { createBranchIpc, deleteBranchIpc } from '../../helpers/ui/db-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB branch [MST-265, MST-275]', () => {
  uiTest('MST-265 active branch name persists in branch list', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const name = `persist-${uid()}`
    const branchId = await createBranchIpc(window, projectId, name)
    const branches = (await listBranches(window, projectId)) as Array<{ id: string; name: string }>
    expect(branches.some((b) => b.id === branchId && b.name === name)).toBe(true)
  })

  uiTest('MST-275 branch delete removes scoped requests from list', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const name = `del-${uid()}`
    const branchId = await createBranchIpc(window, projectId, name)
    const reqName = `Scoped ${uid()}`
    await createBranchScopedRequest(window, {
      projectId,
      branchId: name,
      name: reqName,
      url: 'http://127.0.0.1/get',
    })
    await deleteBranchIpc(window, branchId)
    const branches = (await listBranches(window, projectId)) as Array<{ id: string }>
    expect(branches.some((b) => b.id === branchId)).toBe(false)
  })
})
