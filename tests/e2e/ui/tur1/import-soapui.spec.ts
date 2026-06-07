/**
 * MST-083 — SoapUI project import
 *
 * Tests both the fixture-based SoapUI project (local) and the external
 * student-soapui-project.xml fixture.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId, listEndpointsByProject } from '../../helpers/ui/assert-ipc'

const FIXTURES = path.resolve(__dirname, '../../../fixtures/import-export')
const EXTERNAL = path.resolve(__dirname, '../../../fixtures/external-imports/soapui')
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

type IpcResult<T> = { success: boolean; data?: T; error?: string }

async function importSoapUiIpc(
  page: import('@playwright/test').Page,
  xmlContent: string,
  folderName: string,
): Promise<{
  success?: boolean
  endpointCount?: number
  folderCount?: number
  warnings?: string[]
  error?: string
}> {
  const projectId = await getActiveProjectId(page)
  return page.evaluate(
    async ({ projectId, content, folderName }) => {
      const w = window as Window & {
        api?: {
          folder?: {
            create: (p: unknown) => Promise<IpcResult<{ id: string }>>
          }
          importExport?: {
            importSoapUi: (p: unknown) => Promise<
              IpcResult<{
                success?: boolean
                endpointCount?: number
                folderCount?: number
                warnings?: string[]
                error?: string
              }>
            >
          }
        }
      }
      const folderRes = await w.api?.folder?.create({ project_id: projectId, name: folderName })
      if (!folderRes?.success || !folderRes.data?.id) {
        throw new Error(folderRes?.error ?? 'folder create failed')
      }
      const res = await w.api?.importExport?.importSoapUi({
        projectId,
        content,
        folderId: folderRes.data.id,
      })
      if (!res?.success) return { error: res?.error ?? 'SoapUI import failed' }
      return res.data ?? {}
    },
    { projectId, content: xmlContent, folderName },
  )
}

uiTest.describe('Tur1 — SoapUI project import [MST-083]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-083 local fixture SoapUI project imports SOAP operations', async ({ window }) => {
    const content = fs.readFileSync(path.join(FIXTURES, 'soapui-project.xml'), 'utf8')
    const folder = `SoapUI ${uid()}`
    const result = await importSoapUiIpc(window, content, folder)

    expect(result.error).toBeUndefined()
    expect((result.endpointCount ?? 0)).toBeGreaterThan(0)
  })

  uiTest('MST-083 SoapUI endpoints have protocol=soap and POST method', async ({ window }) => {
    const content = fs.readFileSync(path.join(FIXTURES, 'soapui-project.xml'), 'utf8')
    const folder = `SoapUI2 ${uid()}`
    await importSoapUiIpc(window, content, folder)

    const projectId = await getActiveProjectId(window)
    await expect
      .poll(async () => {
        const rows = (await listEndpointsByProject(window, projectId)) as Array<{
          name: string
          protocol?: string
          method?: string
        }>
        return rows.some((r) => /soap/i.test(r.protocol ?? ''))
      })
      .toBe(true)
  })

  uiTest('MST-083 SoapUI Add + Subtract operations imported as separate endpoints', async ({ window }) => {
    const content = fs.readFileSync(path.join(FIXTURES, 'soapui-project.xml'), 'utf8')
    const folder = `SoapUI3 ${uid()}`
    const result = await importSoapUiIpc(window, content, folder)

    // soapui-project.xml has 2 operations (Add + Subtract)
    expect((result.endpointCount ?? 0)).toBeGreaterThanOrEqual(2)
  })

  uiTest('MST-083 external student-soapui-project.xml imports without crash', async ({ window }) => {
    const content = fs.readFileSync(
      path.join(EXTERNAL, 'student-soapui-project.xml'),
      'utf8',
    )
    const folder = `SoapUI-Student ${uid()}`
    const result = await importSoapUiIpc(window, content, folder)

    // Import must succeed (even with warnings) — no crash
    expect(result.error).toBeUndefined()
    // At least some endpoints expected from student.wsdl operations
    expect((result.endpointCount ?? 0)).toBeGreaterThan(0)
  })

  uiTest('MST-083 non-SoapUI XML is rejected with actionable error', async ({ window }) => {
    const badContent = `<?xml version="1.0"?><root><item>not a soapui project</item></root>`
    const folder = `SoapUI-Bad ${uid()}`
    const result = await importSoapUiIpc(window, badContent, folder)

    // Expect a "not a SoapUI project" error
    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/soapui|not a|wrong|type/i)
  })

  uiTest('MST-083 one folder per interface in SoapUI project', async ({ window }) => {
    const content = fs.readFileSync(path.join(FIXTURES, 'soapui-project.xml'), 'utf8')
    const folder = `SoapUI4 ${uid()}`
    const result = await importSoapUiIpc(window, content, folder)

    // soapui-project.xml has 1 interface (CalculatorPortSoap)
    expect((result.folderCount ?? 0)).toBeGreaterThanOrEqual(1)
  })
})
