import { expect, type Page } from '@playwright/test'
import { navigateSidebar } from './bootstrap'

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'

function workbench(page: Page) {
  return page.getByTestId('workbench')
}

export async function openTool(page: Page, toolName: string): Promise<void> {
  await navigateSidebar(page, 'tools')
  await page.getByText(toolName, { exact: false }).click()
  await expect(page.getByTestId('workbench')).toBeVisible({ timeout: 8_000 })
}

async function fillMonacoAt(page: Page, index: number, text: string): Promise<void> {
  const editor = page.locator('.monaco-editor').nth(index)
  await editor.click()
  await page.keyboard.press(`${modKey}+KeyA`)
  await page.keyboard.insertText(text)
  await page.locator('body').click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(200)
}

/** Run a functional smoke assertion for each standalone tool. */
export async function assertToolFunctional(page: Page, toolName: string): Promise<void> {
  await openTool(page, toolName)

  switch (toolName) {
    case 'JWT Debugger': {
      await fillMonacoAt(page, 0, 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmbG93In0.')
      await expect(page.getByText(/flow|sub/i).first()).toBeVisible({ timeout: 8_000 })
      break
    }
    case 'JSON Formatter': {
      await fillMonacoAt(page, 0, '{"a":1}')
      await workbench(page).getByRole('button', { name: 'Format', exact: true }).click()
      await expect(page.locator('.monaco-editor').nth(1)).toContainText(/"a"/, { timeout: 8_000 })
      break
    }
    case 'XML Formatter': {
      await fillMonacoAt(page, 0, '<root><item>x</item></root>')
      await workbench(page).getByRole('button', { name: 'Format', exact: true }).click()
      await expect(page.locator('.monaco-editor').nth(1)).toContainText(/<item>/, { timeout: 8_000 })
      break
    }
    case 'Encode / Decode': {
      await fillMonacoAt(page, 0, 'hello')
      await workbench(page).getByRole('button', { name: 'Encode', exact: true }).click()
      await expect(page.locator('.monaco-editor').nth(1)).toContainText('aGVsbG8=', { timeout: 8_000 })
      break
    }
    case 'Text Diff': {
      await fillMonacoAt(page, 0, 'alpha')
      await fillMonacoAt(page, 1, 'beta')
      await workbench(page).getByRole('button', { name: 'Compare', exact: true }).click()
      await expect(page.getByText(/alpha|beta|diff|changed/i).first()).toBeVisible({ timeout: 8_000 })
      break
    }
    case 'JSON Schema Generator': {
      await expect(page.locator('.monaco-editor').nth(1)).toContainText(/properties|type/i, {
        timeout: 8_000,
      })
      break
    }
    case 'JSONPath Evaluator': {
      await workbench(page).getByRole('button', { name: 'Evaluate', exact: true }).click()
      await expect(page.locator('.monaco-editor').nth(1)).toContainText(/Nigel|Rees|Tolkien/i, {
        timeout: 8_000,
      })
      break
    }
    case 'XPath Evaluator': {
      await workbench(page).getByRole('button', { name: 'Evaluate', exact: true }).click()
      await expect(page.locator('.monaco-editor').nth(1)).toContainText(/Everyday|title/i, {
        timeout: 8_000,
      })
      break
    }
    case 'JSON ↔ XML Converter': {
      await workbench(page).getByRole('button', { name: 'Transform', exact: true }).click()
      await expect(page.locator('.monaco-editor').nth(1)).toContainText(/Envelope|authors/i, {
        timeout: 8_000,
      })
      break
    }
    case 'XSLT Evaluator': {
      await workbench(page).getByRole('button', { name: 'Transform', exact: true }).click()
      await expect(page.locator('.monaco-editor').nth(2)).toContainText(/<|html|table/i, {
        timeout: 12_000,
      })
      break
    }
    case 'Jolt Evaluator': {
      await workbench(page).getByRole('button', { name: 'Transform', exact: true }).click()
      await expect(page.locator('.monaco-editor').last()).toContainText(/"|\{|\[/, { timeout: 8_000 })
      break
    }
    case 'WS-Security': {
      await expect(page.getByText(/WS-Security|Username|Password/i).first()).toBeVisible({
        timeout: 8_000,
      })
      break
    }
    case 'Hash Calculator': {
      await fillMonacoAt(page, 0, 'flow-test')
      await expect(page.getByText(/SHA-256|MD5/i).first()).toBeVisible({ timeout: 8_000 })
      break
    }
    case 'HMAC Generator': {
      await fillMonacoAt(page, 0, 'message')
      await page.getByPlaceholder('secret key').fill('secret')
      await expect(page.getByText(/SHA-256|HMAC/i).first()).toBeVisible({ timeout: 8_000 })
      break
    }
    case 'Epoch Converter': {
      await expect(page.getByText(/UTC|GMT|epoch|timestamp/i).first()).toBeVisible({ timeout: 8_000 })
      break
    }
    case 'HTTP Status Codes': {
      await page.locator('input[type="text"]').first().fill('404')
      await expect(page.getByText(/404|Not Found/i).first()).toBeVisible({ timeout: 8_000 })
      break
    }
    case 'Base Converter': {
      await page.getByPlaceholder('72 101 108 108 111').fill('255')
      await expect(page.getByPlaceholder('48 65 6c 6c 6f')).toHaveValue(/FF/i, { timeout: 8_000 })
      break
    }
    case 'UUID Generator': {
      await workbench(page).getByRole('button', { name: /Generate/i }).click()
      await expect(page.getByText(/[0-9a-f]{8}-[0-9a-f]{4}/i).first()).toBeVisible({ timeout: 5_000 })
      break
    }
    case 'Regex Tester': {
      await page.locator('input[type="text"]').first().fill('example.com')
      await expect(page.getByText(/match|example/i).first()).toBeVisible({ timeout: 8_000 })
      break
    }
    case 'YAML ↔ JSON': {
      await expect(page.locator('.monaco-editor').nth(1)).toContainText(/openapi|Pet store/i, {
        timeout: 8_000,
      })
      break
    }
    default:
      await expect(page.getByTestId('workbench')).toBeVisible()
  }
}
