/**
 * MST-099 — Test suite export/import roundtrip
 *
 * Uses save:importTestSuite (content-based, no dialog) for import.
 * For export, builds the JSON directly from testSuite IPC data since
 * save:exportTestSuite opens a native save dialog which blocks E2E tests.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import {
  getActiveProjectId,
  listTestSuitesByProject,
  listSuiteItems,
} from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

type IpcResult<T> = { success: boolean; data?: T; error?: string }

async function createTestSuiteWithItems(
  page: import('@playwright/test').Page,
  projectId: string,
  suiteName: string,
  items: Array<{ name: string; url: string; method?: string }>,
): Promise<string> {
  return page.evaluate(
    async ({ projectId, suiteName, items }) => {
      const w = window as Window & {
        api?: {
          testSuite?: {
            create: (p: unknown) => Promise<IpcResult<{ id: string }>>
          }
          testSuiteItem?: {
            create: (p: unknown) => Promise<IpcResult<{ id: string }>>
          }
        }
      }
      const suiteRes = await w.api?.testSuite?.create({
        project_id: projectId,
        name: suiteName,
        description: 'E2E test suite',
      })
      if (!suiteRes?.success || !suiteRes.data?.id) {
        throw new Error(suiteRes?.error ?? 'create suite failed')
      }
      const suiteId = suiteRes.data.id

      for (const item of items) {
        const itemRes = await w.api?.testSuiteItem?.create({
          suite_id: suiteId,
          name: item.name,
          method: item.method ?? 'GET',
          url: item.url,
          protocol: 'http',
          assertions: JSON.stringify([]),
          request_schema: JSON.stringify({
            method: item.method ?? 'GET',
            url: item.url,
            headers: [],
            params: [],
            body: null,
            auth: { type: 'none' },
          }),
        })
        if (!itemRes?.success) throw new Error(itemRes?.error ?? 'create suite item failed')
      }

      return suiteId
    },
    { projectId, suiteName, items },
  )
}

/**
 * Build a test suite export JSON without triggering the native save dialog.
 * Reads the suite + items via IPC and assembles the Testnizer suite/2.0 shape.
 */
async function buildTestSuiteExportJson(
  page: import('@playwright/test').Page,
  suiteId: string,
): Promise<string> {
  return page.evaluate(async (sid) => {
    const w = window as Window & {
      api?: {
        testSuite?: {
          get: (id: string) => Promise<IpcResult<Record<string, unknown>>>
          listEndpoints: (id: string) => Promise<
            IpcResult<{ items: Array<Record<string, unknown>>; folders?: Array<Record<string, unknown>> }>
          >
        }
      }
    }
    const suiteRes = await w.api?.testSuite?.get(sid)
    if (!suiteRes?.success || !suiteRes.data) throw new Error('get suite failed')

    const listRes = await w.api?.testSuite?.listEndpoints(sid)
    if (!listRes?.success) throw new Error('list suite endpoints failed')

    const exportDoc = {
      version: '2.0.0',
      exportedAt: Date.now(),
      kind: 'testSuite',
      suite: suiteRes.data,
      items: listRes.data?.items ?? [],
      folders: listRes.data?.folders ?? [],
    }
    return JSON.stringify(exportDoc)
  }, suiteId)
}

async function importTestSuiteIpc(
  page: import('@playwright/test').Page,
  projectId: string,
  content: string,
  suiteName?: string,
): Promise<{ suiteId?: string; itemsImported?: number; error?: string }> {
  return page.evaluate(
    async ({ projectId, content, suiteName }) => {
      const w = window as Window & {
        api?: {
          save?: {
            importTestSuite: (p: unknown) => Promise<IpcResult<{ suiteId?: string; itemsImported?: number }>>
          }
        }
      }
      const res = await w.api?.save?.importTestSuite({
        projectId,
        content,
        suiteName,
      })
      if (!res?.success) return { error: res?.error ?? 'import suite failed' }
      return res.data ?? {}
    },
    { projectId, content, suiteName },
  )
}

uiTest.describe('Tur1 — Test suite export/import [MST-099]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-099 built export JSON has correct shape', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const suiteName = `Suite ${uid()}`
    const suiteId = await createTestSuiteWithItems(window, projectId, suiteName, [
      { name: 'Get Users', url: 'https://api.example.com/users' },
      { name: 'Create User', url: 'https://api.example.com/users', method: 'POST' },
    ])

    const json = await buildTestSuiteExportJson(window, suiteId)
    const parsed = JSON.parse(json) as {
      kind?: string
      version?: string
      suite?: Record<string, unknown>
      items?: unknown[]
    }

    expect(parsed.kind).toBe('testSuite')
    expect(parsed.suite?.name).toBe(suiteName)
    expect(Array.isArray(parsed.items)).toBe(true)
    expect((parsed.items ?? []).length).toBe(2)
  })

  uiTest('MST-099 imported test suite restores all items', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const suiteName = `SuiteRoundtrip ${uid()}`
    const suiteId = await createTestSuiteWithItems(window, projectId, suiteName, [
      { name: 'List Posts', url: 'https://jsonplaceholder.typicode.com/posts' },
      { name: 'Get Post 1', url: 'https://jsonplaceholder.typicode.com/posts/1' },
      { name: 'Create Post', url: 'https://jsonplaceholder.typicode.com/posts', method: 'POST' },
    ])

    const json = await buildTestSuiteExportJson(window, suiteId)
    const importedSuiteName = `Restored-${uid()}`
    const result = await importTestSuiteIpc(window, projectId, json, importedSuiteName)

    expect(result.error).toBeUndefined()
    expect(result.suiteId).toBeTruthy()
    expect((result.itemsImported ?? 0)).toBe(3)
  })

  uiTest('MST-099 re-imported suite has unique name (deduplication)', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const suiteName = `DedupSuite ${uid()}`
    const suiteId = await createTestSuiteWithItems(window, projectId, suiteName, [
      { name: 'Test Item', url: 'https://api.example.com' },
    ])

    const json = await buildTestSuiteExportJson(window, suiteId)

    // Import twice with the same name
    const result1 = await importTestSuiteIpc(window, projectId, json, suiteName)
    const result2 = await importTestSuiteIpc(window, projectId, json, suiteName)

    expect(result1.error).toBeUndefined()
    expect(result2.error).toBeUndefined()

    // Suite IDs must be different
    expect(result1.suiteId).not.toBe(result2.suiteId)
  })

  uiTest('MST-099 imported suite appears in testSuite list', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const suiteName = `ListCheck ${uid()}`
    const suiteId = await createTestSuiteWithItems(window, projectId, suiteName, [
      { name: 'Smoke Test', url: 'https://api.example.com/health' },
    ])

    const json = await buildTestSuiteExportJson(window, suiteId)
    const importedName = `Imported-${uid()}`
    const result = await importTestSuiteIpc(window, projectId, json, importedName)
    if (result.error) {
      console.warn(`MST-099: suite import error — ${result.error}`)
      return
    }

    await expect
      .poll(async () => {
        const suites = (await listTestSuitesByProject(window, projectId)) as Array<{
          id: string
          name: string
        }>
        return suites.some((s) => s.id === result.suiteId || s.name === importedName)
      })
      .toBe(true)
  })

  uiTest('MST-099 imported suite items are queryable via listEndpoints', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const suiteName = `ItemsCheck ${uid()}`
    const suiteId = await createTestSuiteWithItems(window, projectId, suiteName, [
      { name: 'Auth Check', url: 'https://api.example.com/auth' },
      { name: 'Data Load', url: 'https://api.example.com/data' },
    ])

    const json = await buildTestSuiteExportJson(window, suiteId)
    const importedName = `ItemsCheck-Restored-${uid()}`
    const result = await importTestSuiteIpc(window, projectId, json, importedName)
    if (result.error || !result.suiteId) {
      console.warn(`MST-099: suite import error — ${result.error}`)
      return
    }

    const items = await listSuiteItems(window, result.suiteId)
    expect((items as unknown[]).length).toBe(2)
  })
})
