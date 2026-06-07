/**
 * MST-310 — Insomnia collection export (IPC layer).
 *
 * Parity with `export-postman-ui.spec.ts` (MST-093): import a collection into a
 * uniquely-named folder so the project has endpoints, then call the real
 * `export:insomnia` IPC and assert the returned JSON is in Insomnia v4 export
 * format and carries the imported content (the unique folder surfaces as a
 * `request_group` resource; the requests surface as `request` resources).
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { exportInsomniaIpc } from '../../helpers/ui/export-flow'
import { importFixtureViaIpc } from '../../helpers/ui/import-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

interface InsomniaResource {
  _id: string
  _type: string
  name?: string
}

interface InsomniaExport {
  _type?: string
  __export_format?: number
  __export_source?: string
  resources?: InsomniaResource[]
}

uiTest.describe('Tur1 — Export Insomnia [MST-310]', () => {
  uiTest('MST-310 exportInsomnia returns v4 export JSON containing the project endpoints', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')

    const folder = `InsoExp ${uid()}`
    await importFixtureViaIpc(window, 'postman', 'postman-v2.1.json', folder)

    const projectId = await getActiveProjectId(window)
    const json = await exportInsomniaIpc(window, projectId)
    const parsed = JSON.parse(json) as InsomniaExport

    // Insomnia v4 export envelope.
    expect(parsed._type).toBe('export')
    expect(parsed.__export_format).toBe(4)
    expect(parsed.__export_source).toBe('testnizer')
    expect(Array.isArray(parsed.resources)).toBe(true)

    const resources = parsed.resources ?? []
    // Workspace root + at least one request must be present.
    expect(resources.some((r) => r._type === 'workspace')).toBe(true)
    expect(resources.filter((r) => r._type === 'request').length).toBeGreaterThan(0)

    // The uniquely-named import folder rides through as a request_group, proving
    // this export reflects *this* test's imported content (parallel-safe).
    expect(
      resources.some((r) => r._type === 'request_group' && r.name === folder),
    ).toBe(true)
  })
})
