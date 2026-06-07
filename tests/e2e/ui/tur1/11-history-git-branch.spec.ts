/**
 * MST-185 — Branch create/switch isolation
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar } from '../../helpers/ui/bootstrap'
import { createBranch, switchToDefaultBranch } from '../../helpers/ui/branch-flow'
import { createBranchScopedRequest, getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function countBranchRequests(
  page: import('@playwright/test').Page,
  projectId: string,
  branchScope: string | null,
  name: string,
): Promise<number> {
  return page.evaluate(
    async ({ pid, scope, label }) => {
      const w = window as Window & {
        api?: { savedRequest?: { list: (id: string, branch?: string | null) => Promise<{ success: boolean; data?: Array<{ name: string }> }> } }
      }
      const res = await w.api?.savedRequest?.list(pid, scope)
      return (res?.data ?? []).filter((r) => r.name === label).length
    },
    { pid: projectId, scope: branchScope, label: name },
  )
}

uiTest.describe('Tur1 — Git branch [MST-185]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // Creating + switching to a feature branch mutates the worker-shared active
  // branch. Return to the default branch so later specs see the canonical tree.
  uiTest.afterEach(async ({ window }) => {
    await switchToDefaultBranch(window).catch(() => {})
  })

  uiTest('MST-185 request created on a branch is isolated from parent branch', async ({ window }) => {
    const branchName = `feat-${uid()}`
    const reqLabel = `BranchOnly ${uid()}`
    const projectId = await getActiveProjectId(window)
    const url = `${http()}/get?branch=only`

    await createBranch(window, branchName)
    const reqId = await createBranchScopedRequest(window, {
      projectId,
      branchId: branchName,
      name: reqLabel,
      url,
    })

    // Visible on the feature branch scope.
    await expect
      .poll(() => countBranchRequests(window, projectId, branchName, reqLabel))
      .toBe(1)

    // Hidden from the default (shared) branch scope.
    await expect
      .poll(() => countBranchRequests(window, projectId, null, reqLabel))
      .toBe(0)

    expect(reqId.length).toBeGreaterThan(0)
  })
})
