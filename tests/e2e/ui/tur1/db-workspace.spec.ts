/**
 * MST-251, MST-253 — Workspace persistence
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createWorkspace, deleteWorkspace, getDefaultWorkspaceId } from '../../helpers/ui/db-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB workspace [MST-251, MST-253]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('MST-251 workspace create persists across list reload', async ({ window }) => {
    const name = `WS ${uid()}`
    const id = await createWorkspace(window, name)
    const listed = await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string; name: string }> }> } }
      }
      const res = await w.api?.workspace?.list()
      return res?.data ?? []
    })
    expect(listed.some((ws) => ws.id === id && ws.name === name)).toBe(true)
  })

  uiTest('MST-253 workspace delete removes it from list', async ({ window }) => {
    const name = `DelWS ${uid()}`
    const id = await createWorkspace(window, name)
    await deleteWorkspace(window, id)
    const listed = await window.evaluate(async () => {
      const w = window as unknown as Window & {
        api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
      }
      const res = await w.api?.workspace?.list()
      return res?.data ?? []
    })
    expect(listed.some((ws) => ws.id === id)).toBe(false)
    // Default bootstrap workspace still present.
    const defaultId = await getDefaultWorkspaceId(window)
    expect(defaultId.length).toBeGreaterThan(0)
  })
})
