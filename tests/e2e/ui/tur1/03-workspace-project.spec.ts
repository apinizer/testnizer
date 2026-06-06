/**
 * MST-010, MST-011, MST-012 — Workspace / project lifecycle
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { createProject, goToProjectHome, openProject } from '../../helpers/ui/workspace-flow'
import { fillUrl, saveRequestToTree } from '../../helpers/ui/request-flow'
import { getActiveProjectId, listSavedRequestsByProject } from '../../helpers/ui/assert-ipc'
import { duplicateProject, getDefaultWorkspaceId } from '../../helpers/ui/db-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Workspace / Project [MST-010..012]', () => {
  uiTest('MST-010 requests saved in project A are invisible in project B', async ({ window }) => {
    await dismissOverlays(window)
    const projA = `ProjA ${uid()}`
    const projB = `ProjB ${uid()}`
    const reqName = `IsoReq ${uid()}`

    await goToProjectHome(window)
    await createProject(window, projA)
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?proj=a`)
    await saveRequestToTree(window, reqName)
    const idA = await getActiveProjectId(window, projA)

    await goToProjectHome(window)
    await createProject(window, projB)
    const idB = await getActiveProjectId(window, projB)
    const listB = (await listSavedRequestsByProject(window, idB)) as Array<{ name: string }>
    expect(listB.some((r) => r.name === reqName)).toBe(false)

    await openProject(window, projA)
    const listA = (await listSavedRequestsByProject(window, idA)) as Array<{ name: string }>
    expect(listA.some((r) => r.name === reqName)).toBe(true)
  })

  uiTest('MST-011 project rename updates slug name via IPC', async ({ window }) => {
    await dismissOverlays(window)
    const orig = `Rename ${uid()}`
    const nextSlug = `renamed-${uid()}`
    await goToProjectHome(window)
    await createProject(window, orig)
    const projectId = await getActiveProjectId(window, orig)
    const upd = await window.evaluate(
      async ({ pid, name }) => {
        const w = window as Window & {
          api?: {
            project?: {
              update: (id: string, p: unknown) => Promise<{ success: boolean }>
              get: (id: string) => Promise<{ success: boolean; data?: { name: string } }>
            }
          }
        }
        const res = await w.api?.project?.update(pid, { name })
        if (!res?.success) return res
        return w.api?.project?.get(pid)
      },
      { pid: projectId, name: nextSlug },
    )
    expect(upd?.success).toBe(true)
    expect((upd as { data?: { name: string } })?.data?.name).toBe(nextSlug)
  })

  uiTest('MST-012 project duplicate creates independent copy', async ({ window }) => {
    await dismissOverlays(window)
    const orig = `DupSrc ${uid()}`
    await goToProjectHome(window)
    await createProject(window, orig)
    const projectId = await getActiveProjectId(window, orig)
    const wsId = await getDefaultWorkspaceId(window)
    const copyName = `DupCopy ${uid()}`
    const copyId = await duplicateProject(window, projectId, wsId, copyName)
    expect(copyId).not.toBe(projectId)
    const listed = await window.evaluate(async (wid) => {
      const w = window as Window & {
        api?: { project?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string; display_name?: string; name: string }> }> } }
      }
      const res = await w.api?.project?.list(wid)
      return res?.data ?? []
    }, wsId)
    expect(listed.some((p) => p.id === copyId && (p.display_name === copyName || p.name === copyName))).toBe(true)
  })
})
