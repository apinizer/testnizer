import { expect, type Page } from '@playwright/test'
import { fillMonaco } from './monaco'
import { kvAddRow, kvFillLastRow } from './keyvalue'
import { pressModShortcut } from './keyboard'

export async function fillUrl(page: Page, url: string): Promise<void> {
  await page.getByTestId('url-input').fill(url)
}

export async function setHttpMethod(page: Page, method: string): Promise<void> {
  await page.getByTestId('url-method').click()
  await page.getByTestId(`url-method-option-${method}`).click()
}

export async function clickRequestTab(page: Page, tab: string): Promise<void> {
  await page.getByTestId(`req-tab-${tab}`).click()
}

/** Seed post-response script via store-backed Insert example (Monaco-only edits may not sync). */
export async function seedPostScriptExample(page: Page): Promise<void> {
  await clickRequestTab(page, 'tests')
  const insert = page.getByRole('button', { name: /Insert example/i })
  if (await insert.isVisible().catch(() => false)) {
    await insert.click()
  }
}

export async function addPostScript(page: Page, script: string): Promise<void> {
  await clickRequestTab(page, 'scripts')
  await page.getByTestId('scripts-post').click()
  await page.getByRole('button', { name: /Insert example/i }).click()
  await fillMonaco(page, 'scripts-post-editor', script)
  await page.getByTestId('url-input').click()
  await page.waitForTimeout(200)
}

export async function addPreScript(page: Page, script: string): Promise<void> {
  await clickRequestTab(page, 'scripts')
  await page.getByTestId('scripts-pre').click()
  await page.getByTestId('scripts-insert-example').click()
  await fillMonaco(page, 'scripts-pre-editor', script)
  await page.getByTestId('url-input').click()
}

function lastAssertionBlock(page: Page) {
  return page.getByTestId('assertion-enable').last().locator('xpath=ancestor::div[contains(@class,"rounded")]').first()
}

export async function addVisualAssertion(
  page: Page,
  label: RegExp | string,
  config?: {
    expected?: string | number
    jsonPath?: string
    headerName?: string
  },
): Promise<void> {
  await clickRequestTab(page, 'tests')
  await page.getByTestId('tests-add-assertion').click()
  await page.getByRole('button', { name: label }).click()
  if (!config) return
  const block = lastAssertionBlock(page)
  if (config.jsonPath !== undefined) {
    await block.getByPlaceholder('$.data.items').fill(config.jsonPath)
  }
  if (config.headerName !== undefined) {
    await block.locator('input').first().fill(config.headerName)
  }
  if (config.expected !== undefined) {
    const inputs = block.locator('input[type="text"], input[type="number"]')
    await inputs.last().fill(String(config.expected))
  }
}

export async function addParam(page: Page, key: string, value: string): Promise<void> {
  await clickRequestTab(page, 'params')
  await kvAddRow(page)
  await kvFillLastRow(page, { key, value })
}

export async function addHeader(page: Page, key: string, value: string): Promise<void> {
  await clickRequestTab(page, 'headers')
  await kvAddRow(page)
  await kvFillLastRow(page, { key, value })
}

export async function sendAndWaitResponse(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.getByTestId('send-btn').click()
  await expect(page.getByText(/200|OK/i).first()).toBeVisible({ timeout: timeoutMs })
}

export interface TestResultsSummary {
  passed: number
  total: number
  allPassed: boolean
}

export async function readTestResults(page: Page): Promise<TestResultsSummary> {
  const tab = page.getByTestId('res-tab-testResults')
  const label = (await tab.textContent()) ?? ''
  const match = label.match(/(\d+)\/(\d+)/)
  if (!match) return { passed: 0, total: 0, allPassed: false }
  const passed = Number(match[1])
  const total = Number(match[2])
  return { passed, total, allPassed: passed === total && total > 0 }
}

export async function openTestResultsTab(page: Page): Promise<void> {
  await page.getByTestId('res-tab-testResults').click()
  await expect(page.getByTestId('test-results-panel')).toBeVisible({ timeout: 5_000 })
}

export async function expectTestResults(
  page: Page,
  expected: { passed: number; total: number },
): Promise<void> {
  const tab = page.getByTestId('res-tab-testResults')
  await expect(tab).toHaveText(new RegExp(`${expected.passed}\\s*/\\s*${expected.total}`), {
    timeout: 15_000,
  })
  await openTestResultsTab(page)
  const failed = page.getByText('FAILED')
  if (expected.passed < expected.total) {
    await expect(failed.first()).toBeVisible()
  } else {
    await expect(failed).toHaveCount(0)
    await expect(page.getByText('PASSED').first()).toBeVisible()
  }
}

/** Save active request to tree (opens modal on first save). */
export async function saveRequestToTree(page: Page, name: string): Promise<void> {
  await page.getByTestId('save-btn').click()
  const modal = page.getByTestId('endpoint-save-modal')
  await expect(modal).toBeVisible({ timeout: 8_000 })
  const nameInput = modal.locator('input').first()
  await nameInput.fill(name)
  await modal.getByRole('button', { name: /Save|Update/i }).click()
  await expect(modal).toBeHidden({ timeout: 20_000 })
}

export async function setBodyType(
  page: Page,
  type: 'none' | 'raw' | 'json' | 'urlencoded' | 'formdata' | 'xml',
  content?: string,
): Promise<void> {
  await clickRequestTab(page, 'body')
  if (type === 'none') {
    await page.getByTestId('body-type-none').click()
    return
  }
  if (type === 'urlencoded') {
    await page.getByTestId('body-type-urlencoded').click()
    return
  }
  if (type === 'formdata') {
    await page.getByTestId('body-type-form-data').click()
    return
  }
  await page.getByTestId('body-type-raw').click()
  if (type === 'json' || type === 'xml') {
    await page.getByTestId('body-raw-format').selectOption(type)
  }
  if (content !== undefined) {
    await fillMonaco(page, 'body-raw-editor', content)
    await page.getByTestId('url-input').click()
    await page.waitForTimeout(200)
  }
}

export async function setAuthBasic(page: Page, user: string, pass: string): Promise<void> {
  await clickRequestTab(page, 'auth')
  await page.getByTestId('auth-type-basic').click()
  await page.getByTestId('auth-basic-user').fill(user)
  await page.getByTestId('auth-basic-pass').fill(pass)
}

export async function setAuthBearer(page: Page, token: string): Promise<void> {
  await clickRequestTab(page, 'auth')
  await page.getByTestId('auth-type-bearer').click()
  await page.getByTestId('auth-bearer-token').fill(token)
}
