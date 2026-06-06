import path from 'node:path'
import type { Page } from '@playwright/test'
import { setBodyType } from './request-flow'
import { kvAddRow, kvFillLastRow } from './keyvalue'

const UPLOAD_FIXTURES = path.resolve(__dirname, '../../../fixtures/upload')

/** Add a text field + file field to form-data body and attach a fixture file. */
export async function setFormDataWithFile(
  page: Page,
  opts: { textKey: string; textValue: string; fileKey: string; fileName: string },
): Promise<void> {
  await setBodyType(page, 'formdata')
  await kvAddRow(page)
  await kvFillLastRow(page, { key: opts.textKey, value: opts.textValue })
  await kvAddRow(page)
  const last = page.locator('[data-testid^="kv-row-"]').last()
  await last.getByTestId('kv-key').fill(opts.fileKey)
  await last.locator('select').selectOption('file')
  const filePath = path.join(UPLOAD_FIXTURES, opts.fileName)
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 })
  await last.getByRole('button', { name: /Choose file|Dosya seç/i }).click()
  const fc = await chooser
  await fc.setFiles(filePath)
}
