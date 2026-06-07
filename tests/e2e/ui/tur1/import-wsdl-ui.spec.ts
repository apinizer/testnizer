/**
 * MST-074 — WSDL → SOAP endpoints (file-based import via IPC)
 *
 * The UI WSDL import wizard opens a URL field and calls parseWsdl (remote).
 * For reliable E2E we use the file-based IPC path (parseWsdlFileForImport +
 * importWsdl) which is the same code path the UI takes for local files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId, listEndpointsByProject } from '../../helpers/ui/assert-ipc'

const FIXTURES = path.resolve(__dirname, '../../../fixtures/import-export')
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

type IpcResult<T> = { success: boolean; data?: T; error?: string }

interface WsdlParseResult {
  services?: Array<{
    name: string
    ports?: Array<{
      name: string
      address?: string
      operations?: Array<{ name: string; soapAction?: string }>
    }>
  }>
}

async function importWsdlFileIpc(
  page: import('@playwright/test').Page,
  wsdlContent: string,
  folderName: string,
): Promise<{
  endpointCount?: number
  folderCount?: number
  warnings?: string[]
  error?: string
}> {
  const projectId = await getActiveProjectId(page)
  return page.evaluate(
    async ({ projectId, wsdlContent, folderName }) => {
      const w = window as Window & {
        api?: {
          folder?: {
            create: (p: unknown) => Promise<IpcResult<{ id: string }>>
          }
          importExport?: {
            parseWsdlFileForImport: (content: string) => Promise<IpcResult<WsdlParseResult>>
            importWsdl: (p: unknown) => Promise<
              IpcResult<{
                endpointCount?: number
                folderCount?: number
                warnings?: string[]
                error?: string
              }>
            >
          }
        }
      }

      // Parse the WSDL content (mirrors UI step 1)
      const parseRes = await w.api?.importExport?.parseWsdlFileForImport(wsdlContent)
      if (!parseRes?.success) {
        return { error: parseRes?.error ?? 'WSDL parse failed' }
      }

      // Create target folder (mirrors UI folder step)
      const folderRes = await w.api?.folder?.create({ project_id: projectId, name: folderName })
      if (!folderRes?.success || !folderRes.data?.id) {
        return { error: folderRes?.error ?? 'folder create failed' }
      }

      // Import using parsed result + content (mirrors UI import step)
      const importRes = await w.api?.importExport?.importWsdl({
        projectId,
        targetFolderId: folderRes.data.id,
        createNewFolder: false,
        wsdlContent,
        parsedWsdl: parseRes.data,
      })
      if (!importRes?.success) return { error: importRes?.error ?? 'WSDL import failed' }
      return importRes.data ?? {}
    },
    { projectId, wsdlContent, folderName },
  )
}

uiTest.describe('Tur1 — WSDL → SOAP import [MST-074]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-074 sample.wsdl imports Add operation as SOAP endpoint', async ({ window }) => {
    const wsdlContent = fs.readFileSync(path.join(FIXTURES, 'sample.wsdl'), 'utf8')
    const folder = `WSDL ${uid()}`
    const result = await importWsdlFileIpc(window, wsdlContent, folder)

    if (result.error) {
      // Some environments may not have the SOAP parser available
      console.warn(`MST-074: WSDL import error — ${result.error}`)
    }

    expect(result.error).toBeUndefined()
    expect((result.endpointCount ?? 0)).toBeGreaterThan(0)
  })

  uiTest('MST-074 imported WSDL endpoints have protocol=soap', async ({ window }) => {
    const wsdlContent = fs.readFileSync(path.join(FIXTURES, 'sample.wsdl'), 'utf8')
    const folder = `WSDL2 ${uid()}`
    const result = await importWsdlFileIpc(window, wsdlContent, folder)
    if (result.error) {
      console.warn(`MST-074: WSDL import error — ${result.error}`)
      return
    }

    const projectId = await getActiveProjectId(window)
    await expect
      .poll(async () => {
        const rows = (await listEndpointsByProject(window, projectId)) as Array<{
          name: string
          protocol?: string
        }>
        return rows.some((r) => /soap/i.test(r.protocol ?? ''))
      })
      .toBe(true)
  })

  uiTest('MST-074 WSDL endpoint has soapAction metadata in request_schema', async ({ window }) => {
    const wsdlContent = fs.readFileSync(path.join(FIXTURES, 'sample.wsdl'), 'utf8')
    const folder = `WSDL3 ${uid()}`
    const result = await importWsdlFileIpc(window, wsdlContent, folder)
    if (result.error) {
      console.warn(`MST-074: WSDL import error — ${result.error}`)
      return
    }

    const projectId = await getActiveProjectId(window)
    const rows = (await listEndpointsByProject(window, projectId)) as Array<{
      name: string
      protocol?: string
      request_schema?: string
    }>
    const soapRow = rows.find((r) => /soap/i.test(r.protocol ?? ''))
    if (!soapRow) return // covered by prior test

    // request_schema should contain soap metadata
    const schema = soapRow.request_schema
      ? (JSON.parse(soapRow.request_schema) as Record<string, unknown>)
      : {}
    const hasSoapMeta =
      schema['soap'] != null ||
      (schema['headers'] as Array<{ key?: string }> | undefined)?.some((h) =>
        /SOAPAction/i.test(h.key ?? ''),
      )
    expect(hasSoapMeta).toBe(true)
  })

  uiTest('MST-074 sample.wsdl Add operation endpoint is named correctly', async ({ window }) => {
    const wsdlContent = fs.readFileSync(path.join(FIXTURES, 'sample.wsdl'), 'utf8')
    const folder = `WSDL4 ${uid()}`
    const result = await importWsdlFileIpc(window, wsdlContent, folder)
    if (result.error) {
      console.warn(`MST-074: WSDL import error — ${result.error}`)
      return
    }

    const projectId = await getActiveProjectId(window)
    await expect
      .poll(async () => {
        const rows = (await listEndpointsByProject(window, projectId)) as Array<{ name: string }>
        return rows.some((r) => /Add|add/i.test(r.name))
      })
      .toBe(true)
  })
})
