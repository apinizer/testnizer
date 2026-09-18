/**
 * Issue #124 follow-up — an ENDPOINT-type SOAP row (imported / API-tree
 * endpoint, not a saved request) in Manual mode must reopen from the tree
 * with its manual fields. The TreeView endpoint path used to skip metadata.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  E2E_PROJECT_NAME,
} from '../../helpers/ui/bootstrap'
import { openProject } from '../../helpers/ui/workspace-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { treeClearSearch, treeOpenNode } from '../../helpers/ui/tree'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — SOAP endpoint manual restore [issue #124]', () => {
  uiTest(
    'endpoint row with metadata.soap (manual) reopens on the Manual form with its values',
    async ({ window }) => {
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      await closeAllTabs(window)
      const projectId = await getActiveProjectId(window)
      const name = `soap-ep-${uid()}`
      const url = 'https://svc.example.test/Calc'
      const schema = {
        url,
        method: 'POST',
        headers: [],
        body: {
          type: 'xml',
          content: '<soap:Envelope><soap:Body><tns:Add/></soap:Body></soap:Envelope>',
        },
        auth: { type: 'none' },
        metadata: {
          soap: {
            mode: 'manual',
            endpointUrl: url,
            rawXml: '<soap:Envelope><soap:Body><tns:Add/></soap:Body></soap:Envelope>',
            manualSoapAction: 'urn:Add',
            manualSoapVersion: 'soap12',
            manualOperationName: 'Add',
            manualOperationNamespace: 'http://svc.example.test/calc',
            wsdlUrl: '',
            selectedService: null,
            selectedPort: null,
            selectedOperation: null,
            bodyMode: 'raw',
          },
        },
      }
      await window.evaluate(
        async ({ pid, name, url, schema }) => {
          const w = window as unknown as Window & {
            api?: {
              endpoint?: { create: (p: unknown) => Promise<{ success: boolean; error?: string }> }
            }
          }
          const r = await w.api!.endpoint!.create({
            project_id: pid,
            name,
            protocol: 'soap',
            method: 'POST',
            path: url,
            request_schema: JSON.stringify(schema),
          })
          if (!r.success) throw new Error(r.error)
        },
        { pid: projectId, name, url, schema },
      )
      // The tree is built from the DB on project activation — leave and re-enter
      // the project so the row inserted via IPC shows up.
      await window.getByTestId('header-home').click()
      await openProject(window, E2E_PROJECT_NAME)
      await treeOpenNode(window, name)
      try {
        await expect(window.getByTestId('soap-manual-url')).toBeVisible({ timeout: 10_000 })
        await expect(window.getByTestId('soap-manual-url')).toHaveValue(url)
        await expect(window.getByPlaceholder(/urn:Echo/i)).toHaveValue('urn:Add')
        await expect(window.getByPlaceholder(/^Echo$/)).toHaveValue('Add')
        await expect(window.getByPlaceholder('http://example.com/echo')).toHaveValue(
          'http://svc.example.test/calc',
        )
        await expect(
          window
            .locator('select')
            .filter({ hasText: /SOAP 1\.1/i })
            .first(),
        ).toHaveValue('soap12')
      } finally {
        await treeClearSearch(window)
      }
    },
  )
})
