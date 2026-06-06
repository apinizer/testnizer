/**
 * MST-097 — Save Project roundtrip (duplicate pipeline)
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createSavedRequestIpc, duplicateProject, getDefaultWorkspaceId } from '../../helpers/ui/db-flow'
import { getActiveProjectId, listSavedRequestsByProject } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Export save project [MST-097]', () => {
  uiTest('MST-097 project duplicate deep-copies saved requests', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const wsId = await getDefaultWorkspaceId(window)
    const reqName = `Clone ${uid()}`
    await createSavedRequestIpc(window, {
      projectId,
      name: reqName,
      url: 'http://127.0.0.1/get?clone=1',
    })

    const cloneId = await duplicateProject(window, projectId, wsId, `Copy ${uid()}`)
    const cloned = (await listSavedRequestsByProject(window, cloneId)) as Array<{ name: string }>
    expect(cloned.some((r) => r.name === reqName)).toBe(true)
  })
})
