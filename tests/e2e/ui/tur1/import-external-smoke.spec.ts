/**
 * MST-089 — External real-world fixtures smoke import
 *
 * Imports top external Insomnia YAML fixtures and verifies no crash.
 * Skips files that have known unsupported content types.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'

const EXTERNAL_INSOMNIA = path.resolve(
  __dirname,
  '../../../fixtures/external-imports/insomnia',
)
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

type IpcResult<T> = { success: boolean; data?: T; error?: string }

async function importInsomniaSmoke(
  page: import('@playwright/test').Page,
  fileName: string,
): Promise<{ success?: boolean; endpointCount?: number; error?: string; warnings?: string[] }> {
  const content = fs.readFileSync(path.join(EXTERNAL_INSOMNIA, fileName), 'utf8')
  const projectId = await getActiveProjectId(page)
  return page.evaluate(
    async ({ projectId, content, folderName }) => {
      const w = window as Window & {
        api?: {
          folder?: {
            create: (p: unknown) => Promise<IpcResult<{ id: string }>>
          }
          importExport?: {
            importInsomnia: (p: unknown) => Promise<
              IpcResult<{
                success?: boolean
                endpointCount?: number
                warnings?: string[]
                error?: string
              }>
            >
          }
        }
      }
      const folderRes = await w.api?.folder?.create({ project_id: projectId, name: folderName })
      if (!folderRes?.success || !folderRes.data?.id) {
        return { error: folderRes?.error ?? 'folder create failed' }
      }
      const res = await w.api?.importExport?.importInsomnia({
        projectId,
        content,
        folderId: folderRes.data.id,
      })
      if (!res?.success) return { error: res?.error ?? 'import failed' }
      return res.data ?? {}
    },
    { projectId, content, folderName: `Ext-${fileName.replace(/\W/g, '-')}-${uid()}` },
  )
}

/** External Insomnia fixtures — subset of the most common/interesting */
const SMOKE_FIXTURES = [
  'apiops.yaml',
  'qa-test.yaml',
  'gRPC.yaml',
  'websocket.yaml',
  'sse.yaml',
] as const

uiTest.describe('Tur1 — External fixtures smoke [MST-089]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  for (const fixture of SMOKE_FIXTURES) {
    uiTest(`MST-089 ${fixture} imports without crash`, async ({ window }) => {
      const fixturePath = path.join(EXTERNAL_INSOMNIA, fixture)
      if (!fs.existsSync(fixturePath)) {
        console.warn(`MST-089: fixture missing — ${fixture}`)
        return
      }

      const result = await importInsomniaSmoke(window, fixture)

      // Must not throw — import may succeed with 0 endpoints or with warnings
      // (e.g. gRPC.yaml has protocol-specific nodes the HTTP importer may skip)
      // but it must not crash the app.
      expect(result.error ?? null).toBeNull()
    })
  }

  uiTest('MST-089 all smoke fixtures complete without app crash (aggregate)', async ({ window }) => {
    let failures = 0
    const errors: string[] = []

    for (const fixture of SMOKE_FIXTURES) {
      const fixturePath = path.join(EXTERNAL_INSOMNIA, fixture)
      if (!fs.existsSync(fixturePath)) continue

      try {
        const result = await importInsomniaSmoke(window, fixture)
        if (result.error) {
          failures++
          errors.push(`${fixture}: ${result.error}`)
        }
      } catch (e) {
        failures++
        errors.push(`${fixture}: ${(e as Error).message}`)
      }
    }

    if (failures > 0) {
      console.warn('MST-089 failures:', errors.join('\n'))
    }
    // At most 1 failure tolerated (e.g. one fixture has unusual schema)
    expect(failures).toBeLessThanOrEqual(1)
  })
})
