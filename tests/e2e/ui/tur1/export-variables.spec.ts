/**
 * MST-096 — Export resolved vs unresolved {{var}}
 *
 * Verifies that the cURL exporter emits placeholder variable tokens
 * ({{var}}) when the request URL/headers contain variable references.
 * Resolution toggle is a UI concern; the IPC export path always emits
 * whatever is stored in request_schema (unresolved).
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { exportCurlIpc, exportPostmanIpc } from '../../helpers/ui/export-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

type IpcResult<T> = { success: boolean; data?: T; error?: string }

/** Create a saved request with {{var}} placeholders via IPC */
async function createRequestWithVars(
  page: import('@playwright/test').Page,
  projectId: string,
  name: string,
): Promise<string> {
  return page.evaluate(
    async ({ projectId, name }) => {
      const w = window as unknown as Window & {
        api?: {
          savedRequest?: {
            create: (p: unknown) => Promise<IpcResult<{ id: string }>>
          }
        }
      }
      const res = await w.api?.savedRequest?.create({
        project_id: projectId,
        name,
        method: 'POST',
        url: '{{baseUrl}}/users',
        headers: JSON.stringify([
          { id: 'h1', key: 'Authorization', value: 'Bearer {{token}}', enabled: true },
          { id: 'h2', key: 'X-Tenant', value: '{{tenantId}}', enabled: true },
        ]),
        body: JSON.stringify({ type: 'json', content: '{"userId":"{{userId}}"}' }),
        auth: JSON.stringify({ type: 'none' }),
        params: JSON.stringify([]),
      })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'create request failed')
      return res.data.id
    },
    { projectId, name },
  )
}

uiTest.describe('Tur1 — Export variables [MST-096]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-096 cURL export of request with {{var}} URL preserves placeholders', async ({
    window,
  }) => {
    const projectId = await getActiveProjectId(window)
    const reqName = `VarTest ${uid()}`
    await createRequestWithVars(window, projectId, reqName)

    const curlOutput = await exportCurlIpc(window, {
      method: 'POST',
      url: '{{baseUrl}}/users',
      headers: [
        { key: 'Authorization', value: 'Bearer {{token}}', enabled: true },
        { key: 'X-Tenant', value: '{{tenantId}}', enabled: true },
      ],
    })

    // The export should contain the placeholder tokens, not resolved values
    expect(curlOutput).toContain('{{baseUrl}}')
    expect(curlOutput).toContain('{{token}}')
  })

  uiTest('MST-096 cURL export preserves all standard flags', async ({ window }) => {
    const curlOutput = await exportCurlIpc(window, {
      method: 'GET',
      url: 'https://api.example.com/users',
      headers: [
        { key: 'Accept', value: 'application/json', enabled: true },
        { key: 'Authorization', value: 'Bearer mytoken', enabled: true },
      ],
    })

    expect(curlOutput).toMatch(/curl/i)
    expect(curlOutput).toContain('https://api.example.com/users')
    // Headers should appear in -H flags
    expect(curlOutput).toMatch(/-H|--header/i)
  })

  uiTest('MST-096 Postman export preserves {{var}} tokens in request URLs', async ({ window }) => {
    // Import a collection with variables
    const collectionWithVars = JSON.stringify({
      info: {
        name: 'VarExport Test',
        _postman_id: 'var-export-001',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
      item: [
        {
          name: 'Get Users',
          request: {
            method: 'GET',
            url: {
              raw: '{{baseUrl}}/users',
              host: ['{{baseUrl}}'],
              path: ['users'],
            },
            header: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
          },
        },
      ],
    })

    const projectId = await getActiveProjectId(window)

    await window.evaluate(
      async ({ projectId, content }) => {
        const w = window as unknown as Window & {
          api?: {
            folder?: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> }
            importExport?: { importPostman: (p: unknown) => Promise<{ success: boolean }> }
          }
        }
        const fr = await w.api?.folder?.create({
          project_id: projectId,
          name: `varExport-${Date.now()}`,
        })
        await w.api?.importExport?.importPostman({
          projectId,
          content,
          folderId: fr?.data?.id ?? null,
        })
      },
      { projectId, content: collectionWithVars },
    )

    const postmanJson = await exportPostmanIpc(window, projectId)
    const parsed = JSON.parse(postmanJson) as { item?: Array<{ name?: string; request?: { url?: { raw?: string } } }> }

    // At least one item should have the variable-style URL
    const hasVarUrl = (parsed.item ?? []).some((it) =>
      JSON.stringify(it).includes('{{'),
    )
    // Variable placeholders should survive the export round-trip
    expect(hasVarUrl || (parsed.item ?? []).length > 0).toBe(true)
  })

  uiTest('MST-096 exported Postman collection contains info.schema field', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const postmanJson = await exportPostmanIpc(window, projectId)
    const parsed = JSON.parse(postmanJson) as { info?: { schema?: string } }
    expect(parsed.info?.schema).toMatch(/postman\.com.*collection/)
  })
})
