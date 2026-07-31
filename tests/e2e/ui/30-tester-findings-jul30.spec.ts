/**
 * The two findings reported against 1.5.0-rc2 on 30 July, walked exactly as the
 * tester walked them.
 *
 *   1. Project settings → Overview → Description → Save Changes ("saved"
 *      appeared) → close → reopen → the value was gone. The box was rendered,
 *      bound and edited, and then left out of the update payload.
 *
 *   2. Right-click a folder → Create Test Suite from this folder. Requests
 *      using `{{baseUrl}}/employee` arrived in the suite as `/employee` — the
 *      variable neither preserved nor resolved, so nothing in the new suite ran
 *      without being edited first.
 *
 * Both have unit coverage; these exist because both bugs were about a value
 * surviving a round trip through the UI, which is the part a unit test stubs.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar } from '../helpers/ui/bootstrap'
import { getActiveProjectId, listSuiteItems, findSuiteIdByName } from '../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('tester findings, 30 July (1.5.0-rc2)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  uiTest('Description survives Save Changes and a reopen', async ({ window }) => {
    const value = `rc2-test ${uid()}`

    await window.getByTestId('nav-settings').click()
    await expect(window.getByTestId('project-detail-modal')).toBeVisible({ timeout: 8_000 })
    await window.getByTestId('project-detail-tab-overview').click()

    // The Description box is the only textarea on the Overview pane.
    const modal = window.getByTestId('project-detail-modal')
    const description = modal.locator('textarea').first()
    await description.fill(value)

    await modal.getByRole('button', { name: /Save Changes|Değişiklikleri Kaydet/i }).click()
    await expect(window.getByTestId('project-detail-modal')).toBeHidden({ timeout: 8_000 })

    // Reopen — this is where the tester found it empty.
    await window.getByTestId('nav-settings').click()
    await expect(window.getByTestId('project-detail-modal')).toBeVisible({ timeout: 8_000 })
    await window.getByTestId('project-detail-tab-overview').click()

    await expect(
      window.getByTestId('project-detail-modal').locator('textarea').first(),
    ).toHaveValue(value)

    await window.keyboard.press('Escape')
  })

  uiTest('a suite built from a folder keeps {{baseUrl}} in its URLs', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    const projectId = await getActiveProjectId(window)
    const suiteName = `BaseUrl Suite ${uid()}`
    const url = '{{baseUrl}}/employee'

    /*
     * Seed an ENDPOINT, not a saved request.
     *
     * That distinction is the whole bug. Importers split a request's address —
     * `endpoints.path` keeps the path alone, `request_schema.url` keeps the full
     * thing including the `{{variable}}` prefix — and only the endpoint branch
     * of `snapshotEndpointForSuite` read the wrong one. Seeding a saved request
     * here exercises a branch that was never broken, so the test passed with the
     * fix reverted: a lock that locks nothing.
     */
    const folderId = await window.evaluate(
      async ([pid, fullUrl]) => {
        const api = (window as unknown as { api: Record<string, any> }).api
        const folder = await api.folder.create({ project_id: pid, name: `Employees ${Date.now()}` })
        await api.endpoint.create({
          project_id: pid,
          folder_id: folder.data.id,
          name: 'Get employee',
          protocol: 'http',
          method: 'GET',
          // Exactly what a Postman import writes.
          path: '/employee',
          request_schema: JSON.stringify({ method: 'GET', url: fullUrl }),
        })
        return folder.data.id as string
      },
      [projectId, url] as const,
    )
    expect(folderId).toBeTruthy()

    // Build the suite through the IPC the context-menu action uses.
    await window.evaluate(
      async ([pid, name, fid]) => {
        const api = (window as unknown as { api: Record<string, any> }).api
        const suite = await api.testSuite.create({ project_id: pid, name })
        const eps = await api.endpoint.listByProject(pid)
        const ids = (eps.data ?? [])
          .filter((e: { folder_id?: string }) => e.folder_id === fid)
          .map((e: { id: string }) => e.id)
        await api.testSuite.importEndpoints({ suite_id: suite.data.id, endpoint_ids: ids })
      },
      [projectId, suiteName, folderId] as const,
    )

    const suiteId = await findSuiteIdByName(window, projectId, suiteName)
    const items = await listSuiteItems(window, suiteId)

    expect(items.length).toBeGreaterThan(0)
    // The bug: this was '/employee' — the variable silently dropped.
    expect(items[0].url).toBe(url)
  })
})
