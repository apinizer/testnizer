/**
 * MST-256 — Endpoint rename + duplicate
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createSavedRequestIpc, updateSavedRequestIpc } from '../../helpers/ui/db-flow'
import { getActiveProjectId, getSavedRequest, listSavedRequestsByProject } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB endpoint CRUD [MST-256]', () => {
  uiTest('MST-256 rename and copy produce independent rows', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const orig = `Orig ${uid()}`
    const renamed = `Renamed ${uid()}`
    const id = await createSavedRequestIpc(window, {
      projectId,
      name: orig,
      url: 'http://127.0.0.1/get?v=1',
    })
    await updateSavedRequestIpc(window, id, { name: renamed, url: 'http://127.0.0.1/get?v=2' })
    const row = (await getSavedRequest(window, id)) as { name: string; url: string }
    expect(row.name).toBe(renamed)
    expect(row.url).toContain('v=2')

    const copyName = `Copy ${uid()}`
    const dupId = await createSavedRequestIpc(window, {
      projectId,
      name: copyName,
      url: row.url,
    })
    expect(dupId).not.toBe(id)
    const list = (await listSavedRequestsByProject(window, projectId)) as Array<{ id: string; name: string }>
    expect(list.some((r) => r.id === id && r.name === renamed)).toBe(true)
    expect(list.some((r) => r.id === dupId && r.name === copyName)).toBe(true)
  })
})
