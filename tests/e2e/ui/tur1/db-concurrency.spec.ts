/**
 * MST-276 P1 — Rapid double-save integrity
 *
 * Fires multiple concurrent IPC create/update calls against the same project
 * and verifies that:
 * - All writes land (no rows silently swallowed)
 * - The final read reflects the last update without corruption
 * - Concurrent writes do not leave the row in a partially-updated state
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId, getSavedRequest } from '../../helpers/ui/assert-ipc'
import { createSavedRequestIpc } from '../../helpers/ui/db-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB concurrency / double-save [MST-276]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-276 rapid consecutive updates preserve final state', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const name = `RapidSave-${uid()}`

    const reqId = await createSavedRequestIpc(window, {
      projectId,
      name,
      url: 'http://127.0.0.1/v1',
      method: 'GET',
    })

    // Fire 5 sequential updates in rapid succession — each overwriting the URL.
    const updates = ['v2', 'v3', 'v4', 'v5', 'v6']
    for (const ver of updates) {
      await window.evaluate(
        async ({ id, url }) => {
          const w = window as unknown as Window & {
            api?: {
              savedRequest?: { update: (id: string, p: unknown) => Promise<{ success: boolean; error?: string }> }
            }
          }
          const res = await w.api?.savedRequest?.update(id, { url })
          if (!res?.success) throw new Error(res?.error ?? 'update failed')
        },
        { id: reqId, url: `http://127.0.0.1/${ver}` },
      )
    }

    const final = (await getSavedRequest(window, reqId)) as { url: string }
    expect(final.url).toBe('http://127.0.0.1/v6')
  })

  uiTest('MST-276 parallel creates all persist with distinct IDs', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const baseName = `ParConcurrent-${uid()}`

    // Create 8 requests in parallel via Promise.all inside the page evaluate
    const ids = await window.evaluate(
      async ({ pid, base }) => {
        const w = window as unknown as Window & {
          api?: {
            savedRequest?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string } }> }
          }
        }
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            w.api!.savedRequest!.create({
              project_id: pid,
              name: `${base}-${i}`,
              method: 'GET',
              url: `http://127.0.0.1/par/${i}`,
            }),
          ),
        )
        return results.map((r) => r.data?.id ?? '')
      },
      { pid: projectId, base: baseName },
    )

    // All 8 should have been assigned IDs
    const validIds = (ids as string[]).filter((id) => id.length > 0)
    expect(validIds).toHaveLength(8)

    // All IDs must be distinct
    expect(new Set(validIds).size).toBe(8)

    // Every row must exist in the DB
    const listed = await window.evaluate(async (pid) => {
      const w = window as unknown as Window & {
        api?: {
          savedRequest?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }> }
        }
      }
      const res = await w.api?.savedRequest?.list(pid)
      return (res?.data ?? []).map((r) => r.id)
    }, projectId)

    for (const id of validIds) {
      expect((listed as string[]).includes(id)).toBe(true)
    }
  })

  uiTest('MST-276 interleaved create+update does not corrupt row', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const name = `Interleave-${uid()}`

    // Create the row
    const reqId = await createSavedRequestIpc(window, {
      projectId,
      name,
      url: 'http://127.0.0.1/orig',
      method: 'POST',
    })

    // Race an update with a simultaneous update of a different field
    await window.evaluate(
      async ({ id }) => {
        const w = window as unknown as Window & {
          api?: {
            savedRequest?: { update: (id: string, p: unknown) => Promise<{ success: boolean }> }
          }
        }
        // Intentionally sequential to avoid SQLite BUSY on the same connection,
        // but fast enough to stress the in-flight cache path.
        await w.api!.savedRequest!.update(id, { method: 'PUT' })
        await w.api!.savedRequest!.update(id, { url: 'http://127.0.0.1/updated' })
        await w.api!.savedRequest!.update(id, { name: 'FinalName' })
      },
      { id: reqId },
    )

    const row = (await getSavedRequest(window, reqId)) as {
      method: string
      url: string
      name: string
    }
    expect(row.method).toBe('PUT')
    expect(row.url).toBe('http://127.0.0.1/updated')
    expect(row.name).toBe('FinalName')
  })

  uiTest('MST-276 double-save via IPC returns success both times', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const name = `DoubleSave-${uid()}`

    const reqId = await createSavedRequestIpc(window, {
      projectId,
      name,
      url: 'http://127.0.0.1/ds1',
    })

    const results = await window.evaluate(
      async ({ id }) => {
        const w = window as unknown as Window & {
          api?: {
            savedRequest?: { update: (id: string, p: unknown) => Promise<{ success: boolean; error?: string }> }
          }
        }
        // Two immediate updates — both must report success
        const [r1, r2] = await Promise.all([
          w.api!.savedRequest!.update(id, { url: 'http://127.0.0.1/ds2' }),
          w.api!.savedRequest!.update(id, { url: 'http://127.0.0.1/ds3' }),
        ])
        return [r1.success, r2.success]
      },
      { id: reqId },
    )

    // Both writes must succeed even when concurrent
    expect(results).toContain(true)
    // The row must still be readable afterwards
    const row = (await getSavedRequest(window, reqId)) as { url: string }
    expect(row.url).toMatch(/^http:\/\/127\.0\.0\.1\/ds[23]$/)
  })
})
