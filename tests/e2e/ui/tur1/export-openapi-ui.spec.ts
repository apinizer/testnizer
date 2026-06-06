/**
 * MST-094 — OpenAPI 3 export
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { exportOpenApiIpc } from '../../helpers/ui/export-flow'
import { importFixtureViaIpc } from '../../helpers/ui/import-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Export OpenAPI [MST-094]', () => {
  uiTest('MST-094 exportOpenApi returns openapi 3 document', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await importFixtureViaIpc(window, 'openapi', 'openapi-3.0.json', `OAS ${uid()}`)
    const projectId = await getActiveProjectId(window)
    const yamlOrJson = await exportOpenApiIpc(window, projectId)
    expect(yamlOrJson).toMatch(/openapi:\s*['"]?3|openapi.*3\.0|"openapi"\s*:\s*"3/i)
    expect(yamlOrJson).toMatch(/"paths"\s*:|paths:/i)
  })
})
