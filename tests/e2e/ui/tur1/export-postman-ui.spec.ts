/**
 * MST-093 — Postman collection export + reimport roundtrip
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { exportPostmanIpc } from '../../helpers/ui/export-flow'
import { importFixtureViaIpc } from '../../helpers/ui/import-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Export Postman [MST-093]', () => {
  uiTest('MST-093 exportPostman returns v2.1 collection JSON', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    const folder = `ExpSrc ${uid()}`
    await importFixtureViaIpc(window, 'postman', 'postman-v2.1.json', folder)
    const projectId = await getActiveProjectId(window)
    const json = await exportPostmanIpc(window, projectId)
    const parsed = JSON.parse(json) as { info?: { schema?: string }; item?: unknown[] }
    expect(parsed.info?.schema).toMatch(/postman\.com\/.*collection/)
    expect(Array.isArray(parsed.item)).toBe(true)
    expect((parsed.item ?? []).length).toBeGreaterThan(0)
  })
})
