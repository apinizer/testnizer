import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { openImportDropdown } from './import-flow'

const FIXTURES = path.resolve(__dirname, '../../../fixtures/import-export')

/** Stub the native file dialog so ImportModal reads fixture content via UI. */
export async function stubImportOpenFile(page: Page, fixtureFile: string): Promise<void> {
  const content = fs.readFileSync(path.join(FIXTURES, fixtureFile), 'utf8')
  const filePath = path.join(FIXTURES, fixtureFile)
  await page.evaluate(
    ({ content, filePath }) => {
      const w = window as Window & {
        api?: { importExport?: { openFile?: () => Promise<{ success: boolean; data?: { content: string; filePath: string } }> } }
      }
      if (!w.api?.importExport) throw new Error('importExport API missing')
      w.api.importExport.openFile = async () => ({ success: true, data: { content, filePath } })
    },
    { content, filePath },
  )
}

/** Walk the import wizard: pick file (stubbed) → folder name → Import. */
export async function importFixtureViaUiWizard(
  page: Page,
  formatName: RegExp | string,
  fixtureFile: string,
  folderName: string,
): Promise<void> {
  await stubImportOpenFile(page, fixtureFile)
  await openImportDropdown(page, formatName)
  const modal = page.getByTestId('import-modal')
  await modal.getByRole('button', { name: /Click to select a/i }).click()
  await expect(modal.getByText(/Ready to import|typeMismatch|mismatch|error/i).first()).toBeVisible({
    timeout: 15_000,
  })
  const mismatch = modal.getByText(/mismatch|environment|not a collection/i)
  if (await mismatch.isVisible().catch(() => false)) return
  await modal.getByPlaceholder('Folder name').fill(folderName)
  await modal.getByRole('button', { name: /^Import$/i }).click()
  await expect(modal).toBeHidden({ timeout: 60_000 })
}
