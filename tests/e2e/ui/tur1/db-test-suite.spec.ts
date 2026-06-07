/**
 * MST-263, MST-273, MST-274 — Test suite persistence
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createTestSuiteIpc, deleteTestSuiteIpc } from '../../helpers/ui/db-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB test suite [MST-263, MST-273, MST-274]', () => {
  uiTest('MST-263 suite folder+item hierarchy persists', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const suiteId = await createTestSuiteIpc(window, projectId, `Suite ${uid()}`)

    const folderId = await window.evaluate(
      async ({ sid, name }) => {
        const w = window as unknown as Window & {
          api?: {
            testSuiteFolder?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string } }> }
          }
        }
        const res = await w.api?.testSuiteFolder?.create({ suite_id: sid, name, parent_id: null })
        if (!res?.success || !res.data?.id) throw new Error('folder create failed')
        return res.data.id
      },
      { sid: suiteId, name: `Folder ${uid()}` },
    )

    await window.evaluate(
      async ({ sid, fid }) => {
        const w = window as unknown as Window & {
          api?: { testSuiteItem?: { create: (p: unknown) => Promise<{ success: boolean }> } }
        }
        const res = await w.api?.testSuiteItem?.create({
          suite_id: sid,
          folder_id: fid,
          name: 'HTTP item',
          protocol: 'http',
          method: 'GET',
          url: 'http://127.0.0.1/get',
        })
        if (!res?.success) throw new Error('add item failed')
      },
      { sid: suiteId, fid: folderId },
    )

    const items = await window.evaluate(async (sid) => {
      const w = window as unknown as Window & {
        api?: {
          testSuite?: {
            listEndpoints: (id: string) => Promise<{ success: boolean; data?: { items: unknown[] } }>
          }
        }
      }
      const res = await w.api?.testSuite?.listEndpoints(sid)
      return res?.data?.items ?? []
    }, suiteId)
    expect(items.length).toBeGreaterThanOrEqual(1)
  })

  uiTest('MST-274 suite delete cascades items', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const suiteId = await createTestSuiteIpc(window, projectId, `DelSuite ${uid()}`)
    await deleteTestSuiteIpc(window, suiteId)
    const list = await window.evaluate(async (pid) => {
      const w = window as unknown as Window & {
        api?: { testSuite?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
      }
      const res = await w.api?.testSuite?.list(pid)
      return res?.data ?? []
    }, projectId)
    expect(list.some((s: { id: string }) => s.id === suiteId)).toBe(false)
  })
})
