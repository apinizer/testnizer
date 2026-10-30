import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { pressModShortcut } from './keyboard'
import { getActiveProjectId } from './assert-ipc'

const FIXTURES = path.resolve(__dirname, '../../../fixtures/import-export')

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(FIXTURES, fileName), 'utf8')
}

export type FixtureImportFormat = 'postman' | 'insomnia' | 'har' | 'openapi' | 'wsdl'

/** Force tree reload after IPC-only mutations (import/save) that skip the UI store. */
export async function refreshWorkspaceTree(page: Page): Promise<void> {
  // Re-clicking the active project tab calls setActiveProject → buildTreeFromDB.
  // Multiple projects may be open (worker-scoped app) — target the active one.
  const tab = page.locator('[data-testid="header-project-tab"][data-active="true"]').first()
  if (await tab.isVisible().catch(() => false)) {
    await tab.click()
    await page.waitForTimeout(500)
  }
  if (!(await page.getByTestId('tree-search').isVisible().catch(() => false))) {
    await page.getByTestId('nav-apis').click().catch(() => {})
  }
  await page.getByTestId('tree-search').waitFor({ state: 'visible', timeout: 15_000 })
  // A stale search filter from an earlier test would hide freshly imported nodes.
  await page.getByTestId('tree-search').fill('')
}

/** Import collection/spec formats via IPC (native file dialog is unreliable in E2E). */
export async function importFixtureViaIpc(
  page: Page,
  format: FixtureImportFormat,
  fixtureFile: string,
  folderName: string,
): Promise<void> {
  const content = readFixture(fixtureFile)
  const projectId = await getActiveProjectId(page)
  await page.evaluate(
    async ({ format, content, folderName, projectId, fixtureFile }) => {
      const w = window as Window & {
        api?: {
          folder?: {
            create: (p: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }>
          }
          importExport?: {
            importOpenApi: (p: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
            importPostman: (p: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
            importInsomnia: (p: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
            importHar: (p: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
            importWsdl: (p: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
          }
        }
      }

      const folderRes = await w.api?.folder?.create({
        project_id: projectId,
        parent_id: null,
        name: folderName,
      })
      if (!folderRes?.success || !folderRes.data?.id) {
        throw new Error(folderRes?.error ?? 'folder create failed')
      }
      const folderId = folderRes.data.id

      let importResult:
        | { success: boolean; data?: { success?: boolean; error?: string }; error?: string }
        | undefined

      if (format === 'wsdl') {
        importResult = (await w.api?.importExport?.importWsdl({
          projectId,
          targetFolderId: folderId,
          createNewFolder: false,
          wsdlContent: content,
        })) as typeof importResult
      } else if (format === 'openapi') {
        importResult = (await w.api?.importExport?.importOpenApi({
          projectId,
          content,
          format: 'openapi',
          folderId,
          sourceUrl: `fixture://${fixtureFile}`,
        })) as typeof importResult
      } else if (format === 'postman') {
        importResult = (await w.api?.importExport?.importPostman({
          projectId,
          content,
          folderId,
        })) as typeof importResult
      } else if (format === 'insomnia') {
        importResult = (await w.api?.importExport?.importInsomnia({
          projectId,
          content,
          folderId,
        })) as typeof importResult
      } else {
        importResult = (await w.api?.importExport?.importHar({
          projectId,
          content,
          folderId,
        })) as typeof importResult
      }

      const inner = importResult?.data as { success?: boolean; error?: string } | undefined
      if (!importResult?.success || inner?.success === false) {
        throw new Error(inner?.error ?? importResult?.error ?? `${format} import failed`)
      }
    },
    { format, content, folderName, projectId, fixtureFile },
  )
  await refreshWorkspaceTree(page)
}

/** Open import wizard on step 2 with a format pre-selected (Import dropdown). */
export async function openImportDropdown(page: Page, formatName: RegExp | string): Promise<void> {
  await page.getByRole('button', { name: /Import API Data|API Verisi İçe Aktar/i }).click()
  await page.getByRole('button', { name: formatName }).click()
  await expect(page.getByTestId('import-modal')).toBeVisible({ timeout: 8_000 })
}

export async function openImportModal(page: Page): Promise<void> {
  await pressModShortcut(page, 'o')
  await expect(page.getByTestId('import-modal')).toBeVisible({ timeout: 8_000 })
}

/**
 * After clicking Import: the modal either closes, or (issue #276) shows the
 * result step listing what could not be imported as-is — then click Done.
 */
export async function finishImportWizard(page: Page, timeout = 60_000): Promise<void> {
  const modal = page.getByTestId('import-modal')
  const result = page.getByTestId('import-result')
  await expect(modal.or(result).first()).toBeVisible({ timeout: 5_000 }).catch(() => {})
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!(await modal.isVisible().catch(() => false))) return
    if (await result.isVisible().catch(() => false)) {
      await page.getByTestId('import-result-done').click()
      break
    }
    await page.waitForTimeout(150)
  }
  await expect(modal).toBeHidden({ timeout: Math.max(1_000, deadline - Date.now()) })
}

export async function selectImportFormat(page: Page, formatName: RegExp | string): Promise<void> {
  const modal = page.getByTestId('import-modal')
  await modal.getByRole('button', { name: formatName }).click()
  await modal.getByRole('button', { name: /Next/i }).click()
}

export async function importCurlCommand(page: Page, curl: string, folderName?: string): Promise<void> {
  await openImportDropdown(page, /^cURL$/i)
  const modal = page.getByTestId('import-modal')
  await modal.locator('textarea').first().fill(curl)
  await modal.getByRole('button', { name: /^Continue$/i }).click()
  if (folderName) {
    await modal.getByPlaceholder('Folder name').fill(folderName)
  }
  await modal.getByRole('button', { name: /^Import$/i }).click()
  await finishImportWizard(page, 30_000)
}

export async function importFromUrl(
  page: Page,
  formatName: RegExp | string,
  url: string,
  folderName?: string,
): Promise<void> {
  await openImportDropdown(page, formatName)
  const modal = page.getByTestId('import-modal')
  await modal.getByLabel('Import URL').fill(url)
  await modal.getByRole('button', { name: /^Next$/i }).click()
  await expect(modal.getByPlaceholder('Folder name')).toBeVisible({ timeout: 60_000 })
  if (folderName) {
    await modal.getByPlaceholder('Folder name').fill(folderName)
  }
  await modal.getByRole('button', { name: /^Import$/i }).click()
  await finishImportWizard(page)
}

export async function importFromFile(
  page: Page,
  formatName: RegExp | string,
  fileName: string,
  folderName?: string,
): Promise<void> {
  await openImportDropdown(page, formatName)
  const modal = page.getByTestId('import-modal')
  const filePath = path.join(FIXTURES, fileName)
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 })
  await modal.getByRole('button', { name: /Click to select a/i }).click()
  const fc = await chooser
  await fc.setFiles(filePath)
  await expect(modal.getByText(/Ready to import/i)).toBeVisible({ timeout: 15_000 })
  if (folderName) {
    await modal.getByPlaceholder('Folder name').fill(folderName)
  }
  await modal.getByRole('button', { name: /^Import$/i }).click()
  await finishImportWizard(page)
}
