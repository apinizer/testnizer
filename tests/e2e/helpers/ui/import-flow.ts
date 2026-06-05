import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { pressModShortcut } from './keyboard'

const FIXTURES = path.resolve(__dirname, '../../../fixtures/import-export')

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
  await expect(page.getByTestId('import-modal')).toBeHidden({ timeout: 30_000 })
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
  await expect(page.getByTestId('import-modal')).toBeHidden({ timeout: 60_000 })
}
