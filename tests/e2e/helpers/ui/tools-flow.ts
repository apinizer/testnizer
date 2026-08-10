import { expect, test, type Page } from '@playwright/test'
import { navigateSidebar } from './bootstrap'

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'

function workbench(page: Page) {
  return page.getByTestId('workbench')
}

export async function openTool(page: Page, toolName: string): Promise<void> {
  // Most utilities live on the Tools page; the security-section tools (JWT,
  // WS-Security, Password Generator, OTP) were partitioned onto the Security
  // page, so fall back there when the name isn't on the Tools list.
  await navigateSidebar(page, 'tools')
  let entry = page.getByText(toolName, { exact: false }).first()
  try {
    await entry.waitFor({ state: 'visible', timeout: 2_000 })
  } catch {
    await navigateSidebar(page, 'security')
    entry = page.getByText(toolName, { exact: false }).first()
    await entry.waitFor({ state: 'visible', timeout: 4_000 })
  }
  await entry.click()
  await expect(page.getByTestId('workbench')).toBeVisible({ timeout: 8_000 })
}

/**
 * The Workbench keeps EVERY open tool tab mounted and toggles visibility, so
 * `.monaco-editor` matches editors belonging to tools opened earlier in the
 * run — and `.nth(0)` then resolves to a HIDDEN one, where a click waits
 * forever. Scope every lookup to visible editors so "the first editor" means
 * the first editor of the tool currently on screen.
 */
function visibleMonaco(page: Page) {
  return page.locator('.monaco-editor:visible')
}

async function fillMonacoAt(page: Page, index: number, text: string): Promise<void> {
  const editor = visibleMonaco(page).nth(index)
  await editor.click()
  await page.keyboard.press(`${modKey}+KeyA`)
  await page.keyboard.insertText(text)
  await page.locator('body').click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(200)
}

/** Run a functional smoke assertion for each standalone tool. */
export async function assertToolFunctional(page: Page, toolName: string): Promise<void> {
  await openTool(page, toolName)
  // A bare "locator.click timed out" says nothing about WHICH tool broke when
  // this runs over the whole catalogue.
  await test.step(`tool: ${toolName}`, async () => {
    await assertToolBody(page, toolName)
  })
}

async function assertToolBody(page: Page, toolName: string): Promise<void> {
  switch (toolName) {
    case 'JWT Debugger': {
      await fillMonacoAt(page, 0, 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmbG93In0.')
      await expect(page.getByText(/flow|sub/i).first()).toBeVisible({ timeout: 8_000 })
      break
    }
    case 'JSON Formatter': {
      await fillMonacoAt(page, 0, '{"a":1}')
      await workbench(page).getByRole('button', { name: 'Format', exact: true }).click()
      await expect(visibleMonaco(page).nth(1)).toContainText(/"a"/, { timeout: 8_000 })
      break
    }
    case 'XML Formatter': {
      await fillMonacoAt(page, 0, '<root><item>x</item></root>')
      await workbench(page).getByRole('button', { name: 'Format', exact: true }).click()
      await expect(visibleMonaco(page).nth(1)).toContainText(/<item>/, { timeout: 8_000 })
      break
    }
    case 'Encode / Decode': {
      await fillMonacoAt(page, 0, 'hello')
      await workbench(page).getByRole('button', { name: 'Encode', exact: true }).click()
      await expect(visibleMonaco(page).nth(1)).toContainText('aGVsbG8=', { timeout: 8_000 })
      break
    }
    case 'Text Diff': {
      await fillMonacoAt(page, 0, 'alpha')
      await fillMonacoAt(page, 1, 'beta')
      await workbench(page).getByRole('button', { name: 'Compare', exact: true }).click()
      await expect(page.getByText(/alpha|beta|diff|changed/i).first()).toBeVisible({
        timeout: 8_000,
      })
      break
    }
    case 'JSON Schema Generator': {
      await expect(visibleMonaco(page).nth(1)).toContainText(/properties|type/i, {
        timeout: 8_000,
      })
      break
    }
    case 'JSONPath Evaluator': {
      await workbench(page).getByRole('button', { name: 'Evaluate', exact: true }).click()
      await expect(visibleMonaco(page).nth(1)).toContainText(/Nigel|Rees|Tolkien/i, {
        timeout: 8_000,
      })
      break
    }
    case 'XPath Evaluator': {
      await workbench(page).getByRole('button', { name: 'Evaluate', exact: true }).click()
      await expect(visibleMonaco(page).nth(1)).toContainText(/Everyday|title/i, {
        timeout: 8_000,
      })
      break
    }
    case 'JSON ↔ XML Converter': {
      await workbench(page).getByRole('button', { name: 'Transform', exact: true }).click()
      await expect(visibleMonaco(page).nth(1)).toContainText(/Envelope|authors/i, {
        timeout: 8_000,
      })
      break
    }
    case 'XSLT Evaluator': {
      await workbench(page).getByRole('button', { name: 'Transform', exact: true }).click()
      await expect(visibleMonaco(page).nth(2)).toContainText(/<|html|table/i, {
        timeout: 12_000,
      })
      break
    }
    case 'Jolt Evaluator': {
      await workbench(page).getByRole('button', { name: 'Transform', exact: true }).click()
      await expect(page.locator('.monaco-editor').last()).toContainText(/"|\{|\[/, {
        timeout: 8_000,
      })
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
      await expect(page.getByText(/UTC|GMT|epoch|timestamp/i).first()).toBeVisible({
        timeout: 8_000,
      })
      break
    }
    case 'HTTP Status Codes': {
      await page.locator('input[type="text"]:visible').first().fill('404')
      await expect(page.getByText(/404|Not Found/i).first()).toBeVisible({ timeout: 8_000 })
      break
    }
    case 'Base Converter': {
      await page.getByPlaceholder('72 101 108 108 111').fill('255')
      await expect(page.getByPlaceholder('48 65 6c 6c 6f')).toHaveValue(/FF/i, { timeout: 8_000 })
      break
    }
    case 'UUID Generator': {
      await workbench(page)
        .getByRole('button', { name: /Generate/i })
        .click()
      await expect(page.getByText(/[0-9a-f]{8}-[0-9a-f]{4}/i).first()).toBeVisible({
        timeout: 5_000,
      })
      break
    }
    case 'Regex Tester': {
      await page.locator('input[type="text"]:visible').first().fill('example.com')
      // Scope to the visible pane: an earlier tool's hidden DOM also carries
      // the word "example" (sample data), so an unscoped match can resolve to
      // a hidden node and never become visible.
      await expect(
        workbench(page)
          .getByText(/match|example/i)
          .locator('visible=true')
          .first(),
      ).toBeVisible({ timeout: 8_000 })
      break
    }
    case 'YAML ↔ JSON': {
      await expect(visibleMonaco(page).nth(1)).toContainText(/openapi|Pet store/i, {
        timeout: 8_000,
      })
      break
    }
    default:
      await expect(page.getByTestId('workbench')).toBeVisible()
  }
}
