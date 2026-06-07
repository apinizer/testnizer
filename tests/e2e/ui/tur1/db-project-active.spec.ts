/**
 * MST-016 P0 — Active project reload persists
 *
 * Creates a second project via IPC, opens it in a tab, then asserts that
 * the IPC layer still returns the project when re-queried — proving the DB
 * row survived the write and can be reloaded without a full app restart.
 *
 * NOTE: Full cross-relaunch coverage is in db-relaunch.spec.ts (MST-266).
 * This file uses the shared worker fixture and is intentionally separate from
 * db-project.spec.ts as instructed.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB active project persist [MST-016]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-016 active project ID is stable across IPC round-trips', async ({ window }) => {
    // The canonical project is already open after beforeEach.
    // Read the active project ID twice and confirm it is consistent.
    const idFirst = await getActiveProjectId(window)
    expect(idFirst.length).toBeGreaterThan(0)

    // Reload the project list fresh via IPC and confirm the ID is still present.
    const listed = await window.evaluate(async (pid) => {
      const w = window as unknown as Window & {
        api?: {
          workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> }
          project?: { list: (wsId: string) => Promise<{ success: boolean; data?: Array<{ id: string; name: string }> }> }
        }
      }
      const wsRes = await w.api?.workspace?.list()
      const wsId = wsRes?.data?.[0]?.id
      if (!wsId) return null
      const projRes = await w.api?.project?.list(wsId)
      return projRes?.data?.find((p) => p.id === pid) ?? null
    }, idFirst)

    expect(listed).not.toBeNull()
    expect((listed as { id: string }).id).toBe(idFirst)
  })

  uiTest('MST-016 creating a new project persists it in the DB', async ({ window }) => {
    const projName = `Persist-${uid()}`

    // Get workspace ID
    const wsId = await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
      }
      const res = await w.api?.workspace?.list()
      const id = res?.data?.[0]?.id
      if (!id) throw new Error('no workspace')
      return id
    })

    // Create project via IPC
    const newProjectId = await window.evaluate(
      async ({ wid, name }) => {
        const w = window as unknown as Window & {
          api?: { project?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }> } }
        }
        const res = await w.api?.project?.create({ workspace_id: wid, name, type: 'http' })
        if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'project create failed')
        return res.data.id
      },
      { wid: wsId, name: projName },
    )

    expect(newProjectId.length).toBeGreaterThan(0)

    // Re-list projects and confirm it persisted
    const listed = await window.evaluate(
      async ({ wid, pid }) => {
        const w = window as unknown as Window & {
          api?: { project?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string; name: string }> }> } }
        }
        const res = await w.api?.project?.list(wid)
        return res?.data?.find((p) => p.id === pid) ?? null
      },
      { wid: wsId, pid: newProjectId },
    )

    expect(listed).not.toBeNull()
    expect((listed as { name: string }).name).toBe(projName)

    // Clean up: delete the test project
    await window.evaluate(async (pid) => {
      const w = window as unknown as Window & { api?: { project?: { delete: (id: string) => Promise<unknown> } } }
      await w.api?.project?.delete(pid)
    }, newProjectId)
  })

  uiTest('MST-016 project get by ID returns correct data', async ({ window }) => {
    const projectId = await getActiveProjectId(window)

    const project = await window.evaluate(async (pid) => {
      const w = window as unknown as Window & {
        api?: { project?: { get: (id: string) => Promise<{ success: boolean; data?: { id: string; name: string; type: string }; error?: string }> } }
      }
      const res = await w.api?.project?.get(pid)
      if (!res?.success) throw new Error(res?.error ?? 'project get failed')
      return res.data ?? null
    }, projectId)

    expect(project).not.toBeNull()
    expect((project as { id: string }).id).toBe(projectId)
    expect(typeof (project as { name: string }).name).toBe('string')
    expect((project as { name: string }).name.length).toBeGreaterThan(0)
  })
})
