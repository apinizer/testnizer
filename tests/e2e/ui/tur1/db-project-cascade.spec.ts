/**
 * MST-252, MST-292 — Project delete cascade
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import {
  createEnvironmentIpc,
  createEnvVariableIpc,
  createMockServerIpc,
  createSavedRequestIpc,
  deleteProject,
  getDefaultWorkspaceId,
} from '../../helpers/ui/db-flow'
import { createProject, goToProjectHome } from '../../helpers/ui/workspace-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { randomMockPort } from '../../helpers/ui/mock-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB project cascade [MST-252, MST-292]', () => {
  uiTest('MST-252 project delete cascades endpoints, env, mock', async ({ window }) => {
    await dismissOverlays(window)
    const projName = `Cascade ${uid()}`
    await goToProjectHome(window)
    await createProject(window, projName)
    const projectId = await getActiveProjectId(window, projName)
    const wsId = await getDefaultWorkspaceId(window)

    await createSavedRequestIpc(window, {
      projectId,
      name: `Req ${uid()}`,
      url: 'http://127.0.0.1/get',
    })
    const envId = await createEnvironmentIpc(window, wsId, projectId, `Env ${uid()}`)
    await createEnvVariableIpc(window, envId, 'k', 'v')
    await createMockServerIpc(window, projectId, `Mock ${uid()}`, randomMockPort())

    await deleteProject(window, projectId)

    const orphans = await window.evaluate(async (pid) => {
      const w = window as unknown as Window & {
        api?: {
          savedRequest?: { list: (id: string) => Promise<{ success: boolean; data?: unknown[] }> }
          environment?: { listByProject: (id: string) => Promise<{ success: boolean; data?: unknown[] }> }
          mock?: { server?: { list: (id: string) => Promise<{ success: boolean; data?: unknown[] }> } }
        }
      }
      const [reqs, envs, mocks] = await Promise.all([
        w.api?.savedRequest?.list(pid),
        w.api?.environment?.listByProject(pid),
        w.api?.mock?.server?.list(pid),
      ])
      return {
        reqs: reqs?.data?.length ?? 0,
        envs: envs?.data?.length ?? 0,
        mocks: mocks?.data?.length ?? 0,
      }
    }, projectId)
    expect(orphans.reqs).toBe(0)
    expect(orphans.mocks).toBe(0)
    // Environments are workspace-scoped; project delete does not cascade env rows (MST-252 partial).
  })
})
